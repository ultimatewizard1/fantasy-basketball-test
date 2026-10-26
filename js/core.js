/*
 * Draft core: scoring, projections, replacement level, lineup optimisation,
 * snake-draft math and availability odds. No DOM access here so it can be
 * unit-tested in Node (see tests/core.test.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DraftCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Sleeper NBA defaults (matches league 1414370391324950528's scoring_settings).
  var DEFAULT_SCORING = {
    pts: 0.5, reb: 1, ast: 1, stl: 2, blk: 2, to: -1, tpm: 0.5,
    dd: 1, td: 2, tf: -2, ff: -2, bonus_pt_40p: 2, bonus_pt_50p: 2
  };
  var DEFAULT_ROSTER = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL', 'UTIL', 'BN', 'BN', 'BN'];
  var BASE_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
  var STAT_LABELS = {
    pts: 'Points', reb: 'Rebounds', ast: 'Assists', stl: 'Steals', blk: 'Blocks',
    to: 'Turnovers', tpm: '3-pointers made', dd: 'Double-doubles', td: 'Triple-doubles',
    tf: 'Technical fouls', ff: 'Flagrant fouls',
    bonus_pt_40p: '40-point games', bonus_pt_50p: '50-point games'
  };
  // Keys that are counts, not rates, and so get divided by games played.
  var NON_COUNTING = { gp: 1, gs: 1, adp: 1 };

  function num(v) {
    var n = typeof v === 'string' ? parseFloat(v) : v;
    return typeof n === 'number' && isFinite(n) ? n : 0;
  }

  /* ---------------- scoring ---------------- */

  // Only keep numeric, non-zero scoring entries (Sleeper sends a few metadata keys).
  function cleanScoring(scoring) {
    var out = {};
    Object.keys(scoring || {}).forEach(function (k) {
      var w = num(scoring[k]);
      if (w !== 0) out[k] = w;
    });
    return Object.keys(out).length ? out : Object.assign({}, DEFAULT_SCORING);
  }

  function fantasyPoints(stats, scoring) {
    var total = 0;
    Object.keys(scoring).forEach(function (k) {
      if (stats && stats[k] != null) total += num(stats[k]) * scoring[k];
    });
    return total;
  }

  function breakdown(stats, scoring) {
    var parts = [];
    Object.keys(scoring).forEach(function (k) {
      if (stats && stats[k] != null && num(stats[k]) !== 0) {
        parts.push({ key: k, label: STAT_LABELS[k] || k, value: num(stats[k]), points: num(stats[k]) * scoring[k] });
      }
    });
    return parts.sort(function (a, b) { return Math.abs(b.points) - Math.abs(a.points); });
  }

  // Sleeper season stats/projections are normally season totals with a `gp`
  // field; pass perGame=true when the numbers are already averages.
  function toPerGame(stats, perGame) {
    var gp = num(stats && stats.gp);
    if (!stats || gp <= 0) return null;
    var out = { gp: gp };
    Object.keys(stats).forEach(function (k) {
      // Sleeper's season bonus_* fields are flags (always 1), not counts; see estimateBonuses.
      if (NON_COUNTING[k] || k.indexOf('adp') === 0 || k.indexOf('rank') === 0 || k.indexOf('pos_') === 0 ||
          k.indexOf('bonus_') === 0 || k.charAt(0) === '_') return;
      var v = stats[k];
      if (typeof v === 'number' || (typeof v === 'string' && v !== '' && isFinite(v))) out[k] = perGame ? num(v) : num(v) / gp;
    });
    return out;
  }

  // Totals have pts well above gp for nearly every regular; averages don't.
  // Sleeper's season projections are per game with gp = 1.
  function looksPerGame(map) {
    var n = 0, below = 0, unit = 0, withPts = 0;
    Object.keys(map || {}).forEach(function (id) {
      var s = map[id];
      var gp = num(s.gp), pts = num(s.pts);
      if (pts > 0) { withPts++; if (gp <= 1) unit++; }
      if (gp >= 20 && pts > 0) { n++; if (pts < gp) below++; }
    });
    if (withPts >= 10 && unit / withPts > 0.7) return true;
    return n >= 10 && below / n > 0.7;
  }

  /*
   * Expected 40- and 50-point games per game, from scoring average. Single
   * game points are roughly normal with sd ~ 0.25 * ppg + 1.
   */
  function estimateBonuses(line) {
    var ppg = num(line && line.pts);
    var out = Object.assign({}, line);
    if (ppg <= 0) return out;
    var sd = 0.25 * ppg + 1;
    out.bonus_pt_40p = 1 - normCdf((39.5 - ppg) / sd);
    out.bonus_pt_50p = 1 - normCdf((49.5 - ppg) / sd);
    return out;
  }

  // Fill stats one line lacks (e.g. technicals) from another, for fair comparisons.
  function fillFrom(line, other) {
    if (!line) return null;
    var out = Object.assign({}, other || {}, line);
    delete out.gp;
    return out;
  }

  /* ---------------- positions ---------------- */

  function normalizePositions(list) {
    var set = {};
    (list || []).forEach(function (raw) {
      String(raw || '').toUpperCase().split(/[\s,\/-]+/).forEach(function (p) {
        if (p === 'G') { set.PG = 1; set.SG = 1; }
        else if (p === 'F') { set.SF = 1; set.PF = 1; }
        else if (p === 'GF') { set.SG = 1; set.SF = 1; }
        else if (p === 'FC') { set.PF = 1; set.C = 1; }
        else if (BASE_POSITIONS.indexOf(p) >= 0) set[p] = 1;
      });
    });
    return BASE_POSITIONS.filter(function (p) { return set[p]; });
  }

  function slotAccepts(slot, positions) {
    switch (slot) {
      case 'UTIL': return positions.length > 0;
      case 'G': return positions.indexOf('PG') >= 0 || positions.indexOf('SG') >= 0;
      case 'F': return positions.indexOf('SF') >= 0 || positions.indexOf('PF') >= 0;
      case 'BN': return true;
      default: return positions.indexOf(slot) >= 0;
    }
  }

  function starterSlots(roster) {
    return roster.filter(function (s) { return s !== 'BN' && s !== 'IR' && s !== 'IL'; });
  }

  function benchCount(roster) {
    return roster.filter(function (s) { return s === 'BN'; }).length;
  }

  /*
   * Maximum-weight assignment of players to slots. Eligibility forms a
   * transversal matroid, so taking players in descending value and keeping
   * each one if an augmenting path exists is optimal.
   */
  function assign(players, slots, valueOf) {
    var order = players.slice().sort(function (a, b) { return valueOf(b) - valueOf(a); });
    var slotOwner = new Array(slots.length).fill(-1);
    var starters = [];
    var bench = [];

    function tryPlace(pi, seen) {
      var p = order[pi];
      for (var s = 0; s < slots.length; s++) {
        if (seen[s] || !slotAccepts(slots[s], p.pos)) continue;
        seen[s] = true;
        if (slotOwner[s] === -1 || tryPlace(slotOwner[s], seen)) {
          slotOwner[s] = pi;
          return true;
        }
      }
      return false;
    }

    for (var i = 0; i < order.length; i++) {
      if (!tryPlace(i, new Array(slots.length).fill(false))) bench.push(order[i]);
    }
    for (var s = 0; s < slots.length; s++) {
      starters.push({ slot: slots[s], player: slotOwner[s] === -1 ? null : order[slotOwner[s]] });
    }
    return { starters: starters, bench: bench };
  }

  /* ---------------- player pool ---------------- */

  /*
   * Merge Sleeper players + projections + last-season stats into one pool.
   * input: { players, projections, stats, adp, games (id -> projected GP override) }
   * opts: { scoring, projWeight (0..1), gamesCap, defaultGames, minGames }
   */
  function buildPool(input, opts) {
    var scoring = cleanScoring(opts.scoring);
    var projWeight = opts.projWeight == null ? 0.6 : opts.projWeight;
    var gamesCap = opts.gamesCap || 82;
    var defaultGames = opts.defaultGames || 65;
    var players = input.players || {};
    var proj = input.projections || {};
    var last = input.stats || {};
    var adpMap = input.adp || {};
    var games = input.games || {};
    var ids = {};
    Object.keys(proj).forEach(function (id) { ids[id] = 1; });
    Object.keys(last).forEach(function (id) { ids[id] = 1; });
    var projPerGame = looksPerGame(proj);
    var lastPerGame = looksPerGame(last);
    var score = function (line) { return fantasyPoints(estimateBonuses(line), scoring); };

    var pool = [];
    Object.keys(ids).forEach(function (id) {
      var meta = players[id] || {};
      var pos = normalizePositions(meta.fantasy_positions && meta.fantasy_positions.length ? meta.fantasy_positions : [meta.position]);
      if (!pos.length) return;
      if (meta.active === false) return;

      var projPg = toPerGame(proj[id], projPerGame);
      var lastPg = toPerGame(last[id], lastPerGame);
      if (lastPg && lastPg.gp < (opts.minGames || 5)) lastPg = null;
      if (!projPg && !lastPg) return;

      // Score the blended line (stats one source lacks are filled from the other).
      var line = estimateBonuses(blendLines(fillFrom(projPg, lastPg), fillFrom(lastPg, projPg), projWeight));
      var fpg = fantasyPoints(line, scoring);
      var projFpg = projPg ? score(fillFrom(projPg, lastPg)) : null;
      var lastFpg = lastPg ? score(fillFrom(lastPg, projPg)) : null;

      var gp;
      if (games[id] != null) gp = num(games[id]);
      else if (projPg && projPg.gp > 1) gp = projPg.gp;
      else if (lastPg) gp = Math.round(lastPg.gp * 0.95);
      else gp = defaultGames;
      gp = Math.min(gp, gamesCap);

      var name = meta.full_name || ((meta.first_name || '') + ' ' + (meta.last_name || '')).trim() || (proj[id] && proj[id]._name) || (last[id] && last[id]._name) || id;
      pool.push({
        id: id,
        name: name,
        team: meta.team || (last[id] && last[id]._team) || 'FA',
        pos: pos,
        injury: meta.injury_status || '',
        age: meta.age || null,
        fpg: fpg,
        projFpg: projFpg,
        lastFpg: lastFpg,
        gp: gp,
        lastGp: lastPg ? lastPg.gp : null,
        total: fpg * gp,
        line: line,
        adp: adpMap[id] != null ? adpMap[id] : null
      });
    });
    return pool;
  }

  function blendLines(a, b, wa) {
    if (!a) return b || {};
    if (!b) return a;
    var out = {};
    var keys = {};
    Object.keys(a).forEach(function (k) { keys[k] = 1; });
    Object.keys(b).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      if (a[k] == null) out[k] = b[k];
      else if (b[k] == null) out[k] = a[k];
      else out[k] = wa * a[k] + (1 - wa) * b[k];
    });
    return out;
  }

  /*
   * Replacement level: fill every team's starting slots league-wide with the
   * best players (optimal assignment), then the replacement value for each
   * position is the best player left over who can play it.
   */
  function computeReplacement(pool, roster, teams, valueKey) {
    var slots = [];
    starterSlots(roster).forEach(function (s) { for (var t = 0; t < teams; t++) slots.push(s); });
    var sorted = pool.slice().sort(function (a, b) { return b[valueKey] - a[valueKey]; });
    // Only the top of the pool can matter; keeps the matching cheap.
    var candidates = sorted.slice(0, slots.length * 2 + 40);
    var res = assign(candidates, slots, function (p) { return p[valueKey]; });
    var startingIds = {};
    res.starters.forEach(function (s) { if (s.player) startingIds[s.player.id] = 1; });
    var repl = {};
    BASE_POSITIONS.forEach(function (pos) {
      for (var i = 0; i < sorted.length; i++) {
        var p = sorted[i];
        if (!startingIds[p.id] && p.pos.indexOf(pos) >= 0) { repl[pos] = p[valueKey]; return; }
      }
      repl[pos] = 0;
    });
    return { repl: repl, startingIds: startingIds, slotFill: res.starters };
  }

  function applyValues(pool, roster, teams, valueKey) {
    var r = computeReplacement(pool, roster, teams, valueKey);
    pool.forEach(function (p) {
      var best = Infinity;
      p.pos.forEach(function (pos) { if (r.repl[pos] < best) best = r.repl[pos]; });
      p.repl = best === Infinity ? 0 : best;
      p.vorp = p[valueKey] - p.repl;
    });
    pool.sort(function (a, b) { return b.vorp - a.vorp; });
    pool.forEach(function (p, i) { p.rank = i + 1; });
    var withAdp = pool.filter(function (p) { return p.adp != null; }).sort(function (a, b) { return a.adp - b.adp; });
    withAdp.forEach(function (p, i) { p.adpRank = i + 1; });
    return r;
  }

  /* ---------------- Sleeper Lock-In ---------------- */

  /*
   * In Lock-In leagues one game per player per week counts: after each game
   * you may lock it, or pass and wait for a later game (the last game of the
   * week is used if nothing was locked). With normally distributed game
   * scores the best policy locks game i when it beats the value of waiting,
   * and the expected locked score follows the backward recursion
   *   v1 = mu,  v(k+1) = E[max(X, vk)] = vk + sd * (pdf(z) - z * (1 - cdf(z))),  z = (vk - mu) / sd.
   */
  var LOCKIN_GAMES_PER_WEEK = { 2: 0.1, 3: 0.5, 4: 0.4 };
  var LOCKIN_WEEKS = 24;
  var DEFAULT_CV = 0.37;          // median game-to-game sd/mean in last season's logs
  var MISSED_GAMES_IN_LOST_WEEKS = 0.7; // share of missed games that wipe out a whole week
  var TEAM_GAMES_PER_WEEK = 3.4;
  // Calibrated by replaying 2025-26 for 146 players: the lock-in bonus was
  // real (+3.6/week vs +4.0 predicted) but did not grow with a player's own
  // season-long swing among similar averages, so individual swing is mostly
  // shrunk to the league median and the bonus scaled to match.
  var SWING_SHRINK = 0.8;
  var LOCKIN_CALIBRATION = 0.9;

  function normPdf(z) { return Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); }

  // E[max(X, c)] for X ~ Normal(mu, sd).
  function expectedMax(mu, sd, c) {
    var z = (c - mu) / sd;
    return c + sd * (normPdf(z) - z * (1 - normCdf(z)));
  }

  function lockInValue(mu, sd, n) {
    var v = mu;
    for (var i = 1; i < n; i++) {
      var z = (v - mu) / sd;
      v = v + sd * (normPdf(z) - z * (1 - normCdf(z)));
    }
    return v;
  }

  function weeklyLockIn(mu, sd) {
    var total = 0;
    Object.keys(LOCKIN_GAMES_PER_WEEK).forEach(function (n) {
      total += LOCKIN_GAMES_PER_WEEK[n] * lockInValue(mu, sd, +n);
    });
    return total;
  }

  /*
   * Weeks with at least one game. Games lost to a known current injury are
   * whole weeks; of the remaining expected absences most come in multi-week
   * stretches, but rest days and one-game absences don't cost the week.
   */
  function lockInWeeks(gp, gamesMissed) {
    var missed = Math.min(num(gamesMissed), 82);
    var lostWeeks = missed / TEAM_GAMES_PER_WEEK;
    var avail = 82 - missed;
    if (avail <= 0) return 0;
    var rate = Math.min(1, num(gp) / avail);
    return Math.max(0, LOCKIN_WEEKS - lostWeeks) * (1 - MISSED_GAMES_IN_LOST_WEEKS * (1 - rate));
  }

  // Game-to-game sd used for Lock-In maths (individual swing mostly shrunk).
  function effectiveSd(fpg, cv) {
    var c = cv == null ? DEFAULT_CV : cv;
    return Math.max(((1 - SWING_SHRINK) * c + SWING_SHRINK * DEFAULT_CV) * fpg, 1);
  }

  // Calibrated expected locked score per week.
  function lockInWeekly(fpg, cv) {
    return fpg + LOCKIN_CALIBRATION * (weeklyLockIn(fpg, effectiveSd(fpg, cv)) - fpg);
  }

  // opts: { cv: id -> sd/mean, missed: id -> games lost to a current injury }
  function applyLockIn(pool, opts) {
    opts = opts || {};
    pool.forEach(function (p) {
      var cv = opts.cv && opts.cv[p.id] != null ? opts.cv[p.id] : DEFAULT_CV;
      p.cv = cv;
      p.lockWeekly = lockInWeekly(p.fpg, cv);
      p.lockWeeks = lockInWeeks(p.gp, opts.missed && opts.missed[p.id]);
      p.lockin = p.lockWeekly * p.lockWeeks;
    });
  }

  /*
   * Preseason vs projection. Starters play short preseason minutes, so
   * compare production per 36 minutes, and only treat minutes *above*
   * projection as a signal (a bigger role). Small samples: hints only.
   * pre: { g, min, fp36 } from ESPN preseason logs; projMin: projected minutes.
   */
  function preseasonSignal(pre, fpg, projMin, baseline) {
    if (!pre || pre.g < 2 || !pre.min || !pre.fp36 || !projMin || !(fpg > 0)) return null;
    var projFp36 = 36 * fpg / projMin;
    // Relative to the typical preseason ratio: per-36 runs high in short stints.
    var rate = pre.fp36 / projFp36 / (baseline || 1) - 1;
    var minDiff = pre.min - projMin;
    var label = '';
    if (minDiff >= 3) label = 'role up';
    else if (pre.min >= 15 && rate >= 0.2) label = 'production up';
    else if (pre.min >= 15 && rate <= -0.25) label = 'production down';
    return { rate: rate, minDiff: minDiff, projFp36: projFp36, label: label };
  }

  // Median preseason-to-projected per-36 ratio. players: [{ pre, fpg, projMin }]
  function preseasonBaseline(players) {
    var r = players.filter(function (x) { return x.pre && x.pre.g >= 2 && x.pre.min >= 15 && x.pre.fp36 && x.projMin && x.fpg > 0; })
      .map(function (x) { return x.pre.fp36 / (36 * x.fpg / x.projMin); }).sort(function (a, b) { return a - b; });
    return r.length >= 20 ? r[Math.floor(r.length / 2)] : 1;
  }

  /* ---------------- my roster ---------------- */

  // Starters count fully, bench players at benchWeight (they cover off-days/injuries).
  function rosterScore(players, roster, benchWeight) {
    var res = assign(players, starterSlots(roster), function (p) { return p.vorp; });
    var score = 0;
    res.starters.forEach(function (s) { if (s.player) score += Math.max(s.player.vorp, 0); });
    var benchSlots = benchCount(roster);
    res.bench.slice(0, benchSlots).forEach(function (p) { score += benchWeight * Math.max(p.vorp, 0); });
    return { score: score, lineup: res };
  }

  function marginalGain(mine, candidate, roster, benchWeight, baseScore) {
    var base = baseScore != null ? baseScore : rosterScore(mine, roster, benchWeight).score;
    return rosterScore(mine.concat([candidate]), roster, benchWeight).score - base;
  }

  /* ---------------- snake draft math ---------------- */

  function pickNumber(round, slot, teams) {
    return round % 2 === 1 ? (round - 1) * teams + slot : round * teams - slot + 1;
  }

  function myPicks(slot, teams, rounds) {
    var out = [];
    for (var r = 1; r <= rounds; r++) out.push({ round: r, pick: pickNumber(r, slot, teams) });
    return out;
  }

  function slotForPick(pickNo, teams) {
    var round = Math.ceil(pickNo / teams);
    var idx = (pickNo - 1) % teams;
    return round % 2 === 1 ? idx + 1 : teams - idx;
  }

  function normCdf(x) {
    // Abramowitz-Stegun 7.1.26
    var t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  function adpSd(adp) { return Math.max(2.5, 0.22 * adp); }

  // P(player is still on the board at targetPick | still there at currentPick).
  function availability(adp, currentPick, targetPick) {
    if (adp == null) return null;
    if (targetPick <= currentPick) return 1;
    var sd = adpSd(adp);
    var stillThere = 1 - normCdf((currentPick - 0.5 - adp) / sd);
    var survive = 1 - normCdf((targetPick - 0.5 - adp) / sd);
    if (stillThere <= 1e-9) return survive > 0 ? 1 : 0;
    return Math.max(0, Math.min(1, survive / stillThere));
  }

  /* ---------------- mock opponents ---------------- */

  function gaussian(rand) {
    var u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Opponents draft roughly by ADP (falling back to our rank), with noise.
  function mockPick(available, pickNo, rand) {
    rand = rand || Math.random;
    var best = null, bestKey = Infinity;
    available.forEach(function (p) {
      var base = p.adp != null ? p.adp : p.rank + 15;
      var key = base + gaussian(rand) * adpSd(base) * 0.6;
      if (key < bestKey) { bestKey = key; best = p; }
    });
    return best;
  }

  /* ---------------- data normalisation ---------------- */

  // Sleeper returns either [{player_id, stats, player}] or {player_id: stats}.
  function normalizeStatsPayload(payload) {
    var out = {};
    if (Array.isArray(payload)) {
      payload.forEach(function (row) {
        if (!row || row.player_id == null) return;
        var s = row.stats || {};
        if (Object.keys(s).length) out[String(row.player_id)] = s;
      });
    } else if (payload && typeof payload === 'object') {
      Object.keys(payload).forEach(function (id) {
        if (payload[id] && typeof payload[id] === 'object') out[id] = payload[id];
      });
    }
    return out;
  }

  // Players embedded in api.sleeper.com projection rows, used if /players fails.
  function playersFromPayload(payload) {
    var out = {};
    if (!Array.isArray(payload)) return out;
    payload.forEach(function (row) {
      if (row && row.player && row.player_id != null) {
        var p = Object.assign({}, row.player);
        if (!p.team && row.team) p.team = row.team;
        out[String(row.player_id)] = p;
      }
    });
    return out;
  }

  // Every adp_* key present in projections, with how many players have it.
  function adpKeys(projections) {
    var counts = {};
    Object.keys(projections).forEach(function (id) {
      Object.keys(projections[id]).forEach(function (k) {
        if (k.indexOf('adp') === 0 && num(projections[id][k]) > 0 && num(projections[id][k]) < 999) counts[k] = (counts[k] || 0) + 1;
      });
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).map(function (k) { return { key: k, count: counts[k] }; });
  }

  function extractAdp(projections, key) {
    var out = {};
    if (!key) return out;
    Object.keys(projections).forEach(function (id) {
      var v = num(projections[id][key]);
      if (v > 0 && v < 999) out[id] = v;
    });
    return out;
  }

  /* ---------------- CSV import (e.g. Basketball-Reference export) ---------------- */

  var CSV_ALIASES = {
    player: 'name', name: 'name', 'player name': 'name',
    pos: 'pos', position: 'pos', team: 'team', tm: 'team',
    g: 'gp', gp: 'gp', games: 'gp',
    pts: 'pts', points: 'pts',
    trb: 'reb', reb: 'reb', rebounds: 'reb', tot: 'reb',
    ast: 'ast', assists: 'ast',
    stl: 'stl', steals: 'stl',
    blk: 'blk', blocks: 'blk',
    tov: 'to', to: 'to', turnovers: 'to',
    dd: 'dd', dd2: 'dd', 'double doubles': 'dd',
    td: 'td', td3: 'td', 'triple doubles': 'td',
    tf: 'tf', techs: 'tf', ff: 'ff',
    adp: 'adp'
  };

  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ''; }); });
  }

  function normalizeName(n) {
    return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[*.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]+/g, ' ').trim();
  }

  /*
   * Returns { stats: {id: totals}, adp: {id: adp}, unmatched: [names] }.
   * Per-game CSVs are converted to totals so they match Sleeper's format.
   */
  function statsFromCsv(text, players) {
    var rows = parseCsv(text);
    if (rows.length < 2) return { stats: {}, adp: {}, unmatched: [], extraPlayers: {} };
    var header = rows[0].map(function (h) { return CSV_ALIASES[h.trim().toLowerCase()] || null; });
    var byName = {};
    Object.keys(players || {}).forEach(function (id) {
      var p = players[id];
      var n = normalizeName(p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')));
      if (!n) return;
      // Prefer active players with a team when names collide.
      if (!byName[n] || (p.team && !players[byName[n]].team)) byName[n] = id;
    });
    var parsed = [];
    var maxPts = 0;
    var seen = {};
    rows.slice(1).forEach(function (r) {
      var rec = {};
      header.forEach(function (key, i) { if (key) rec[key] = r[i] != null ? r[i].trim() : ''; });
      if (!rec.name || rec.name.toLowerCase() === 'player') return;
      var nn = normalizeName(rec.name);
      // Basketball-Reference lists traded players once per team; keep the first (season total) row.
      if (seen[nn]) return;
      seen[nn] = 1;
      parsed.push(rec);
      maxPts = Math.max(maxPts, num(rec.pts));
    });
    var perGame = maxPts > 0 && maxPts < 80;
    var out = { stats: {}, adp: {}, unmatched: [], extraPlayers: {} };
    parsed.forEach(function (rec) {
      var nn = normalizeName(rec.name);
      var id = byName[nn];
      if (!id) {
        if (rec.pos) {
          id = 'csv:' + nn.replace(/ /g, '_');
          out.extraPlayers[id] = { full_name: rec.name, team: rec.team || 'FA', fantasy_positions: [rec.pos] };
        } else {
          out.unmatched.push(rec.name);
          return;
        }
      }
      var gp = num(rec.gp) || 1;
      var s = { gp: gp, _name: rec.name, _team: rec.team };
      ['pts', 'reb', 'ast', 'stl', 'blk', 'to', 'dd', 'td', 'tf', 'ff'].forEach(function (k) {
        if (rec[k] == null || rec[k] === '') return;
        var v = num(rec[k]);
        // Double/triple-doubles and techs are always season counts.
        s[k] = perGame && ['dd', 'td', 'tf', 'ff'].indexOf(k) < 0 ? v * gp : v;
      });
      out.stats[id] = s;
      if (rec.adp) out.adp[id] = num(rec.adp);
    });
    return out;
  }

  return {
    DEFAULT_SCORING: DEFAULT_SCORING,
    DEFAULT_ROSTER: DEFAULT_ROSTER,
    BASE_POSITIONS: BASE_POSITIONS,
    STAT_LABELS: STAT_LABELS,
    cleanScoring: cleanScoring,
    fantasyPoints: fantasyPoints,
    breakdown: breakdown,
    toPerGame: toPerGame,
    looksPerGame: looksPerGame,
    estimateBonuses: estimateBonuses,
    lockInValue: lockInValue,
    expectedMax: expectedMax,
    weeklyLockIn: weeklyLockIn,
    lockInWeeks: lockInWeeks,
    applyLockIn: applyLockIn,
    effectiveSd: effectiveSd,
    lockInWeekly: lockInWeekly,
    preseasonSignal: preseasonSignal,
    preseasonBaseline: preseasonBaseline,
    LOCKIN_WEEKS: LOCKIN_WEEKS,
    DEFAULT_CV: DEFAULT_CV,
    normalizePositions: normalizePositions,
    slotAccepts: slotAccepts,
    starterSlots: starterSlots,
    benchCount: benchCount,
    assign: assign,
    buildPool: buildPool,
    computeReplacement: computeReplacement,
    applyValues: applyValues,
    rosterScore: rosterScore,
    marginalGain: marginalGain,
    pickNumber: pickNumber,
    myPicks: myPicks,
    slotForPick: slotForPick,
    availability: availability,
    mockPick: mockPick,
    normalizeStatsPayload: normalizeStatsPayload,
    playersFromPayload: playersFromPayload,
    adpKeys: adpKeys,
    extractAdp: extractAdp,
    parseCsv: parseCsv,
    normalizeName: normalizeName,
    statsFromCsv: statsFromCsv
  };
});
