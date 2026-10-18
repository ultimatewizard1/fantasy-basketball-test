# Hoops Draft Assistant

A draft tool for Sleeper fantasy basketball points leagues. It rescores Sleeper's projections and
last season's stats with **your league's own scoring**, values players over replacement for
**your** roster (e.g. 3 UTIL slots), and helps you pick live during the draft.

See [STRATEGY.md](STRATEGY.md) for the draft plan for a 10-team league, pick 6, default Sleeper
scoring and 3 UTIL slots.

## Run it

It's a static page with no build step and no dependencies. Run either:

```sh
npm start            # or: python3 -m http.server 8000
# then open http://localhost:8000
```

Or open `index.html` directly, or turn on GitHub Pages for the repo.

Then go to **Settings & data**, enter the league ID and your Sleeper username, and click
**Load from Sleeper**.

## What it pulls from Sleeper (read-only, no login)

| Data | Endpoint |
|---|---|
| League scoring, roster slots, team count, draft ID | `api.sleeper.app/v1/league/{id}` (+ `/users`, `/drafts`) |
| Draft order and live picks | `api.sleeper.app/v1/draft/{id}` and `/picks` |
| Player positions, teams, injury status | `api.sleeper.app/v1/players/nba` (cached for 24h) |
| Season projections + ADP | `api.sleeper.com/projections/nba/{season}` |
| Last season's stats | `api.sleeper.com/stats/nba/{season-1}` |

Fantasy points are always recomputed from the raw stat line (points, rebounds, assists, steals,
blocks, turnovers, double/triple-doubles, technicals…) with the league's `scoring_settings`.
Pre-computed fantasy totals are never used.

If your browser blocks a request, the **Manual import** box lists each URL so you can paste the
JSON instead. You can also import a CSV of stats from any site, such as Basketball-Reference,
Hashtag Basketball or ESPN. It is rescored with your settings, never trusted as fantasy points.

## Features

- **Board**: every player with FP/G, projected games, season FP, VORP, **Gain** (improvement to
  *your* optimal lineup), **Now** (gain adjusted for whether he'd last to your next pick), Sleeper
  ADP, value vs ADP, and the chance he survives to your next pick. Position filters, a "fits my
  lineup" filter and tier-break markers.
- **Recommendations**: the top three picks for your next selection, with reasons.
- **Live sync**: polls the Sleeper draft every 4s.
- **Manual mode**: *Taken* / *Mine* buttons for drafts tracked by hand.
- **Mock draft**: the other teams pick around ADP. Undo steps back to your previous pick.
- **Draft plan**: realistic targets for each of your upcoming picks, a positional scarcity
  table, players the market over- and under-values, and format risers and fallers.
- **Player detail**: where each player's fantasy points come from, stat by stat.
- **Export**: rankings as CSV.

## How values are computed

1. **Projected line** = weighted blend of Sleeper's season projection and last season's per-game
   stats (default 60/40), scored with the league settings. Projected games come from Sleeper's
   projection (or 95% of last season's games), capped by *Max games*.
2. **Replacement level**: all teams' starting slots are filled league-wide with an optimal
   assignment. The best leftover player at each position sets the bar. VORP = value − replacement
   at the player's most favourable eligible position.
3. **Gain**: your roster is scored as an optimal starting lineup plus bench at *bench weight*
   (default 0.3). Gain is the change from adding the player.
4. **Now** = Gain − (expected best Gain at your next pick − the same without this player). This
   favours players who won't make it back to you. Availability assumes ADP ± max(2.5, 22% of ADP).

## Tests

```sh
npm test
```
