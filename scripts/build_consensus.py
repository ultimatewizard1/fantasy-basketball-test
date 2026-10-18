#!/usr/bin/env python3
"""
Build consensus per-game projections + injury-adjusted games for the draft tool.

Sources (raw stats only; fantasy points are computed in the app with the
league's own scoring):
  * Sleeper season projections (Rotowire), per game, plus Sleeper ADP (adp_std)
  * ESPN season projections (per game + projected games)
  * FantasyPros consensus projections (season totals + games)
  * Last season's actual stats (Sleeper), at half weight
  * Career games played (Sleeper, up to 9 seasons) for durability, ignoring
    one-off outlier seasons
  * ESPN injury report (status, estimated return date) + Sleeper injury fields

Writes data/consensus.js (loaded by index.html) and data/consensus.csv.

Usage: python3 scripts/build_consensus.py [--season 2026]
Standard library only.
"""
import argparse
import csv
import datetime as dt
import html
import json
import os
import re
import sys
import unicodedata
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (draft-tool data builder)'}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAT_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'to', 'tpm', 'dd', 'td', 'tf', 'ff', 'min']
SEASON_GAMES = 82
# Weight of each source in the consensus stat line.
WEIGHTS = {'sleeper': 1.0, 'espn': 1.0, 'fantasypros': 1.0, 'last': 0.5}
# Career games history: seasons back from last season, recency decay per season,
# and games scheduled in shortened seasons (2019-20 bubble, 2020-21).
CAREER_SEASONS = 9
RECENCY_DECAY = 0.85
SEASON_LENGTH = {2019: 72, 2020: 72}
# A season under this share of the player's median rate is a one-off outlier
# (e.g. a single major injury) and is dropped, at most a quarter of seasons.
OUTLIER_SHARE = 0.55
# Prior pulling durability toward a typical regular (~66 games) for small samples.
GP_PRIOR_WEIGHT = 1.0
GP_PRIOR_RATE = 0.80


def get(url, data=None, headers=None, timeout=90):
    h = dict(UA)
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


def get_json(url, headers=None):
    return json.loads(get(url, headers=headers))


def norm_name(n):
    n = unicodedata.normalize('NFD', n or '')
    n = ''.join(c for c in n if unicodedata.category(c) != 'Mn').lower()
    n = re.sub(r"[.'’`]", '', n)
    n = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', n)
    return re.sub(r'[^a-z]+', ' ', n).strip()


def num(v):
    try:
        return float(str(v).replace(',', ''))
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- Sleeper

SLEEPER_POS = '&'.join('position[]=' + p for p in ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C'])


def sleeper_rows(kind, season):
    url = 'https://api.sleeper.com/%s/nba/%s?season_type=regular&%s' % (kind, season, SLEEPER_POS)
    return get_json(url)


def load_sleeper(season):
    proj_rows = sleeper_rows('projections', season)
    players, proj, adp = {}, {}, {}
    for r in proj_rows:
        pid = str(r['player_id'])
        p = r.get('player') or {}
        players[pid] = {
            'name': ('%s %s' % (p.get('first_name', ''), p.get('last_name', ''))).strip(),
            'team': r.get('team') or p.get('team'),
            'pos': p.get('fantasy_positions') or [p.get('position')],
            'injury_status': p.get('injury_status'),
            'injury_body_part': p.get('injury_body_part'),
            'injury_notes': p.get('injury_notes'),
            'years_exp': p.get('years_exp'),
        }
        s = r.get('stats') or {}
        a = num(s.get('adp_std'))
        if a and a < 999:
            adp[pid] = a
        if num(s.get('pts')):
            gp = num(s.get('gp')) or 1
            # Sleeper's season projections are per game with gp = 1.
            proj[pid] = {k: num(s[k]) / (gp if gp > 1 else 1) for k in STAT_KEYS if k in s and num(s[k]) is not None}
    history = {}
    for i in range(CAREER_SEASONS):
        yr = int(season) - 1 - i
        rows = sleeper_rows('stats', yr)
        history[yr] = {str(r['player_id']): (r.get('stats') or {}) for r in rows}
        for r in rows:
            pid = str(r['player_id'])
            if pid not in players and r.get('player'):
                p = r['player']
                players[pid] = {
                    'name': ('%s %s' % (p.get('first_name', ''), p.get('last_name', ''))).strip(),
                    'team': r.get('team') or p.get('team'), 'pos': p.get('fantasy_positions') or [p.get('position')],
                    'injury_status': p.get('injury_status'), 'injury_body_part': p.get('injury_body_part'),
                    'injury_notes': p.get('injury_notes'), 'years_exp': p.get('years_exp'),
                }
    return players, proj, adp, history


# ---------------------------------------------------------------- ESPN

ESPN_STATS = {'0': 'pts', '1': 'blk', '2': 'stl', '3': 'ast', '6': 'reb', '11': 'to', '17': 'tpm', '37': 'dd', '38': 'td', '40': 'min'}


def load_espn(espn_season):
    url = ('https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/%d/segments/0/leaguedefaults/1?view=kona_player_info' % espn_season)
    filt = {'players': {'limit': 1000, 'sortPercOwned': {'sortPriority': 1, 'sortAsc': False}}}
    data = get_json(url, headers={'X-Fantasy-Filter': json.dumps(filt)})
    out = {}
    for row in data.get('players', []):
        p = row.get('player') or {}
        for s in p.get('stats') or []:
            if s.get('seasonId') == espn_season and s.get('statSourceId') == 1 and s.get('statSplitTypeId') == 0:
                avg = s.get('averageStats') or {}
                if not avg.get('0'):
                    continue
                line = {ESPN_STATS[k]: v for k, v in avg.items() if k in ESPN_STATS}
                out[norm_name(p.get('fullName'))] = {
                    'espn_id': p.get('id'),
                    'name': p.get('fullName'),
                    'line': line,
                    'gp': avg.get('42'),
                    'adp': (p.get('ownership') or {}).get('averageDraftPosition'),
                }
    return out


def load_espn_injuries():
    data = get_json('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries')
    out = {}
    for team in data.get('injuries', []):
        for inj in team.get('injuries', []):
            det = inj.get('details') or {}
            out[norm_name(inj['athlete']['displayName'])] = {
                'status': inj.get('status'),
                'fantasy': (det.get('fantasyStatus') or {}).get('abbreviation'),
                'type': det.get('type'),
                'return_date': det.get('returnDate'),
                'comment': inj.get('shortComment'),
                'date': inj.get('date'),
            }
    return out


# League scoring, for scoring individual games from ESPN game logs.
GAME_SCORING = {'pts': 0.5, 'reb': 1, 'ast': 1, 'stl': 2, 'blk': 2, 'to': -1, 'tpm': 0.5}
MIN_LOG_GAMES = 15


def game_fp(g):
    fp = sum(GAME_SCORING[k] * g.get(k, 0) for k in GAME_SCORING)
    tens = sum(1 for k in ('pts', 'reb', 'ast', 'stl', 'blk') if g.get(k, 0) >= 10)
    fp += 1 if tens >= 2 else 0
    fp += 2 if tens >= 3 else 0
    fp += 2 if g.get('pts', 0) >= 40 else 0
    fp += 2 if g.get('pts', 0) >= 50 else 0
    return fp


def espn_game_fps(espn_id, espn_season):
    """Fantasy points for each regular-season game in an ESPN game log."""
    url = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/%s/gamelog?season=%d' % (espn_id, espn_season)
    d = get_json(url)
    names = d.get('names') or []
    idx = {n: i for i, n in enumerate(names)}
    fps = []
    for st in d.get('seasonTypes', []):
        if 'Regular Season' not in (st.get('displayName') or ''):
            continue
        for cat in st.get('categories', []):
            for ev in cat.get('events', []) or []:
                s = ev.get('stats') or []
                try:
                    if float(s[idx['minutes']] or 0) <= 0:
                        continue
                    g = {
                        'pts': float(s[idx['points']]), 'reb': float(s[idx['totalRebounds']]),
                        'ast': float(s[idx['assists']]), 'stl': float(s[idx['steals']]),
                        'blk': float(s[idx['blocks']]), 'to': float(s[idx['turnovers']]),
                        'tpm': float(s[idx['threePointFieldGoalsMade-threePointFieldGoalsAttempted']].split('-')[0]),
                    }
                except (KeyError, ValueError, IndexError):
                    continue
                fps.append(game_fp(g))
    return fps


def game_volatility(espn_id, espn_last_season):
    """
    Coefficient of variation (sd / mean) of single-game fantasy points, from
    last season's game log, adding the season before when the sample is small.
    """
    fps = espn_game_fps(espn_id, espn_last_season)
    if len(fps) < MIN_LOG_GAMES:
        fps += espn_game_fps(espn_id, espn_last_season - 1)
    if len(fps) < MIN_LOG_GAMES:
        return None, len(fps)
    mean = sum(fps) / len(fps)
    if mean <= 0:
        return None, len(fps)
    sd = (sum((x - mean) ** 2 for x in fps) / (len(fps) - 1)) ** 0.5
    return sd / mean, len(fps)


# ---------------------------------------------------------------- FantasyPros

def strip_tags(s):
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s))).strip()


def load_fantasypros():
    t = get('https://www.fantasypros.com/nba/projections/overall.php')
    start = t.find('id="data"')
    table = t[start:t.find('</table>', start)]
    head = [strip_tags(h).lower() for h in re.findall(r'<th.*?</th>', table, re.S)]
    keymap = {'pts': 'pts', 'reb': 'reb', 'ast': 'ast', 'blk': 'blk', 'stl': 'stl', '3pm': 'tpm', 'gp': 'gp', 'min': 'min', 'to': 'to'}
    out = {}
    for row in re.findall(r'<tr class="mpb-player.*?</tr>', table, re.S):
        m = re.search(r'fp-player-name="([^"]+)"', row)
        if not m:
            continue
        cells = [strip_tags(c) for c in re.findall(r'<td.*?</td>', row, re.S)]
        rec = dict(zip(head, cells))
        gp = num(rec.get('gp'))
        if not gp:
            continue
        line = {}
        for col, key in keymap.items():
            v = num(rec.get(col))
            if v is not None and key != 'gp':
                line[key] = v / gp  # FantasyPros lists season totals
        out[norm_name(html.unescape(m.group(1)))] = {'name': html.unescape(m.group(1)), 'line': line, 'gp': gp}
    return out


# ---------------------------------------------------------------- model

def games_missed_at_start(inj, season_start, season_end):
    """Estimated regular-season games lost to a current injury."""
    if not inj:
        return 0, ''
    status = (inj.get('status') or '').lower()
    fantasy = (inj.get('fantasy') or '').upper()
    if fantasy == 'OFS':
        return SEASON_GAMES, 'out for season'
    rd = inj.get('return_date')
    if rd:
        try:
            ret = dt.date.fromisoformat(rd[:10])
            if ret >= season_end:
                return SEASON_GAMES, 'out for season (return %s)' % rd[:10]
            days = (ret - season_start).days
            if days > 0:
                frac = days / (season_end - season_start).days
                return round(SEASON_GAMES * frac), 'est. return %s' % rd[:10]
        except ValueError:
            pass
    if 'out' in status:
        return 6, 'out, no timetable'
    if 'day' in status:
        return 1, 'day-to-day'
    if 'susp' in status:
        return 5, 'suspended'
    return 0, ''


def career_games(pid, history, years_exp, season):
    """Each NBA season's games played (most recent first) as [season, gp, share of schedule]."""
    out = []
    for i in range(CAREER_SEASONS):
        yr = int(season) - 1 - i
        if years_exp is None or years_exp <= i:
            break  # before his rookie season
        s = history.get(yr, {}).get(pid) or {}
        gp = num(s.get('gp')) or 0.0  # in the league but no games: missed the whole season
        length = SEASON_LENGTH.get(yr, SEASON_GAMES)
        out.append([yr, int(gp), min(gp / length, 1.0)])
    return out


def durability(career):
    """
    Recency-weighted share of games played over the career, ignoring one-off
    outlier seasons, shrunk toward a prior. Returns (rate, excluded seasons).
    """
    if not career:
        return GP_PRIOR_RATE, []
    rates = sorted(c[2] for c in career)
    median = rates[len(rates) // 2] if len(rates) % 2 else (rates[len(rates) // 2 - 1] + rates[len(rates) // 2]) / 2
    excluded = []
    if len(career) >= 3:
        max_drop = max(1, len(career) // 4)
        for c in sorted(career, key=lambda c: c[2]):
            if len(excluded) < max_drop and c[2] < OUTLIER_SHARE * median:
                excluded.append(c[0])
    num_, den = 0.0, 0.0
    for i, (yr, gp, rate) in enumerate(career):
        if yr in excluded:
            continue
        w = RECENCY_DECAY ** i
        num_ += w * rate
        den += w
    rate = (num_ + GP_PRIOR_WEIGHT * GP_PRIOR_RATE) / (den + GP_PRIOR_WEIGHT)
    return min(rate, 0.98), excluded


def consensus_line(lines):
    out = {}
    for key in STAT_KEYS:
        tot, w = 0.0, 0.0
        for src, line in lines.items():
            v = line.get(key)
            if v is not None:
                tot += WEIGHTS[src] * v
                w += WEIGHTS[src]
        if w:
            out[key] = round(tot / w, 3)
    return out


def r3(d):
    return {k: round(v, 3) for k, v in d.items() if v is not None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--season', default='2026', help='Sleeper season label (2026 = 2026-27)')
    ap.add_argument('--start', default='2026-10-20')
    ap.add_argument('--end', default='2027-04-11')
    args = ap.parse_args()
    season = args.season
    start, end = dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end)

    log = lambda *a: print(*a, file=sys.stderr)
    log('Sleeper projections, ADP and %d seasons of stats...' % CAREER_SEASONS)
    players, sl_proj, adp, history = load_sleeper(season)
    log('  %d players, %d projections, %d with ADP' % (len(players), len(sl_proj), len(adp)))
    sources_ok = ['Sleeper/Rotowire']
    try:
        log('ESPN projections...')
        espn = load_espn(int(season) + 1)
        sources_ok.append('ESPN')
        log('  %d' % len(espn))
    except Exception as e:  # keep going with the other sources
        log('  ESPN failed: %s' % e)
        espn = {}
    try:
        log('FantasyPros projections...')
        fpros = load_fantasypros()
        sources_ok.append('FantasyPros consensus')
        log('  %d' % len(fpros))
    except Exception as e:
        log('  FantasyPros failed: %s' % e)
        fpros = {}
    try:
        log('ESPN injury report...')
        injuries = load_espn_injuries()
        log('  %d' % len(injuries))
    except Exception as e:
        log('  injuries failed: %s' % e)
        injuries = {}

    by_name = {}
    for pid, p in players.items():
        n = norm_name(p['name'])
        # Prefer the player with a projection/ADP when two share a name.
        if n not in by_name or pid in sl_proj or pid in adp:
            by_name[n] = pid

    last_season = int(season) - 1
    rows, unmatched = [], {'espn': [], 'fantasypros': []}
    matched = {'espn': set(), 'fantasypros': set()}
    for src, data in (('espn', espn), ('fantasypros', fpros)):
        for n, rec in data.items():
            if n in by_name:
                matched[src].add(by_name[n])
            else:
                unmatched[src].append(rec['name'])

    espn_by_id = {by_name[n]: rec for n, rec in espn.items() if n in by_name}
    fp_by_id = {by_name[n]: rec for n, rec in fpros.items() if n in by_name}

    candidates = set(sl_proj) | set(espn_by_id) | set(fp_by_id)
    for pid in candidates:
        p = players.get(pid)
        if not p:
            continue
        lines = {}
        if pid in sl_proj:
            lines['sleeper'] = sl_proj[pid]
        if pid in espn_by_id:
            lines['espn'] = espn_by_id[pid]['line']
        if pid in fp_by_id:
            lines['fantasypros'] = fp_by_id[pid]['line']
        last = history.get(last_season, {}).get(pid) or {}
        lgp = num(last.get('gp'))
        if lgp and lgp >= 10:
            lines['last'] = {k: num(last[k]) / lgp for k in STAT_KEYS if k in last and num(last[k]) is not None}
        if not any(k in lines for k in ('sleeper', 'espn', 'fantasypros')):
            continue
        line = consensus_line(lines)
        if line.get('pts', 0) < 3 and pid not in adp:
            continue

        career = career_games(pid, history, p.get('years_exp'), season)
        rate, excluded = durability(career)
        gps = [c[1] for c in career[:3]] + [None] * (3 - min(3, len(career)))
        inj_src = injuries.get(norm_name(p['name']))
        if not inj_src and p.get('injury_status'):
            inj_src = {'status': p['injury_status'], 'comment': ' '.join(x for x in [p.get('injury_body_part'), p.get('injury_notes')] if x)}
        missed, why = games_missed_at_start(inj_src, start, end)
        available = max(0, SEASON_GAMES - missed)
        hist_gp = rate * available
        src_gps = [g for g in [(espn_by_id.get(pid) or {}).get('gp'), (fp_by_id.get(pid) or {}).get('gp')] if g]
        proj_gp = 0.5 * hist_gp + 0.5 * (sum(src_gps) / len(src_gps)) if src_gps else hist_gp
        proj_gp = round(min(proj_gp, available), 1)
        played = [g for g in gps if g is not None]

        rows.append({
            'id': pid,
            'name': p['name'],
            'team': p.get('team') or 'FA',
            'pos': [x for x in (p.get('pos') or []) if x],
            'adp': adp.get(pid),
            'espnAdp': round((espn_by_id.get(pid) or {}).get('adp') or 0, 1) or None,
            'line': line,
            'sources': {k: r3(v) for k, v in lines.items()},
            'gp': proj_gp,
            'gpSources': {'history': round(hist_gp, 1), 'espn': (espn_by_id.get(pid) or {}).get('gp'), 'fantasypros': (fp_by_id.get(pid) or {}).get('gp')},
            'gpHist': gps,
            'gpAvg': round(sum(played) / len(played), 1) if played else None,
            'career': [[c[0], c[1]] for c in career],
            'excluded': excluded,
            'durability': round(rate, 3),
            'injury': {
                'status': (inj_src or {}).get('status') or '',
                'note': (inj_src or {}).get('comment') or '',
                'returnDate': ((inj_src or {}).get('return_date') or '')[:10],
                'gamesMissed': missed,
                'summary': why,
            } if inj_src else None,
        })

    # Game-to-game volatility for Lock-In valuation, for everyone draftable.
    from concurrent.futures import ThreadPoolExecutor
    espn_last = int(season)  # ESPN labels 2025-26 as 2026
    todo = [r for r in rows if r['id'] in espn_by_id and ((r['adp'] or 999) <= 260 or r['line'].get('pts', 0) >= 12)]
    log('ESPN game logs for %d players (volatility)...' % len(todo))

    def vol(r):
        try:
            return r, game_volatility(espn_by_id[r['id']]['espn_id'], espn_last)
        except Exception as e:  # one failed log shouldn't sink the build
            return r, (None, 0)
    with ThreadPoolExecutor(max_workers=12) as ex:
        for r, (cv, n) in ex.map(vol, todo):
            r['cv'] = round(cv, 3) if cv else None
            r['logGames'] = n
    have = [r['cv'] for r in rows if r.get('cv')]
    log('  volatility for %d players, median CV %.2f' % (len(have), sorted(have)[len(have) // 2] if have else 0))

    rows.sort(key=lambda r: (r['adp'] or 999))
    out = {
        'generated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
        'season': season,
        'seasonStart': args.start,
        'seasonEnd': args.end,
        'sources': sources_ok,
        'weights': WEIGHTS,
        'gpHistorySeasons': [int(season) - 1 - i for i in range(3)],
        'players': rows,
    }
    os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
    with open(os.path.join(ROOT, 'data', 'consensus.js'), 'w') as f:
        f.write('/* Generated by scripts/build_consensus.py on %s. Do not edit by hand. */\n' % out['generated'])
        f.write('window.CONSENSUS = ')
        json.dump(out, f, separators=(',', ':'))
        f.write(';\n')
    with open(os.path.join(ROOT, 'data', 'consensus.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['sleeper_id', 'name', 'team', 'pos', 'sleeper_adp', 'proj_gp', 'gp_avg_3y', 'gp_hist', 'injury', 'games_missed'] + STAT_KEYS + ['n_sources'])
        for r in rows:
            w.writerow([r['id'], r['name'], r['team'], '/'.join(r['pos']), r['adp'] or '', r['gp'], r['gpAvg'] or '',
                        ' '.join('-' if g is None else str(g) for g in r['gpHist']),
                        (r['injury'] or {}).get('summary', '') or (r['injury'] or {}).get('status', ''),
                        (r['injury'] or {}).get('gamesMissed', 0)] + [r['line'].get(k, '') for k in STAT_KEYS] + [len([s for s in r['sources'] if s != 'last'])])
    log('Wrote %d players to data/consensus.js and data/consensus.csv' % len(rows))
    top_adp = {pid for pid, a in adp.items() if a <= 150}
    for src in ('espn', 'fantasypros'):
        missing = [players[pid]['name'] for pid in top_adp if pid in players and pid not in matched[src]]
        log('Top-150 ADP players without a %s match: %s' % (src, ', '.join(sorted(missing)) or 'none'))


if __name__ == '__main__':
    main()
