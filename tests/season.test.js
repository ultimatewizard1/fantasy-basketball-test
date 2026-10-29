'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');
const S = require('../js/season-core.js');

test('Lock-In weeks run Monday to Sunday', () => {
  assert.deepEqual(S.weekDates('2026-10-21'), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.equal(S.weekDates('2026-10-25')[0], '2026-10-19');
  assert.equal(S.weekDates('2026-10-26')[0], '2026-10-26');
  assert.equal(S.easternDate(new Date('2026-10-22T02:30:00Z')), '2026-10-21');
});

test('box score fantasy points use league scoring, double-doubles and bonuses', () => {
  const keys = ['minutes', 'points', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'rebounds', 'assists', 'turnovers', 'steals', 'blocks'];
  const r = S.boxScoreFp(keys, ['35', '41', '3-7', '12', '5', '4', '2', '1'], C.DEFAULT_SCORING);
  // 41*.5 + 3*.5 + 12 + 5 - 4 + 2*2 + 1*2 + dd 1 + 40-pt bonus 2
  assert.equal(r.fp, 20.5 + 1.5 + 12 + 5 - 4 + 4 + 2 + 1 + 2);
});

test('lock decision: last game is forced, thresholds rise with games left', () => {
  assert.equal(S.lockDecision(30, 10, 5, 0).forced, true);
  const one = S.lockDecision(30, 10, 31, 1), two = S.lockDecision(30, 10, 31, 2);
  assert.equal(one.lock, true);   // beats the average of the one game left
  assert.equal(two.lock, false);  // two games left: bar is ~34
  assert.ok(Math.abs(two.threshold - C.lockInValue(30, 10, 2)) < 1e-9);
  // An injured player is worth less to wait on, so the bar drops.
  assert.ok(S.lockDecision(30, 10, 31, 2, 0.5).threshold < two.threshold);
});

test('week value keeps a lockable game as a floor', () => {
  assert.equal(S.weekValue(30, 10, 45, 1), 45);
  assert.equal(S.weekValue(30, 10, 10, 1), 30);
  assert.equal(S.weekValue(30, 10, null, 0), 0);
});

test('season blend moves from projection toward actual production and current role', () => {
  assert.equal(S.blendFpg(30, 20, 0), 30);
  assert.equal(S.blendFpg(30, 20, 15), 25);
  assert.ok(S.blendFpg(null, 35, 10) > 25);
  // Bench player promoted to starter: 14 preseason, 23 this week.
  const v = S.blendFpg(14, 18.5, 1, 23);
  assert.ok(v > 17 && v < 18.5);
  assert.equal(S.weekLevel([22, 23, 26], 15), 0.8 * (71 / 3) + 0.2 * 15);
  assert.equal(S.weekLevel([], 15), 15);
});

test('short-term pickups only consider the drops offered and report the season cost', () => {
  const mine = [{ id: 'a', pos: ['C'], h: 0, r: 900 }, { id: 'b', pos: ['C'], h: 10, r: 50 }];
  const fa = [{ id: 'z', pos: ['C'], h: 40, r: 60 }];
  const m = S.shortTermMoves(mine, fa, [mine[1]], C.DEFAULT_ROSTER, p => p.h, p => p.r, ctx);
  assert.equal(m[0].drop.id, 'b');
  assert.equal(m[0].gain, 30);
  assert.ok(m[0].rosChange > 0);
});

test('short-term pickups: shortfall when he would not start, each week its own lineup', () => {
  // A full lineup of 20s at every slot; bench players worth little.
  const mine = [];
  for (let i = 0; i < 10; i++) mine.push({ id: 's' + i, pos: ['PG', 'SG', 'SF', 'PF', 'C'], h: 20, n: 20, r: 900 });
  for (let i = 0; i < 3; i++) mine.push({ id: 'b' + i, pos: ['C'], h: 5, n: 5, r: 100 + i });
  const thisWk = p => p.h, nextWk = p => p.n;
  const fa = { id: 'z', pos: ['C'], h: 17, n: 26, r: 200 };
  const one = S.shortTermMoves(mine, [fa], mine.slice(10), C.DEFAULT_ROSTER, [thisWk], p => p.r, ctx)[0];
  assert.equal(one.starts, false);
  assert.equal(one.gain, -3); // 3 short of the weakest starter
  // Next week he'd start (+6) even though he wouldn't this week.
  const two = S.shortTermMoves(mine, [fa], mine.slice(10), C.DEFAULT_ROSTER, [thisWk, nextWk], p => p.r, ctx)[0];
  assert.equal(two.starts, true);
  assert.equal(two.gain, 6);
});

function player(id, pos, v) { return { id, pos, v }; }
const ctx = { roster: C.DEFAULT_ROSTER, rosterSize: 13, val: p => p.v, fill: 100 };

test('trade evaluation is lineup-aware for both teams', () => {
  const mine = [player('a', ['C'], 900), player('b', ['C'], 800), player('c', ['C'], 700), player('d', ['C'], 650), player('e', ['C'], 600)];
  const theirs = [player('x', ['PG'], 700), player('y', ['SG'], 650)];
  // My 5th center only plays bench; their PG starts for me. Bench centers have value for them.
  const r = S.evaluateTrade(mine, theirs, [mine[4]], [theirs[0]], ctx);
  assert.ok(r.mine > 0);
  assert.ok(r.theirs < 0);
  const found = S.findTrades(mine, [{ name: 'T', players: theirs }], ctx, { tolerance: 1000 });
  assert.ok(found.length > 0 && found[0].mine > 0);
});

test('waiver moves pick the best drop', () => {
  const mine = [player('a', ['PG'], 500), player('b', ['PG'], 50)];
  const fa = [player('z', ['SG'], 300)];
  const m = S.waiverMoves(mine, fa, ctx);
  assert.equal(m[0].drop.id, 'b');
  assert.ok(m[0].gain > 0);
});

test('matchup simulation: locked players are fixed, never-lockers keep their last game', () => {
  const p = { id: 'a', mu: 30, sd: 10, q: 1, left: 2, pending: 50, locked: null };
  assert.equal(S.simulatePlayer({ ...p, locked: 12 }, {}, undefined, []), 12);
  const draws = [{ u: 0, z: -1 }, { u: 0, z: 0.5 }];
  assert.equal(S.simulatePlayer(p, { never: true }, undefined, draws), 35);
  assert.equal(S.simulatePlayer(p, {}, undefined, draws), 50); // 50 beats the bar: smart lock
  assert.equal(S.simulatePlayer(p, {}, 'pass', draws), 35);    // passed: lock bar for 1 left is 30, 20 fails, 35 counts
  // Sits out his remaining games after passing: the last game played (the pending one) counts.
  assert.equal(S.simulatePlayer({ ...p, q: 0.5 }, {}, 'pass', [{ u: 0.99, z: 0 }, { u: 0.99, z: 0 }]), 50);
});

test('matchup plan: safer when ahead, more aggressive when behind', () => {
  const me = id => ({ id, mu: 30, sd: 10, q: 1, left: 3, pending: null, locked: null });
  const mine = [me('a'), me('b'), me('c')];
  const ahead = S.matchupPlan(mine, [{ id: 'x', locked: 90, left: 0 }], { n: 3000 });
  const behind = S.matchupPlan(mine, [{ id: 'x', locked: 135, left: 0 }], { n: 3000 });
  assert.ok(ahead.best.result.win > 0.5 && behind.best.result.win < 0.5);
  assert.ok(ahead.best.shift < 0, 'ahead: lock sooner');
  assert.ok(behind.best.shift > 0, 'behind: hold out for big games');
});

test('matchup plan: lock-vs-pass call depends on the standing', () => {
  const p = { id: 'a', mu: 30, sd: 10, q: 1, left: 2, pending: 32, locked: null };
  const fixed = { id: 'b', locked: 30, left: 0 };
  const ahead = S.matchupPlan([p, fixed], [{ id: 'x', locked: 50, left: 0 }], { n: 4000 });
  const behind = S.matchupPlan([p, fixed], [{ id: 'x', locked: 75, left: 0 }], { n: 4000 });
  assert.equal(ahead.decisions[0].call, 'lock');   // 62 already beats 50: bank it
  assert.equal(behind.decisions[0].call, 'pass');  // need 45+ from him: chase it
});

test('per-game play chances: back-to-backs lower the value of waiting', () => {
  // All games certain: same as the standard optimal-stopping value.
  assert.ok(Math.abs(S.sequenceValue(30, 10, [1, 1, 1]) - C.lockInValue(30, 10, 3)) < 1e-9);
  assert.ok(Math.abs(S.waitValue(30, 10, 2, [1, 1, 1]) - C.lockInValue(30, 10, 2)) < 1e-9);
  const qs = S.gamePlayProbs(0.97, ['2026-10-27', '2026-10-28', '2026-10-31']);
  assert.deepEqual(qs.map(q => +q.toFixed(4)), [0.97, +(0.97 * S.B2B_PLAY_FACTOR).toFixed(4), 0.97]);
  assert.ok(S.sequenceValue(30, 10, qs) < S.sequenceValue(30, 10, [0.97, 0.97, 0.97]));
  // The simulation uses each game's own chance.
  const p = { id: 'a', mu: 30, sd: 10, left: 2, qs: [0, 1], pending: null, locked: null };
  assert.equal(S.simulatePlayer(p, {}, undefined, [{ u: 0.5, z: 2 }, { u: 0.5, z: 0 }]), 30);
});

test('IR players do not take an active spot, so a deep-bench swap still shows its value', () => {
  // 10 starters + 3 bench + 1 IR: the 3rd bench player is the drop candidate.
  const mine = [];
  for (let i = 0; i < 13; i++) mine.push(player('m' + i, ['PG', 'SG', 'SF', 'PF', 'C'], 1000 - i * 50));
  mine.push({ id: 'ir', pos: ['PG'], v: 420, onIR: true }); // injured, but worth more than the 400 bench player
  // A 450 free agent replaces the 400 bench player: +50 of bench value at 0.3 weight.
  const m = S.waiverMoves(mine, [player('fa', ['C'], 450)], ctx);
  assert.equal(m[0].drop.id, 'm12');
  assert.ok(Math.abs(m[0].gain - 0.3 * 50) < 1e-9);
  // The IR player's value still counts toward the team (as bench depth).
  assert.ok(S.teamValue(mine, C.DEFAULT_ROSTER, p => p.v, 0, 13) > S.teamValue(mine.slice(0, 13), C.DEFAULT_ROSTER, p => p.v, 0, 13));
});

test('market perception: slumping players look worse to their manager; needy teams', () => {
  // Drafted as a 35 FP/G star, averaging 25 over 6 games: the market sees 30, our model (15-game prior) more.
  assert.equal(S.perceivedFpg(35, 25, 6), 30);
  assert.equal(S.perceivedFpg(35, 25, 0), 35);
  assert.equal(S.teamUrgency(300, 0, 2, 2), 0);
  assert.ok(S.teamUrgency(300, 70, 1, 3) > 0.7);
  // A trade they'd accept by their (needy) valuation but not by ours.
  const mine = [player('a', ['PG'], 500)];
  const theirs = [player('x', ['PG'], 600)];
  const theirVal = p => (p.id === 'a' ? 700 : p.v);
  const r = S.evaluateTrade(mine, theirs, [mine[0]], [theirs[0]], Object.assign({}, ctx, { theirVal }));
  assert.ok(r.mine > 0 && r.theirs > 0 && r.theirsModel < 0);
});
