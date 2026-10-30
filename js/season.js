/* global DraftCore, SeasonCore, Sleeper */
(function () {
  'use strict';

  var C = DraftCore;
  var S = SeasonCore;
  var $ = function (id) { return document.getElementById(id); };
  var ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
  var LS_DRAFT = 'fbd.config.v1';
  var LS_SEASON = 'fbd.season.v1';
  var CONS = window.CONSENSUS || { players: [] };

  var draftCfg = load(LS_DRAFT) || {};
  var cfg = Object.assign({ leagueId: draftCfg.leagueId || '1414370391324950528', myRosterId: null, partnerRosterId: null }, load(LS_SEASON) || {});

  var st = null;      // loaded league + live data
  var view = { faPos: 'ALL', faHealthy: true };

  /* ---------------- utils ---------------- */

  function load(key) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem(LS_SEASON, JSON.stringify(cfg)); } catch (e) { /* private mode */ } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n, d) { return n == null || !isFinite(n) ? '–' : Number(n).toFixed(d == null ? 1 : d); }
  function setStatus(html, cls) { $('status').innerHTML = html ? '<span class="' + (cls || '') + '">' + html + '</span>' : ''; }
  function getJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status + ' from ' + url); return r.json(); });
  }
  function dayLabel(iso) {
    return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric' });
  }

  /* ---------------- loading ---------------- */

  function loadAll() {
    setStatus('Loading league, rosters, stats, injuries and this week\'s games…');
    // ?date=YYYY-MM-DD views another week (handy for checking past weeks).
    var forced = (location.search.match(/[?&]date=(\d{4}-\d{2}-\d{2})/) || [])[1];
    var today = forced || S.easternDate(new Date());
    var dates = S.weekDates(today);
    var out = { today: today, dates: dates };
    return Promise.all([
      Sleeper.league(cfg.leagueId),
      Sleeper.rosters(cfg.leagueId),
      Sleeper.state(),
      Sleeper.players(false, 6 * 3600 * 1000).catch(function () { return {}; }),
      getJson(ESPN + '/injuries').catch(function () { return { injuries: [] }; }),
      Promise.all(dates.map(function (d) {
        return getJson(ESPN + '/scoreboard?dates=' + d.replace(/-/g, '')).catch(function () { return { events: [] }; });
      }))
    ]).then(function (r) {
      out.league = r[0].league;
      out.users = r[0].users;
      out.rosters = r[1];
      out.state = r[2];
      out.players = r[3];
      out.espnInj = parseInjuries(r[4]);
      out.games = parseGames(r[5]);
      out.week = parseInt(out.state.week, 10) || 1;
      return Promise.all([
        Sleeper.stats(out.league.season).then(function (x) { return C.normalizeStatsPayload(x.data); }).catch(function () { return {}; }),
        out.league.draft_id ? Sleeper.draft(out.league.draft_id).catch(function () { return null; }) : null,
        Sleeper.weekProjections(out.league.season, out.week).catch(function () { return []; }),
        Sleeper.weekProjections(out.league.season, out.week + 1).catch(function () { return []; }),
        Sleeper.matchups(cfg.leagueId, out.week).catch(function () { return []; }),
        Sleeper.lines().catch(function () { return []; }),
        Sleeper.weekStats(out.league.season, out.week).catch(function () { return []; }),
        Sleeper.transactions(cfg.leagueId, out.week).catch(function () { return []; }),
        Sleeper.lockedGames(cfg.leagueId, out.week).catch(function () { return null; })
      ]);
    }).then(function (r) {
      out.seasonStats = r[0];
      out.draft = r[1];
      out.weekProjRaw = { this: r[2] || [], next: r[3] || [] };
      out.matchups = r[4] || [];
      out.lines = S.linesByGame(r[5]);
      out.weekStatsRaw = r[6] || [];
      out.pickups = S.pickupTimes(r[7]);
      out.lockedRaw = r[8];
      st = out;
      pickMyTeam();
      buildValues();
      return loadBoxScores();
    }).then(function () {
      computeWeek();
      render();
      setStatus('Updated ' + new Date().toLocaleTimeString() + '. Week ' + st.week + ', ' + Object.keys(st.seasonStats).length + ' players with stats this season.', 'ok');
    }).catch(function (e) {
      setStatus('Load failed: ' + esc(e.message), 'err');
    });
  }

  function parseInjuries(data) {
    var out = {};
    (data.injuries || []).forEach(function (team) {
      (team.injuries || []).forEach(function (inj) {
        var det = inj.details || {};
        out[C.normalizeName(inj.athlete && inj.athlete.displayName)] = {
          status: inj.status, comment: inj.shortComment || '',
          ret: det.returnDate || null, ofs: (det.fantasyStatus || {}).abbreviation === 'OFS'
        };
      });
    });
    return out;
  }

  function parseGames(boards) {
    var games = [];
    boards.forEach(function (b) {
      (b.events || []).forEach(function (e) {
        var comp = (e.competitions || [])[0] || {};
        games.push({
          id: e.id, date: e.date, state: ((e.status || {}).type || {}).state || 'pre',
          detail: ((e.status || {}).type || {}).shortDetail || '',
          teams: (comp.competitors || []).map(function (c) { return S.sleeperTeam(c.team.abbreviation); })
        });
      });
    });
    return games.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  function pickMyTeam() {
    if (cfg.myRosterId && st.rosters.some(function (r) { return r.roster_id === cfg.myRosterId; })) return;
    var userId = null;
    var uname = (draftCfg.username || '').toLowerCase();
    if (uname) {
      var u = st.users.filter(function (x) { return (x.display_name || '').toLowerCase() === uname; })[0];
      if (u) userId = u.user_id;
    }
    if (!userId && st.draft && st.draft.draft_order) {
      var slot = draftCfg.slot || 6;
      Object.keys(st.draft.draft_order).forEach(function (uid) { if (st.draft.draft_order[uid] === slot) userId = uid; });
    }
    var mine = st.rosters.filter(function (r) { return r.owner_id === userId; })[0] || st.rosters[0];
    cfg.myRosterId = mine.roster_id;
    save();
  }

  /* ---------------- values ---------------- */

  // Sleeper weekly projections: one row per player per game -> id -> [{date, opp, fp}].
  // Per-game projections; where betting lines exist for the game, the stats
  // they cover are pulled toward the lines.
  function parseWeekProj(rows, scoring, lines) {
    var out = {};
    var fp = function (stats) { return C.fantasyPoints(C.estimateBonuses(stats), scoring); };
    (rows || []).forEach(function (r) {
      if (!r || !r.stats || !r.stats.gp || r.player_id == null) return;
      var id = String(r.player_id);
      var ls = lines && lines[r.game_id + '|' + id];
      var stats = S.adjustProjection(r.stats);
      (out[id] = out[id] || []).push({
        date: r.date, opp: r.opponent, fp: fp(ls ? S.blendLines(stats, ls) : stats), min: (r.stats.sp || 0) / 60,
        fpSleeper: ls ? fp(stats) : null, fpLines: ls ? fp(S.blendLines(stats, ls, 1)) : null
      });
    });
    Object.keys(out).forEach(function (id) { out[id].sort(function (a, b) { return a.date < b.date ? -1 : 1; }); });
    return out;
  }

  function avgFp(list) { return list && list.length ? list.reduce(function (s, g) { return s + g.fp; }, 0) / list.length : null; }

  function buildValues() {
    var scoring = C.cleanScoring(st.league.scoring_settings);
    st.scoring = scoring;
    st.wp = { this: parseWeekProj(st.weekProjRaw.this, scoring, st.lines), next: parseWeekProj(st.weekProjRaw.next, scoring, st.lines) };
    // Sleeper's own box scores this week (playerId -> date -> FP; null = did not play), and the
    // score each player currently counts in his matchup: together they reveal locks.
    st.sleeperGames = {};
    st.weekStatsRaw.forEach(function (r) {
      if (!r || r.player_id == null || !r.date) return;
      var s = r.stats || {};
      (st.sleeperGames[String(r.player_id)] = st.sleeperGames[String(r.player_id)] || {})[r.date] = s.sp ? S.statLineFp(s, scoring) : null;
    });
    st.shown = {};
    (st.matchups || []).forEach(function (m) { Object.keys(m.players_points || {}).forEach(function (id) { st.shown[id] = m.players_points[id]; }); });
    // Sleeper's lock data: playerId -> date of the game he's locked on (Sleeper game ids are
    // mapped to dates through this week's box scores and projections). null if unavailable.
    st.lockDate = null;
    if (st.lockedRaw) {
      var gameDate = {};
      st.weekStatsRaw.concat(st.weekProjRaw.this).forEach(function (r) { if (r && r.game_id && r.date) gameDate[r.game_id] = r.date; });
      st.lockDate = {};
      Object.keys(st.lockedRaw).forEach(function (rid) {
        Object.keys(st.lockedRaw[rid]).forEach(function (pid) { st.lockDate[pid] = gameDate[st.lockedRaw[rid][pid]] || '?'; });
      });
    }
    st.rosterOf = {};
    st.rosters.forEach(function (r) { (r.players || []).forEach(function (id) { st.rosterOf[id] = r.roster_id; }); });
    st.roster = st.league.roster_positions || C.DEFAULT_ROSTER;
    st.weeksLeft = Math.max(1, S.FANTASY_WEEKS - st.week + 1);
    var consById = {};
    CONS.players.forEach(function (r) { consById[r.id] = r; });
    var ids = {};
    Object.keys(consById).forEach(function (id) { ids[id] = 1; });
    Object.keys(st.seasonStats).forEach(function (id) { ids[id] = 1; });
    Object.keys(st.wp.this).forEach(function (id) { ids[id] = 1; });
    Object.keys(st.wp.next).forEach(function (id) { ids[id] = 1; });
    st.rosters.forEach(function (r) { (r.players || []).forEach(function (id) { ids[id] = 1; }); });

    var pool = {};
    var todayMs = Date.parse(st.today + 'T12:00:00Z');
    Object.keys(ids).forEach(function (id) {
      var meta = st.players[id] || {};
      var cons = consById[id];
      var pos = C.normalizePositions(meta.fantasy_positions && meta.fantasy_positions.length ? meta.fantasy_positions : (cons ? cons.pos : [meta.position]));
      if (!pos.length) return;
      var name = meta.full_name || (cons && cons.name) || id;
      var projFpg = cons ? C.fantasyPoints(C.estimateBonuses(cons.line), scoring) : null;
      var pg = st.seasonStats[id] ? C.toPerGame(st.seasonStats[id]) : null;
      var gp = pg ? pg.gp : 0;
      var seasonFpg = pg ? C.fantasyPoints(C.estimateBonuses(pg), scoring) : null;
      var projThis = st.wp.this[id] || [], projNext = st.wp.next[id] || [];
      if (!cons && gp < 2 && !isRostered(id) && !projThis.length && !projNext.length) return;
      var recent = avgFp(projThis.length ? projThis : projNext);
      var mu = S.blendFpg(projFpg, seasonFpg || 0, gp, recent);
      var cv = cons ? cons.cv : null;
      var injLive = meta.injury_status || '';
      var espn = st.espnInj[C.normalizeName(name)];
      var weeksOut = 0;
      if (espn && /out/i.test(espn.status || '')) {
        if (espn.ofs) weeksOut = st.weeksLeft;
        else if (espn.ret) weeksOut = Math.max(0, (Date.parse(espn.ret) - todayMs) / (7 * 864e5));
        else weeksOut = 1;
      } else if (/out/i.test(injLive)) weeksOut = 1;
      var weekly = C.lockInWeekly(mu, cv);
      pool[id] = {
        id: id, name: name, team: meta.team || (cons && cons.team) || 'FA', pos: pos,
        injury: injLive || (espn ? espn.status : ''), injNote: espn ? espn.comment : '', injReturn: espn ? espn.ret : null,
        mu: mu, sd: C.effectiveSd(mu, cv), cv: cv, weekly: weekly, projFpg: projFpg, seasonFpg: seasonFpg, gp: gp,
        projThis: projThis, projNext: projNext, recentProj: recent,
        weeksOut: weeksOut, durability: cons ? cons.durability : 0.8, adp: cons ? cons.adp : null,
        ros: S.rosValue(weekly, st.weeksLeft, cons ? cons.durability : 0.8, weeksOut)
      };
    });
    st.pool = pool;
    st.rostered = {};
    st.rosters.forEach(function (r) {
      (r.players || []).forEach(function (id) { st.rostered[id] = r.roster_id; });
      (r.reserve || []).forEach(function (id) { if (pool[id]) pool[id].onIR = true; });
    });
    // IR eligibility follows the player (his injury status and the league's IR rules), not
    // the roster he's on now, so it carries correctly through trades.
    var set = st.league.settings || {};
    Object.keys(pool).forEach(function (k) {
      var inj = String(pool[k].injury || '').toLowerCase();
      pool[k].irEligible = pool[k].onIR || (set.reserve_allow_out && /out|^ir$/.test(inj)) || (set.reserve_allow_sus && /susp/.test(inj)) ||
        (set.reserve_allow_doubtful && /doubt/.test(inj)) || (set.reserve_allow_dtd && /day|dtd|question/.test(inj)) || false;
    });
    // Market view: draft-day reputation (projected FP/G of the player ranked
    // at his ADP) pulled toward this season's numbers faster than our model.
    var byProj = Object.keys(pool).map(function (k) { return pool[k].projFpg; }).filter(function (v) { return v != null; }).sort(function (a, b) { return b - a; });
    Object.keys(pool).forEach(function (k) {
      var p = pool[k];
      var nameFpg = p.adp != null ? byProj[Math.min(byProj.length - 1, Math.max(0, Math.round(p.adp) - 1))] : p.projFpg;
      var perceived = S.perceivedFpg(nameFpg, p.seasonFpg || 0, p.gp);
      p.marketFpg = perceived == null ? p.mu : perceived;
      p.market = S.rosValue(C.lockInWeekly(p.marketFpg, p.cv), st.weeksLeft, p.durability, p.weeksOut);
      p.form = p.gp >= 2 && p.projFpg != null ? p.seasonFpg - p.projFpg : null;
      // Production over the next ~3 weeks: what a team short on healthy players cares about.
      p.near = Math.max(0, 3 - Math.min(3, p.weeksOut || 0)) * p.weekly * S.playProb(p.injury && !/out/i.test(p.injury) ? p.injury : '');
    });
    st.teamInfo = {};
    st.rosters.forEach(function (r) {
      var list = (r.players || []).map(function (id) { return pool[id]; }).filter(Boolean);
      // Healthy lineup (ignoring injuries) vs the share of it currently out.
      var healthy = C.assign(list, C.starterSlots(st.roster), function (p) { return C.lockInWeekly(p.mu, p.cv); });
      var total = 0, hurt = 0, injured = [];
      healthy.starters.forEach(function (sl) {
        if (!sl.player) return;
        var w = C.lockInWeekly(sl.player.mu, sl.player.cv);
        total += w;
        if (sl.player.weeksOut >= 1 || /out/i.test(sl.player.injury || '')) { hurt += w; injured.push(sl.player); }
      });
      var set = r.settings || {};
      st.teamInfo[r.roster_id] = { urgency: S.teamUrgency(total, hurt, set.wins, set.losses), injured: injured, wins: set.wins || 0, losses: set.losses || 0 };
    });
    var fas = Object.keys(pool).filter(function (k) { return !st.rostered[k]; }).map(function (k) { return pool[k].ros; }).sort(function (a, b) { return b - a; });
    st.fill = fas[Math.min(fas.length - 1, 14)] || 0; // a typical pickup
  }

  function isRostered(id) {
    return st.rosters.some(function (r) { return (r.players || []).indexOf(id) >= 0; });
  }

  function rosterPlayers(r) {
    return (r.players || []).map(function (id) { return st.pool[id] || { id: id, name: (st.players[id] || {}).full_name || id, pos: [], ros: 0, weekly: 0, mu: 0, sd: 1, team: '' }; });
  }

  function myRoster() { return st.rosters.filter(function (r) { return r.roster_id === cfg.myRosterId; })[0]; }

  // This week's matchup entries (Sleeper) for me and my opponent.
  function myMatchup() {
    var me = (st.matchups || []).filter(function (m) { return m.roster_id === cfg.myRosterId; })[0];
    if (!me) return null;
    var opp = st.matchups.filter(function (m) { return m.matchup_id === me.matchup_id && m.roster_id !== me.roster_id; })[0];
    return { me: me, opp: opp };
  }

  // Players whose finished games we track: my roster and this week's opponent's.
  function lockableIds() {
    var ids = (myRoster().players || []).slice();
    var mu = myMatchup();
    if (mu && mu.opp) ids = ids.concat(mu.opp.players || mu.opp.starters || []);
    return ids;
  }

  function ownerName(r) {
    var u = st.users.filter(function (x) { return x.user_id === r.owner_id; })[0];
    return u ? (u.display_name || u.user_id) : 'Team ' + r.roster_id;
  }

  /* ---------------- this week's games ---------------- */

  function loadBoxScores() {
    var teams = {};
    lockableIds().forEach(function (id) { var p = st.pool[id]; if (p) teams[p.team] = 1; });
    var wanted = st.games.filter(function (g) { return g.state !== 'pre' && g.teams.some(function (t) { return teams[t]; }); });
    st.box = {};
    return Promise.all(wanted.map(function (g) {
      return getJson(ESPN + '/summary?event=' + g.id).then(function (d) {
        var rows = {};
        ((d.boxscore || {}).players || []).forEach(function (team) {
          var t = S.sleeperTeam(team.team.abbreviation);
          (team.statistics || []).forEach(function (grp) {
            (grp.athletes || []).forEach(function (a) {
              if (a.didNotPlay || !a.stats || !a.stats.length) return;
              var r = S.boxScoreFp(grp.keys || [], a.stats, st.scoring);
              if (r.minutes > 0) rows[t + '|' + C.normalizeName(a.athlete.displayName)] = r;
            });
          });
        });
        st.box[g.id] = rows;
      }).catch(function () { st.box[g.id] = null; });
    }));
  }

  // Per player: this week's games, a finished game that can still be locked
  // (my roster only), games left, the expected locked score for the rest of
  // the week at this week's projected level, and next week's expected score.
  function computeWeek() {
    var mineIds = {};
    lockableIds().forEach(function (id) { mineIds[id] = 1; });
    st.autoLock = {};
    Object.keys(st.pool).forEach(function (id) {
      var p = st.pool[id];
      var key = p.team + '|' + C.normalizeName(p.name);
      var pickup = autoPickup(id);
      var list = st.games.filter(function (g) { return g.teams.indexOf(p.team) >= 0; }).map(function (g) {
        var box = mineIds[id] ? st.box[g.id] : null;
        var row = box ? box[key] : null;
        var day = S.easternDate(new Date(g.date));
        var proj = (p.projThis || []).filter(function (x) { return x.date === day; })[0] || null;
        var sl = (st.sleeperGames[id] || {})[day];
        return {
          game: g, state: g.state, fp: row ? row.fp : (sl != null ? sl : null), fpSleeper: sl, line: row ? row.line : null,
          dnp: g.state === 'post' && ((box && !row) || sl === null), proj: proj,
          // Added mid-week: games that tipped before he joined don't count.
          beforePickup: !!(pickup && Date.parse(g.date) < pickup.at)
        };
      });
      var left = list.filter(function (x) { return x.state === 'pre'; }).length;
      var live = list.some(function (x) { return x.state === 'in'; });
      // The latest finished game is lockable only if nothing after it has tipped off.
      var pending = null;
      if (mineIds[id]) {
        for (var i = list.length - 1; i >= 0; i--) {
          if (list[i].beforePickup) break;
          if (list[i].state === 'post' && list[i].fp != null) {
            var laterStarted = list.slice(i + 1).some(function (x) { return x.state !== 'pre'; });
            if (!laterStarted) pending = list[i];
            break;
          }
          if (list[i].state !== 'pre') break;
        }
      }
      if (mineIds[id] && st.lockDate) {
        var ld = st.lockDate[id];
        var lg = ld ? list.filter(function (x) { return S.easternDate(new Date(x.game.date)) === ld; })[0] : null;
        st.autoLock[id] = ld
          ? { status: 'locked', source: 'sleeper', date: ld, score: lg ? (lg.fpSleeper != null ? lg.fpSleeper : lg.fp) : st.shown[id] }
          : { status: 'open', source: 'sleeper' };
      } else if (mineIds[id]) {
        st.autoLock[id] = S.detectLock(list.filter(function (x) { return !x.beforePickup; }).map(function (x) {
          return { state: x.state, dnp: x.dnp, fps: [x.fp, x.fpSleeper], settled: x.state === 'post' && Date.now() - Date.parse(x.game.date) > SETTLE_MS };
        }), st.shown[id]);
      }
      // Added mid-week (marked by hand): games before he joined your lineup can't be locked.
      var ls = st.league ? lockState(id) : { type: 'auto' };
      if (pending && ls.type === 'pickup' && ls.since && S.easternDate(new Date(pending.game.date)) < ls.since) pending = null;
      var lockedScore = null;
      if (ls.type === 'locked') { lockedScore = ls.score != null ? ls.score : pending ? pending.fp : 0; pending = null; }
      var q = S.playProb(p.injury);
      var upcoming = list.filter(function (x) { return x.state !== 'post' && x.proj; }).map(function (x) { return x.proj.fp; });
      var mu = S.weekLevel(upcoming.length ? upcoming : (p.projThis || []).map(function (x) { return x.fp; }), p.mu);
      var sd = C.effectiveSd(mu, p.cv);
      // Per-game play chances for his remaining games: lower on the 2nd night of a back-to-back.
      var etDay = function (x) { return S.easternDate(new Date(x.game.date)); };
      var qs = S.gamePlayProbs(q, list.filter(function (x) { return x.state !== 'post'; }).map(etDay), list.map(etDay));
      var muNext = S.weekLevel((p.projNext || []).map(function (x) { return x.fp; }), p.mu);
      var next;
      if (p.projNext && p.projNext.length) {
        // Projected next week, so expected back by then even if out now.
        var qsNext = S.gamePlayProbs(Math.max(q, 0.8), p.projNext.map(function (x) { return x.date; }));
        next = S.waitValue(muNext, C.effectiveSd(muNext, p.cv), qsNext.length, qsNext);
      } else if (!(p.projThis && p.projThis.length)) next = p.weekly * q; // not in weekly projections: season level
      else next = 0; // projected this week but not next: expected out
      p.week = {
        games: list, left: left + (live ? 1 : 0), pending: pending, q: q, qs: qs, live: live, mu: mu, sd: sd,
        value: lockedScore != null ? lockedScore : S.weekValue(mu, sd, pending ? pending.fp : null, left + (live ? 1 : 0), qs),
        locked: lockedScore, lockAuto: !!ls.auto,
        muNext: muNext, next: next, nextGames: (p.projNext || []).length
      };
    });
  }

  /* ---------------- rendering ---------------- */

  function render() {
    $('leagueName').textContent = st.league.name + ' · ' + ownerName(myRoster());
    $('weekInfo').textContent = 'Week ' + st.week + ' · ' + dayLabel(st.dates[0] + 'T16:00:00Z') + ' – ' + dayLabel(st.dates[6] + 'T16:00:00Z') + ' · ' + st.weeksLeft + ' weeks left';
    $('teamSelect').innerHTML = st.rosters.map(function (r) {
      return '<option value="' + r.roster_id + '"' + (r.roster_id === cfg.myRosterId ? ' selected' : '') + '>' + esc(ownerName(r)) + '</option>';
    }).join('');
    var others = st.rosters.filter(function (r) { return r.roster_id !== cfg.myRosterId; });
    if (!others.some(function (r) { return r.roster_id === cfg.partnerRosterId; })) cfg.partnerRosterId = others[0] && others[0].roster_id;
    $('partnerSelect').innerHTML = others.map(function (r) {
      return '<option value="' + r.roster_id + '"' + (r.roster_id === cfg.partnerRosterId ? ' selected' : '') + '>' + esc(ownerName(r)) + '</option>';
    }).join('');
    renderMatchup();
    renderWeek();
    renderLock();
    renderWaivers();
    renderTradeRosters();
    renderTeamNeeds();
  }

  /* ---------------- matchup: what it takes to win the week ---------------- */

  // Sleeper's matchup scores catch up with finished games within a few hours; trust them the morning after.
  var SETTLE_MS = 12 * 3600 * 1000;

  // Your manual setting if any, else what Sleeper's data shows (a lock or a mid-week pickup).
  function lockState(id) {
    var wk = (cfg.locks = cfg.locks || {})[st.league.season + '-' + st.week] || {};
    if (wk[id]) return wk[id];
    var det = st.autoLock && st.autoLock[id];
    if (det && det.status === 'locked') return { type: 'locked', score: det.score, auto: true };
    if (autoPickup(id)) return { type: 'pickup', auto: true };
    return { type: 'auto' };
  }

  // A player added to his current roster after this week started.
  function autoPickup(id) {
    var pk = st.pickups && st.pickups[id];
    if (!pk || !st.rosterOf || pk.roster !== st.rosterOf[id]) return null;
    return pk.at > Date.parse(st.dates[0] + 'T04:00:00Z') ? pk : null;
  }

  function setLockState(id, state) {
    cfg.locks = cfg.locks || {};
    var key = st.league.season + '-' + st.week;
    cfg.locks[key] = cfg.locks[key] || {};
    if (state.type === 'auto') delete cfg.locks[key][id]; else cfg.locks[key][id] = state;
    save();
  }

  // Simulation input for one starter, honouring locks/pickups the user marked.
  function simPlayer(id, sleeperPoints) {
    var p = st.pool[id];
    var w = p && p.week;
    var ls = lockState(id);
    var sp = {
      id: id, name: p ? p.name : id, p: p,
      mu: w ? w.mu : 0, sd: w ? w.sd : 1, q: w ? w.q : 1, qs: w ? w.qs : null, left: w ? w.left : 0,
      pending: w && w.pending ? w.pending.fp : null, locked: null, shown: sleeperPoints
    };
    if (ls.type === 'locked') { sp.locked = ls.score != null ? ls.score : (sp.pending != null ? sp.pending : sleeperPoints || 0); sp.left = 0; }
    return sp;
  }

  var matchupTimer = null;

  function renderMatchup() {
    var mu = myMatchup();
    if (!mu || !mu.opp) { $('matchupView').innerHTML = '<p class="muted">No matchup found for week ' + st.week + '.</p>'; return; }
    var oppRoster = st.rosters.filter(function (r) { return r.roster_id === mu.opp.roster_id; })[0];
    var mine = (mu.me.starters || []).map(function (id, i) { return simPlayer(id, (mu.me.starters_points || [])[i]); });
    var theirs = (mu.opp.starters || []).map(function (id, i) { return simPlayer(id, (mu.opp.starters_points || [])[i]); });
    var oppPolicy = { smart: {}, never: { never: true }, eager: { eager: true } }[cfg.oppPolicy || 'smart'];
    $('matchupView').innerHTML = '<p class="muted">Simulating the rest of the week…</p>';
    clearTimeout(matchupTimer);
    matchupTimer = setTimeout(function () {
      var plan = S.matchupPlan(mine, theirs, { n: 4000, oppPolicy: oppPolicy });
      var best = plan.best;
      var alt = ['smart', 'never', 'eager'].map(function (k) {
        var pol = { smart: {}, never: { never: true }, eager: { eager: true } }[k];
        return { k: k, win: S.simulateMatchup(mine, theirs, { n: 3000, myPolicy: { shift: best.shift }, oppPolicy: pol }).win };
      });
      // Expected locked score per starter under the plan.
      var expect = function (sp, pol) {
        var t = 0, n = 1500;
        for (var i = 0; i < n; i++) {
          var draws = [];
          for (var k = 0; k < sp.left; k++) { var u = Math.random(), a = 1 - Math.random(), b = Math.random(); draws.push({ u: u, z: Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b) }); }
          t += S.simulatePlayer(sp, pol, undefined, draws);
        }
        return t / n;
      };
      $('matchupView').innerHTML = matchupHtml(mu, oppRoster, mine, theirs, plan, alt, function (sp) { return expect(sp, { shift: best.shift }); }, function (sp) { return expect(sp, oppPolicy); });
    }, 20);
  }

  // Near-certain chances keep a decimal: 99.6% and 100% are different calls.
  function pct(x) {
    if (x >= 1) return '100%';
    if (x <= 0) return '0%';
    if (x > 0.99 || x < 0.01) return (Math.floor(x * 1000) / 10).toFixed(1) + '%';
    return Math.round(x * 100) + '%';
  }

  function modeText(shift, win) {
    if (win >= 0.97) return '<strong class="good">You\'re a heavy favorite: protect the lead.</strong> Lock good games instead of hoping for better ones; the only way to lose is a collapse. Bars are set ' + fmt(shift, 2) + ' × swing ' + (shift < 0 ? 'below' : 'from') + ' normal.';
    if (win <= 0.03) return '<strong class="warnc">Long shot: you need big games.</strong> Pass on anything that doesn\'t help you catch up.';
    if (shift <= -0.25) return '<strong class="good">You\'re favored: play it safe.</strong> Lock good games sooner (bars ' + fmt(shift, 2) + ' × swing below normal).';
    if (shift >= 0.25) return '<strong class="warnc">You\'re behind: chase upside.</strong> Hold out for big games (bars +' + fmt(shift, 2) + ' × swing above normal).';
    return '<strong>Close matchup:</strong> use the standard bars.';
  }

  function callText(d, diff) {
    if (d.clinch) return '<strong class="good">LOCK</strong>: locks up the win in every simulation';
    if (d.tie) return d.call === 'lock'
      ? '<strong class="good">LOCK</strong> <span class="muted">(same win chance; banking it is safer)</span>'
      : '<strong class="warnc">PASS</strong> <span class="muted">(same win chance; keep the upside)</span>';
    return d.call === 'lock' ? '<strong class="good">LOCK</strong> (+' + fmt(100 * diff, 1) + ' pts of win%)' : '<strong class="warnc">PASS</strong> (+' + fmt(100 * diff, 1) + ' pts of win%)';
  }

  function statusControl(sp) {
    var ls = lockState(sp.id);
    var det = (st.autoLock || {})[sp.id] || {};
    var autoLabel = det.status === 'locked' ? 'Sleeper: locked ' + fmt(det.score) + (det.date ? ' (' + dayLabel(det.date + 'T16:00:00Z').split(',')[0] + ')' : '') :
      autoPickup(sp.id) ? 'Sleeper: added mid-week' : det.source === 'sleeper' ? 'Sleeper: not locked' :
      det.status === 'open' ? 'Sleeper: not locked' : det.waiting ? 'Sleeper: still processing his last game' :
      det.status === 'unknown' && det.index != null ? 'Sleeper: latest game counts (a lock on it shows once he plays again)' : 'Sleeper: nothing locked';
    return '<select data-lockstate="' + esc(sp.id) + '">' +
      '<option value="auto"' + (ls.auto || ls.type === 'auto' ? ' selected' : '') + '>' + esc(autoLabel) + '</option>' +
      '<option value="open"' + (ls.type === 'open' ? ' selected' : '') + '>Not locked</option>' +
      '<option value="locked"' + (ls.type === 'locked' && !ls.auto ? ' selected' : '') + '>Locked</option>' +
      '<option value="pickup"' + (ls.type === 'pickup' && !ls.auto ? ' selected' : '') + '>Added mid-week</option></select>' +
      (ls.type === 'locked' && !ls.auto ? ' <input data-lockscore="' + esc(sp.id) + '" type="number" step="0.5" style="width:70px" value="' + esc(ls.score != null ? ls.score : (sp.pending != null ? sp.pending : sp.shown || 0)) + '">' : '') +
      (ls.type === 'pickup' && !ls.auto ? '<div class="small muted">in lineup since <input data-locksince="' + esc(sp.id) + '" type="date" value="' + esc(ls.since || st.today) + '" style="width:auto;padding:2px 4px"> (earlier games don\'t count)</div>' : '');
  }

  function lineupTable(list, expectFn) {
    return '<table class="detail-table">' + list.map(function (sp) {
      var p = sp.p;
      var games = p && p.week ? gameChips(p) : '';
      var cur = sp.locked != null ? '<strong class="good">' + fmt(sp.locked) + ' locked</strong>' + (lockState(sp.id).auto ? ' <span class="muted">(Sleeper)</span>' : '') : sp.pending != null ? fmt(sp.pending) + ' lockable' : (sp.shown ? fmt(sp.shown) + ' (Sleeper)' : '–');
      return '<tr><td>' + (p ? nameCell(p) : esc(sp.name)) + '<div class="small">' + games + '</div></td><td class="num small">' + cur + '<br><span class="muted">exp ' + fmt(expectFn(sp)) + '</span></td><td>' + statusControl(sp) + '</td></tr>';
    }).join('') + '</table>';
  }

  function matchupHtml(mu, oppRoster, mine, theirs, plan, alt, expMine, expTheirs) {
    var best = plan.best;
    var oppName = ownerName(oppRoster || { roster_id: mu.opp.roster_id });
    var head = '<div class="card"><div class="row gap wrap" style="justify-content:space-between;align-items:center">' +
      '<div><h2 style="margin:0">You vs ' + esc(oppName) + '</h2><div class="small muted">Week ' + st.week + ' · expected final: you ' + fmt(best.result.mine, 0) + ', them ' + fmt(best.result.theirs, 0) + '</div></div>' +
      '<div style="text-align:right"><div style="font-size:30px;font-weight:700">' + pct(best.result.win) + '</div><div class="small muted">win chance with the plan below</div></div></div>' +
      '<p>' + modeText(best.shift, best.result.win) + '</p>' +
      '<p class="small muted">If they… lock smartly: ' + pct(alt[0].win) + ' · never lock: ' + pct(alt[1].win) + ' · lock anything above average: ' + pct(alt[2].win) +
      '. Bar settings tested: ' + plan.shifts.map(function (x) { return (x.shift > 0 ? '+' : '') + x.shift + ' → ' + pct(x.result.win); }).join(', ') + '.</p></div>';
    var dec = plan.decisions.length ? '<h3>Decide now: games you can lock</h3><div class="table-wrap"><table class="board"><thead><tr><th>Player</th><th class="num">Game</th><th class="num">Bar (this matchup)</th><th class="num">Win if LOCK</th><th class="num">Win if PASS</th><th>Call</th></tr></thead><tbody>' +
      plan.decisions.sort(function (a, b) { return Math.abs(b.lockWin - b.passWin) - Math.abs(a.lockWin - a.passWin); }).map(function (d) {
        var diff = Math.abs(d.lockWin - d.passWin);
        return '<tr><td>' + nameCell(d.player.p || { id: d.player.id, name: d.player.name, team: '', pos: [] }) + '</td><td class="num">' + fmt(d.player.pending) + '</td><td class="num">' + fmt(d.bar) + '</td>' +
          '<td class="num">' + pct(d.lockWin) + '</td><td class="num">' + pct(d.passWin) + '</td>' +
          '<td>' + callText(d, diff) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">No games to decide on right now (nothing finished and still lockable).</p>';
    var bars = plan.bars.filter(function (b) { return b.bar != null; });
    var barsHtml = bars.length ? '<h3>Bars for upcoming games</h3><p class="small muted">Lock his next game if it reaches the bar. Adjusted for this matchup; the standard bar is shown for comparison. His last game of the week counts automatically.</p><div class="table-wrap"><table class="board"><thead><tr><th>Player</th><th class="num">Games left</th><th class="num">Next-game bar</th><th class="num">Standard</th></tr></thead><tbody>' +
      bars.map(function (b) {
        return '<tr><td>' + nameCell(b.player.p || { id: b.player.id, name: b.player.name, team: '', pos: [] }) + '</td><td class="num">' + b.player.left + '</td><td class="num"><strong>' + fmt(b.bar) + '</strong></td><td class="num muted">' + fmt(b.standardBar) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '';
    var lineups = '<h3>Lineups</h3><p class="small muted">' + (st.lockDate ? 'Locks for both teams come straight from Sleeper, and mid-week pickups from the league\'s transactions.' : 'Sleeper\'s lock data didn\'t load, so locks are inferred from the score each player counts (a lock on his latest game only shows once he plays again). Mark any you know.') + ' Override any player with the menu. "exp" is his expected locked score.</p><div class="plan-grid">' +
      '<div class="card"><h3>You</h3>' + lineupTable(mine, expMine) + '</div><div class="card"><h3>' + esc(oppName) + '</h3>' + lineupTable(theirs, expTheirs) + '</div></div>';
    return head + dec + barsHtml + lineups;
  }

  function injTag(p) {
    if (!p.injury) return '';
    var t = p.injury + (p.injReturn ? ' (est. return ' + p.injReturn.slice(0, 10) + ')' : '') + (p.injNote ? ': ' + p.injNote : '');
    return ' <span class="inj" title="' + esc(t) + '">' + esc(p.injury.toUpperCase().slice(0, 4)) + '</span>';
  }

  function nameCell(p) {
    return '<span class="name" data-detail="' + esc(p.id) + '">' + esc(p.name) + '</span> <span class="team">' + esc(p.team) + '</span>' + injTag(p);
  }

  function gameChips(p) {
    return p.week.games.map(function (x) {
      var label = dayLabel(x.game.date);
      var b2b = p.week && p.week.games.some(function (y) { return S.easternDate(new Date(y.game.date)) === S.addDays(S.easternDate(new Date(x.game.date)), -1); });
      if (x.state === 'pre') {
        var lines = x.proj && x.proj.fpLines != null;
        var title = lines ? 'Projection ' + fmt(x.proj.fp) + ': betting lines ' + fmt(x.proj.fpLines) + ' (70%), Sleeper ' + fmt(x.proj.fpSleeper) + ' (30%)' : 'Sleeper projection';
        return '<span class="pick-pill" title="' + title + (b2b ? '; 2nd night of a back-to-back: a bit more likely to rest' : '') + '">' + label + (b2b ? ' (B2B)' : '') + (x.proj ? ' · proj ' + fmt(x.proj.fp, 0) + (lines ? ' ($)' : '') : '') + '</span>';
      }
      if (x.state === 'in') return '<span class="pick-pill next">' + label + ' live</span>';
      if (x.dnp) return '<span class="pick-pill done">' + label + ' DNP</span>';
      return '<span class="pick-pill' + (p.week.pending === x ? ' next' : '') + '">' + label + ': <strong>' + fmt(x.fp) + '</strong></span>';
    }).join(' ') || '<span class="muted small">no games</span>';
  }

  function renderWeek() {
    var mine = rosterPlayers(myRoster());
    var slots = C.starterSlots(st.roster);
    var best = C.assign(mine.filter(function (p) { return p.pos.length && !p.onIR; }), slots, function (p) { return p.week ? p.week.value : 0; });
    var current = (myRoster().starters || []);
    var curSet = {};
    current.forEach(function (id) { curSet[id] = 1; });
    var rows = best.starters.map(function (s) {
      var p = s.player;
      var change = p && !curSet[p.id];
      return '<tr' + (change ? ' class="rec"' : '') + '><td class="slot">' + esc(s.slot) + '</td><td>' + (p ? nameCell(p) : '<span class="slot-empty">empty</span>') + '</td>' +
        '<td class="pos">' + (p ? esc(p.pos.join('/')) : '') + '</td><td class="num">' + (p ? fmt(p.week.value) : '') + '</td>' +
        '<td>' + (p ? gameChips(p) : '') + '</td>' +
        '<td class="small ' + (change ? 'good' : 'muted') + '">' + (change ? 'Start (not in your current lineup)' : 'already starting') + '</td></tr>';
    }).join('');
    var bench = best.bench.map(function (p) {
      var starting = curSet[p.id];
      return '<tr' + (starting ? ' class="drafted"' : '') + '><td class="slot">BN</td><td>' + nameCell(p) + '</td><td class="pos">' + esc(p.pos.join('/')) + '</td><td class="num">' + fmt(p.week ? p.week.value : 0) + '</td><td>' + (p.week ? gameChips(p) : '') + '</td>' +
        '<td class="small ' + (starting ? 'bad' : 'muted') + '">' + (starting ? 'Sit (currently starting)' : 'bench') + '</td></tr>';
    }).join('');
    var curTotal = 0, bestTotal = 0;
    current.forEach(function (id) { var p = st.pool[id]; if (p && p.week) curTotal += p.week.value; });
    best.starters.forEach(function (s) { if (s.player) bestTotal += s.player.week.value; });
    $('weekView').innerHTML = '<p>Expected locked points for the rest of the week: <strong>' + fmt(bestTotal, 0) + '</strong> with this lineup vs ' + fmt(curTotal, 0) + ' with your current Sleeper lineup.</p>' +
      '<div class="table-wrap"><table class="board"><thead><tr><th>Slot</th><th>Player</th><th>Pos</th><th class="num" title="Expected locked score from the rest of the week">Exp. locked</th><th>Games this week (FP, or projection)</th><th></th></tr></thead><tbody>' + rows + bench + '</tbody></table></div>' +
      renderNextWeek(mine, slots);
  }

  // Best lineup for next week from Sleeper's per-game projections.
  function renderNextWeek(mine, slots) {
    var best = C.assign(mine.filter(function (p) { return p.pos.length && !p.onIR; }), slots, function (p) { return p.week ? p.week.next : 0; });
    var total = 0;
    var row = function (slot, p) {
      if (p) total += slot === 'BN' ? 0 : p.week.next;
      return '<tr' + (slot === 'BN' ? ' class="drafted"' : '') + '><td class="slot">' + esc(slot) + '</td><td>' + (p ? nameCell(p) : '<span class="slot-empty">empty</span>') + '</td><td class="pos">' + (p ? esc(p.pos.join('/')) : '') + '</td>' +
        '<td class="num">' + (p ? p.week.nextGames : '') + '</td><td class="num">' + (p ? fmt(p.week.muNext) : '') + '</td><td class="num">' + (p ? fmt(p.week.next) : '') + '</td></tr>';
    };
    var html = best.starters.map(function (s) { return row(s.slot, s.player); }).join('') + best.bench.map(function (p) { return row('BN', p); }).join('');
    return '<h2 style="margin-top:18px">Next week (planning)</h2><p class="muted small">From Sleeper\'s per-game projections for next week, which reflect current roles and injuries. Expected locked points with this lineup: <strong>' + fmt(total, 0) + '</strong>.</p>' +
      '<div class="table-wrap"><table class="board"><thead><tr><th>Slot</th><th>Player</th><th>Pos</th><th class="num">Games</th><th class="num" title="Projected FP per game next week">Proj FP/G</th><th class="num">Exp. locked</th></tr></thead><tbody>' + html + '</tbody></table></div>';
  }

  function renderLock() {
    var r = myRoster();
    var starters = (r.starters || []).map(function (id) { return st.pool[id]; }).filter(Boolean);
    var cards = starters.map(function (p) {
      var w = p.week;
      var verdict, cls = '';
      if (w.locked != null) { verdict = '<strong class="good">Locked</strong> at <strong>' + fmt(w.locked) + '</strong>' + (w.lockAuto ? ' (from Sleeper)' : '') + '.'; cls = 'muted'; }
      else if (w.pending && w.left === 0) { verdict = 'Last game of his week: <strong>' + fmt(w.pending.fp) + '</strong> counts automatically.'; cls = 'muted'; }
      else if (w.pending) {
        var d = S.lockDecision(p.week.mu, p.week.sd, w.pending.fp, w.left, w.qs);
        verdict = (d.lock ? '<strong class="good">LOCK</strong>' : '<strong class="warnc">PASS</strong>') + ': scored <strong>' + fmt(w.pending.fp) + '</strong>, the bar with ' + w.left + ' game' + (w.left === 1 ? '' : 's') + ' left is <strong>' + fmt(d.threshold) + '</strong>' +
          (w.q < 0.95 ? ' (lowered: ' + esc(p.injury) + ')' : '') + '. Decide before his next game tips off.';
      } else if (w.live) verdict = 'Game in progress. Check back after it ends.';
      else if (!w.games.length) verdict = 'No games this week. Consider benching him.';
      else if (w.games.every(function (x) { return x.state === 'pre'; })) verdict = w.left > 1
        ? 'First game ' + dayLabel(w.games[0].game.date) + '. Lock it if it reaches <strong>' + fmt(S.lockDecision(p.week.mu, p.week.sd, 0, w.left - 1, w.qs).threshold) + '</strong>; otherwise wait.'
        : 'Only one game this week (' + dayLabel(w.games[0].game.date) + '). It counts automatically.';
      else verdict = w.left > 1
        ? 'His last finished game can no longer be locked (a later game started). Bar for his next game: <strong>' + fmt(S.lockDecision(p.week.mu, p.week.sd, 0, w.left - 1, w.qs).threshold) + '</strong>.'
        : 'His last finished game can no longer be locked. His final game this week counts automatically.';
      return '<div class="card"><div class="row gap wrap" style="justify-content:space-between"><div>' + nameCell(p) + ' <span class="pos">' + esc(p.pos.join('/')) + '</span></div><div class="small muted">this week ' + fmt(p.week.mu) + ' FP/G' + (Math.abs(p.week.mu - p.mu) >= 1 ? ' (season ' + fmt(p.mu) + ')' : '') + ' · swing ±' + fmt(p.week.sd) + '</div></div>' +
        '<div style="margin:6px 0">' + gameChips(p) + '</div><div class="' + cls + '">' + verdict + '</div></div>';
    }).join('');
    $('lockView').innerHTML = '<p class="muted small">Starters only (bench players can\'t be locked). The bar is the expected value of waiting for his remaining games. Lock if the game you just saw beats it. These bars maximise points; the <strong>Matchup</strong> tab adjusts them to your matchup (when you\'re far ahead it locks sooner). Locks are read from Sleeper once a player\'s next game has started.</p><div class="plan-grid">' + cards + '</div>';
    $('calcPlayer').innerHTML = rosterPlayers(r).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
  }

  function waiverCtx() {
    var irSlots = (st.league.settings || {}).reserve_slots;
    if (irSlots == null) irSlots = st.roster.filter(function (s) { return s === 'IR'; }).length;
    return { roster: st.roster, rosterSize: st.roster.filter(function (s) { return s !== 'IR'; }).length, irSlots: irSlots, val: function (p) { return p.ros || 0; }, fill: st.fill };
  }

  function renderWaivers() {
    var horizon = view.faHorizon || 'ros';
    var hv = function (p) {
      if (!p.week) return 0;
      return horizon === 'this' ? p.week.value : horizon === 'two' ? p.week.value + p.week.next : p.ros;
    };
    var fas = Object.keys(st.pool).filter(function (k) { return !st.rostered[k]; }).map(function (k) { return st.pool[k]; })
      .filter(function (p) { return view.faPos === 'ALL' || p.pos.indexOf(view.faPos) >= 0; })
      .filter(function (p) { return !view.faHealthy || !/out/i.test(p.injury || ''); })
      .sort(function (a, b) { return hv(b) - hv(a); }).slice(0, 60);
    var mine = rosterPlayers(myRoster());
    var moves;
    if (horizon === 'ros') moves = S.waiverMoves(mine, fas, waiverCtx());
    else {
      // Short-term pickups: only consider dropping my 4 lowest rest-of-season players.
      var cands = mine.slice().sort(function (a, b) { return a.ros - b.ros; }).slice(0, 4);
      var thisWeek = function (p) { return p.week ? p.week.value : 0; };
      var nextWeek = function (p) { return p.week ? p.week.next : 0; };
      moves = S.shortTermMoves(mine, fas, cands, st.roster, horizon === 'two' ? [thisWeek, nextWeek] : [thisWeek], function (p) { return p.ros || 0; }, waiverCtx());
    }
    moves = moves.slice(0, 30);
    var help = {
      ros: 'Gain = change in your team\'s rest-of-season lineup value if you add him and drop the suggested player.',
      this: 'Gain = extra expected locked points in your starting lineup for the rest of this week, dropping one of your 4 lowest rest-of-season players. A <span class="bad">negative</span> gain means he wouldn\'t crack your lineup (bench players don\'t score in Lock-In): it\'s how far short he falls of the starter he\'d replace. "Season cost" is what that drop costs over the rest of the season.',
      two: 'Gain = extra expected locked points in your starting lineups for the rest of this week plus next week (each week gets its own best lineup), dropping one of your 4 lowest rest-of-season players. A <span class="bad">negative</span> gain means he wouldn\'t start in either week: it\'s how far short he falls. "Season cost" is what that drop costs over the rest of the season.'
    }[horizon];
    $('waiverView').innerHTML = '<p class="muted small">' + help + ' FP/G blends his preseason projection, this season\'s games and this week\'s projection.</p>' +
      '<div class="table-wrap"><table class="board"><thead><tr><th>Add</th><th>Pos</th><th class="num" title="Projected FP per game this week (Sleeper)">This wk FP/G</th><th class="num" title="Expected locked points, rest of this week">This wk</th><th class="num" title="Expected locked points next week">Next wk</th><th class="num" title="Rest-of-season FP/G">FP/G</th><th class="num">Season (GP)</th><th class="num">ROS</th><th>Drop</th><th class="num">Gain</th>' + (horizon === 'ros' ? '' : '<th class="num">Season cost</th>') + '</tr></thead><tbody>' +
      moves.map(function (m) {
        var p = m.add;
        return '<tr' + (m.gain > 0 ? ' class="rec"' : '') + '><td>' + nameCell(p) + '</td><td class="pos">' + esc(p.pos.join('/')) + '</td>' +
          '<td class="num">' + fmt(p.week.mu) + '</td><td class="num">' + fmt(p.week.value) + '</td><td class="num">' + fmt(p.week.next) + '</td><td class="num">' + fmt(p.mu) + '</td>' +
          '<td class="num">' + (p.gp ? fmt(p.seasonFpg) + ' (' + p.gp + ')' : '–') + '</td><td class="num">' + fmt(p.ros, 0) + '</td>' +
          '<td>' + (m.drop ? esc(m.drop.name) : '–') + '</td><td class="num ' + (m.gain > 0 ? 'good' : 'bad') + '"' + (horizon !== 'ros' && !m.starts ? ' title="Wouldn\'t start: ' + fmt(-m.gain) + ' short of the starter he\'d replace"' : '') + '>' + (m.gain > 0 ? '+' : '') + fmt(m.gain, horizon === 'ros' ? 0 : 1) + '</td>' +
          (horizon === 'ros' ? '' : '<td class="num ' + (m.rosChange >= 0 ? 'good' : 'bad') + '">' + (m.rosChange >= 0 ? '+' : '') + fmt(m.rosChange, 0) + '</td>') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  var tradePick = { give: {}, get: {} };

  // How a team likely values players: market view plus, when it is short on
  // healthy players, extra weight on the next ~3 weeks of production.
  function theirValFor(rosterId) {
    var u = (st.teamInfo[rosterId] || {}).urgency || 0;
    return function (p) { return (p.market || 0) + 1.5 * u * (p.near || 0); };
  }

  function marketTag(p) {
    if (!p.market || !p.ros) return '';
    var r = p.ros / p.market;
    if (r >= 1.1) return '<span class="good small" title="Our value ' + fmt(p.ros, 0) + ' vs market ' + fmt(p.market, 0) + '">buy low</span>';
    if (r <= 0.9) return '<span class="bad small" title="Our value ' + fmt(p.ros, 0) + ' vs market ' + fmt(p.market, 0) + '">sell high</span>';
    return '';
  }

  function formCell(p) {
    if (p.form == null) return '<span class="muted">–</span>';
    var cls = p.form >= 2 ? 'good' : p.form <= -2 ? 'bad' : 'muted';
    return '<span class="' + cls + '" title="This season ' + fmt(p.seasonFpg) + ' FP/G in ' + p.gp + ' games vs ' + fmt(p.projFpg) + ' projected">' + (p.form >= 0 ? '+' : '') + fmt(p.form) + '</span>';
  }

  function renderTeamNeeds() {
    var rows = st.rosters.filter(function (r) { return r.roster_id !== cfg.myRosterId; }).map(function (r) {
      var ti = st.teamInfo[r.roster_id] || { urgency: 0, injured: [] };
      return { r: r, ti: ti };
    }).sort(function (a, b) { return b.ti.urgency - a.ti.urgency; });
    $('teamNeeds').innerHTML = '<div class="card"><h3>Who needs a trade</h3><p class="small muted">Urgency = share of their healthy lineup currently injured, plus a losing record. Urgent teams value players who help in the next few weeks more, which makes them easier trade partners for healthy players.</p><table class="detail-table">' +
      rows.map(function (x) {
        var u = x.ti.urgency;
        return '<tr><td>' + esc(ownerName(x.r)) + '</td><td class="small muted">' + x.ti.wins + '-' + x.ti.losses + '</td><td class="num ' + (u >= 0.5 ? 'bad' : u >= 0.25 ? 'warnc' : 'muted') + '">' + Math.round(u * 100) + '%</td><td class="small">' +
          (x.ti.injured.length ? x.ti.injured.map(function (p) { return esc(p.name) + (p.weeksOut >= 1 ? ' (~' + fmt(p.weeksOut, 0) + ' wk)' : ''); }).join(', ') : '<span class="muted">healthy</span>') + '</td></tr>';
      }).join('') + '</table></div>';
  }

  function renderTradeRosters() {
    var mine = rosterPlayers(myRoster()).sort(function (a, b) { return b.ros - a.ros; });
    var partner = st.rosters.filter(function (r) { return r.roster_id === cfg.partnerRosterId; })[0];
    var theirs = partner ? rosterPlayers(partner).sort(function (a, b) { return b.ros - a.ros; }) : [];
    var table = function (list, side, title) {
      return '<div class="card"><h3>' + esc(title) + '</h3><table class="detail-table"><tr class="small muted"><td></td><td>Player</td><td>Pos</td><td class="num">FP/G</td><td class="num" title="This season vs projection">Form</td><td class="num">Our value</td><td class="num" title="How other managers likely value him">Market</td><td></td></tr>' + list.map(function (p) {
        return '<tr><td><input type="checkbox" data-side="' + side + '" data-id="' + esc(p.id) + '"' + (tradePick[side][p.id] ? ' checked' : '') + '></td><td>' + nameCell(p) + (p.onIR ? ' <span class="small muted">IR</span>' : '') + '</td><td class="pos">' + esc(p.pos.join('/')) + '</td>' +
          '<td class="num">' + fmt(p.mu) + '</td><td class="num">' + formCell(p) + '</td><td class="num">' + fmt(p.ros, 0) + '</td><td class="num">' + fmt(p.market, 0) + '</td><td>' + marketTag(p) + '</td></tr>';
      }).join('') + '</table></div>';
    };
    $('tradeRosters').innerHTML = table(mine, 'give', 'You give') + table(theirs, 'get', ownerName(partner || {}) + ' gives');
  }

  function evaluateSelected() {
    var mine = rosterPlayers(myRoster());
    var partner = st.rosters.filter(function (r) { return r.roster_id === cfg.partnerRosterId; })[0];
    var theirs = rosterPlayers(partner);
    var give = mine.filter(function (p) { return tradePick.give[p.id]; });
    var get = theirs.filter(function (p) { return tradePick.get[p.id]; });
    if (!give.length && !get.length) { $('tradeResult').innerHTML = '<p class="muted">Tick players on both sides first.</p>'; return; }
    var r = S.evaluateTrade(mine, theirs, give, get, Object.assign({}, waiverCtx(), { theirVal: theirValFor(partner.roster_id) }));
    var sign = function (v) { return '<strong class="' + (v >= 0 ? 'good' : 'bad') + '">' + (v >= 0 ? '+' : '') + fmt(v, 0) + '</strong>'; };
    $('tradeResult').innerHTML = '<div class="card"><p>You (our numbers): ' + sign(r.mine) + ' · ' + esc(ownerName(partner)) + ', as they likely see it: ' + sign(r.theirs) +
      ' · them by our numbers: ' + sign(r.theirsModel) + '.</p>' +
      (r.dropsNeeded ? '<p>You\'d need to drop <strong>' + r.drops.map(function (p) { return esc(p.name) + ' (' + fmt(p.ros, 0) + ')'; }).join(', ') + '</strong>: your lowest-valued player' + (r.dropsNeeded > 1 ? 's' : '') + ' after the trade. That cost is already in your number. Injured players only free a spot on IR if they\'re out ' + S.IR_STASH_WEEKS + '+ weeks.</p>' : '') +
      '<p class="small muted">' + verdictText(r) + '</p></div>';
  }

  function verdictText(r) {
    if (r.mine > 0 && r.theirs >= 0 && r.theirsModel < 0) return 'Good for you, and they\'ll likely see it as fair or better (market view and their needs), even though our numbers say they lose value. This is the kind of deal to pitch.';
    if (r.mine > 0 && r.theirs >= 0) return 'Helps you, and they should like it too. Easy pitch.';
    if (r.mine > 0) return 'Helps you, but they\'ll likely see it as a loss. Expect pushback, or add a sweetener.';
    return 'Doesn\'t help you by our numbers.';
  }

  function findTrades() {
    $('tradeFinder').innerHTML = '<p class="muted">Searching 1-for-1, 2-for-1 and 1-for-2 trades with every team…</p>';
    setTimeout(function () {
      var mine = rosterPlayers(myRoster());
      var teams = st.rosters.filter(function (r) { return r.roster_id !== cfg.myRosterId; })
        .map(function (r) { return { name: ownerName(r), players: rosterPlayers(r), val: theirValFor(r.roster_id), urgency: (st.teamInfo[r.roster_id] || {}).urgency || 0 }; });
      var res = S.findTrades(mine, teams, waiverCtx(), { tolerance: 0, limit: 25 });
      var list = function (ps) { return ps.map(function (p) { return esc(p.name) + ' ' + marketTag(p); }).join(' + '); };
      var mineSorted = mine.slice().sort(function (a, b) { return (b.market - b.ros) - (a.market - a.ros); });
      var sellHigh = mineSorted.filter(function (p) { return p.market > p.ros * 1.1; }).slice(0, 5);
      var buyLow = Object.keys(st.pool).map(function (k) { return st.pool[k]; })
        .filter(function (p) { return st.rostered[p.id] && st.rostered[p.id] !== cfg.myRosterId && p.ros > p.market * 1.1 && p.ros > st.fill * 1.3; })
        .sort(function (a, b) { return (b.ros - b.market) - (a.ros - a.market); }).slice(0, 8);
      var owner = function (p) { return ownerName(st.rosters.filter(function (r) { return r.roster_id === st.rostered[p.id]; })[0]); };
      $('tradeFinder').innerHTML = '<h2>Trades they\'d likely accept that help you</h2><p class="small muted">"Them (likely view)" uses market values and their needs; "Them (our numbers)" is our model. The best deals help you and look fine to them, even when our numbers say they lose.</p>' +
        (res.length ? '<div class="table-wrap"><table class="board"><thead><tr><th>Team</th><th>You give</th><th>You get</th><th class="num">You</th><th class="num">Them (likely view)</th><th class="num">Them (our numbers)</th></tr></thead><tbody>' +
        res.map(function (t) {
          return '<tr><td>' + esc(t.team.name) + (t.team.urgency >= 0.25 ? ' <span class="warnc small">needs help</span>' : '') + '</td><td>' + list(t.give) + '</td><td>' + list(t.get) + (t.drops && t.drops.length ? '<div class="small muted">you drop ' + t.drops.map(function (p) { return esc(p.name); }).join(', ') + '</div>' : '') + '</td>' +
            '<td class="num good">+' + fmt(t.mine, 0) + '</td><td class="num">' + (t.theirs >= 0 ? '+' : '') + fmt(t.theirs, 0) + '</td><td class="num ' + (t.theirsModel < 0 ? 'muted' : '') + '">' + (t.theirsModel >= 0 ? '+' : '') + fmt(t.theirsModel, 0) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">No deals found that help you and that they\'d likely accept.</p>') +
        '<div class="plan-grid"><div class="card"><h3>Buy-low targets</h3><p class="small muted">Our value is well above what their manager likely thinks.</p><table class="detail-table">' +
        buyLow.map(function (p) { return '<tr><td>' + nameCell(p) + '</td><td class="small muted">' + esc(owner(p)) + '</td><td class="num">' + formCell(p) + '</td><td class="num">' + fmt(p.ros, 0) + ' vs ' + fmt(p.market, 0) + '</td></tr>'; }).join('') +
        '</table></div><div class="card"><h3>Sell-high on your roster</h3><p class="small muted">The market likely values him above our numbers.</p><table class="detail-table">' +
        (sellHigh.length ? sellHigh.map(function (p) { return '<tr><td>' + nameCell(p) + '</td><td class="num">' + formCell(p) + '</td><td class="num">' + fmt(p.ros, 0) + ' vs ' + fmt(p.market, 0) + '</td></tr>'; }).join('') : '<tr><td class="muted">Nobody right now.</td></tr>') +
        '</table></div></div>';
    }, 30);
  }

  function showDetail(id) {
    var p = st.pool[id];
    if (!p) return;
    var projList = function (list) {
      return (list || []).map(function (g) { return dayLabel(g.date + 'T16:00:00Z') + ' vs ' + esc(g.opp || '?') + ': <strong>' + fmt(g.fp) + '</strong> (' + fmt(g.min, 0) + ' min)'; }).join('<br>') || 'none';
    };
    var weekLine = p.week ? '<tr><td>This week</td><td class="num">' + gameChips(p) + '</td></tr>' +
      '<tr><td>Sleeper projections this week</td><td class="num small">' + projList(p.projThis) + '</td></tr>' +
      '<tr><td>Expected locked score, rest of week</td><td class="num">' + fmt(p.week.value) + ' (at ' + fmt(p.week.mu) + ' FP/G)</td></tr>' +
      '<tr><td>Sleeper projections next week</td><td class="num small">' + projList(p.projNext) + '</td></tr>' +
      '<tr><td>Expected locked score, next week</td><td class="num">' + fmt(p.week.next) + '</td></tr>' : '';
    $('playerDetail').innerHTML = '<h2>' + esc(p.name) + ' <span class="pos">' + esc(p.pos.join('/')) + ' · ' + esc(p.team) + '</span></h2>' +
      (p.injury ? '<p class="bad">' + esc(p.injury) + (p.injReturn ? ' · est. return ' + esc(p.injReturn.slice(0, 10)) : '') + (p.injNote ? '<br><span class="small">' + esc(p.injNote) + '</span>' : '') + '</p>' : '') +
      '<table class="detail-table">' +
      '<tr><td>Preseason projection</td><td class="num">' + fmt(p.projFpg) + ' FP/G</td></tr>' +
      '<tr><td>This season</td><td class="num">' + (p.gp ? fmt(p.seasonFpg) + ' FP/G in ' + p.gp + ' games' : 'no games yet') + '</td></tr>' +
      '<tr><td>Blended FP/G (rest of season)</td><td class="num"><strong>' + fmt(p.mu) + '</strong></td></tr>' +
      '<tr><td>Expected locked score / week</td><td class="num">' + fmt(p.weekly) + '</td></tr>' +
      '<tr><td>Rest-of-season value (' + st.weeksLeft + ' weeks' + (p.weeksOut ? ', ~' + fmt(p.weeksOut) + ' out' : '') + ')</td><td class="num">' + fmt(p.ros, 0) + '</td></tr>' +
      weekLine + '</table>';
    $('playerModal').hidden = false;
  }

  /* ---------------- events ---------------- */

  function bind() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === t); });
        document.querySelectorAll('.tab-panel').forEach(function (x) { x.classList.toggle('active', x.id === 'tab-' + t.dataset.tab); });
      });
    });
    $('refreshBtn').addEventListener('click', loadAll);
    $('oppPolicy').value = cfg.oppPolicy || 'smart';
    $('oppPolicy').addEventListener('change', function (e) { cfg.oppPolicy = e.target.value; save(); renderMatchup(); });
    $('matchupView').addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.lockstate) {
        var id = t.dataset.lockstate, sp = st.pool[id];
        var cur = sp && sp.week && sp.week.pending ? sp.week.pending.fp : null;
        setLockState(id, t.value === 'locked' ? { type: 'locked', score: cur } : t.value === 'pickup' ? { type: 'pickup', since: st.today } : { type: t.value });
        computeWeek();
        renderMatchup();
      } else if (t.dataset.locksince) {
        setLockState(t.dataset.locksince, { type: 'pickup', since: t.value || st.today });
        computeWeek();
        renderMatchup();
      } else if (t.dataset.lockscore) {
        setLockState(t.dataset.lockscore, { type: 'locked', score: parseFloat(t.value) || 0 });
        renderMatchup();
      }
    });
    $('teamSelect').addEventListener('change', function (e) {
      cfg.myRosterId = parseInt(e.target.value, 10);
      save();
      setStatus('Loading box scores for this team…');
      loadBoxScores().then(function () { computeWeek(); render(); setStatus('Switched team.', 'ok'); });
    });
    $('partnerSelect').addEventListener('change', function (e) {
      cfg.partnerRosterId = parseInt(e.target.value, 10);
      tradePick.get = {};
      save();
      renderTradeRosters();
    });
    $('tradeRosters').addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.side) { if (t.checked) tradePick[t.dataset.side][t.dataset.id] = 1; else delete tradePick[t.dataset.side][t.dataset.id]; }
    });
    $('evalBtn').addEventListener('click', evaluateSelected);
    $('findBtn').addEventListener('click', findTrades);
    $('faPos').addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      view.faPos = b.dataset.pos;
      document.querySelectorAll('#faPos .chip').forEach(function (x) { x.classList.toggle('active', x === b); });
      renderWaivers();
    });
    $('faHealthy').addEventListener('change', function (e) { view.faHealthy = e.target.checked; renderWaivers(); });
    $('faHorizon').addEventListener('change', function (e) { view.faHorizon = e.target.value; renderWaivers(); });
    $('calcBtn').addEventListener('click', function () {
      var p = st.pool[$('calcPlayer').value];
      var score = parseFloat($('calcScore').value);
      var left = parseInt($('calcLeft').value, 10) || 0;
      if (!p || !isFinite(score)) { $('calcOut').innerHTML = '<p class="muted">Pick a player and enter his score.</p>'; return; }
      var lvl = p.week ? p.week.mu : p.mu, sdv = p.week ? p.week.sd : p.sd;
      var d = S.lockDecision(lvl, sdv, score, left, S.playProb(p.injury));
      $('calcOut').innerHTML = '<p>' + (d.forced ? 'No games left: this game counts automatically.' :
        (d.lock ? '<strong class="good">LOCK</strong>' : '<strong class="warnc">PASS</strong>') + ': the bar with ' + left + ' game' + (left === 1 ? '' : 's') + ' left is <strong>' + fmt(d.threshold) + '</strong> (his level this week ' + fmt(lvl) + ').') + '</p>';
    });
    document.body.addEventListener('click', function (e) {
      var d = e.target.closest('[data-detail]');
      if (d) showDetail(d.dataset.detail);
    });
    $('playerModal').addEventListener('click', function (e) {
      if (e.target === $('playerModal') || e.target.classList.contains('modal-close')) $('playerModal').hidden = true;
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('playerModal').hidden = true; });
  }

  bind();
  loadAll();
})();
