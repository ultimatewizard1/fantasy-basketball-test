#!/usr/bin/env node
/*
 * Writes CHEATSHEET.md from data/consensus.js using the same valuation code
 * as the web app. Usage: node scripts/cheatsheet.js [slot] [teams]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('../js/core.js');

const ROOT = path.join(__dirname, '..');
const slot = parseInt(process.argv[2] || '6', 10);
const teams = parseInt(process.argv[3] || '10', 10);
const roster = C.DEFAULT_ROSTER;
const rounds = roster.length;
const scoring = C.DEFAULT_SCORING;

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
const pool = C.buildPool({ players: meta, projections: proj, stats: {}, adp, games }, { scoring, projWeight: 1 });
const cv = {}, missed = {};
pool.forEach(p => {
  const r = byId[p.id];
  if (r.cv) cv[p.id] = r.cv;
  if (r.injury) missed[p.id] = r.injury.gamesMissed;
});
C.applyLockIn(pool, { cv, missed });
const repl = C.applyValues(pool, roster, teams, 'lockin');
pool.forEach(p => { p.cons = byId[p.id]; p.diff = p.adpRank != null ? p.adpRank - p.rank : null; });

const f = (n, d = 1) => (n == null || !isFinite(n) ? '–' : Number(n).toFixed(d));
const pct = x => Math.round(x * 100) + '%';
const effAdp = p => (p.adp != null ? p.adp : p.rank + 20);
const inj = p => {
  const i = p.cons.injury;
  if (!i) return '';
  if (i.gamesMissed >= 82) return 'OUT for season';
  if (i.gamesMissed >= 3) return i.status + ', ~' + i.gamesMissed + ' g (' + (i.summary || '') + ')';
  return i.status;
};
const hist = p => p.cons.gpHist.map((g, i) => (g == null ? '–' : g + ((p.cons.excluded || []).includes(CONS.gpHistorySeasons[i]) ? '*' : ''))).join('/');

const picks = C.myPicks(slot, teams, rounds);
let md = '';
md += '# Draft cheat sheet: slot ' + slot + ', ' + teams + ' teams\n\n';
md += 'Generated from `data/consensus.js` (built ' + CONS.generated + ' from ' + CONS.sources.join(', ') +
  ' + last season at half weight). Regenerate: `python3 scripts/build_consensus.py && node scripts/cheatsheet.js`.\n\n';
md += 'Scoring: ' + Object.entries(scoring).map(([k, v]) => k + ' ' + v).join(', ') + '. ';
md += '**Lock-In scoring:** one game per player per week counts, and you choose which. Rankings use **Lock/wk** (the expected score of the game you lock, with smart lock-or-pass decisions over 2–4 games, from his projected average and game-to-game **Swing** in last season\'s ESPN game logs) × weeks he plays at least one game. A missed game here and there barely matters; whole weeks lost to injury do. Expected games = 50% career games-played rate (one-off outlier seasons such as a single major injury count at 35% weight; recent seasons weigh more) + 50% ESPN/FantasyPros expected games, minus games lost to current injuries. Outlier seasons are marked * in the 3y GP column.\n\n';
md += 'Your picks: ' + picks.map(p => '#' + p.pick).join(', ') + '.\n\n';
md += '**Columns.** **FP/G**: fantasy points per game. **GP**: projected games. **3y GP**: games played in 2025-26/2024-25/2023-24 (* = outlier season, counted at 35% weight). **VORP**: season Lock-In points above replacement. **Swing**: game-to-game standard deviation ÷ average. **ADP**: Sleeper redraft ADP. **Avail**: chance the player is still there at that pick, from ADP.\n\n';

md += '## Targets at your first picks\n\n';
const used = new Set();
picks.slice(0, 6).forEach(mp => {
  const list = pool.filter(p => !used.has(p.id) && C.availability(effAdp(p), 1, mp.pick) >= 0.4).slice(0, 8);
  list.slice(0, 5).forEach(p => used.add(p.id));
  md += '### Round ' + mp.round + ', pick ' + mp.pick + '\n\n| Player | Pos | FP/G | Lock/wk | Swing | GP | 3y GP | VORP | ADP | Avail | Note |\n|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|\n';
  list.forEach(p => {
    md += '| ' + p.name + ' (' + p.team + ') | ' + p.pos.join('/') + ' | ' + f(p.fpg) + ' | ' + f(p.lockWeekly) + ' | ' + pct(p.cv) + ' | ' + f(p.gp, 0) + ' | ' + hist(p) + ' | ' + f(p.vorp, 0) + ' | ' + f(p.adp) + ' | ' + pct(C.availability(effAdp(p), 1, mp.pick)) + ' | ' + inj(p) + ' |\n';
  });
  md += '\n';
});

const preBase = C.preseasonBaseline(pool.map(p => ({ pre: p.cons.preseason, fpg: p.fpg, projMin: p.cons.preseason && p.cons.preseason.projMin })));
const pre = pool.map(p => ({ p, pre: p.cons.preseason, sig: C.preseasonSignal(p.cons.preseason, p.fpg, p.cons.preseason && p.cons.preseason.projMin, preBase) }))
  .filter(x => x.sig && x.sig.label && (x.p.rank <= 180 || (x.p.adp != null && x.p.adp <= 180)));
md += '## Preseason watch list (hints only, not in the rankings)\n\n';
md += 'Preseason is 3–5 games and starters play short minutes, so this compares **production per 36 minutes** with the projection, relative to a typical player\'s preseason (per-36 numbers run ' + Math.round((preBase - 1) * 100) + '% high across the league in short stints), and flags minutes **above** projection (a bigger role). Use it to break ties, not to override the rankings.\n\n';
md += '| Player | Pos | Rank | ADP | Pre games | Pre min (proj) | FP/36 pre vs proj | Signal |\n|---|---|---:|---:|---:|---|---|---|\n';
const order = { 'role up': 0, 'production up': 1, 'production down': 2 };
pre.sort((a, b) => order[a.sig.label] - order[b.sig.label] || a.p.rank - b.p.rank).forEach(({ p, pre, sig }) => {
  md += '| ' + p.name + ' (' + p.team + ') | ' + p.pos.join('/') + ' | ' + p.rank + ' | ' + f(p.adp) + ' | ' + pre.g + ' | ' + f(pre.min) + ' (' + f(pre.projMin) + ') | ' +
    f(pre.fp36) + ' vs ' + f(sig.projFp36) + ' (' + (sig.rate >= 0 ? '+' : '') + Math.round(sig.rate * 100) + '% vs typical) | ' + (sig.label.indexOf('up') >= 0 ? '▲ ' : '▼ ') + sig.label + ' |\n';
});
md += '\n';

md += '## Injury and durability traps (ADP much earlier than value)\n\n| Player | ADP | Our rank | GP | 3y GP | Why |\n|---|---:|---:|---:|---|---|\n';
pool.filter(p => p.adp != null && p.adp <= 150 && (p.diff <= -25) && (p.gp < 62 || p.cons.injury))
  .sort((a, b) => a.adp - b.adp).forEach(p => {
    md += '| ' + p.name + ' | ' + f(p.adp) + ' | ' + p.rank + ' | ' + f(p.gp, 0) + ' | ' + hist(p) + ' | ' + (inj(p) || 'durability') + ' |\n';
  });

md += '\n## Values: your format likes them more than Sleeper ADP does\n\n| Player | Pos | Our rank | ADP | +/- | FP/G | GP |\n|---|---|---:|---:|---:|---:|---:|\n';
pool.filter(p => p.diff != null && p.rank <= 130 && p.diff >= 15).sort((a, b) => a.rank - b.rank).slice(0, 30).forEach(p => {
  md += '| ' + p.name + ' | ' + p.pos.join('/') + ' | ' + p.rank + ' | ' + f(p.adp) + ' | +' + p.diff + ' | ' + f(p.fpg) + ' | ' + f(p.gp, 0) + ' |\n';
});

md += '\n## Overall rankings (top 160)\n\nReplacement level (season FP): ' + C.BASE_POSITIONS.map(pos => pos + ' ' + f(repl.repl[pos], 0)).join(', ') + '.\n\n';
md += '| Rk | Player | Pos | FP/G | Lock/wk | Swing | GP | 3y GP | Lock-In season | VORP | ADP | +/- | Injury |\n|---:|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---|\n';
pool.slice(0, 160).forEach(p => {
  md += '| ' + p.rank + ' | ' + p.name + ' (' + p.team + ') | ' + p.pos.join('/') + ' | ' + f(p.fpg) + ' | ' + f(p.lockWeekly) + ' | ' + pct(p.cv) + ' | ' + f(p.gp, 0) + ' | ' + hist(p) + ' | ' + f(p.lockin, 0) + ' | ' + f(p.vorp, 0) + ' | ' + f(p.adp) + ' | ' + (p.diff == null ? '–' : (p.diff > 0 ? '+' : '') + p.diff) + ' | ' + inj(p) + ' |\n';
});

fs.writeFileSync(path.join(ROOT, 'CHEATSHEET.md'), md);
console.log('Wrote CHEATSHEET.md (' + pool.length + ' players valued)');
