/* global DraftCore, Sleeper */
(function () {
  'use strict';

  var C = DraftCore;
  var $ = function (id) { return document.getElementById(id); };
  var LS = { config: 'fbd.config.v1', data: 'fbd.data.v1', picks: 'fbd.picks.v1' };

  var DEFAULT_CONFIG = {
    leagueId: '1414370391324950528',
    username: '',
    draftId: '',
    teams: 10,
    slot: 6,
    rounds: 13,
    roster: C.DEFAULT_ROSTER.slice(),
    scoring: Object.assign({}, C.DEFAULT_SCORING),
    projSeason: '',
    statsSeason: '',
    projWeight: 0.6,
    valueKey: 'total',
    gamesCap: 78,
    benchWeight: 0.3,
    adpKey: ''
  };

  var config = Object.assign({}, DEFAULT_CONFIG, load(LS.config) || {});
  var data = load(LS.data) || { projections: {}, stats: {}, players: {}, csv: null, leagueName: '', sources: {} };
  var picksState = load(LS.picks) || { mode: 'manual', picks: [] };
  var players = data.players || {};
  var pool = [];
  var poolById = {};
  var replInfo = null;
  var view = { pos: 'ALL', search: '', sortBy: 'score', showDrafted: false };
  var liveTimer = null;
  var derived = null;

  /* ---------------- persistence ---------------- */

  function load(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function saveAll() {
    save(LS.config, config);
    save(LS.picks, picksState);
    var toSave = Object.assign({}, data, { players: Object.keys(players).length > 4000 ? {} : players });
    if (!save(LS.data, toSave)) save(LS.data, Object.assign({}, toSave, { players: {} }));
  }

  // Drop stat keys we never use so projections fit in localStorage.
  function slimStats(map) {
    var keep = Object.assign({ gp: 1, gs: 1, min: 1 }, config.scoring, C.DEFAULT_SCORING);
    var out = {};
    Object.keys(map).forEach(function (id) {
      var s = map[id], o = {};
      Object.keys(s).forEach(function (k) {
        if (keep[k] != null || k.indexOf('adp') === 0) o[k] = s[k];
      });
      if (Object.keys(o).length) out[id] = o;
    });
    return out;
  }

  /* ---------------- utils ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n, d) { return n == null || !isFinite(n) ? '–' : Number(n).toFixed(d == null ? 1 : d); }
  function pct(p) { return p == null ? '–' : Math.round(p * 100) + '%'; }
  function setStatus(html, cls) { $('status').innerHTML = html ? '<span class="' + (cls || '') + '">' + html + '</span>' : ''; }
  function nameOf(id) {
    var p = poolById[id] || players[id];
    return p ? (p.name || p.full_name || id) : id;
  }

  /* ---------------- model ---------------- */

  function rebuild() {
    var proj = data.projections || {};
    var stats = data.stats || {};
    var adp = {};
    var allPlayers = Object.assign({}, players);
    if (data.csv) {
      Object.assign(allPlayers, data.csv.extraPlayers || {});
      if (data.csv.role === 'projections') proj = data.csv.stats;
      else stats = data.csv.stats;
    }
    if (config.adpKey === 'csv' && data.csv) adp = data.csv.adp || {};
    else if (config.adpKey && config.adpKey !== 'none') adp = C.extractAdp(data.projections || {}, config.adpKey);

    pool = C.buildPool({ players: allPlayers, projections: proj, stats: stats, adp: adp }, {
      scoring: config.scoring,
      projWeight: config.projWeight,
      gamesCap: config.gamesCap
    });
    poolById = {};
    pool.forEach(function (p) { poolById[p.id] = p; });
    replInfo = pool.length ? C.applyValues(pool, config.roster, config.teams, config.valueKey) : null;
    pool.forEach(function (p) { p.diff = p.adpRank != null ? p.adpRank - p.rank : null; });
  }

  function adpOptions() {
    var opts = C.adpKeys(data.projections || {});
    var list = opts.map(function (o) { return { value: o.key, label: 'Sleeper ' + o.key + ' (' + o.count + ' players)' }; });
    if (data.csv && data.csv.adp && Object.keys(data.csv.adp).length) list.push({ value: 'csv', label: 'ADP column from CSV' });
    list.push({ value: 'none', label: 'None (use our rank as a proxy)' });
    return list;
  }

  function ensureAdpKey() {
    var opts = adpOptions();
    if (!opts.some(function (o) { return o.value === config.adpKey; })) config.adpKey = opts[0].value;
  }

  /* ---------------- draft state ---------------- */

  function draftedIds() {
    var s = {};
    picksState.picks.forEach(function (p) { if (p.player_id) s[p.player_id] = p; });
    return s;
  }
  function currentPick() {
    var max = 0;
    picksState.picks.forEach(function (p) { if (p.pick_no > max) max = p.pick_no; });
    return max + 1;
  }
  function totalPicks() { return config.teams * config.rounds; }
  function myPickList() { return C.myPicks(config.slot, config.teams, config.rounds); }
  function upcomingMine() {
    var cur = currentPick();
    return myPickList().filter(function (p) { return p.pick >= cur; });
  }

  // Effective ADP for availability maths: real ADP, else our rank as a stand-in.
  function effAdp(p) { return p.adp != null ? p.adp : p.rank; }

  function computeDerived() {
    var drafted = draftedIds();
    var mine = [];
    var mineOther = [];
    picksState.picks.forEach(function (pk) {
      if (!pk.mine) return;
      if (poolById[pk.player_id]) mine.push(poolById[pk.player_id]);
      else mineOther.push(pk);
    });
    var available = pool.filter(function (p) { return !drafted[p.id]; });
    var base = C.rosterScore(mine, config.roster, config.benchWeight);

    var cur = currentPick();
    var up = upcomingMine();
    var onClock = up.length && up[0].pick === cur;
    var decision = up.length ? up[0].pick : null;
    var following = up.length > 1 ? up[1].pick : null;

    // Gain for everyone available.
    available.forEach(function (p) {
      p.gain = C.marginalGain(mine, p, config.roster, config.benchWeight, base.score);
      // "Next": will he last until the next pick where I get to choose again?
      var target = onClock ? following : decision;
      p.next = target ? C.availability(effAdp(p), cur, target) : null;
    });

    // Pick-now value: gain minus what passing on him costs, using odds he
    // survives from my decision pick to my following pick.
    var cands = available.slice().sort(function (a, b) { return b.gain - a.gain; }).slice(0, 80);
    var probs = cands.map(function (p) {
      if (!decision || !following) return 0;
      return C.availability(effAdp(p), Math.max(cur, decision), following);
    });
    function expectedBest(skip) {
      var e = 0, none = 1;
      for (var i = 0; i < cands.length; i++) {
        if (i === skip) continue;
        e += Math.max(cands[i].gain, 0) * probs[i] * none;
        none *= 1 - probs[i];
      }
      return e;
    }
    var eAll = expectedBest(-1);
    available.forEach(function (p) { p.score = p.gain; });
    cands.forEach(function (p, i) { p.score = p.gain - (eAll - expectedBest(i)); });

    var recs = available.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, 3);
    derived = {
      drafted: drafted, mine: mine, mineOther: mineOther, available: available, base: base,
      cur: cur, up: up, onClock: onClock, decision: decision, following: following, recs: recs
    };
  }

  function addPick(playerId, mine) {
    var cur = currentPick();
    if (cur > totalPicks()) return;
    var p = poolById[playerId] || players[playerId] || {};
    picksState.picks.push({
      pick_no: cur,
      player_id: playerId,
      name: p.name || p.full_name || playerId,
      slot: mine ? config.slot : C.slotForPick(cur, config.teams),
      mine: !!mine
    });
  }

  function runMockOpponents() {
    if (picksState.mode !== 'mock') return;
    var guard = 0;
    while (currentPick() <= totalPicks() && C.slotForPick(currentPick(), config.teams) !== config.slot && guard++ < 500) {
      var drafted = draftedIds();
      var avail = pool.filter(function (p) { return !drafted[p.id]; }).slice(0, 200);
      var choice = C.mockPick(avail, currentPick());
      if (!choice) break;
      addPick(choice.id, false);
    }
  }

  /* ---------------- live sync ---------------- */

  function syncPicks(quiet) {
    if (!config.draftId) { if (!quiet) setStatus('No Sleeper draft ID yet. Load your league in Settings first.', 'err'); return Promise.resolve(); }
    return Sleeper.picks(config.draftId).then(function (list) {
      var myUserId = data.myUserId;
      picksState.mode = 'live';
      picksState.picks = (list || []).map(function (pk) {
        var meta = pk.metadata || {};
        return {
          pick_no: pk.pick_no,
          player_id: String(pk.player_id),
          name: ((meta.first_name || '') + ' ' + (meta.last_name || '')).trim() || nameOf(pk.player_id),
          slot: pk.draft_slot,
          mine: pk.draft_slot === config.slot || (myUserId && pk.picked_by === myUserId)
        };
      }).sort(function (a, b) { return a.pick_no - b.pick_no; });
      saveAll();
      render();
      if (!quiet) setStatus('Synced ' + picksState.picks.length + ' picks from Sleeper.', 'ok');
    }).catch(function (e) {
      setStatus('Could not fetch draft picks: ' + esc(e.message), 'err');
    });
  }

  function setLive(on) {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    $('liveToggle').checked = on;
    if (on) {
      syncPicks(false);
      liveTimer = setInterval(function () { if (!document.hidden) syncPicks(true); }, 4000);
    }
  }

  /* ---------------- loading ---------------- */

  function loadFromSleeper() {
    readSettingsForm();
    var leagueId = config.leagueId.trim();
    if (!leagueId) { setStatus('Enter a league ID first.', 'err'); return; }
    var notes = [];
    setStatus('Loading league…');
    Sleeper.league(leagueId).then(function (L) {
      var lg = L.league;
      data.leagueName = lg.name || '';
      config.teams = lg.total_rosters || config.teams;
      if (Array.isArray(lg.roster_positions) && lg.roster_positions.length) config.roster = lg.roster_positions.slice();
      if (lg.scoring_settings) config.scoring = C.cleanScoring(lg.scoring_settings);
      config.rounds = config.roster.length;
      var season = parseInt(lg.season, 10);
      if (!config.projSeason) config.projSeason = String(season);
      if (!config.statsSeason) config.statsSeason = String(season - 1);
      config.draftId = config.draftId || lg.draft_id || (L.drafts[0] && L.drafts[0].draft_id) || '';
      var me = null;
      var uname = config.username.trim().toLowerCase();
      if (uname) {
        me = L.users.filter(function (u) {
          return (u.display_name || '').toLowerCase() === uname || (u.username || '').toLowerCase() === uname;
        })[0];
        if (!me) notes.push('username "' + esc(config.username) + '" not found in league');
      }
      data.myUserId = me ? me.user_id : null;
      setStatus('Loading draft and player data…');
      var draftP = config.draftId ? Sleeper.draft(config.draftId).catch(function () { return null; }) : Promise.resolve(null);
      return Promise.all([
        draftP,
        Sleeper.players(false).catch(function (e) { notes.push('player list failed (' + esc(e.message) + ')'); return null; }),
        Sleeper.projections(config.projSeason).catch(function (e) { notes.push('projections unavailable (' + esc(e.message) + ')'); return null; }),
        Sleeper.stats(config.statsSeason).catch(function (e) { notes.push('last-season stats unavailable (' + esc(e.message) + ')'); return null; })
      ]);
    }).then(function (r) {
      if (!r) return;
      var draft = r[0], pl = r[1], proj = r[2], stats = r[3];
      if (draft) {
        if (draft.settings && draft.settings.rounds) config.rounds = draft.settings.rounds;
        if (draft.settings && draft.settings.teams) config.teams = draft.settings.teams;
        if (draft.draft_order && data.myUserId && draft.draft_order[data.myUserId]) config.slot = draft.draft_order[data.myUserId];
        data.draftStatus = draft.status;
      }
      var embedded = {};
      if (proj) embedded = Object.assign(embedded, Sleeper.slimPlayers(C.playersFromPayload(proj.data)));
      if (stats) embedded = Object.assign(embedded, Sleeper.slimPlayers(C.playersFromPayload(stats.data)));
      players = Object.assign({}, embedded, pl || {});
      if (proj) { data.projections = slimStats(C.normalizeStatsPayload(proj.data)); data.sources.projections = proj.url; }
      if (stats) { data.stats = slimStats(C.normalizeStatsPayload(stats.data)); data.sources.stats = stats.url; }
      // Fresh data: pick the best ADP source again rather than a stale choice.
      config.adpKey = '';
      ensureAdpKey();
      rebuild();
      saveAll();
      populateSettingsForm();
      var msg = 'Loaded ' + esc(data.leagueName) + ': ' + pool.length + ' players valued, ' +
        Object.keys(data.projections).length + ' projections, ' + Object.keys(data.stats).length + ' stat lines' +
        (config.adpKey && config.adpKey !== 'none' ? ', ADP from ' + esc(config.adpKey) : ', no ADP found') + '.';
      if (notes.length) msg += ' <span class="warnc">Note: ' + notes.join('; ') + '.</span>';
      setStatus(msg, pool.length ? 'ok' : 'err');
      if (config.draftId) return syncPicks(true);
    }).then(render).catch(function (e) {
      var hint = e instanceof TypeError ? ' Your browser blocked the request. Use <em>Manual import</em> in Settings instead.' : '';
      setStatus('Load failed: ' + esc(e.message) + '.' + hint, 'err');
      renderManualLinks();
    });
  }

  function parsePasted(id) {
    var v = $(id).value.trim();
    if (!v) return null;
    try { return JSON.parse(v); } catch (e) { throw new Error('Could not parse ' + id.replace('paste', '') + ' JSON: ' + e.message); }
  }

  function usePasted() {
    try {
      var lg = parsePasted('pasteLeague');
      var pl = parsePasted('pastePlayers');
      var proj = parsePasted('pasteProj');
      var st = parsePasted('pasteStats');
      if (lg) {
        data.leagueName = lg.name || data.leagueName;
        config.teams = lg.total_rosters || config.teams;
        if (lg.roster_positions) { config.roster = lg.roster_positions.slice(); config.rounds = config.roster.length; }
        if (lg.scoring_settings) config.scoring = C.cleanScoring(lg.scoring_settings);
        if (lg.draft_id) config.draftId = lg.draft_id;
      }
      if (pl) players = Sleeper.slimPlayers(pl);
      if (proj) {
        players = Object.assign(Sleeper.slimPlayers(C.playersFromPayload(proj)), players);
        data.projections = slimStats(C.normalizeStatsPayload(proj));
      }
      if (st) {
        players = Object.assign(Sleeper.slimPlayers(C.playersFromPayload(st)), players);
        data.stats = slimStats(C.normalizeStatsPayload(st));
      }
      ensureAdpKey();
      rebuild();
      saveAll();
      populateSettingsForm();
      render();
      setStatus('Pasted data loaded: ' + pool.length + ' players valued.', 'ok');
    } catch (e) { setStatus(esc(e.message), 'err'); }
  }

  function importCsv(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var res = C.statsFromCsv(String(reader.result), players);
      var n = Object.keys(res.stats).length;
      if (!n) { $('csvResult').textContent = 'No usable rows found. Check the column headers.'; return; }
      data.csv = { role: $('csvRole').value, stats: res.stats, adp: res.adp, extraPlayers: res.extraPlayers, name: file.name };
      ensureAdpKey();
      rebuild();
      saveAll();
      populateSettingsForm();
      render();
      $('csvResult').innerHTML = 'Imported ' + n + ' players from ' + esc(file.name) + ' as ' + data.csv.role + '.' +
        (res.unmatched.length ? ' Unmatched: ' + esc(res.unmatched.slice(0, 15).join(', ')) + (res.unmatched.length > 15 ? '…' : '') : '');
    };
    reader.readAsText(file);
  }

  /* ---------------- settings form ---------------- */

  function populateSettingsForm() {
    $('leagueId').value = config.leagueId;
    $('username').value = config.username;
    $('draftId').value = config.draftId;
    $('teams').value = config.teams;
    $('slot').value = config.slot;
    $('rounds').value = config.rounds;
    $('roster').value = config.roster.join(', ');
    $('scoring').value = JSON.stringify(config.scoring, null, 1);
    $('projSeason').value = config.projSeason;
    $('statsSeason').value = config.statsSeason;
    $('projWeight').value = Math.round(config.projWeight * 100);
    $('projWeightOut').textContent = Math.round(config.projWeight * 100) + '% projections / ' + (100 - Math.round(config.projWeight * 100)) + '% last season';
    $('valueKey').value = config.valueKey;
    $('gamesCap').value = config.gamesCap;
    $('benchWeight').value = config.benchWeight;
    var sel = $('adpKey');
    sel.innerHTML = adpOptions().map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (o.value === config.adpKey ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    $('leagueName').textContent = data.leagueName ? data.leagueName + ' · ' + config.teams + ' teams · slot ' + config.slot : 'No league loaded';
    renderManualLinks();
  }

  function readSettingsForm() {
    config.leagueId = $('leagueId').value.trim();
    config.username = $('username').value.trim();
    config.draftId = $('draftId').value.trim();
    config.teams = Math.max(2, parseInt($('teams').value, 10) || config.teams);
    config.slot = Math.min(config.teams, Math.max(1, parseInt($('slot').value, 10) || config.slot));
    config.rounds = Math.max(1, parseInt($('rounds').value, 10) || config.rounds);
    var roster = $('roster').value.split(/[\s,]+/).map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
    if (roster.length) config.roster = roster;
    try { config.scoring = C.cleanScoring(JSON.parse($('scoring').value)); }
    catch (e) { setStatus('Scoring JSON is invalid; keeping previous scoring.', 'err'); }
    config.projSeason = $('projSeason').value.trim();
    config.statsSeason = $('statsSeason').value.trim();
    config.projWeight = (parseInt($('projWeight').value, 10) || 0) / 100;
    config.valueKey = $('valueKey').value;
    config.gamesCap = Math.max(1, parseInt($('gamesCap').value, 10) || 82);
    var bw = parseFloat($('benchWeight').value);
    config.benchWeight = isFinite(bw) ? Math.max(0, Math.min(1, bw)) : config.benchWeight;
    config.adpKey = $('adpKey').value || config.adpKey;
  }

  function renderManualLinks() {
    var ps = config.projSeason || '2026', ss = config.statsSeason || '2025';
    var links = [
      ['Players', Sleeper.V1 + '/players/nba'],
      ['Projections', Sleeper.seasonUrls('projections', ps)[0]],
      ['Last-season stats', Sleeper.seasonUrls('stats', ss)[0]],
      ['League', Sleeper.V1 + '/league/' + encodeURIComponent(config.leagueId || '')]
    ];
    $('manualLinks').innerHTML = links.map(function (l) {
      return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + ': ' + esc(l[1]) + '</a>';
    }).join('');
  }

  /* ---------------- rendering ---------------- */

  function render() {
    if (!pool.length) {
      $('board').querySelector('tbody').innerHTML = '<tr><td colspan="13" class="muted">No player data yet. Go to <strong>Settings &amp; data</strong> and click <strong>Load from Sleeper</strong>.</td></tr>';
      $('recs').innerHTML = '';
      renderSide();
      renderClock();
      $('plan').innerHTML = '<p class="muted">Load data to build your draft plan.</p>';
      return;
    }
    computeDerived();
    renderClock();
    renderRecs();
    renderBoard();
    renderSide();
    renderPlan();
    $('mockBtn').textContent = picksState.mode === 'mock' ? 'End mock draft' : 'Start mock draft';
    $('undoBtn').disabled = picksState.mode === 'live' || !picksState.picks.length;
  }

  function roundLabel(pick) {
    var r = Math.ceil(pick / config.teams);
    var i = ((pick - 1) % config.teams) + 1;
    return 'R' + r + '.' + (i < 10 ? '0' : '') + i;
  }

  function renderClock() {
    var cur = currentPick();
    var el = $('clock');
    if (cur > totalPicks()) { el.innerHTML = 'Draft complete'; return; }
    var up = upcomingMine();
    if (!up.length) { el.innerHTML = 'Pick ' + cur + ' (' + roundLabel(cur) + ')'; return; }
    var until = up[0].pick - cur;
    if (until === 0) el.innerHTML = '<span class="you">You are on the clock: pick ' + cur + ' (' + roundLabel(cur) + ')</span>';
    else el.innerHTML = 'Pick ' + cur + ' (' + roundLabel(cur) + ') · <span class="' + (until <= 2 ? 'soon' : '') + '">your pick in ' + until + '</span> (#' + up[0].pick + ')';
  }

  function whyText(p) {
    var bits = [];
    var gainPct = derived.recs[0] && derived.recs[0].gain > 0 ? p.gain / derived.recs[0].gain : 1;
    bits.push(fmt(p.fpg) + ' FP/G, ' + fmt(p.gp, 0) + ' GP');
    bits.push('VORP ' + fmt(p.vorp, 0));
    if (p.next != null) bits.push(pct(p.next) + ' to last to your next pick');
    if (p.diff != null && p.diff >= 10) bits.push('market undervalues him (+' + p.diff + ')');
    if (gainPct < 0.6) bits.push('limited lineup fit');
    if (p.injury) bits.push('injury: ' + p.injury);
    return bits.join(' · ');
  }

  function renderRecs() {
    var labels = ['Best pick now', 'Alternative', 'Alternative'];
    $('recs').innerHTML = derived.recs.map(function (p, i) {
      return '<div class="rec-card' + (i === 0 ? ' top' : '') + '">' +
        '<div class="label">' + labels[i] + (derived.onClock ? '' : ' (at #' + (derived.decision || '–') + ')') + '</div>' +
        '<div class="who" data-detail="' + esc(p.id) + '">' + esc(p.name) + ' <span class="pos">' + esc(p.pos.join('/')) + ' · ' + esc(p.team) + '</span></div>' +
        '<div class="why">' + esc(whyText(p)) + '</div></div>';
    }).join('');
  }

  function fitsLineup(p) { return p.gain > 0.5 * Math.max(p.vorp, 0) && p.gain > 0; }

  function renderBoard() {
    var q = view.search.toLowerCase();
    var recIds = {};
    derived.recs.forEach(function (p) { recIds[p.id] = 1; });
    var rows = (view.showDrafted ? pool : derived.available).filter(function (p) {
      if (view.pos === 'NEED') { if (derived.drafted[p.id] || !fitsLineup(p)) return false; }
      else if (view.pos !== 'ALL' && p.pos.indexOf(view.pos) < 0) return false;
      if (q && p.name.toLowerCase().indexOf(q) < 0 && String(p.team).toLowerCase() !== q) return false;
      return true;
    });
    var key = view.sortBy;
    var sorters = {
      score: function (p) { return derived.drafted[p.id] ? -1e9 + p.vorp : p.score; },
      gain: function (p) { return derived.drafted[p.id] ? -1e9 + p.vorp : p.gain; },
      vorp: function (p) { return p.vorp; },
      fpg: function (p) { return p.fpg; },
      total: function (p) { return p.total; },
      adp: function (p) { return p.adp != null ? -p.adp : -1e9; },
      diff: function (p) { return p.diff != null ? p.diff : -1e9; }
    };
    var f = sorters[key] || sorters.score;
    rows.sort(function (a, b) { return f(b) - f(a); });
    rows = rows.slice(0, 300);

    var tierKey = { vorp: 'vorp', fpg: 'fpg', total: 'total' }[key];
    var top = rows.length && tierKey ? Math.abs(rows[0][tierKey]) || 1 : 1;
    var html = rows.map(function (p, i) {
      var d = derived.drafted[p.id];
      var cls = [];
      if (d) cls.push(d.mine ? 'mine' : 'drafted');
      if (recIds[p.id]) cls.push('rec');
      if (tierKey && i > 0 && rows[i - 1][tierKey] - p[tierKey] > 0.035 * top) cls.push('tier-break');
      var diffCls = p.diff == null ? '' : p.diff >= 10 ? 'good' : p.diff <= -10 ? 'bad' : '';
      var nextCls = p.next == null ? '' : p.next < 0.3 ? 'bad' : p.next > 0.7 ? 'good' : 'warnc';
      var actions = d
        ? '<span class="muted small">#' + d.pick_no + (d.mine ? ' (you)' : '') + '</span>'
        : (picksState.mode === 'live' ? '' :
          '<button class="btn small" data-take="' + esc(p.id) + '" title="Drafted by another team">Taken</button>' +
          '<button class="btn small mine" data-mine="' + esc(p.id) + '" title="I drafted him">Mine</button>');
      return '<tr class="' + cls.join(' ') + '">' +
        '<td>' + p.rank + '</td>' +
        '<td><span class="name" data-detail="' + esc(p.id) + '">' + esc(p.name) + '</span><span class="team">' + esc(p.team) + '</span>' +
        (p.injury ? '<span class="inj">' + esc(p.injury.toUpperCase()) + '</span>' : '') + '</td>' +
        '<td class="pos">' + esc(p.pos.join('/')) + '</td>' +
        '<td class="num">' + fmt(p.fpg) + '</td>' +
        '<td class="num">' + fmt(p.gp, 0) + '</td>' +
        '<td class="num">' + fmt(p.total, 0) + '</td>' +
        '<td class="num">' + fmt(p.vorp, config.valueKey === 'fpg' ? 1 : 0) + '</td>' +
        '<td class="num">' + (d ? '–' : fmt(p.gain, config.valueKey === 'fpg' ? 1 : 0)) + '</td>' +
        '<td class="num">' + (d ? '–' : fmt(p.score, config.valueKey === 'fpg' ? 1 : 0)) + '</td>' +
        '<td class="num">' + fmt(p.adp, 1) + '</td>' +
        '<td class="num ' + diffCls + '">' + (p.diff == null ? '–' : (p.diff > 0 ? '+' : '') + p.diff) + '</td>' +
        '<td class="num ' + nextCls + '">' + (d ? '–' : pct(p.next)) + '</td>' +
        '<td><div class="actions">' + actions + '</div></td></tr>';
    }).join('');
    $('board').querySelector('tbody').innerHTML = html || '<tr><td colspan="13" class="muted">No players match.</td></tr>';
  }

  function renderSide() {
    // Lineup
    var lineupHtml = '';
    if (derived) {
      var lu = derived.base.lineup;
      lineupHtml = lu.starters.map(function (s) {
        return '<div class="lineup-row"><span class="slot">' + esc(s.slot) + '</span>' +
          (s.player ? '<span>' + esc(s.player.name) + ' <span class="pos">' + esc(s.player.pos.join('/')) + '</span></span><span class="num small">' + fmt(s.player.fpg) + '</span>'
            : '<span class="slot-empty">empty</span><span></span>') + '</div>';
      }).join('');
      var benchSlots = C.benchCount(config.roster);
      var bench = lu.bench.concat(derived.mineOther.map(function (pk) { return { name: pk.name, pos: [], fpg: null }; }));
      for (var i = 0; i < Math.max(benchSlots, bench.length); i++) {
        var b = bench[i];
        lineupHtml += '<div class="lineup-row"><span class="slot">BN</span>' +
          (b ? '<span>' + esc(b.name) + ' <span class="pos">' + esc((b.pos || []).join('/')) + '</span></span><span class="num small">' + fmt(b.fpg) + '</span>'
            : '<span class="slot-empty">empty</span><span></span>') + '</div>';
      }
      var startFpg = 0;
      lu.starters.forEach(function (s) { if (s.player) startFpg += s.player.fpg; });
      lineupHtml += '<p class="small muted">Starters: ' + fmt(startFpg) + ' FP/G combined.</p>';
    }
    $('myLineup').innerHTML = lineupHtml || '<p class="muted small">No picks yet.</p>';

    // My picks
    var cur = currentPick();
    var nextShown = false;
    $('myPicks').innerHTML = myPickList().map(function (mp) {
      var cls = 'pick-pill';
      if (mp.pick < cur) cls += ' done';
      else if (!nextShown) { cls += ' next'; nextShown = true; }
      return '<span class="' + cls + '" title="Round ' + mp.round + '">R' + mp.round + ' · #' + mp.pick + '</span>';
    }).join('');

    // Feed
    var feed = picksState.picks.slice(-40).reverse().map(function (pk) {
      return '<div class="' + (pk.mine ? 'me' : '') + '">#' + pk.pick_no + ' ' + roundLabel(pk.pick_no) + ' · ' + esc(pk.name) +
        (pk.mine ? ' (you)' : ' · team ' + (pk.slot || '?')) + '</div>';
    }).join('');
    $('recentPicks').innerHTML = feed || '<p class="muted small">No picks yet.</p>';
  }

  /* ---------------- draft plan tab ---------------- */

  function renderPlan() {
    var avail = derived.available;
    var cur = derived.cur;
    var hasAdp = pool.some(function (p) { return p.adp != null; });
    var html = '<div class="plan">';

    html += '<div class="card prose"><h2>Your draft at a glance</h2>' +
      '<p>' + config.teams + '-team snake, slot <strong>' + config.slot + '</strong>, ' + config.rounds + ' rounds. Your picks: ' +
      myPickList().map(function (m) { return '#' + m.pick; }).join(', ') + '. ' +
      'The longest wait between your picks is ' + longestGap() + ' picks, at the turns.</p>' +
      scoringInsight() +
      (hasAdp ? '' : '<p class="warnc">No ADP loaded, so availability uses our own rank as a stand-in. Expect real drafters to differ.</p>') +
      '</div>';

    // Round targets
    html += '<h2>Round-by-round targets</h2><p class="muted small">Players likely (≥45%) to be on the board at each of your picks, best VORP first. Each player is listed only at your earliest pick where he is a realistic target. This updates live as the draft moves.</p><div class="plan-grid">';
    var used = {};
    upcomingMine().slice(0, 8).forEach(function (mp) {
      var list = avail.filter(function (p) {
        return !used[p.id] && C.availability(effAdp(p), cur, mp.pick) >= 0.45;
      }).slice(0, 7);
      list.forEach(function (p) { used[p.id] = 1; });
      html += '<div class="card"><h3>Round ' + mp.round + ' · pick #' + mp.pick + '</h3><table><tr><th>Player</th><th>Pos</th><th class="num">FP/G</th><th class="num">ADP</th><th class="num">Avail</th></tr>' +
        list.map(function (p) {
          return '<tr><td><span class="name" data-detail="' + esc(p.id) + '">' + esc(p.name) + '</span></td><td class="pos">' + esc(p.pos.join('/')) + '</td><td class="num">' + fmt(p.fpg) +
            '</td><td class="num">' + fmt(p.adp) + '</td><td class="num">' + pct(C.availability(effAdp(p), cur, mp.pick)) + '</td></tr>';
        }).join('') + '</table></div>';
    });
    html += '</div>';

    // Positional scarcity
    html += '<h2>Positional scarcity</h2><div class="card"><table><tr><th>Pos</th><th class="num">Replacement level (' + (config.valueKey === 'fpg' ? 'FP/G' : 'season FP') + ')</th><th class="num">Players above replacement (left)</th><th>Best available</th><th class="num">Top-5 avg VORP left</th></tr>';
    C.BASE_POSITIONS.forEach(function (pos) {
      var left = avail.filter(function (p) { return p.pos.indexOf(pos) >= 0; });
      var above = left.filter(function (p) { return p.vorp > 0; });
      var top5 = left.slice(0, 5);
      var avg = top5.length ? top5.reduce(function (s, p) { return s + p.vorp; }, 0) / top5.length : 0;
      html += '<tr><td><strong>' + pos + '</strong></td><td class="num">' + fmt(replInfo.repl[pos], config.valueKey === 'fpg' ? 1 : 0) + '</td><td class="num">' + above.length +
        '</td><td>' + (left[0] ? esc(left[0].name) : '–') + '</td><td class="num">' + fmt(avg, 0) + '</td></tr>';
    });
    html += '</table><p class="small muted">With 3 UTIL slots, ' + C.starterSlots(config.roster).length * config.teams + ' players start league-wide. Few players above replacement at a position means fill it early. Several players above replacement means you can wait.</p></div>';

    // Value vs ADP
    if (hasAdp) {
      var sleepers = avail.filter(function (p) { return p.diff != null && p.rank <= 150; }).sort(function (a, b) { return b.diff - a.diff; }).slice(0, 12);
      var traps = avail.filter(function (p) { return p.diff != null && p.adpRank <= 130; }).sort(function (a, b) { return a.diff - b.diff; }).slice(0, 12);
      html += '<div class="plan-grid"><div class="card"><h3>Your scoring likes them more than ADP does (wait on them)</h3>' + diffTable(sleepers) + '</div>' +
        '<div class="card"><h3>ADP likes them more than your scoring does (let others reach)</h3>' + diffTable(traps) + '</div></div>';
    }

    // Scoring-format movers
    var movers = formatMovers(avail);
    html += '<div class="plan-grid"><div class="card"><h3>Format risers: better here than in points-only rankings</h3>' + moverTable(movers.risers) + '</div>' +
      '<div class="card"><h3>Format fallers: scorers who lose value here</h3>' + moverTable(movers.fallers) + '</div></div>';

    html += '</div>';
    $('plan').innerHTML = html;
  }

  function longestGap() {
    var picks = myPickList();
    var g = 0;
    for (var i = 1; i < picks.length; i++) g = Math.max(g, picks[i].pick - picks[i - 1].pick);
    return g;
  }

  function scoringInsight() {
    var s = config.scoring;
    var ptsW = s.pts || 0;
    if (!ptsW) return '';
    var rel = function (k) { return s[k] ? fmt(s[k] / ptsW, 0) : '0'; };
    // Average share of fantasy points by stat among the top 100.
    var top = pool.slice(0, 100);
    var shares = {};
    var tot = 0;
    top.forEach(function (p) {
      C.breakdown(p.line, s).forEach(function (b) {
        shares[b.key] = (shares[b.key] || 0) + b.points;
        tot += b.points;
      });
    });
    var shareTxt = Object.keys(shares).filter(function (k) { return Math.abs(shares[k]) / tot >= 0.01; })
      .sort(function (a, b) { return Math.abs(shares[b]) - Math.abs(shares[a]); })
      .map(function (k) { return (C.STAT_LABELS[k] || k) + ' ' + Math.round(100 * shares[k] / tot) + '%'; }).join(', ');
    return '<p>In this scoring, one rebound or assist is worth ' + rel('reb') + ' points scored, and one steal or block is worth ' + rel('stl') + '. ' +
      'Among the top 100 players, fantasy points come from: ' + shareTxt + '. ' +
      'So rebounding and passing bigs, stocks-heavy defenders and high-assist guards beat pure scorers with the same box-score "feel".</p>';
  }

  function diffTable(list) {
    return '<table><tr><th>Player</th><th>Pos</th><th class="num">Our rk</th><th class="num">ADP</th><th class="num">+/-</th></tr>' +
      list.map(function (p) {
        return '<tr><td><span class="name" data-detail="' + esc(p.id) + '">' + esc(p.name) + '</span></td><td class="pos">' + esc(p.pos.join('/')) + '</td><td class="num">' + p.rank +
          '</td><td class="num">' + fmt(p.adp) + '</td><td class="num ' + (p.diff > 0 ? 'good' : 'bad') + '">' + (p.diff > 0 ? '+' : '') + p.diff + '</td></tr>';
      }).join('') + '</table>';
  }

  // Compare our rank to a points-per-game-only rank to show why other sites' rankings mislead.
  function formatMovers(avail) {
    var top = avail.slice(0, 150);
    var byPts = top.slice().sort(function (a, b) { return (b.line.pts || 0) - (a.line.pts || 0); });
    var ptsRank = {};
    byPts.forEach(function (p, i) { ptsRank[p.id] = i + 1; });
    var byFp = top.slice().sort(function (a, b) { return b.fpg - a.fpg; });
    var rows = byFp.map(function (p, i) { return { p: p, fpRank: i + 1, ptsRank: ptsRank[p.id], delta: ptsRank[p.id] - (i + 1) }; });
    return {
      risers: rows.filter(function (r) { return r.fpRank <= 80; }).sort(function (a, b) { return b.delta - a.delta; }).slice(0, 10),
      fallers: rows.filter(function (r) { return r.ptsRank <= 60; }).sort(function (a, b) { return a.delta - b.delta; }).slice(0, 10)
    };
  }

  function moverTable(list) {
    return '<table><tr><th>Player</th><th>Pos</th><th class="num">PTS/G</th><th class="num">FP/G</th><th class="num">Pts rk → FP rk</th></tr>' +
      list.map(function (r) {
        return '<tr><td><span class="name" data-detail="' + esc(r.p.id) + '">' + esc(r.p.name) + '</span></td><td class="pos">' + esc(r.p.pos.join('/')) + '</td><td class="num">' + fmt(r.p.line.pts) +
          '</td><td class="num">' + fmt(r.p.fpg) + '</td><td class="num">' + r.ptsRank + ' → ' + r.fpRank + '</td></tr>';
      }).join('') + '</table>';
  }

  /* ---------------- player detail ---------------- */

  function showDetail(id) {
    var p = poolById[id];
    if (!p) return;
    var parts = C.breakdown(p.line, config.scoring);
    var maxAbs = parts.reduce(function (m, b) { return Math.max(m, Math.abs(b.points)); }, 0) || 1;
    var html = '<h2>' + esc(p.name) + ' <span class="pos">' + esc(p.pos.join('/')) + ' · ' + esc(p.team) + '</span></h2>' +
      (p.injury ? '<p class="bad">Injury status: ' + esc(p.injury) + '</p>' : '') +
      '<table class="detail-table">' +
      '<tr><td>Our rank / ADP</td><td class="num">' + p.rank + ' / ' + fmt(p.adp) + '</td></tr>' +
      '<tr><td>Blended FP/G (your scoring)</td><td class="num"><strong>' + fmt(p.fpg, 2) + '</strong></td></tr>' +
      '<tr><td>Sleeper projection FP/G</td><td class="num">' + fmt(p.projFpg, 2) + '</td></tr>' +
      '<tr><td>Last season FP/G</td><td class="num">' + fmt(p.lastFpg, 2) + (p.lastGp ? ' (' + p.lastGp + ' GP)' : '') + '</td></tr>' +
      '<tr><td>Projected games / season FP</td><td class="num">' + fmt(p.gp, 0) + ' / ' + fmt(p.total, 0) + '</td></tr>' +
      '<tr><td>VORP (replacement ' + fmt(p.repl, 1) + ')</td><td class="num">' + fmt(p.vorp, 1) + '</td></tr>' +
      '</table><h3>Where his points come from (per game)</h3><table class="detail-table">' +
      parts.map(function (b) {
        var w = Math.round(120 * Math.abs(b.points) / maxAbs);
        return '<tr><td>' + esc(b.label) + '</td><td class="num">' + fmt(b.value, 2) + '</td><td class="num">' + (b.points >= 0 ? '+' : '') + fmt(b.points, 2) +
          '</td><td><span class="bar' + (b.points < 0 ? ' neg' : '') + '" style="width:' + w + 'px"></span></td></tr>';
      }).join('') + '</table>';
    $('playerDetail').innerHTML = html;
    $('playerModal').hidden = false;
  }

  /* ---------------- export ---------------- */

  function exportCsv() {
    var head = ['rank', 'name', 'team', 'pos', 'fpg', 'gp', 'season_fp', 'vorp', 'adp', 'adp_minus_rank', 'proj_fpg', 'last_fpg'];
    var lines = [head.join(',')].concat(pool.map(function (p) {
      return [p.rank, '"' + p.name.replace(/"/g, '""') + '"', p.team, p.pos.join('/'), fmt(p.fpg, 2), fmt(p.gp, 0), fmt(p.total, 0), fmt(p.vorp, 1),
        p.adp == null ? '' : fmt(p.adp, 1), p.diff == null ? '' : p.diff, fmt(p.projFpg, 2), fmt(p.lastFpg, 2)].join(',');
    }));
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'draft-rankings.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------------- events ---------------- */

  function bind() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === t); });
        document.querySelectorAll('.tab-panel').forEach(function (x) { x.classList.toggle('active', x.id === 'tab-' + t.dataset.tab); });
      });
    });
    $('posFilter').addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      view.pos = b.dataset.pos;
      document.querySelectorAll('#posFilter .chip').forEach(function (x) { x.classList.toggle('active', x === b); });
      renderBoard();
    });
    $('search').addEventListener('input', function (e) { view.search = e.target.value; renderBoard(); });
    $('sortBy').addEventListener('change', function (e) { view.sortBy = e.target.value; renderBoard(); });
    $('showDrafted').addEventListener('change', function (e) { view.showDrafted = e.target.checked; renderBoard(); });

    document.body.addEventListener('click', function (e) {
      var t = e.target;
      if (t.dataset.take || t.dataset.mine) {
        addPick(t.dataset.take || t.dataset.mine, !!t.dataset.mine);
        if (t.dataset.mine) runMockOpponents();
        saveAll();
        render();
        return;
      }
      var d = t.closest('[data-detail]');
      if (d) showDetail(d.dataset.detail);
    });
    $('playerModal').addEventListener('click', function (e) {
      if (e.target === $('playerModal') || e.target.classList.contains('modal-close')) $('playerModal').hidden = true;
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('playerModal').hidden = true; });

    $('undoBtn').addEventListener('click', function () {
      if (picksState.mode === 'mock') {
        while (picksState.picks.length && !picksState.picks[picksState.picks.length - 1].mine) picksState.picks.pop();
      }
      picksState.picks.pop();
      runMockOpponents();
      saveAll();
      render();
    });
    $('mockBtn').addEventListener('click', function () {
      if (picksState.mode === 'mock') {
        picksState = { mode: 'manual', picks: [] };
      } else {
        if (picksState.picks.length && !confirm('Start a mock draft? This clears the current picks.')) return;
        setLive(false);
        picksState = { mode: 'mock', picks: [] };
        runMockOpponents();
      }
      saveAll();
      render();
    });
    $('resetDraftBtn').addEventListener('click', function () {
      if (!confirm('Clear all recorded picks?')) return;
      setLive(false);
      picksState = { mode: 'manual', picks: [] };
      saveAll();
      render();
    });
    $('liveToggle').addEventListener('change', function (e) { setLive(e.target.checked); });
    $('refreshBtn').addEventListener('click', function () { syncPicks(false); });

    $('loadBtn').addEventListener('click', loadFromSleeper);
    $('reloadPlayersBtn').addEventListener('click', function () {
      setStatus('Downloading player list…');
      Sleeper.players(true).then(function (pl) {
        players = Object.assign({}, players, pl);
        rebuild(); saveAll(); render();
        setStatus('Player list updated (' + Object.keys(pl).length + ' players).', 'ok');
      }).catch(function (e) { setStatus('Player download failed: ' + esc(e.message), 'err'); });
    });
    $('applyBtn').addEventListener('click', function () {
      readSettingsForm();
      rebuild(); saveAll(); populateSettingsForm(); render();
      setStatus('Recalculated with current settings.', 'ok');
    });
    $('projWeight').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      $('projWeightOut').textContent = v + '% projections / ' + (100 - v) + '% last season';
    });
    $('csvFile').addEventListener('change', function (e) { if (e.target.files[0]) importCsv(e.target.files[0]); });
    $('pasteBtn').addEventListener('click', usePasted);
    $('exportBtn').addEventListener('click', exportCsv);
  }

  /* ---------------- boot ---------------- */

  bind();
  var hasData = Object.keys(data.projections || {}).length || Object.keys(data.stats || {}).length || data.csv;
  if (hasData) {
    if (!Object.keys(players).length) {
      Sleeper.players(false).then(function (pl) { players = pl; rebuild(); populateSettingsForm(); render(); }).catch(function () {});
    }
    ensureAdpKey();
    rebuild();
  }
  populateSettingsForm();
  render();
  if (!hasData) {
    document.querySelector('.tab[data-tab="settings"]').click();
    setStatus('Click <strong>Load from Sleeper</strong> to pull your league settings, projections, ADP and stats.');
  }
})();
