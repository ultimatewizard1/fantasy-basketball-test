#!/usr/bin/env node
/*
 * Monte Carlo mock drafts using data/consensus.js and the app's valuation.
 * Opponents draft around Sleeper ADP with noise; "my" team uses a strategy.
 * Team value = season Lock-In points of the optimal starting lineup plus
 * bench at the bench weight.
 *
 *   node scripts/simulate.js [sims=200]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('../js/core.js');

const ROOT = path.join(__dirname, '..');
const SIMS = parseInt(process.argv[2] || '200', 10);
const TEAMS = 10;
const ROSTER = C.DEFAULT_ROSTER;
const ROUNDS = ROSTER.length;
const BENCH_WEIGHT = 0.3;
const SLOTS = C.starterSlots(ROSTER);

// ---- player pool (same steps as the app's consensus mode) ----
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data', 'consensus.js'), 'utf8'), sandbox);
const CONS = sandbox.window.CONSENSUS;
const proj = {}, games = {}, adp = {}, meta = {}, byId = {};
CONS.players.forEach(r => {
  byId[r.id] = r;
  proj[r.id] = Object.assign({ gp: 1 }, r.line);
  games[r.id] = r.gp;
  if (r.adp) adp[r.id] = r.adp;
  meta[r.id] = { full_name: r.name, team: r.team, fantasy_positions: r.pos };
});
const all = C.buildPool({ players: meta, projections: proj, stats: {}, adp, games }, { scoring: C.DEFAULT_SCORING, projWeight: 1 });
const cv = {}, missed = {};
all.forEach(p => { const r = byId[p.id]; if (r.cv) cv[p.id] = r.cv; if (r.injury) missed[p.id] = r.injury.gamesMissed; });
C.applyLockIn(all, { cv, missed });
C.applyValues(all, ROSTER, TEAMS, 'lockin');
const pool = all.slice(0, 260); // nobody relevant is ranked lower than this
const BIG = p => p.pos.indexOf('C') >= 0;
const GUARD = p => p.pos.indexOf('PG') >= 0 || p.pos.indexOf('SG') >= 0;

// ---- helpers ----
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }
const effAdp = p => (p.adp != null ? p.adp : p.rank + 20);
const vorpScore = roster => C.rosterScore(roster, ROSTER, BENCH_WEIGHT).score;

function teamPoints(roster) {
  const res = C.assign(roster, SLOTS, p => p.lockin);
  let pts = 0;
  res.starters.forEach(s => { if (s.player) pts += s.player.lockin; });
  res.bench.sort((a, b) => b.lockin - a.lockin).slice(0, C.benchCount(ROSTER)).forEach(p => { pts += BENCH_WEIGHT * p.lockin; });
  return pts;
}

// ---- my strategies: (available, mine, pickNo, nextPick) -> player ----
function gains(avail, mine) {
  const base = vorpScore(mine);
  return avail.slice(0, 70).map(p => ({ p, g: vorpScore(mine.concat([p])) - base }));
}

const STRATEGIES = {
  'Tool (Now: two-pick lookahead)': (avail, mine, cur, next) => {
    const gl = gains(avail, mine).sort((a, b) => b.g - a.g);
    if (!next) return gl[0].p;
    const cands = gl.slice(0, 40);
    const probs = cands.map(x => C.availability(effAdp(x.p), cur, next));
    const expectedNext = (roster, skip) => {
      const b = vorpScore(roster);
      const opts = [];
      cands.forEach((x, i) => {
        if (i === skip || probs[i] <= 0.01) return;
        const g = vorpScore(roster.concat([x.p])) - b;
        if (g > 0) opts.push({ g, a: probs[i] });
      });
      opts.sort((x, y) => y.g - x.g);
      let e = 0, none = 1;
      opts.forEach(o => { e += o.g * o.a * none; none *= 1 - o.a; });
      return e;
    };
    let best = null, bestScore = -Infinity;
    cands.slice(0, 15).forEach((x, i) => {
      const s = x.g + expectedNext(mine.concat([x.p]), i);
      if (s > bestScore) { bestScore = s; best = x.p; }
    });
    return best;
  },
  // Same as the tool, but never takes a player more than 8 picks before his ADP.
  'Tool, no reaches (max 8 picks ahead of ADP)': (avail, mine, cur, next) => {
    const ok = avail.filter(p => effAdp(p) <= cur + 8);
    return STRATEGIES['Tool (Now: two-pick lookahead)'](ok.length ? ok : avail, mine, cur, next);
  },
  'Best roster fit (Gain, no lookahead)': (avail, mine) => gains(avail, mine).sort((a, b) => b.g - a.g)[0].p,
  'Best value on board (VORP, ignores roster)': avail => avail.slice().sort((a, b) => b.vorp - a.vorp)[0],
  'Draft by ADP (like everyone else)': avail => avail.slice().sort((a, b) => effAdp(a) - effAdp(b))[0],
  'Bigs early (C-eligible in rounds 1-4)': (avail, mine, cur) => {
    const gl = gains(avail, mine).sort((a, b) => b.g - a.g);
    if (cur <= 4 * TEAMS) { const b = gl.find(x => BIG(x.p)); if (b && b.g > 0.75 * gl[0].g) return b.p; }
    return gl[0].p;
  },
  'Guards early (PG/SG in rounds 1-4)': (avail, mine, cur) => {
    const gl = gains(avail, mine).sort((a, b) => b.g - a.g);
    if (cur <= 4 * TEAMS) { const b = gl.find(x => GUARD(x.p)); if (b && b.g > 0.75 * gl[0].g) return b.p; }
    return gl[0].p;
  }
};

// ---- one draft ----
function draft(slot, strategy, seed) {
  const rand = rng(seed);
  let avail = pool.slice();
  const mine = [];
  const myPicks = C.myPicks(slot, TEAMS, ROUNDS).map(p => p.pick);
  for (let pick = 1; pick <= TEAMS * ROUNDS; pick++) {
    let choice;
    if (C.slotForPick(pick, TEAMS) === slot) {
      const next = myPicks.find(p => p > pick) || null;
      choice = strategy(avail, mine, pick, next);
      mine.push(choice);
    } else {
      choice = C.mockPick(avail.slice(0, 120), pick, rand);
    }
    avail = avail.filter(p => p !== choice);
  }
  return mine;
}

function run(slot, name, sims) {
  let tot = 0, tot2 = 0;
  const firsts = {};
  for (let i = 0; i < sims; i++) {
    const team = draft(slot, STRATEGIES[name], 1000 + i * 7919);
    const v = teamPoints(team);
    tot += v; tot2 += v * v;
    firsts[team[0].name] = (firsts[team[0].name] || 0) + 1;
  }
  const mean = tot / sims;
  const se = Math.sqrt(Math.max(0, tot2 / sims - mean * mean) / sims);
  const top = Object.entries(firsts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => n + ' ' + Math.round(100 * c / sims) + '%');
  return { mean, se, top };
}

// Most common pick per round for one slot/strategy: `node scripts/simulate.js 300 rounds 6`
if (process.argv[3] === 'rounds') {
  const slot = parseInt(process.argv[4] || '6', 10);
  const counts = Array.from({ length: ROUNDS }, () => ({}));
  for (let i = 0; i < SIMS; i++) {
    draft(slot, STRATEGIES['Tool (Now: two-pick lookahead)'], 1000 + i * 7919).forEach((p, r) => { counts[r][p.name] = (counts[r][p.name] || 0) + 1; });
  }
  const picks = C.myPicks(slot, TEAMS, ROUNDS);
  counts.forEach((c, r) => {
    const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, k]) => n + ' ' + Math.round(100 * k / SIMS) + '%');
    console.log('R' + (r + 1) + ' #' + picks[r].pick + ': ' + top.join(', '));
  });
  process.exit(0);
}

// Head-to-head of named strategies from one slot: `node scripts/simulate.js 1000 compare 6 "<name>" "<name>"`
if (process.argv[3] === 'compare') {
  const slot = parseInt(process.argv[4], 10);
  process.argv.slice(5).forEach(name => {
    const r = run(slot, name, SIMS);
    console.log(name + ': ' + r.mean.toFixed(0) + ' ± ' + r.se.toFixed(0));
  });
  process.exit(0);
}

const t0 = Date.now();
const out = { sims: SIMS, strategies: {}, slots: {} };
console.error('Strategies from slot 6 (' + SIMS + ' drafts each)...');
Object.keys(STRATEGIES).forEach(name => {
  out.strategies[name] = run(6, name, SIMS);
  console.error('  ' + name + ': ' + out.strategies[name].mean.toFixed(0) + ' ± ' + out.strategies[name].se.toFixed(0));
});
console.error('Every draft slot with the tool strategy...');
for (let slot = 1; slot <= TEAMS; slot++) {
  out.slots[slot] = run(slot, 'Tool (Now: two-pick lookahead)', SIMS);
  console.error('  slot ' + slot + ': ' + out.slots[slot].mean.toFixed(0) + ' ± ' + out.slots[slot].se.toFixed(0) + '  first pick: ' + out.slots[slot].top.join(', '));
}
console.error('done in ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
console.log(JSON.stringify(out, null, 1));
