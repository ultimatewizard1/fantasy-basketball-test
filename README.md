# Hoops Draft Assistant

A draft tool for Sleeper fantasy basketball points leagues. It takes projected **stats** from
several sites (never their fantasy-point totals), scores them with **your league's own scoring**,
projects games played from durability history and current injuries, and compares the result
with Sleeper ADP. It values players over replacement for **your** roster (e.g. 3 UTIL slots) and
syncs live with your Sleeper draft.

- [STRATEGY.md](STRATEGY.md): draft plan for a 10-team league, pick 6, 3 UTIL, with player
  targets for each early pick.
- [CHEATSHEET.md](CHEATSHEET.md): printable rankings, pick-by-pick targets, injury traps and
  values.

## Run it

It's a static page with no build step and no dependencies. Download the repo and double-click
`index.html`, or serve it:

```sh
npm start            # python3 -m http.server 8000 → http://localhost:8000
```

Go to **Settings & data** → **Load from Sleeper** (the league and draft IDs are pre-filled), then
turn on **Live sync** when the draft starts.

## Where the numbers come from

`scripts/build_consensus.py` (Python standard library only) writes `data/consensus.js` and
`data/consensus.csv`:

| Input | Used for |
|---|---|
| Sleeper season projections (Rotowire, per game) | Stat line, weight 1 |
| ESPN season projections (per game + projected games) | Stat line, weight 1; games |
| FantasyPros consensus projections (season totals + games) | Stat line, weight 1; games |
| Sleeper actual stats, last season | Stat line, weight 0.5 (also technicals, flagrants) |
| Sleeper games played, up to 9 seasons | Career durability |
| ESPN injury report (status, estimated return date) + Sleeper injury fields | Games lost to current injuries |
| ESPN game logs, last season | Game-to-game swing (Lock-In) |
| ESPN preseason game logs | Preseason watch list (▲/▼ badges; hints only, not in rankings) |
| Sleeper `adp_std` | ADP (ESPN ADP optional) |

**Projected games** = 50% × durability × games still available + 50% × the average of the ESPN and
FantasyPros games projections, capped at games still available. In more detail:

- **Durability** is the career share of scheduled games played (2019-20 and 2020-21 count as
  72-game seasons). One-off outlier seasons (under 55% of the player's own median, at most a quarter of his
  seasons) count at 35% of their normal weight. A single major injury year barely moves the
  rate, but it still hints at re-injury risk, and chronic absences count fully (Embiid,
  Morant). Each older season counts 15% less,
  and the result is pulled toward 80% for short careers.
- **Games still available** = 82 − estimated games missed to a current injury, from the ESPN
  return date or "out for season" flag.
- **Override:** you can set any player's games estimate yourself in their detail view.

**Lock-In (default ranking).** In Sleeper Lock-In leagues one game per player per week counts,
and you choose which by locking it after it's played.
- **Weekly value:** the expected score of the game you end up locking. It comes from an
  optimal-stopping calculation over 2–4 games, using the player's projected average and his
  game-to-game swing. Swing is the standard deviation of last season's single-game fantasy
  points from ESPN game logs, scored with your league's settings.
- **Weeks played:** weeks with at least one game. Known injuries count as whole lost weeks, and
  70% of other expected absences are assumed to wipe out a week.
- **Season value** = weekly value × weeks played.

Switch to *Season fantasy points* under Settings for standard points leagues.

**Fantasy points** are computed in the app from the stat line with the league's
`scoring_settings` (pts 0.5, reb 1, ast 1, stl 2, blk 2, TO −1, 3PM 0.5, DD 1, TD 2, tech/flagrant −2,
40-pt and 50-pt game bonuses +2). 40/50-point games are estimated from scoring average. Sleeper's
season `bonus_*` fields are flags, not counts, so they're ignored.

To refresh before a draft:

```sh
python3 scripts/build_consensus.py && node scripts/cheatsheet.js
```

There's also a **Live Sleeper** source (Settings → Projection source), and you can import a stats
CSV from any site.

## Features

- **Board.** For every player:
  - fantasy points per game, projected games, 3-season average games, season points
  - value over replacement (VORP)
  - **Gain**: how much he improves *your* best lineup
  - **Now**: Gain adjusted for whether he'd last to your next pick
  - Sleeper ADP, value vs ADP, chance he's still there at your next pick
  - injury badges (OUT / DTD with games missed; hover for the report)
- **Recommendations**: the top three picks for your next selection, with reasons.
- **Live sync** with the Sleeper draft (every 4s). Manual *Taken* / *Mine* buttons. **Mock draft**
  against ADP.
- **Draft plan tab**: realistic targets at each of your upcoming picks, positional scarcity, and
  players your format likes more or less than ADP.
- **Player detail**: projections by source, games-played history, durability, the injury note, a
  games override, and a per-stat points breakdown.
- **Export**: rankings as CSV.

## How values are computed

1. **Replacement level**: all teams' starting slots (100 with 3 UTIL) are filled league-wide with
   an optimal assignment. The best leftover player at each position sets the bar. VORP = season
   points − replacement.
2. **Gain**: your roster is scored as an optimal starting lineup plus bench at *bench weight*
   (0.3). Gain is the change from adding a player.
3. **Now** is a two-pick lookahead ("value over next available"). It is what the player adds now,
   plus the best Gain you can expect at your next pick **with him on your roster**, minus that
   same expectation if you don't take him. A player likely to make it back to you scores lower.
   So does one whose position you'd fill twice. Availability assumes ADP ± max(2.5, 22% of ADP).

## Tests

```sh
npm test
```
