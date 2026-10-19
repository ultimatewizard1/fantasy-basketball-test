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

test('season blend moves from projection toward actual production', () => {
  assert.equal(S.blendFpg(30, 20, 0), 30);
  assert.equal(S.blendFpg(30, 20, 15), 25);
  assert.ok(S.blendFpg(null, 35, 10) > 25);
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
