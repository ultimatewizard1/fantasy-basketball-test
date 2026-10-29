#!/usr/bin/env python3
"""Backtest the in-season model against last season (Python standard library only).

Downloads Sleeper's per-game projections and box scores for 2025-26 (cached in
.cache/backtest), then fits on Oct - mid Jan and tests on mid Jan - Apr:
  1. per-stat bias of Sleeper's projections (actual / projected)
  2. blend weight between the projection and the season-to-date average
  3. spread of a single game around its prediction (sd = a + b * mean)
  4. a Lock-In replay of every player-week: average locked score per policy,
     and predicted vs realized locked score by player level.

    python3 scripts/backtest.py
"""
import json, math, os, sys, collections, statistics as stt, urllib.request

SEASON = '2025'
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.cache', 'backtest')
POS = '&'.join('position[]=' + p for p in ('PG', 'SG', 'G', 'SF', 'PF', 'F', 'C'))

def fetch(kind, week):
    path = os.path.join(CACHE, f'{kind}_{week}.json')
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        url = f'https://api.sleeper.com/{kind}/nba/{SEASON}/{week}?season_type=regular&{POS}'
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'backtest'}), timeout=120) as r:
            open(path, 'wb').write(r.read())
    return json.load(open(path))

SPLIT = '2026-01-15'
STATS = ('pts', 'reb', 'ast', 'stl', 'blk', 'to', 'tpm')

def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def npdf(x): return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)

def fp_actual(s):
    g = lambda k: s.get(k, 0) or 0
    cats = sum(1 for k in ('pts', 'reb', 'ast', 'stl', 'blk') if g(k) >= 10)
    return (.5 * g('pts') + g('reb') + g('ast') + 2 * g('stl') + 2 * g('blk') - g('to') + .5 * g('tpm')
            + (cats >= 2) + 2 * (cats >= 3) + 2 * (g('pts') >= 40) + 2 * (g('pts') >= 50))

def fp_proj(s, mult=None):
    g = lambda k: (s.get(k, 0) or 0) * ((mult or {}).get(k, 1))
    ppg = g('pts'); sd = .25 * ppg + 1
    v = .5 * ppg + g('reb') + g('ast') + 2 * g('stl') + 2 * g('blk') - g('to') + .5 * g('tpm') + (s.get('dd', 0) or 0) + 2 * (s.get('td', 0) or 0)
    if ppg > 0: v += 2 * (1 - ncdf((39.5 - ppg) / sd)) + 2 * (1 - ncdf((49.5 - ppg) / sd))
    return v

proj, act, week_of = {}, {}, {}
for w in range(1, 26):
    for r in fetch('projections', w):
        s = r.get('stats') or {}
        if s.get('gp') and r.get('game_id'): proj[(str(r['player_id']), r['game_id'])] = (r['date'], s)
    for r in fetch('stats', w):
        s = r.get('stats') or {}
        if r.get('game_id') and s.get('sp'):
            k = (str(r['player_id']), r['game_id']); act[k] = (r['date'], s); week_of[k] = w

hist = collections.defaultdict(list)
for k, (d, s) in act.items(): hist[k[0]].append((d, fp_actual(s)))
for v in hist.values(): v.sort()

games = []
for k, (d, ps) in proj.items():
    if k not in act: continue
    prior = [x[1] for x in hist[k[0]] if x[0] < d]
    games.append(dict(k=k, date=d, w=week_of[k], ps=ps, a=act[k][1], afp=fp_actual(act[k][1]), std=stt.mean(prior) if prior else None, n=len(prior)))
train = [g for g in games if g['date'] < SPLIT]; test = [g for g in games if g['date'] >= SPLIT]
print('train', len(train), 'test', len(test))

# 1. Per-stat multipliers from the training half.
mult = {s: sum(g['a'].get(s, 0) or 0 for g in train) / sum(g['ps'].get(s, 0) or 0 for g in train) for s in STATS}
print('per-stat multipliers (actual/projected, train):', {s: round(m, 3) for s, m in mult.items()})
for g in games:
    g['raw'] = fp_proj(g['ps']); g['adj'] = fp_proj(g['ps'], mult)

def rmse(sel, f):
    e = [f(g) - g['afp'] for g in sel]
    return stt.mean(e), math.sqrt(stt.mean(x * x for x in e))

# 2. Blend weight with season-to-date average (players with >= 8 earlier games), fit on train.
def best_w(sel, key):
    sel = [g for g in sel if g['n'] >= 8]
    return min((rmse(sel, lambda g: w / 20 * g[key] + (1 - w / 20) * g['std'])[1], w / 20) for w in range(21))[1]
w_raw, w_adj = best_w(train, 'raw'), best_w(train, 'adj')
print(f'best weight on Sleeper (train): raw {w_raw:.2f}, adjusted {w_adj:.2f}')
t8 = [g for g in test if g['n'] >= 8]
for name, f in [('Sleeper raw', lambda g: g['raw']), ('Sleeper per-stat adjusted', lambda g: g['adj']), ('season-to-date', lambda g: g['std']),
                ('current tool: 0.8 raw + 0.2 season', lambda g: .8 * g['raw'] + .2 * g['std']),
                (f'{w_raw:.2f} raw + rest season', lambda g: w_raw * g['raw'] + (1 - w_raw) * g['std']),
                (f'{w_adj:.2f} adjusted + rest season', lambda g: w_adj * g['adj'] + (1 - w_adj) * g['std'])]:
    b, r = rmse(t8, f); print(f'  TEST {name:<36} bias {b:+5.2f}  RMSE {r:6.3f}')

# 3. Single-game spread around the prediction: fit sd = a + b * mu on train.
for g in games: g['mu'] = w_adj * g['adj'] + (1 - w_adj) * g['std'] if g['n'] >= 8 else g['adj']
def fit_sd(sel):
    bins = collections.defaultdict(list)
    for g in sel: bins[min(int(g['mu'] // 5), 8)].append(g['afp'] - g['mu'])
    pts = [(stt.mean(g['mu'] for g in sel if min(int(g['mu'] // 5), 8) == b), stt.pstdev(v), len(v)) for b, v in bins.items() if len(v) >= 50]
    W = sum(n for _, _, n in pts); mx = sum(m * n for m, _, n in pts) / W; my = sum(s * n for _, s, n in pts) / W
    b = sum(n * (m - mx) * (s - my) for m, s, n in pts) / sum(n * (m - mx) ** 2 for m, _, n in pts)
    return my - b * mx, b, sorted(pts)
a, b, pts = fit_sd(train)
print(f'single-game sd ~ {a:.2f} + {b:.3f} * mu (train)')
for m, s, n in fit_sd(test)[2]: print(f'   test mu {m:5.1f}: sd {s:5.2f}  fitted {a + b * m:5.2f}  old model {0.37 * m:5.2f}  n={n}')

# 4. Lock-In replay on the test half: each player-week, decide game by game.
def emax(mu, sd, c):
    z = (c - mu) / sd
    return c + sd * (npdf(z) - z * (1 - ncdf(z)))
def bar(mus, sds):
    # Expected value of waiting for the remaining games (optimal stopping, last game forced).
    v = None
    for mu, sd in zip(reversed(mus), reversed(sds)):
        v = mu if v is None else emax(mu, sd, v)
    return v
weeks = collections.defaultdict(list)
for g in test: weeks[(g['k'][0], g['w'])].append(g)
policies = {
    'no locks (last game counts)': None,
    'old: raw proj, sd 0.37*mu': (lambda g: g['raw'], lambda m: max(1, .37 * m)),
    'raw proj, fitted sd': (lambda g: g['raw'], lambda m: a + b * m),
    'new: adjusted blend, fitted sd': (lambda g: g['mu'], lambda m: a + b * m),
    'new mu, sd x0.8': (lambda g: g['mu'], lambda m: .8 * (a + b * m)),
    'new mu, sd x1.2': (lambda g: g['mu'], lambda m: 1.2 * (a + b * m)),
}
res = {}
for name, pol in policies.items():
    tot, n, pred = 0, 0, 0
    for gs in weeks.values():
        if len(gs) < 2: continue
        gs = sorted(gs, key=lambda g: g['date'])
        locked = gs[-1]['afp']
        if pol:
            fmu, fsd = pol
            for i, g in enumerate(gs[:-1]):
                rest = gs[i + 1:]
                if g['afp'] >= bar([fmu(x) for x in rest], [fsd(fmu(x)) for x in rest]):
                    locked = g['afp']; break
            pred += bar([fmu(x) for x in gs], [fsd(fmu(x)) for x in gs])
        tot += locked; n += 1
    res[name] = tot / n
    print(f'  {name:<34} avg locked {tot / n:6.3f}' + (f'   predicted {pred / n:6.2f}' if pol else '') + f'   (n={n} player-weeks)')

print('predicted vs realized locked score by player level:')
for name in ('old: raw proj, sd 0.37*mu', 'new: adjusted blend, fitted sd'):
    fmu, fsd = policies[name]
    buck = collections.defaultdict(lambda: [0, 0, 0, 0])
    for gs in weeks.values():
        if len(gs) < 2: continue
        gs = sorted(gs, key=lambda g: g['date'])
        locked = gs[-1]['afp']
        for i, g in enumerate(gs[:-1]):
            rest = gs[i + 1:]
            if g['afp'] >= bar([fmu(x) for x in rest], [fsd(fmu(x)) for x in rest]): locked = g['afp']; break
        m = stt.mean(fmu(x) for x in gs)
        b_ = buck[min(int(m // 8), 4)]
        b_[0] += 1; b_[1] += bar([fmu(x) for x in gs], [fsd(fmu(x)) for x in gs]); b_[2] += locked; b_[3] += stt.mean(x['afp'] for x in gs)
    print(name)
    for k in sorted(buck):
        n, p, l, avg = buck[k]
        print(f'   mu {k*8:2d}-{k*8+8:2d}: n={n:5d}  predicted {p/n:5.2f}  realized {l/n:5.2f}  (avg game {avg/n:5.2f}, realized bonus {(l-avg)/n:+.2f})')
