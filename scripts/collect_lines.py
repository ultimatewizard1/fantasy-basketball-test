#!/usr/bin/env python3
"""Save Sleeper's NBA prop lines and per-game projections before they disappear.

Sleeper removes each line when its game tips off, and its projection archive
keeps only the last version, so testing "lines vs projections vs results" needs
our own snapshots. Run on a schedule (.github/workflows/collect-lines.yml):

    python3 scripts/collect_lines.py OUT_DIR

Writes (Python standard library only):
  OUT_DIR/lines/<game date>.json        one entry per player/stat market: the first
                                        line seen and the last line before tip-off
  OUT_DIR/matchups/<date>.json           the score each starter currently counts in our league's
                                        matchups, per run (shows locks, and how long Sleeper
                                        takes to apply a finished game)
  OUT_DIR/projections/<snapshot date>.json
                                        Sleeper's projection for every game not yet
                                        started this week, as of that day (for
                                        "how much worse are projections made days ahead")
Dates are US Eastern. Actual results come later from Sleeper's stats archive.
"""
import json, os, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

LINES = 'https://api.sleeper.app/lines/available?dynamic=true&include_preseason=true'
STATE = 'https://api.sleeper.app/v1/state/nba'
PROJ = 'https://api.sleeper.com/projections/nba/{season}/{week}?season_type=regular&' + '&'.join(
    'position[]=' + p for p in ('PG', 'SG', 'G', 'SF', 'PF', 'F', 'C'))
LEAGUE = os.environ.get('SLEEPER_LEAGUE_ID', '1414370391324950528')
MATCHUPS = 'https://api.sleeper.app/v1/league/{league}/matchups/{week}'
KEEP = ('pts', 'reb', 'ast', 'stl', 'blk', 'to', 'tpm', 'dd', 'td', 'sp')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'fantasy-lines-collector', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def eastern(now):
    # US Eastern: UTC-4 from the 2nd Sunday of March to the 1st Sunday of November, else UTC-5.
    y = now.year
    mar = datetime(y, 3, 8, 7, tzinfo=timezone.utc); mar += timedelta(days=(6 - mar.weekday()) % 7)
    nov = datetime(y, 11, 1, 6, tzinfo=timezone.utc); nov += timedelta(days=(6 - nov.weekday()) % 7)
    return now - timedelta(hours=4 if mar <= now < nov else 5)


def load(path):
    try:
        return json.load(open(path))
    except (OSError, ValueError):
        return {}


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, sort_keys=True, separators=(',', ':'))
        f.write('\n')


def main(out):
    now = datetime.now(timezone.utc)
    stamp = now.strftime('%Y-%m-%dT%H:%MZ')
    et = eastern(now)
    today = et.strftime('%Y-%m-%d')
    state = get(STATE)
    season, week = state.get('season'), int(state.get('week') or 0)
    if not week:
        print('NBA season not in progress:', state.get('season_type'))
        return

    # Game ids -> dates, from this week's and next week's projections.
    rows, game_date = [], {}
    for w in (week, week + 1):
        try:
            batch = get(PROJ.format(season=season, week=w))
        except Exception as e:  # next week may not be posted yet
            print('projections week', w, 'unavailable:', e)
            continue
        for r in batch:
            if r.get('game_id') and r.get('date'):
                game_date[r['game_id']] = r['date']
        if w == week:
            rows = batch

    # Projections for games that haven't started. Day-of games only before 6 pm ET, so a
    # version touched after tip-off never overwrites the pre-game one.
    path = os.path.join(out, 'projections', today + '.json')
    snap = load(path)
    for r in rows:
        s, d = r.get('stats') or {}, r.get('date')
        if not s.get('gp') or not d or d < today or (d == today and et.hour >= 18):
            continue
        snap[f"{r['game_id']}|{r['player_id']}"] = {'d': d, 'at': stamp, 's': {k: round(s[k], 2) for k in KEEP if s.get(k) is not None}}
    save(path, snap)

    # Counted scores in our league's matchups, keyed by run time.
    try:
        mpath = os.path.join(out, 'matchups', today + '.json')
        msnap = load(mpath)
        msnap[stamp] = {str(m['roster_id']): {pid: m.get('players_points', {}).get(pid) for pid in m.get('starters') or []}
                        for m in get(MATCHUPS.format(league=LEAGUE, week=week))}
        # Locked games ({roster: {player: sleeper game id}}), from the GraphQL API Sleeper's app uses.
        q = '{ matchup_legs_raw(league_id: "%s", round: %d) { roster_id starters_games } }' % (LEAGUE, week)
        legs = get('https://sleeper.com/graphql?' + urllib.parse.urlencode({'query': q}))['data']['matchup_legs_raw']
        msnap[stamp]['locks'] = {str(m['roster_id']): m.get('starters_games') or {} for m in legs}
        save(mpath, msnap)
    except Exception as e:
        print('matchups unavailable:', e)

    # Lines: keep the first and the latest pre-game version of every market.
    files, n = {}, 0
    for m in get(LINES):
        if m.get('sport') != 'nba' or m.get('subject_type') != 'player' or m.get('outcome_type') != 'over_under':
            continue
        if m.get('game_status') not in (None, 'pre_game'):
            continue
        side = {o.get('outcome'): o for o in m.get('options') or [] if o.get('status') == 'active'}
        if 'over' not in side or 'under' not in side:
            continue
        d = game_date.get(m.get('game_id'), today)
        if d not in files:
            files[d] = load(os.path.join(out, 'lines', d + '.json'))
        key = f"{m['game_id']}|{m['subject_id']}|{m['wager_type']}"
        quote = {'line': float(side['over']['outcome_value']), 'over': float(side['over']['payout_multiplier']),
                 'under': float(side['under']['payout_multiplier']), 'at': stamp}
        entry = files[d].setdefault(key, {'game': m['game_id'], 'player': m['subject_id'], 'stat': m['wager_type'],
                                         'team': side['over'].get('subject_team'), 'first': quote})
        entry['last'] = quote
        n += 1
    for d, data in files.items():
        save(os.path.join(out, 'lines', d + '.json'), data)
    print(f'{stamp}: {n} NBA line markets, {len(snap)} projections saved for {today}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'snapshots')
