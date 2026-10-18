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
const repl = C.applyValues(pool, roster, teams, 'total');
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
const hist = p => p.cons.gpHist.map(g => (g == null ? '–' : g)).join('/');

const picks = C.myPicks(slot, teams, rounds);
let md = '';
md += '# Draft cheat sheet: slot ' + slot + ', ' + teams + ' teams\n\n';
md += 'Generated from `data/consensus.js` (built ' + CONS.generated + ' from ' + CONS.sources.join(', ') +
  ' + last season at half weight). Regenerate: `python3 scripts/build_consensus.py && node scripts/cheatsheet.js`.\n\n';
md += 'Scoring: ' + Object.entries(scoring).map(([k, v]) => k + ' ' + v).join(', ') + '. ';
md += 'Season FP = FP/G × projected games. Projected games blend 3-season games-played history (3:2:1 weights) with ESPN/FantasyPros games projections, minus games lost to current injuries.\n\n';
md += 'Your picks: ' + picks.map(p => '#' + p.pick).join(', ') + '.\n\n';
md += '**Columns.** **FP/G**: fantasy points per game. **GP**: projected games. **3y GP**: games played in 2025-26/2024-25/2023-24. **VORP**: season points above replacement. **ADP**: Sleeper redraft ADP. **Avail**: chance the player is still there at that pick, from ADP.\n\n';

md += '## Targets at your first picks\n\n';
const used = new Set();
picks.slice(0, 6).forEach(mp => {
  const list = pool.filter(p => !used.has(p.id) && C.availability(effAdp(p), 1, mp.pick) >= 0.4).slice(0, 8);
  list.slice(0, 5).forEach(p => used.add(p.id));
  md += '### Round ' + mp.round + ', pick ' + mp.pick + '\n\n| Player | Pos | FP/G | GP | 3y GP | VORP | ADP | Avail | Note |\n|---|---|---:|---:|---|---:|---:|---:|---|\n';
  list.forEach(p => {
    md += '| ' + p.name + ' (' + p.team + ') | ' + p.pos.join('/') + ' | ' + f(p.fpg) + ' | ' + f(p.gp, 0) + ' | ' + hist(p) + ' | ' + f(p.vorp, 0) + ' | ' + f(p.adp) + ' | ' + pct(C.availability(effAdp(p), 1, mp.pick)) + ' | ' + inj(p) + ' |\n';
  });
  md += '\n';
});

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
md += '| Rk | Player | Pos | FP/G | GP | 3y GP | Season FP | VORP | ADP | +/- | Injury |\n|---:|---|---|---:|---:|---|---:|---:|---:|---:|---|\n';
pool.slice(0, 160).forEach(p => {
  md += '| ' + p.rank + ' | ' + p.name + ' (' + p.team + ') | ' + p.pos.join('/') + ' | ' + f(p.fpg) + ' | ' + f(p.gp, 0) + ' | ' + hist(p) + ' | ' + f(p.total, 0) + ' | ' + f(p.vorp, 0) + ' | ' + f(p.adp) + ' | ' + (p.diff == null ? '–' : (p.diff > 0 ? '+' : '') + p.diff) + ' | ' + inj(p) + ' |\n';
});

fs.writeFileSync(path.join(ROOT, 'CHEATSHEET.md'), md);
console.log('Wrote CHEATSHEET.md (' + pool.length + ' players valued)');
