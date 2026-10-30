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
  var RECENT_PROJ_GAMES = 10;     // this week's projection (current role) counts like this many games
  var WEEK_PROJ_WEIGHT = 0.8;     // short-term level: weekly projection vs rest-of-season level
  var UNKNOWN_PRIOR_FPG = 15;     // prior for players without a projection
  var BENCH_WEIGHT = 0.3;
  // Chance a player suits up for a game, by Sleeper/ESPN injury status.
  // Players sat ~6 points more often on the 2nd night of a back-to-back in
  // 2025-26 (stars 19.5% vs 13.9%, others 23.3% vs 16.8%); per-game
  // projections don't account for it.
  var B2B_PLAY_FACTOR = 0.93;
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

  // Fantasy points for one game from a Sleeper stat line (adds double-doubles and 40/50-point bonuses).
  function statLineFp(s, scoring) {
    var line = Object.assign({}, s);
    var tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter(function (k) { return num(s[k]) >= 10; }).length;
    line.dd = tens >= 2 ? 1 : 0;
    line.td = tens >= 3 ? 1 : 0;
    line.bonus_pt_40p = num(s.pts) >= 40 ? 1 : 0;
    line.bonus_pt_50p = num(s.pts) >= 50 ? 1 : 0;
    return C.fantasyPoints(line, scoring);
  }

  /* ---------------- locks and pickups from Sleeper ---------------- */

  /*
   * Lock status from the score Sleeper counts for a player this week (its
   * matchup players_points). games: his games in date order, each
   * { state: 'pre'|'in'|'post', dnp, fps: [the game's score from each source] }.
   * - Counted score equals an earlier game while a later game has been played
   *   with a different score: that earlier game is locked.
   * - Counted score is live points: not locked.
   * - Equal to his latest game with nothing played since: can't tell yet
   *   (Sleeper only shows the difference once his next game starts).
   * Sleeper's matchup scores lag the box scores: for a few hours after a game
   * ends it can still show his previous game (on 10/28, Giannis, Flagg and
   * Durant all showed Monday's score at 10:55 pm ET, then switched to
   * Wednesday's). So a later game only counts as evidence once it's settled
   * (g.settled: about 12 hours after tip-off).
   */
  function detectLock(games, shown) {
    if (shown == null) return { status: 'unknown' };
    var near = function (g) { return (g.fps || []).some(function (f) { return f != null && Math.abs(f - shown) < 0.06; }); };
    var scored = function (g) { return (g.fps || []).some(function (f) { return f != null && f !== 0; }); };
    for (var i = games.length - 1; i >= 0; i--) {
      var g = games[i];
      if (g.state !== 'post' || g.dnp || !near(g)) continue;
      // Later games he actually played (a DNP doesn't change what counts).
      var later = games.slice(i + 1).filter(function (x) { return x.state !== 'pre' && !x.dnp; });
      if (!later.length) return { status: 'unknown', index: i };
      // Sleeper may not have processed the later game yet.
      if (!later.every(function (x) { return x.settled; })) return { status: 'unknown', index: i, waiting: true };
      if (later.some(near)) return { status: 'unknown', index: i };
      // A game that just tipped with no stats yet can't tell us anything.
      if (later.every(function (x) { return x.state === 'in' && !scored(x); })) return { status: 'unknown', index: i };
      return { status: 'locked', score: shown, index: i };
    }
    if (games.some(function (g) { return g.state === 'in'; })) return { status: 'open' };
    return { status: 'unknown' };
  }

  // When each player joined his current roster this week: { playerId: { roster, at (ms) } }.
  function pickupTimes(transactions) {
    var out = {};
    (transactions || []).forEach(function (t) {
      if (!t || t.status !== 'complete' || !t.adds) return;
      var at = t.status_updated || t.created;
      Object.keys(t.adds).forEach(function (pid) {
        if (!out[pid] || out[pid].at < at) out[pid] = { roster: t.adds[pid], at: at };
      });
    });
    return out;
  }

  /* ---------------- Lock-In decisions ---------------- */

  /*
   * Value of passing now with `left` games still to come. q is the chance he
   * plays each game, or an array of per-game chances (the last `left` entries
   * are used), e.g. lower on the 2nd night of a back-to-back.
   */
  function waitValue(mu, sd, left, q) {
    if (left <= 0) return 0;
    if (Array.isArray(q)) return sequenceValue(mu, sd, q.slice(Math.max(0, q.length - left)));
    q = q == null ? 1 : q;
    if (q >= 0.999) return C.lockInValue(mu, sd, left);
    // Unknown availability: average over how many of the games he plays.
    var total = 0;
    for (var k = 1; k <= left; k++) total += binom(left, k, q) * C.lockInValue(mu, sd, k);
    return total; // playing none of them scores 0
  }

  // Optimal lock-or-pass value over games played with chances qs (in order).
  function sequenceValue(mu, sd, qs) {
    var v = 0;
    for (var i = qs.length - 1; i >= 0; i--) {
      var cont = i === qs.length - 1 ? mu : C.expectedMax(mu, sd, v);
      v = qs[i] * cont + (1 - qs[i]) * v;
    }
    return v;
  }

  // Per-game play chances given dates (YYYY-MM-DD, in order) and the team's game dates.
  function gamePlayProbs(base, dates, teamDates) {
    var set = {};
    (teamDates || dates).forEach(function (d) { set[d] = 1; });
    return dates.map(function (d) { return set[addDays(d, -1)] ? base * B2B_PLAY_FACTOR : base; });
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

  /*
   * Rest-of-season FP/G: preseason projection, this season's production and
   * the current weekly projection (which reflects role changes), weighted as
   * 15 games, games played, and 10 games respectively.
   */
  function blendFpg(projFpg, seasonFpg, gp, recentFpg) {
    gp = num(gp);
    var w = 0, t = 0;
    if (projFpg != null) { t += projFpg * SEASON_PRIOR_GAMES; w += SEASON_PRIOR_GAMES; }
    else { t += UNKNOWN_PRIOR_FPG * 5; w += 5; }
    if (gp > 0) { t += seasonFpg * gp; w += gp; }
    if (recentFpg != null) { t += recentFpg * RECENT_PROJ_GAMES; w += RECENT_PROJ_GAMES; }
    return t / w;
  }

  // Short-term per-game level: mostly the weekly projection, anchored to the season level.
  function weekLevel(projGames, rosFpg) {
    if (!projGames || !projGames.length) return rosFpg;
    var avg = projGames.reduce(function (s, g) { return s + g; }, 0) / projGames.length;
    return WEEK_PROJ_WEIGHT * avg + (1 - WEEK_PROJ_WEIGHT) * rosFpg;
  }

  /*
   * Sleeper's per-game projections vs 2025-26 box scores (actual / projected,
   * fit Oct-Jan): rebounds run 13% high and turnovers 7% high. Scaling them
   * removed the +0.7 FP/game bias and cut the error on Jan-Apr games.
   */
  var PROJ_STAT_MULT = { pts: 0.99, reb: 0.87, ast: 0.99, stl: 0.97, to: 0.93, tpm: 0.98 };

  function adjustProjection(stats) {
    var out = Object.assign({}, stats);
    Object.keys(PROJ_STAT_MULT).forEach(function (k) { if (out[k] != null) out[k] *= PROJ_STAT_MULT[k]; });
    return out;
  }

  /* ---------------- betting lines (Sleeper Picks) ---------------- */

  // Sleeper Picks over/under markets -> stat keys.
  var LINE_STATS = { points: 'pts', rebounds: 'reb', assists: 'ast', threes_made: 'tpm', steals: 'stl', blocks: 'blk', turnovers: 'to', double_double: 'dd' };
  // Game-to-game spread of points/rebounds/assists: sd ~ k * sqrt(mean). Rarer stats are Poisson.
  // Fit to 2025-26 single games around Sleeper's projections: pts 1.7-1.8, reb 1.1, ast 1.15-1.3.
  var LINE_SPREAD = { pts: 1.7, reb: 1.1, ast: 1.2 };
  // Line-implied stats vs Sleeper's projection for the same game. Lines track
  // minutes and role changes better: on 10/28 Sleeper projected Mamukelashvili
  // for 15.9 pts / 7.9 reb, his lines implied ~11.8 / 4.8 and he was averaging 9.5 / 4.0.
  var LINE_WEIGHT = 0.7;

  // Over probability from both sides' payouts, with the house margin removed.
  function impliedOver(overMult, underMult) {
    var o = 1 / overMult, u = 1 / underMult;
    return o / (o + u);
  }

  function invNorm(p) {
    var lo = -8, hi = 8;
    for (var i = 0; i < 60; i++) { var mid = (lo + hi) / 2; if (C.normCdf(mid) < p) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  // P(X > line) for a Poisson count.
  function poissonOver(lambda, line) {
    var term = Math.exp(-lambda), cdf = term;
    for (var i = 1; i <= Math.floor(line); i++) { term *= lambda / i; cdf += term; }
    return 1 - cdf;
  }

  // Expected value of a stat given its line and the chance of going over.
  function lineMean(stat, line, pOver) {
    if (stat === 'dd') return pOver;
    var p = Math.min(0.97, Math.max(0.03, pOver));
    if (LINE_SPREAD[stat]) {
      var z = invNorm(p), mu = line;
      for (var i = 0; i < 30; i++) mu = Math.max(0, line + z * LINE_SPREAD[stat] * Math.sqrt(Math.max(mu, 0.25)));
      return mu;
    }
    var lo = 0, hi = 4 * line + 10;
    for (var j = 0; j < 60; j++) { var mid = (lo + hi) / 2; if (poissonOver(mid, line) < p) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  // { 'gameId|playerId': { pts: expected, reb: ..., ... } } from Sleeper Picks markets.
  function linesByGame(markets) {
    var out = {};
    (markets || []).forEach(function (m) {
      if (!m || m.sport !== 'nba' || m.subject_type !== 'player' || m.outcome_type !== 'over_under') return;
      var stat = LINE_STATS[m.wager_type];
      if (!stat) return;
      var side = function (name) { return (m.options || []).filter(function (o) { return o.outcome === name && o.status === 'active'; })[0]; };
      var over = side('over'), under = side('under');
      if (!over || !under || +over.outcome_value !== +under.outcome_value) return;
      var key = m.game_id + '|' + m.subject_id;
      (out[key] = out[key] || {})[stat] = lineMean(stat, +over.outcome_value, impliedOver(+over.payout_multiplier, +under.payout_multiplier));
    });
    return out;
  }

  // Projected stat line with the stats the lines cover pulled toward them.
  function blendLines(stats, lineStats, weight) {
    var w = weight == null ? LINE_WEIGHT : weight;
    var out = Object.assign({}, stats);
    Object.keys(lineStats || {}).forEach(function (k) {
      out[k] = stats[k] == null ? lineStats[k] : w * lineStats[k] + (1 - w) * stats[k];
    });
    return out;
  }

  /*
   * Short-term lineup gain from adding a free agent: best drop among my
   * `candidates` (lowest rest-of-season value) by change in the value of my
   * starting lineups. Bench players don't score in Lock-In. weekVals is one
   * valuation per week (or a single function); each week gets its own best
   * lineup, so a pickup can start next week without starting this week.
   * A free agent who wouldn't start in any week gets a negative gain: how
   * much the lineup would lose if he started anyway (his shortfall).
   */
  function shortTermMoves(mine, freeAgents, candidates, roster, weekVals, rosVal, ctx) {
    var slots = C.starterSlots(roster);
    var weeks = Array.isArray(weekVals) ? weekVals : [weekVals];
    var total = function (p) { return weeks.reduce(function (t, val) { return t + val(p); }, 0); };
    var lineup = function (list, force) {
      var active = list.filter(function (p) { return !p.onIR; });
      return weeks.reduce(function (t, val) {
        var v = force ? function (p) { return p === force ? val(p) + 1e6 : val(p); } : val;
        C.assign(active, slots, v).starters.forEach(function (s) { if (s.player) t += val(s.player); });
        return t;
      }, 0);
    };
    var base = lineup(mine);
    var rosSize = Math.max(ctx.rosterSize, activeCount(mine, ctx.irSlots));
    var rosBase = teamValue(mine, roster, rosVal, ctx.fill, rosSize, ctx.irSlots);
    return freeAgents.map(function (fa) {
      var best = null;
      candidates.forEach(function (d) {
        var after = without(mine, [d]).concat([fa]);
        var g = lineup(after) - base;
        var starts = g > 1e-9;
        if (!starts) g = Math.min(0, lineup(after, fa) - base);
        if (!best || g > best.gain) best = { drop: d, gain: g, starts: starts, after: after };
      });
      var rosChange = best ? teamValue(best.after, roster, rosVal, ctx.fill, rosSize, ctx.irSlots) - rosBase : 0;
      return { add: fa, drop: best && best.drop, gain: best ? best.gain : 0, starts: !!(best && best.starts), rosChange: rosChange };
    }).sort(function (a, b) { return (b.gain - a.gain) || (total(b.add) - total(a.add)); });
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
  /*
   * IR only frees a roster spot while the player is out. Someone back within a
   * few weeks needs his spot again almost right away (you'd drop someone when
   * he returns), so only longer absences count as stashed.
   */
  var IR_STASH_WEEKS = 3;

  // Players stashed on IR (up to irSlots, longest absences first); the rest need active spots.
  // p.irEligible: his injury status qualifies for IR under the league's rules.
  function splitIR(players, irSlots) {
    var stash = players.filter(function (p) { return p.irEligible && (p.weeksOut || 0) >= IR_STASH_WEEKS; })
      .sort(function (a, b) { return (b.weeksOut || 0) - (a.weeksOut || 0); }).slice(0, irSlots || 0);
    var ids = {};
    stash.forEach(function (p) { ids[p.id] = 1; });
    return { ir: stash, active: players.filter(function (p) { return !ids[p.id]; }) };
  }

  function teamValue(players, roster, val, fill, rosterSize, irSlots) {
    // IR stashes don't use an active spot; they count like bench depth.
    var split = splitIR(players, irSlots);
    var ir = split.ir, list = split.active.slice();
    var size = rosterSize || roster.length;
    for (var i = list.length; i < size; i++) list.push({ id: '_fa' + i, pos: ['PG', 'SG', 'SF', 'PF', 'C'], _fill: true });
    var v = function (p) { return p._fill ? (fill || 0) : val(p); };
    var res = C.assign(list, C.starterSlots(roster), v);
    var total = 0;
    res.starters.forEach(function (s) { if (s.player) total += v(s.player); });
    res.bench.sort(function (a, b) { return v(b) - v(a); })
      .slice(0, C.benchCount(roster)).forEach(function (p) { total += BENCH_WEIGHT * v(p); });
    ir.forEach(function (p) { total += BENCH_WEIGHT * val(p); });
    return total;
  }

  function activeCount(list, irSlots) { return splitIR(list, irSlots).active.length; }

  // Who you'd cut to get back to the roster limit: your lowest-valued active players.
  function dropsFor(list, size, val, irSlots) {
    var active = splitIR(list, irSlots).active;
    return active.slice().sort(function (a, b) { return val(a) - val(b); }).slice(0, Math.max(0, active.length - size));
  }

  function without(list, remove) {
    var ids = {};
    remove.forEach(function (p) { ids[p.id] = 1; });
    return list.filter(function (p) { return !ids[p.id]; });
  }

  // Change in team value for both sides of a trade.
  /*
   * Change in team value for both sides of a trade. ctx.val is our model;
   * ctx.theirVal (optional) is how the other manager likely values players
   * (market perception plus their short-term needs). `theirs` uses theirVal
   * when given, `theirsModel` always uses our model.
   */
  function evaluateTrade(mine, theirs, give, get, ctx) {
    var size = ctx.rosterSize, irs = ctx.irSlots;
    var myAfterList = without(mine, give).concat(get), theirAfterList = without(theirs, get).concat(give);
    // A roster over the limit keeps its best players: the extra ones count for nothing (dropped).
    var delta = function (before, after, val) {
      return teamValue(after, ctx.roster, val, ctx.fill, Math.max(size, activeCount(after, irs)), irs) -
        teamValue(before, ctx.roster, val, ctx.fill, Math.max(size, activeCount(before, irs)), irs);
    };
    var theirsModel = delta(theirs, theirAfterList, ctx.val);
    // Drops this trade adds, beyond any you already owe (e.g. someone back from IR).
    var extra = Math.max(0, activeCount(myAfterList, irs) - Math.max(size, activeCount(mine, irs)));
    return {
      mine: delta(mine, myAfterList, ctx.val),
      theirs: ctx.theirVal ? delta(theirs, theirAfterList, ctx.theirVal) : theirsModel,
      theirsModel: theirsModel,
      dropsNeeded: extra,
      drops: extra ? dropsFor(myAfterList, activeCount(myAfterList, irs) - extra, ctx.val, irs) : []
    };
  }

  /*
   * Trades (1-for-1, 2-for-1, 1-for-2) a real manager would plausibly accept,
   * best for me first. The other side must:
   *  - not lose value by our projections (theirsModel >= minModel): most
   *    managers check rankings or projections before accepting;
   *  - see a gain the way they value players (theirs >= minTheirs): market
   *    view plus their short-term needs;
   *  - not give up the best player in the deal for clearly less: the best
   *    player they get must be worth >= STAR_RATIO of the best they give,
   *    by market value (opts.market). Two decent players rarely buy a star.
   * Near-duplicates are collapsed: one deal per set of players I'd get.
   */
  var STAR_RATIO = 0.85;

  function findTrades(mine, teams, ctx, opts) {
    opts = opts || {};
    var minTheirs = opts.minTheirs == null ? 0 : opts.minTheirs;
    var minModel = opts.minModel == null ? 0 : opts.minModel;
    var market = opts.market;
    var best = function (list, f) { return list.reduce(function (m, p) { return Math.max(m, f(p)); }, -Infinity); };
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
            if (market && best(give, market) < STAR_RATIO * best(get, market)) return;
            var r = evaluateTrade(mine, t.players, give, get, t.val ? Object.assign({}, ctx, { theirVal: t.val }) : ctx);
            if (r.mine > 0 && r.theirs >= minTheirs && r.theirsModel >= minModel) out.push({ team: t, give: give, get: get, mine: r.mine, theirs: r.theirs, theirsModel: r.theirsModel, drops: r.drops });
          });
        });
      });
    });
    out.sort(function (a, b) { return b.mine - a.mine; });
    var seen = {}, perTeam = {};
    return out.filter(function (t) {
      var key = t.team.name + '|' + t.get.map(function (p) { return p.id; }).sort().join(',');
      if (seen[key] || (perTeam[t.team.name] || 0) >= (opts.perTeam || 4)) return false;
      seen[key] = 1; perTeam[t.team.name] = (perTeam[t.team.name] || 0) + 1;
      return true;
    }).slice(0, opts.limit || 25);
  }

  // Best add/drop for each free agent: team value gain from swapping him in.
  function waiverMoves(mine, freeAgents, ctx) {
    var size = Math.max(ctx.rosterSize, activeCount(mine, ctx.irSlots));
    var base = teamValue(mine, ctx.roster, ctx.val, ctx.fill, size, ctx.irSlots);
    return freeAgents.map(function (fa) {
      var best = null;
      mine.forEach(function (p) {
        if (ctx.undroppable && ctx.undroppable(p)) return;
        var v = teamValue(without(mine, [p]).concat([fa]), ctx.roster, ctx.val, ctx.fill, size, ctx.irSlots) - base;
        if (!best || v > best.gain) best = { drop: p, gain: v };
      });
      return { add: fa, drop: best && best.drop, gain: best ? best.gain : 0 };
    }).sort(function (a, b) { return b.gain - a.gain; });
  }

  /* ---------------- how other managers see players ---------------- */

  // Managers react to this season's numbers faster than our model does: their
  // draft-day view of a player counts like this many games.
  var MARKET_NAME_GAMES = 6;

  /*
   * Perceived FP/G: draft-day reputation (the projected FP/G of the player
   * ranked at his ADP) pulled toward this season's actual FP/G.
   */
  function perceivedFpg(nameFpg, seasonFpg, gp) {
    gp = num(gp);
    if (nameFpg == null) return gp > 0 ? seasonFpg : null;
    if (!gp) return nameFpg;
    return (nameFpg * MARKET_NAME_GAMES + seasonFpg * gp) / (MARKET_NAME_GAMES + gp);
  }

  /*
   * How urgently a team needs healthy production now (0..1): share of its
   * starters' weekly value currently out injured, plus a losing record.
   */
  function teamUrgency(starterWeekly, injuredWeekly, wins, losses) {
    var share = starterWeekly > 0 ? injuredWeekly / starterWeekly : 0;
    return Math.max(0, Math.min(1, share * 2.5 + (num(losses) - num(wins)) * 0.08));
  }

  /* ---------------- matchup simulation ---------------- */

  // Small seeded RNG so every scenario sees the same random games
  // (common random numbers make lock-vs-pass comparisons precise).
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function gaussFrom(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // Lock bar for a game with `after` games still to come, shifted by `shift` sds
  // (negative = lock sooner, safer; positive = hold out for a big game).
  function lockBar(p, after, shift) { return waitValue(p.mu, p.sd, after, p.qs || p.q) + (shift || 0) * p.sd; }

  /*
   * One simulated rest-of-week for a starter.
   * p: { mu, sd, q, left, pending (lockable score or null), locked (score or null) }
   * policy: { shift } (smart, bars shifted) | { never: true } | { eager: true } (lock anything >= average)
   * decision: 'lock' | 'pass' | undefined for the pending game.
   * draws: per remaining game { u, z } so scenarios share the same games.
   */
  function simulatePlayer(p, policy, decision, draws) {
    if (p.locked != null) return p.locked;
    var lockIt = function (score, after) {
      if (policy.never) return false;
      if (policy.eager) return score >= p.mu;
      return score >= lockBar(p, after, policy.shift);
    };
    var last = p.pending; // if no later game is played, the last game played counts
    if (p.pending != null) {
      var lockNow = decision === 'lock' || (decision !== 'pass' && lockIt(p.pending, p.left));
      if (lockNow || p.left === 0) return p.pending;
    }
    for (var k = p.left; k >= 1; k--) {
      var d = draws[p.left - k];
      var q = p.qs && p.qs.length === p.left ? p.qs[p.left - k] : (p.q == null ? 1 : p.q);
      if (d.u >= q) continue; // sits this one out
      var g = p.mu + p.sd * d.z;
      last = g;
      if (k === 1 || lockIt(g, k - 1)) return g;
    }
    return last == null ? 0 : last;
  }

  /*
   * Monte Carlo of the rest of the week. Ties count as half a win.
   * opts: { n, seed, myPolicy, oppPolicy, decisions: { playerId: 'lock' | 'pass' } }
   */
  function simulateMatchup(mine, theirs, opts) {
    var n = opts.n || 5000, seed = opts.seed || 1;
    var decisions = opts.decisions || {};
    var wins = 0, sumA = 0, sumB = 0;
    var all = mine.concat(theirs);
    for (var i = 0; i < n; i++) {
      var r = mulberry32(seed + i * 7919);
      var a = 0, b = 0;
      for (var j = 0; j < all.length; j++) {
        var p = all[j], draws = [];
        for (var k = 0; k < p.left; k++) draws.push({ u: r(), z: gaussFrom(r) });
        if (j < mine.length) a += simulatePlayer(p, opts.myPolicy || {}, decisions[p.id], draws);
        else b += simulatePlayer(p, opts.oppPolicy || {}, undefined, draws);
      }
      sumA += a; sumB += b;
      wins += a > b ? 1 : a === b ? 0.5 : 0;
    }
    return { win: wins / n, mine: sumA / n, theirs: sumB / n };
  }

  var PLAN_SHIFTS = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];

  /*
   * What to do to win the week: how aggressive your lock bars should be,
   * and lock-vs-pass win chances for every game you can lock right now.
   */
  /*
   * Win chances within this margin count as a tie. Ties go to the lower-risk
   * choice for the side you're on: ahead -> lock (a banked score can't fall
   * apart; the simulation can't see every way a game goes wrong), behind ->
   * pass (keep the upside).
   */
  // About 20 of 20,000 simulations (the count used when one side is a big favorite):
  // anything smaller is noise.
  var TIE_MARGIN = 0.001;

  function matchupPlan(mine, theirs, opts) {
    opts = opts || {};
    var base = { n: opts.n || 5000, seed: opts.seed || 1, oppPolicy: opts.oppPolicy || {} };
    var sim = function (extra) { return simulateMatchup(mine, theirs, Object.assign({}, base, extra)); };
    var shifts = PLAN_SHIFTS.map(function (sh) { return { shift: sh, result: sim({ myPolicy: { shift: sh } }) }; });
    var ahead = shifts.filter(function (x) { return x.shift === 0; })[0].result.win >= 0.5;
    var best = shifts.reduce(function (a, b) {
      if (b.result.win > a.result.win + TIE_MARGIN) return b;
      // Tie: ahead -> safer bars (lock sooner), behind -> bolder bars.
      if (Math.abs(b.result.win - a.result.win) <= TIE_MARGIN && (ahead ? b.shift < a.shift : b.shift > a.shift)) return b;
      return a;
    });
    var policy = { shift: best.shift };
    // Near-certain outcomes: more simulations, so 99.6% vs 100% is real and not noise.
    if (best.result.win > 0.9 || best.result.win < 0.1) base.n = Math.max(base.n, 20000);
    var decisions = mine.filter(function (p) { return p.pending != null && p.locked == null && p.left > 0; }).map(function (p) {
      var d = {}, e = {};
      d[p.id] = 'lock'; e[p.id] = 'pass';
      var lock = sim({ myPolicy: policy, decisions: d }), pass = sim({ myPolicy: policy, decisions: e });
      var tie = Math.abs(lock.win - pass.win) <= TIE_MARGIN;
      var call = tie ? (ahead ? 'lock' : 'pass') : lock.win > pass.win ? 'lock' : 'pass';
      return { player: p, lockWin: lock.win, passWin: pass.win, bar: lockBar(p, p.left, best.shift), call: call, tie: tie, clinch: lock.win >= 1 && pass.win < 1 };
    });
    var bars = mine.filter(function (p) { return p.locked == null && p.left > 0; }).map(function (p) {
      return { player: p, after: p.left - 1, bar: p.left > 1 ? lockBar(p, p.left - 1, best.shift) : null, standardBar: p.left > 1 ? lockBar(p, p.left - 1, 0) : null };
    });
    return { shifts: shifts, best: best, ahead: ahead, smart: shifts.filter(function (x) { return x.shift === 0; })[0], decisions: decisions, bars: bars };
  }

  return {
    ESPN_TO_SLEEPER: ESPN_TO_SLEEPER,
    perceivedFpg: perceivedFpg,
    teamUrgency: teamUrgency,
    lockBar: lockBar,
    simulatePlayer: simulatePlayer,
    simulateMatchup: simulateMatchup,
    matchupPlan: matchupPlan,
    FANTASY_WEEKS: FANTASY_WEEKS,
    BENCH_WEIGHT: BENCH_WEIGHT,
    sleeperTeam: sleeperTeam,
    B2B_PLAY_FACTOR: B2B_PLAY_FACTOR,
    sequenceValue: sequenceValue,
    gamePlayProbs: gamePlayProbs,
    playProb: playProb,
    easternDate: easternDate,
    addDays: addDays,
    weekDates: weekDates,
    boxScoreFp: boxScoreFp,
    statLineFp: statLineFp,
    detectLock: detectLock,
    pickupTimes: pickupTimes,
    TIE_MARGIN: TIE_MARGIN,
    waitValue: waitValue,
    lockDecision: lockDecision,
    weekValue: weekValue,
    blendFpg: blendFpg,
    weekLevel: weekLevel,
    shortTermMoves: shortTermMoves,
    adjustProjection: adjustProjection,
    impliedOver: impliedOver,
    lineMean: lineMean,
    linesByGame: linesByGame,
    blendLines: blendLines,
    LINE_WEIGHT: LINE_WEIGHT,
    rosValue: rosValue,
    teamValue: teamValue,
    splitIR: splitIR,
    IR_STASH_WEEKS: IR_STASH_WEEKS,
    evaluateTrade: evaluateTrade,
    findTrades: findTrades,
    waiverMoves: waiverMoves,
    STAR_RATIO: STAR_RATIO
  };
});
