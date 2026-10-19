/*
 * In-season logic: rest-of-season values, weekly start/sit, Lock-In
 * decisions, waiver and trade evaluation. Builds on DraftCore. No DOM access
 * so it can be unit-tested in Node (tests/season.test.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.SeasonCore = factory(root.DraftCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  // ESPN team abbreviations that differ from Sleeper's.
  var ESPN_TO_SLEEPER = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };
  var FANTASY_WEEKS = 24;         // Sleeper weeks 1-24 (playoffs start week 22)
  var SEASON_PRIOR_GAMES = 15;    // projection counts like this many games of current-season data
  var UNKNOWN_PRIOR_FPG = 15;     // prior for players without a projection
  var BENCH_WEIGHT = 0.3;
  // Chance a player suits up for a game, by Sleeper/ESPN injury status.
  var PLAY_PROB = { out: 0, suspended: 0, doubtful: 0.25, questionable: 0.65, 'day-to-day': 0.8, probable: 0.95 };

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function sleeperTeam(espnAbbr) { return ESPN_TO_SLEEPER[espnAbbr] || espnAbbr; }

  function playProb(status) {
    if (!status) return 0.97;
    var s = String(status).toLowerCase();
    for (var k in PLAY_PROB) if (s.indexOf(k) >= 0) return PLAY_PROB[k];
    if (s === 'dtd') return PLAY_PROB['day-to-day'];
    if (s === 'ir' || s === 'na') return 0;
    return 0.9;
  }

  /* ---------------- dates (NBA dates are US Eastern) ---------------- */

  // YYYY-MM-DD of a Date in US Eastern time.
  function easternDate(d) {
    var s = d.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    var m = s.match(/(\d+)\/(\d+)\/(\d+)/);
    return m[3] + '-' + m[1] + '-' + m[2];
  }

  function addDays(ymd, n) {
    var d = new Date(ymd + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // Monday..Sunday (Lock-In matchup week) containing the given Eastern date.
  function weekDates(ymd) {
    var dow = new Date(ymd + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
    var monday = addDays(ymd, dow === 0 ? -6 : 1 - dow);
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(monday, i));
    return out;
  }

  /* ---------------- box scores ---------------- */

  // ESPN box score row ({keys, stats}) -> league fantasy points.
  function boxScoreFp(keys, stats, scoring) {
    var i = {};
    keys.forEach(function (k, j) { i[k] = j; });
    var get = function (k) { return i[k] == null ? 0 : num(String(stats[i[k]]).split('-')[0]); };
    var line = {
      pts: get('points'), reb: get('rebounds'), ast: get('assists'), stl: get('steals'),
      blk: get('blocks'), to: get('turnovers'),
      tpm: get('threePointFieldGoalsMade-threePointFieldGoalsAttempted')
    };
    var tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter(function (k) { return line[k] >= 10; }).length;
    line.dd = tens >= 2 ? 1 : 0;
    line.td = tens >= 3 ? 1 : 0;
    line.bonus_pt_40p = line.pts >= 40 ? 1 : 0;
    line.bonus_pt_50p = line.pts >= 50 ? 1 : 0;
    return { fp: C.fantasyPoints(line, scoring), line: line, minutes: get('minutes') };
  }

  /* ---------------- Lock-In decisions ---------------- */

  // Value of passing now with `left` games still to come (each played with prob q).
  function waitValue(mu, sd, left, q) {
    if (left <= 0) return 0;
    q = q == null ? 1 : q;
    if (q >= 0.999) return C.lockInValue(mu, sd, left);
    // Unknown availability: average over how many of the games he plays.
    var total = 0;
    for (var k = 1; k <= left; k++) total += binom(left, k, q) * C.lockInValue(mu, sd, k);
    return total; // playing none of them scores 0
  }

  function binom(n, k, p) {
    var c = 1;
    for (var i = 0; i < k; i++) c = c * (n - i) / (i + 1);
    return c * Math.pow(p, k) * Math.pow(1 - p, n - k);
  }

  /*
   * Decide whether to lock a finished game.
   * score: fantasy points of the game; left: his remaining games this week.
   */
  function lockDecision(mu, sd, score, left, q) {
    if (left <= 0) return { lock: true, threshold: -Infinity, forced: true };
    var threshold = waitValue(mu, sd, left, q);
    return { lock: score >= threshold, threshold: threshold, forced: false };
  }

  /*
   * Expected locked score for the rest of this week. `pending` is a finished
   * game that can still be locked (its next game hasn't started), or null.
   */
  function weekValue(mu, sd, pending, left, q) {
    var wait = waitValue(mu, sd, left, q);
    if (pending == null) return wait;
    return left > 0 ? Math.max(pending, wait) : pending;
  }

  /* ---------------- rest-of-season values ---------------- */

  // Blend preseason projection with this season's per-game production.
  function blendFpg(projFpg, seasonFpg, gp) {
    gp = num(gp);
    if (projFpg == null) return gp > 0 ? (seasonFpg * gp + UNKNOWN_PRIOR_FPG * 5) / (gp + 5) : UNKNOWN_PRIOR_FPG;
    if (!gp) return projFpg;
    return (projFpg * SEASON_PRIOR_GAMES + seasonFpg * gp) / (SEASON_PRIOR_GAMES + gp);
  }

  /*
   * Rest-of-season Lock-In points: weekly locked score x remaining weeks he
   * plays. weeksOut: weeks lost to a known injury from now.
   */
  function rosValue(weekly, weeksLeft, durability, weeksOut) {
    var healthy = Math.max(0, weeksLeft - (weeksOut || 0));
    var rate = durability == null ? 0.8 : durability;
    return weekly * healthy * (1 - 0.7 * (1 - rate));
  }

  /* ---------------- team value, trades, waivers ---------------- */

  /*
   * Team value = rest-of-season points of the best starting lineup plus bench
   * at BENCH_WEIGHT. Missing roster spots are filled with `fill` (the value of
   * a typical free agent) so 2-for-1 trades credit the open spot.
   */
  function teamValue(players, roster, val, fill, rosterSize) {
    var list = players.slice();
    var size = rosterSize || roster.length;
    for (var i = list.length; i < size; i++) list.push({ id: '_fa' + i, pos: ['PG', 'SG', 'SF', 'PF', 'C'], _fill: true });
    var v = function (p) { return p._fill ? (fill || 0) : val(p); };
    var res = C.assign(list, C.starterSlots(roster), v);
    var total = 0;
    res.starters.forEach(function (s) { if (s.player) total += v(s.player); });
    res.bench.sort(function (a, b) { return v(b) - v(a); })
      .slice(0, C.benchCount(roster)).forEach(function (p) { total += BENCH_WEIGHT * v(p); });
    return total;
  }

  function without(list, remove) {
    var ids = {};
    remove.forEach(function (p) { ids[p.id] = 1; });
    return list.filter(function (p) { return !ids[p.id]; });
  }

  // Change in team value for both sides of a trade.
  function evaluateTrade(mine, theirs, give, get, ctx) {
    var size = ctx.rosterSize;
    var myBefore = teamValue(mine, ctx.roster, ctx.val, ctx.fill, size);
    var theirBefore = teamValue(theirs, ctx.roster, ctx.val, ctx.fill, size);
    var myAfter = teamValue(without(mine, give).concat(get), ctx.roster, ctx.val, ctx.fill, Math.max(size, mine.length - give.length + get.length));
    var theirAfter = teamValue(without(theirs, get).concat(give), ctx.roster, ctx.val, ctx.fill, Math.max(size, theirs.length - get.length + give.length));
    return { mine: myAfter - myBefore, theirs: theirAfter - theirBefore, dropsNeeded: Math.max(0, mine.length - give.length + get.length - size) };
  }

  /*
   * Trades (1-for-1, 2-for-1, 1-for-2) that help me and don't hurt them by
   * more than `tolerance`, best for me first.
   */
  function findTrades(mine, teams, ctx, opts) {
    opts = opts || {};
    var tolerance = opts.tolerance == null ? 0 : opts.tolerance;
    var out = [];
    var combos = function (list, k) {
      var res = [];
      if (k === 1) list.forEach(function (a) { res.push([a]); });
      else for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) res.push([list[i], list[j]]);
      return res;
    };
    var myOnes = combos(mine, 1), myTwos = combos(mine, 2);
    teams.forEach(function (t) {
      var theirOnes = combos(t.players, 1), theirTwos = combos(t.players, 2);
      var shapes = [[myOnes, theirOnes], [myTwos, theirOnes], [myOnes, theirTwos]];
      shapes.forEach(function (sh) {
        sh[0].forEach(function (give) {
          sh[1].forEach(function (get) {
            var r = evaluateTrade(mine, t.players, give, get, ctx);
            if (r.mine > 0 && r.theirs >= -tolerance) out.push({ team: t, give: give, get: get, mine: r.mine, theirs: r.theirs });
          });
        });
      });
    });
    out.sort(function (a, b) { return b.mine - a.mine; });
    return out.slice(0, opts.limit || 25);
  }

  // Best add/drop for each free agent: team value gain from swapping him in.
  function waiverMoves(mine, freeAgents, ctx) {
    var size = Math.max(ctx.rosterSize, mine.length);
    var base = teamValue(mine, ctx.roster, ctx.val, ctx.fill, size);
    return freeAgents.map(function (fa) {
      var best = null;
      mine.forEach(function (p) {
        if (ctx.undroppable && ctx.undroppable(p)) return;
        var v = teamValue(without(mine, [p]).concat([fa]), ctx.roster, ctx.val, ctx.fill, size) - base;
        if (!best || v > best.gain) best = { drop: p, gain: v };
      });
      return { add: fa, drop: best && best.drop, gain: best ? best.gain : 0 };
    }).sort(function (a, b) { return b.gain - a.gain; });
  }

  return {
    ESPN_TO_SLEEPER: ESPN_TO_SLEEPER,
    FANTASY_WEEKS: FANTASY_WEEKS,
    BENCH_WEIGHT: BENCH_WEIGHT,
    sleeperTeam: sleeperTeam,
    playProb: playProb,
    easternDate: easternDate,
    addDays: addDays,
    weekDates: weekDates,
    boxScoreFp: boxScoreFp,
    waitValue: waitValue,
    lockDecision: lockDecision,
    weekValue: weekValue,
    blendFpg: blendFpg,
    rosValue: rosValue,
    teamValue: teamValue,
    evaluateTrade: evaluateTrade,
    findTrades: findTrades,
    waiverMoves: waiverMoves
  };
});
