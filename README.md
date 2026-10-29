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

## Updating

Double-click **`update.bat`** (Windows) or **`update.command`** (Mac) in the folder, then reload
the page. It pulls the latest version from GitHub. Your settings (team, locks, overrides) are saved
in the browser, so updating doesn't touch them.

- **Needs Git:** [Git for Windows](https://git-scm.com/download/win), or on a Mac run
  `xcode-select --install` in Terminal.
- **Sign-in:** the repo is private, so the first update asks you to sign in to GitHub. On Windows a
  browser window opens. On a Mac, use a
  [personal access token](https://github.com/settings/tokens) as the password.
- **Folder from a ZIP:** the first run connects it to GitHub. After that each update only pulls
  the changes.
- **Mac blocks the script:** if macOS says it can't open the script, right-click it → **Open**, or
  run `sh update.command` in Terminal.

Prefer the command line? Clone once, then `git pull`:

```sh
git clone https://github.com/ultimatewizard1/fantasy-basketball-test.git
```

[GitHub Desktop](https://desktop.github.com) also works: clone the repo, then press **Fetch
origin → Pull**.

## In-season tools (`season.html`)

Open `season.html`, or click **In-season tools** in the draft tool. It loads your league, every
roster, this season's stats, live injuries and this week's NBA games from Sleeper and ESPN. Pick
your team in the top right; it defaults to your draft slot.

| Tab | What it does |
|---|---|
| **Matchup** | What it takes to win this week. It simulates the rest of the week thousands of times for both lineups: remaining games, injury odds, each manager locking or passing. You get your **win chance** and the **lock or pass** call for every game you can lock now, with win chance for each option. It tests whether you should play it safe (ahead) or chase upside (behind) and adjusts your bars for upcoming games. Mark locks and mid-week pickups for both teams, since Sleeper doesn't publish them, and choose how your opponent plays: locks smartly, locks anything above average, or never locks. |
| **This week** | The best lineup for the rest of the week. Each player's expected locked score uses his remaining games, his injury status (Out 0%, Doubtful 25%, Questionable 65%, Day-to-day 80% chance to play) and any finished game you can still lock. It flags who to start and who to sit compared with your current Sleeper lineup. |
| **Lock-In** | For every starter: this week's games with fantasy points from ESPN box scores, and **LOCK** or **PASS** on his latest game. The bar is the expected value of waiting for his remaining games, and drops if he might miss them. Includes a quick calculator for any score. |
| **Waivers** | Free agents ranked by **rest of season**, **this week** or **this week + next week**, with the best player to drop. Short-term modes use Sleeper's per-game weekly projections, only suggest dropping one of your 4 lowest rest-of-season players, and show the season cost of that drop. Each week gets its own best lineup. A negative gain means he wouldn't crack your lineup, and shows how far short he falls. |
| **Trades** | Tick players on both sides to see the change for you (our numbers) and for them, **as they likely see it**. Their view uses **market value** (draft-day reputation pulled quickly toward this season's numbers, so slumping players look worse to their managers) and their **needs**: teams with injured starters or losing records value the next ~3 weeks more. **Find trades** searches every 1-for-1, 2-for-1 and 1-for-2 with all teams for deals that help you and that they'd likely accept. It also lists buy-low targets, sell-high candidates and a "who needs a trade" table. |

**Back-to-backs.** Last season players weren't worse on the 2nd night of a back-to-back
(+1.6% vs their average), but they **sat more often**: stars 19.5% vs 13.9%, others 23.3% vs
16.8%. Sleeper's projections don't account for this, so the tool lowers the chance of playing
those games by 7%. Back-to-back games are marked "B2B". A 4-game week is still worth clearly more
than a 3-game week: players averaged 3.42 vs 2.57 games played.

**Weekly projections.** Sleeper publishes a projection for every game this week and next, and
these react to role changes like a starter getting hurt. They set each player's level for this
week's start/sit, lock bars and the **next-week lineup** (80% weekly projection, 20% season level).
Before use, Sleeper's stats are corrected for the biases measured last season: rebounds × 0.87,
turnovers × 0.93, steals × 0.97, the rest × 0.98–0.99 (see *Model checks*).

**Betting lines.** Sleeper Picks posts over/under lines (points, rebounds, assists, threes,
steals, blocks, double-double) for upcoming games, usually the next day's, for about a dozen
players per game. Both sides' payouts give the chance of the over, with the house margin removed.
That gives an expected value for each stat: normal for points/rebounds/assists, Poisson for the
rest. Those stats are blended 70% lines / 30% Sleeper's projection, then scored with your league's
settings. Games with lines show **($)**; hover for both numbers. Lines track minutes and role better:
on 10/28 Sleeper projected Mamukelashvili for 15.9 pts / 7.9 reb, his lines said ~11.8 / 4.8, and
he was averaging 9.5 / 4.0. Sportsbooks (DraftKings, FanDuel), PrizePicks and Underdog block
browser access; The Odds API needs a paid key for this volume.

Players on IR don't take an active roster spot; they count like bench depth until they return.

Rest-of-season value works like the draft values, with two changes:
- **Per-game projection:** the preseason consensus counts as 15 games and the current weekly
  projection as 10, then this season's real production takes over as games pile up.
- **Injuries:** live injury reports remove weeks.

Add `?date=YYYY-MM-DD` to the URL to view another week.

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
  game-to-game swing. Swing is how far single games land from their projection: 4.3 + 0.14 ×
  average, measured on last season's games (so ±8.5 for a 30 FP/G player, ±5.7 at 10). A
  player's own swing from last season's ESPN game logs only tilts this by 20%, because it
  barely predicted his lock-in bonus.
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

## Model checks

`python3 scripts/backtest.py` replays last season (2025-26): about 24,000 games with Sleeper's
per-game projection and box score. It fits on October to mid-January and tests on mid-January
to April, so every number below is out of sample.

| Check | Result |
|---|---|
| Sleeper's per-game projections | +0.74 FP/game too high. Rebounds run 13% high, turnovers 7%; minutes for starters ~1.4 high. |
| After the per-stat correction | Bias −0.01; error (RMSE) 6.54 → 6.48. |
| Best short-term level | 80% corrected projection + 20% season level (RMSE 6.45). Season average alone: 7.1. |
| Single-game spread | 4.3 + 0.14 × projection. The old model (37% of the average) was too wide for stars and too narrow for bench players. |
| Lock-In replay (3,797 player-weeks) | The lock/pass rule locks 18.9 points/week vs 15.0 with no locks. The old spread predicted 19.95 vs 18.87 realized, overstating stars by ~3 points a week. The new spread predicts 18.87 vs 18.94, within 0.8 at every player level. |
| Line conversion | Single-game spread of points ≈ 1.7 × √mean, rebounds 1.1, assists 1.2. Steals, blocks, threes and turnovers are close to Poisson. |

**What isn't tested yet:**
- **The 70/30 betting-line weight.** Past prop lines aren't available for free: Sleeper removes
  its lines at tip-off, and the archives (BigDataBall, SportsDataIO, The Odds API) are paid.
- **How far ahead the projection was made.** The archive holds Sleeper's last saved version of
  each projection, most saved after the game. They aren't suspiciously accurate (only ~0.1 FP
  better than a per-minute model), so they look like final pre-game numbers. Projections pulled
  several days ahead, as the tool does for later games in the week, are probably a bit worse.
- **Some fixed assumptions** come from published odds rather than our data: injury-status
  play chances (Questionable 65% etc.) and the market-value heuristic for trades.

## Collecting betting lines

Sleeper deletes each prop line when its game tips off, and its projection archive keeps only the
final version. So a GitHub Actions job (`.github/workflows/collect-lines.yml`) saves both on a
schedule:
- **When:** every 2 hours from 9 am to 11 pm ET.
- **What:** `scripts/collect_lines.py` downloads Sleeper's NBA prop lines and this week's per-game
  projections.
- **Where:** the **`data-snapshots`** branch, never `main`, so your copy of the tool and its
  updates stay clean.
  - `lines/<game date>.json`: the first line seen and the last one before tip-off, for each
    player and stat.
  - `projections/<date>.json`: Sleeper's projection that day for every game not yet played.

After a few weeks, these show how betting lines, early projections and final projections compare
with actual results. That will set the line weight (now 70%) and how much to trust projections
made days ahead.
- **Cost:** about 240 of the 2,000 free Actions minutes a month for a private repo.
- **To stop it:** GitHub → **Actions** → *Collect Sleeper lines* → **⋯** → **Disable workflow**.

## Tests

```sh
npm test
```
