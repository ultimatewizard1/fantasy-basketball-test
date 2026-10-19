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
        out.league.draft_id ? Sleeper.draft(out.league.draft_id).catch(function () { return null; }) : null
      ]);
    }).then(function (r) {
      out.seasonStats = r[0];
      out.draft = r[1];
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

  function buildValues() {
    var scoring = C.cleanScoring(st.league.scoring_settings);
    st.scoring = scoring;
    st.roster = st.league.roster_positions || C.DEFAULT_ROSTER;
    st.weeksLeft = Math.max(1, S.FANTASY_WEEKS - st.week + 1);
    var consById = {};
    CONS.players.forEach(function (r) { consById[r.id] = r; });
    var ids = {};
    Object.keys(consById).forEach(function (id) { ids[id] = 1; });
    Object.keys(st.seasonStats).forEach(function (id) { ids[id] = 1; });
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
      if (!cons && gp < 2 && !isRostered(id)) return;
      var mu = S.blendFpg(projFpg, seasonFpg || 0, gp);
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
        mu: mu, sd: C.effectiveSd(mu, cv), weekly: weekly, projFpg: projFpg, seasonFpg: seasonFpg, gp: gp,
        weeksOut: weeksOut, durability: cons ? cons.durability : 0.8, adp: cons ? cons.adp : null,
        ros: S.rosValue(weekly, st.weeksLeft, cons ? cons.durability : 0.8, weeksOut)
      };
    });
    st.pool = pool;
    st.rostered = {};
    st.rosters.forEach(function (r) { (r.players || []).forEach(function (id) { st.rostered[id] = r.roster_id; }); });
    // "Market" value: the ROS value of the player ranked at this player's draft-day ADP.
    var sorted = Object.keys(pool).map(function (k) { return pool[k].ros; }).sort(function (a, b) { return b - a; });
    Object.keys(pool).forEach(function (k) {
      var p = pool[k];
      p.market = p.adp != null ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p.adp) - 1))] : p.ros;
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

  function ownerName(r) {
    var u = st.users.filter(function (x) { return x.user_id === r.owner_id; })[0];
    return u ? (u.display_name || u.user_id) : 'Team ' + r.roster_id;
  }

  /* ---------------- this week's games ---------------- */

  function loadBoxScores() {
    var mine = myRoster();
    var teams = {};
    rosterPlayers(mine).forEach(function (p) { teams[p.team] = 1; });
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

  // Per player: this week's games, a finished game that can still be locked,
  // games left, and the expected locked score for the rest of the week.
  function computeWeek() {
    var mine = myRoster();
    rosterPlayers(mine).forEach(function (p) {
      var games = st.games.filter(function (g) { return g.teams.indexOf(p.team) >= 0; });
      var key = p.team + '|' + C.normalizeName(p.name);
      var list = games.map(function (g) {
        var box = st.box[g.id];
        var row = box ? box[key] : null;
        return { game: g, state: g.state, fp: row ? row.fp : null, line: row ? row.line : null, dnp: g.state === 'post' && box && !row };
      });
      var left = list.filter(function (x) { return x.state === 'pre'; }).length;
      var live = list.some(function (x) { return x.state === 'in'; });
      // The latest finished game is lockable only if nothing after it has tipped off.
      var pending = null;
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i].state === 'post' && list[i].fp != null) {
          var laterStarted = list.slice(i + 1).some(function (x) { return x.state !== 'pre'; });
          if (!laterStarted) pending = list[i];
          break;
        }
        if (list[i].state !== 'pre') break;
      }
      var q = S.playProb(p.injury);
      p.week = {
        games: list, left: left + (live ? 1 : 0), pending: pending, q: q, live: live,
        value: S.weekValue(p.mu, p.sd, pending ? pending.fp : null, left + (live ? 1 : 0), q)
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
    renderWeek();
    renderLock();
    renderWaivers();
    renderTradeRosters();
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
      if (x.state === 'pre') return '<span class="pick-pill">' + label + '</span>';
      if (x.state === 'in') return '<span class="pick-pill next">' + label + ' live</span>';
      if (x.dnp) return '<span class="pick-pill done">' + label + ' DNP</span>';
      return '<span class="pick-pill' + (p.week.pending === x ? ' next' : '') + '">' + label + ': <strong>' + fmt(x.fp) + '</strong></span>';
    }).join(' ') || '<span class="muted small">no games</span>';
  }

  function renderWeek() {
    var mine = rosterPlayers(myRoster());
    var slots = C.starterSlots(st.roster);
    var best = C.assign(mine.filter(function (p) { return p.pos.length; }), slots, function (p) { return p.week ? p.week.value : 0; });
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
      '<div class="table-wrap"><table class="board"><thead><tr><th>Slot</th><th>Player</th><th>Pos</th><th class="num" title="Expected locked score from the rest of the week">Exp. locked</th><th>Games this week (FP)</th><th></th></tr></thead><tbody>' + rows + bench + '</tbody></table></div>';
  }

  function renderLock() {
    var r = myRoster();
    var starters = (r.starters || []).map(function (id) { return st.pool[id]; }).filter(Boolean);
    var cards = starters.map(function (p) {
      var w = p.week;
      var verdict, cls = '';
      if (w.pending && w.left === 0) { verdict = 'Last game of his week: <strong>' + fmt(w.pending.fp) + '</strong> counts automatically.'; cls = 'muted'; }
      else if (w.pending) {
        var d = S.lockDecision(p.mu, p.sd, w.pending.fp, w.left, w.q);
        verdict = (d.lock ? '<strong class="good">LOCK</strong>' : '<strong class="warnc">PASS</strong>') + ': scored <strong>' + fmt(w.pending.fp) + '</strong>, the bar with ' + w.left + ' game' + (w.left === 1 ? '' : 's') + ' left is <strong>' + fmt(d.threshold) + '</strong>' +
          (w.q < 0.95 ? ' (lowered: ' + esc(p.injury) + ')' : '') + '. Decide before his next game tips off.';
      } else if (w.live) verdict = 'Game in progress. Check back after it ends.';
      else if (!w.games.length) verdict = 'No games this week. Consider benching him.';
      else if (w.games.every(function (x) { return x.state === 'pre'; })) verdict = w.left > 1
        ? 'First game ' + dayLabel(w.games[0].game.date) + '. Lock it if it reaches <strong>' + fmt(S.lockDecision(p.mu, p.sd, 0, w.left - 1, w.q).threshold) + '</strong>; otherwise wait.'
        : 'Only one game this week (' + dayLabel(w.games[0].game.date) + '). It counts automatically.';
      else verdict = w.left > 1
        ? 'His last finished game can no longer be locked (a later game started). Bar for his next game: <strong>' + fmt(S.lockDecision(p.mu, p.sd, 0, w.left - 1, w.q).threshold) + '</strong>.'
        : 'His last finished game can no longer be locked. His final game this week counts automatically.';
      return '<div class="card"><div class="row gap wrap" style="justify-content:space-between"><div>' + nameCell(p) + ' <span class="pos">' + esc(p.pos.join('/')) + '</span></div><div class="small muted">avg ' + fmt(p.mu) + ' FP/G · swing ±' + fmt(p.sd) + '</div></div>' +
        '<div style="margin:6px 0">' + gameChips(p) + '</div><div class="' + cls + '">' + verdict + '</div></div>';
    }).join('');
    $('lockView').innerHTML = '<p class="muted small">Starters only (bench players can\'t be locked). The bar is the expected value of waiting for his remaining games. Lock if the game you just saw beats it. Sleeper doesn\'t publish what you\'ve already locked, so ignore players you\'ve locked this week.</p><div class="plan-grid">' + cards + '</div>';
    $('calcPlayer').innerHTML = rosterPlayers(r).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
  }

  function waiverCtx() {
    return { roster: st.roster, rosterSize: st.roster.filter(function (s) { return s !== 'IR'; }).length, val: function (p) { return p.ros || 0; }, fill: st.fill };
  }

  function renderWaivers() {
    var fas = Object.keys(st.pool).filter(function (k) { return !st.rostered[k]; }).map(function (k) { return st.pool[k]; })
      .filter(function (p) { return view.faPos === 'ALL' || p.pos.indexOf(view.faPos) >= 0; })
      .filter(function (p) { return !view.faHealthy || !/out/i.test(p.injury || ''); })
      .sort(function (a, b) { return b.ros - a.ros; }).slice(0, 60);
    var mine = rosterPlayers(myRoster());
    var moves = S.waiverMoves(mine, fas, waiverCtx()).slice(0, 30);
    var gamesThisWeek = function (p) { return st.games.filter(function (g) { return g.teams.indexOf(p.team) >= 0 && g.state === 'pre'; }).length; };
    $('waiverView').innerHTML = '<p class="muted small">Gain = change in your team\'s rest-of-season lineup value if you add him and drop the suggested player. FP/G blends his projection with this season\'s games.</p>' +
      '<div class="table-wrap"><table class="board"><thead><tr><th>Add</th><th>Pos</th><th class="num">FP/G</th><th class="num">Season (GP)</th><th class="num">Lock/wk</th><th class="num">ROS</th><th class="num" title="Games left this week">Wk G</th><th>Drop</th><th class="num">Gain</th></tr></thead><tbody>' +
      moves.map(function (m) {
        var p = m.add;
        return '<tr' + (m.gain > 0 ? ' class="rec"' : '') + '><td>' + nameCell(p) + '</td><td class="pos">' + esc(p.pos.join('/')) + '</td><td class="num">' + fmt(p.mu) + '</td>' +
          '<td class="num">' + (p.gp ? fmt(p.seasonFpg) + ' (' + p.gp + ')' : '–') + '</td><td class="num">' + fmt(p.weekly) + '</td><td class="num">' + fmt(p.ros, 0) + '</td><td class="num">' + gamesThisWeek(p) + '</td>' +
          '<td>' + (m.drop ? esc(m.drop.name) : '–') + '</td><td class="num ' + (m.gain > 0 ? 'good' : 'bad') + '">' + (m.gain > 0 ? '+' : '') + fmt(m.gain, 0) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  var tradePick = { give: {}, get: {} };

  function renderTradeRosters() {
    var mine = rosterPlayers(myRoster()).sort(function (a, b) { return b.ros - a.ros; });
    var partner = st.rosters.filter(function (r) { return r.roster_id === cfg.partnerRosterId; })[0];
    var theirs = partner ? rosterPlayers(partner).sort(function (a, b) { return b.ros - a.ros; }) : [];
    var table = function (list, side, title) {
      return '<div class="card"><h3>' + esc(title) + '</h3><table class="detail-table">' + list.map(function (p) {
        return '<tr><td><input type="checkbox" data-side="' + side + '" data-id="' + esc(p.id) + '"' + (tradePick[side][p.id] ? ' checked' : '') + '></td><td>' + nameCell(p) + '</td><td class="pos">' + esc(p.pos.join('/')) + '</td><td class="num">' + fmt(p.mu) + '</td><td class="num">' + fmt(p.ros, 0) + '</td></tr>';
      }).join('') + '</table><p class="small muted">FP/G · rest-of-season value</p></div>';
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
    var r = S.evaluateTrade(mine, theirs, give, get, waiverCtx());
    var sum = function (l, k) { return l.reduce(function (s, p) { return s + (p[k] || 0); }, 0); };
    var mkt = sum(get, 'market') - sum(give, 'market');
    $('tradeResult').innerHTML = '<div class="card"><p>You: <strong class="' + (r.mine >= 0 ? 'good' : 'bad') + '">' + (r.mine >= 0 ? '+' : '') + fmt(r.mine, 0) + '</strong> rest-of-season points · ' +
      esc(ownerName(partner)) + ': <strong class="' + (r.theirs >= 0 ? 'good' : 'bad') + '">' + (r.theirs >= 0 ? '+' : '') + fmt(r.theirs, 0) + '</strong>' +
      ' · Draft-day market value: you ' + (mkt >= 0 ? 'receive' : 'give') + ' ' + fmt(Math.abs(mkt), 0) + ' more' +
      (r.dropsNeeded ? ' · you would need to drop ' + r.dropsNeeded + ' player' + (r.dropsNeeded > 1 ? 's' : '') : '') + '.</p>' +
      '<p class="small muted">' + verdictText(r, mkt) + '</p></div>';
  }

  function verdictText(r, mkt) {
    if (r.mine > 0 && r.theirs >= 0) return 'Helps both teams by our numbers: a good pitch.';
    if (r.mine > 0 && mkt <= 0) return 'Helps you, and on draft-day value they get more, which makes it easier to sell.';
    if (r.mine > 0) return 'Helps you. They lose value by our numbers, so expect pushback.';
    return 'Doesn\'t help you by our numbers.';
  }

  function findTrades() {
    $('tradeFinder').innerHTML = '<p class="muted">Searching 1-for-1, 2-for-1 and 1-for-2 trades with every team…</p>';
    setTimeout(function () {
      var mine = rosterPlayers(myRoster());
      var teams = st.rosters.filter(function (r) { return r.roster_id !== cfg.myRosterId; })
        .map(function (r) { return { name: ownerName(r), players: rosterPlayers(r) }; });
      var res = S.findTrades(mine, teams, waiverCtx(), { tolerance: 0, limit: 25 });
      $('tradeFinder').innerHTML = '<h2>Trades that help you without hurting them (by our numbers)</h2>' + (res.length ? '<div class="table-wrap"><table class="board"><thead><tr><th>Team</th><th>You give</th><th>You get</th><th class="num">You</th><th class="num">Them</th></tr></thead><tbody>' +
        res.map(function (t) {
          return '<tr><td>' + esc(t.team.name) + '</td><td>' + t.give.map(function (p) { return esc(p.name); }).join(' + ') + '</td><td>' + t.get.map(function (p) { return esc(p.name); }).join(' + ') + '</td>' +
            '<td class="num good">+' + fmt(t.mine, 0) + '</td><td class="num">' + (t.theirs >= 0 ? '+' : '') + fmt(t.theirs, 0) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">No win-win trades found right now.</p>');
    }, 30);
  }

  function showDetail(id) {
    var p = st.pool[id];
    if (!p) return;
    var weekLine = p.week ? '<tr><td>This week</td><td class="num">' + gameChips(p) + '</td></tr><tr><td>Expected locked score, rest of week</td><td class="num">' + fmt(p.week.value) + '</td></tr>' : '';
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
    $('calcBtn').addEventListener('click', function () {
      var p = st.pool[$('calcPlayer').value];
      var score = parseFloat($('calcScore').value);
      var left = parseInt($('calcLeft').value, 10) || 0;
      if (!p || !isFinite(score)) { $('calcOut').innerHTML = '<p class="muted">Pick a player and enter his score.</p>'; return; }
      var d = S.lockDecision(p.mu, p.sd, score, left, S.playProb(p.injury));
      $('calcOut').innerHTML = '<p>' + (d.forced ? 'No games left: this game counts automatically.' :
        (d.lock ? '<strong class="good">LOCK</strong>' : '<strong class="warnc">PASS</strong>') + ': the bar with ' + left + ' game' + (left === 1 ? '' : 's') + ' left is <strong>' + fmt(d.threshold) + '</strong> (his average ' + fmt(p.mu) + ').') + '</p>';
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
