'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

const S = C.DEFAULT_SCORING;

test('fantasy points use league weights', () => {
  // 20 pts, 10 reb, 5 ast, 1 stl, 1 blk, 3 to, 1 dd
  const fp = C.fantasyPoints({ pts: 20, reb: 10, ast: 5, stl: 1, blk: 1, to: 3, dd: 1 }, S);
  assert.equal(fp, 10 + 10 + 5 + 2 + 2 - 3 + 1);
});

test('cleanScoring drops zero and non-numeric entries and falls back to defaults', () => {
  assert.deepEqual(C.cleanScoring({ pts: 0.5, reb: 1, fgm: 0, foo: 'x' }), { pts: 0.5, reb: 1 });
  assert.deepEqual(C.cleanScoring({}), S);
});

test('positions normalise combo labels', () => {
  assert.deepEqual(C.normalizePositions(['G']), ['PG', 'SG']);
  assert.deepEqual(C.normalizePositions(['SF-PF']), ['SF', 'PF']);
  assert.deepEqual(C.normalizePositions(['C', 'PF']), ['PF', 'C']);
  assert.deepEqual(C.normalizePositions([null]), []);
});

test('slot eligibility', () => {
  assert.ok(C.slotAccepts('G', ['SG']));
  assert.ok(!C.slotAccepts('G', ['SF']));
  assert.ok(C.slotAccepts('F', ['PF', 'C']));
  assert.ok(C.slotAccepts('UTIL', ['C']));
  assert.ok(!C.slotAccepts('C', ['PF']));
});

test('assignment is optimal, not naive greedy', () => {
  // Greedy would put the PF/C star at C and leave the C-only player on the bench.
  const players = [
    { id: 'a', pos: ['PF', 'C'], v: 10 },
    { id: 'b', pos: ['C'], v: 8 }
  ];
  const res = C.assign(players, ['C', 'PF'], p => p.v);
  assert.equal(res.bench.length, 0);
  const bySlot = Object.fromEntries(res.starters.map(s => [s.slot, s.player.id]));
  assert.deepEqual(bySlot, { C: 'b', PF: 'a' });
});

test('snake pick numbers for slot 6 of 10', () => {
  const picks = C.myPicks(6, 10, 13).map(p => p.pick);
  assert.deepEqual(picks, [6, 15, 26, 35, 46, 55, 66, 75, 86, 95, 106, 115, 126]);
  assert.equal(C.slotForPick(15, 10), 6);
  assert.equal(C.slotForPick(11, 10), 10);
  assert.equal(C.slotForPick(20, 10), 1);
});

test('availability is monotone and conditional', () => {
  const a1 = C.availability(20, 6, 15);
  const a2 = C.availability(20, 6, 26);
  assert.ok(a1 > a2);
  assert.ok(C.availability(5, 6, 15) < 0.2);
  assert.ok(C.availability(80, 6, 15) > 0.95);
  assert.equal(C.availability(30, 10, 10), 1);
  assert.equal(C.availability(null, 1, 10), null);
});

test('per-game detection', () => {
  const totals = {}, avgs = {};
  for (let i = 0; i < 20; i++) {
    totals[i] = { gp: 70, pts: 900 + i * 20 };
    avgs[i] = { gp: 70, pts: 12 + i };
  }
  assert.equal(C.looksPerGame(totals), false);
  assert.equal(C.looksPerGame(avgs), true);
  assert.equal(C.toPerGame({ gp: 10, pts: 200 }).pts, 20);
  assert.equal(C.toPerGame({ gp: 10, pts: 20 }, true).pts, 20);
});

function fakePool() {
  const players = {}, projections = {}, stats = {};
  const pos = ['PG', 'SG', 'SF', 'PF', 'C'];
  for (let i = 0; i < 200; i++) {
    const id = String(i);
    players[id] = { full_name: 'Player ' + i, team: 'T' + (i % 30), fantasy_positions: [pos[i % 5]] };
    const gp = 60 + (i % 20);
    const pg = { pts: 30 - i * 0.12, reb: (i % 5 === 4 ? 11 : 5) - i * 0.02, ast: 4, stl: 1, blk: i % 5 === 4 ? 1.5 : 0.4, to: 2 };
    projections[id] = Object.fromEntries(Object.entries(pg).map(([k, v]) => [k, v * gp]));
    projections[id].gp = gp;
    projections[id].adp_test = i + 1;
  }
  return { players, projections, stats };
}

test('pool build, VORP and ranking', () => {
  const input = fakePool();
  input.adp = C.extractAdp(input.projections, 'adp_test');
  const pool = C.buildPool(input, { scoring: S, projWeight: 1 });
  assert.equal(pool.length, 200);
  const r = C.applyValues(pool, C.DEFAULT_ROSTER, 10, 'total');
  assert.equal(pool[0].rank, 1);
  assert.ok(pool[0].vorp > pool[50].vorp);
  // 100 starters league-wide: replacement levels sit near the 100th player.
  C.BASE_POSITIONS.forEach(pos => assert.ok(r.repl[pos] > 0));
  assert.equal(Object.keys(r.startingIds).length, 100);
  assert.ok(pool.every(p => p.adpRank != null));
});

test('marginal gain falls when the roster cannot start a player', () => {
  const input = fakePool();
  const pool = C.buildPool(input, { scoring: S, projWeight: 1 });
  C.applyValues(pool, C.DEFAULT_ROSTER, 10, 'total');
  const centers = pool.filter(p => p.pos[0] === 'C');
  const mine = centers.slice(0, 4); // C + 3 UTIL already full of centers
  const nextC = centers[4];
  const guard = pool.find(p => p.pos[0] === 'PG' && p.vorp > 0 && p.vorp < nextC.vorp);
  const gainC = C.marginalGain(mine, nextC, C.DEFAULT_ROSTER, 0.3);
  const gainG = C.marginalGain(mine, guard, C.DEFAULT_ROSTER, 0.3);
  assert.ok(Math.abs(gainC - 0.3 * nextC.vorp) < 1e-6, 'fifth center only adds bench value');
  assert.ok(gainG > gainC, 'a startable guard beats a benched center');
});

test('Sleeper payload normalisation handles array and map forms', () => {
  const arr = [{ player_id: 1, stats: { pts: 10, gp: 1 }, player: { first_name: 'A', last_name: 'B', fantasy_positions: ['C'] } }, { player_id: 2, stats: {} }];
  assert.deepEqual(C.normalizeStatsPayload(arr), { 1: { pts: 10, gp: 1 } });
  assert.deepEqual(C.normalizeStatsPayload({ 5: { pts: 1 } }), { 5: { pts: 1 } });
  assert.equal(C.playersFromPayload(arr)['1'].first_name, 'A');
});

test('ADP keys are detected', () => {
  const keys = C.adpKeys({ 1: { adp_dd_pts: 3, adp_x: 999 }, 2: { adp_dd_pts: 5 } });
  assert.deepEqual(keys, [{ key: 'adp_dd_pts', count: 2 }]);
});

test('CSV import (per-game, Basketball-Reference style) converts to totals and matches names', () => {
  const players = { 10: { full_name: 'Nikola Jokić', team: 'DEN', fantasy_positions: ['C'] } };
  const csv = 'Rk,Player,Age,Team,Pos,G,TRB,AST,STL,BLK,TOV,PTS\n' +
    '1,Nikola Jokic,30,DEN,C,70,12.0,10.0,1.5,0.7,3.0,29.0\n' +
    '2,Some Rookie,20,XXX,SG,50,3,2,1,0,1,10\n' +
    '3,Nobody,22,YYY,,10,1,1,0,0,0,2\n';
  const res = C.statsFromCsv(csv, players);
  assert.equal(res.stats['10'].pts, 29 * 70);
  assert.equal(res.stats['10'].reb, 12 * 70);
  assert.ok(res.extraPlayers['csv:some_rookie']);
  assert.deepEqual(res.unmatched, ['Nobody']);
});

test('mock pick favours low ADP', () => {
  const avail = [{ id: 'a', adp: 1, rank: 1 }, { id: 'b', adp: 40, rank: 2 }];
  let aCount = 0;
  let seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 200; i++) if (C.mockPick(avail, 1, rand).id === 'a') aCount++;
  assert.ok(aCount > 180);
});
