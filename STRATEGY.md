# Draft strategy: 10-team Sleeper points league, pick 6

This plan is built for **your** settings. Other sites' fantasy-point projections use different
scoring (or are category-based), so the tool only takes their raw stat lines and rescores them
with your league's scoring. Section 3 has the player-specific plan for this draft. The tool's
**Draft plan** tab updates it live as picks happen.

## 1. What your scoring rewards

| Stat | Fantasy pts | Worth this many points scored |
|---|---|---|
| Point | 0.5 | 1 |
| Rebound | 1 | **2** |
| Assist | 1 | **2** |
| Steal | 2 | **4** |
| Block | 2 | **4** |
| Turnover | −1 | −2 |
| 3-pointer made | +0.5 bonus | 1 |
| Double-double | +1 bonus | |
| Triple-double | +2 bonus | |
| 40-point game / 50-point game | +2 / +2 | |
| Technical / flagrant | −2 | |

These are the league's actual `scoring_settings`. They include three items beyond the ones you
listed: 3-pointers made (+0.5), and +2 bonuses for 40- and 50-point games. All three are small.
3s add ~1 FP/G for a high-volume shooter. The 40-point bonus adds ~0.2 FP/G even for the top
scorers.

Points scored are worth half as much as everything else, so the box-score "feel" misleads. Some
example stat lines:

| Archetype | Line (pts / reb / ast / stl / blk / TO / 3PM) | FP/G |
|---|---|---|
| Volume wing scorer | 27 / 5 / 5 / 1.0 / 0.5 / 3.0 / 2.5 | **24.9** |
| Rebounding + passing center | 20 / 12 / 6 / 1.0 / 1.0 / 3.0 / 0.5, 60% DD | **29.9** |
| Rim protector | 14 / 10 / 2 / 0.7 / 2.5 / 1.5 / 0, 45% DD | **24.4** |
| Pass-first PG | 20 / 4 / 9 / 1.5 / 0.3 / 3.5 / 2.0, 30% DD | **24.4** |

A 14-point rim protector is worth about the same as a 27-point scorer. Takeaways:

- **Bigs who rebound, pass or block are this format's premium asset.** Points-heavy rankings
  (ESPN, Yahoo, 9-cat lists) undervalue them.
- **Stocks (steals + blocks) are the cheapest way to add points late.** One extra stock per game is
  worth as much as 4 extra points per game.
- **Turnovers are a real tax.** A high-usage guard with 4 TO/game gives back 4 FP every night.
  Volume alone isn't enough; he needs the assists to pay for it.
- **Pure scorers with thin peripherals (low reb/ast/stl/blk) are traps** at their usual draft cost.
  The tool's *Format fallers* table lists them.

Sleeper's ADP comes mostly from leagues on these same default settings, so it predicts your
leaguemates' picks well. Your edge over them comes from:

1. Projections rescored exactly for your settings, blended with last season's stats.
2. Roster construction for **3 UTIL** (most Sleeper leagues have 2).
3. Using odds of a player surviving to your next pick instead of strict ADP order.

## 2. What 3 UTIL slots change

Each team starts 10: PG, SG, G, SF, PF, F, C + 3 UTIL. That is **100 starters league-wide** plus 30
bench players, so the waiver wire starts around the 131st-best player.

- Only **one** slot strictly requires a center, but a C-only player can still fill C + 3 UTIL, so
  4 slots. A PF/C can fill PF, F, C and UTIL. **Starting 3–4 bigs costs you nothing** in this
  format. The extra UTIL is exactly what lets you lean into the most valuable archetype.
- You still need three guards (PG, SG, G) and two wings (SF, F). The UTILs absorb the best
  available player, so positional needs only start to bite around rounds 6–9. The tool's **Gain**
  column handles this. Once your C/UTIL spots are full of bigs, another big's Gain drops to bench
  value, and the board pushes guards and wings up.
- **Multi-position eligibility (PG/SG, SF/PF, PF/C) has real value.** It lets the lineup
  optimiser start your best 10 every night.

## 3. Lock-In changes the math

Your league uses **Sleeper Lock-In** (`game_mode` 1): one game per player per week counts.
After each game you can lock it in, or pass and hope for a better one. You must decide before
his next game starts, and the last game of the week counts if you never lock. Only starters can
be locked. The tool's default ranking (**Lock-In**) is built for this:

- **Weekly value = the expected score of the game you end up locking.** With smart lock-or-pass
  decisions over a typical 2–4-game week, that's about **the player's average + 0.67 × his
  game-to-game swing** (standard deviation). Swing is measured from each player's ESPN game
  logs last season, scored with your settings.
- **Season value = weekly value × weeks with at least one game.** Missing 1–2 games in a week
  costs almost nothing, but a missed week scores zero. Known injuries count as whole lost weeks.
  For other expected absences, 70% are assumed to wipe out a week (injury stretches); the rest
  are rest days.

What that means for the draft:
1. **Durability matters less than in standard leagues.** A star who plays 55–60 games but shows
   up most weeks is fine. Anthony Davis climbs to #14 and Embiid to #55, about his ADP. Players
   who miss **long stretches** still hurt: Morant ranks #107 against ADP 48, Zion #86 against 51.
2. **Upside beats consistency.** A streaky player with the same average is worth more, because
   you lock his big game and skip the dud. Big men are the streakiest (blocks and boards swing a
   lot): Kel'el Ware, Zach Edey and Jakob Poeltl have ~50% swing and all move up. Very steady
   players lose a little: SGA (24%) drops to #7 and Amen Thompson (25%) to #33.
3. **Games per week stop mattering.** Don't pay for 4-game weeks or chase schedule streams.
4. **Your 3 IR slots** accept Out, Suspended and DNR players. An injured player only costs you a
   roster spot once he's healthy. That makes late-round stashes of long-term injured players
   (Butler, Sharpe, Mark Williams) cheaper, but only at a late-round price.
5. **Bench players can't be locked.** Their job is to fill a starting slot when a starter has no
   game that week, so a deep bench matters less than strong starters.

### Lock-or-pass rule during the season

Compare the game he just played with his average (FP/G in the tool) and his swing:

| Games he has left this week after this one | Lock if this game is at least… |
|---|---|
| 0 | It counts automatically |
| 1 | his average |
| 2 | average + 0.4 × swing |
| 3 | average + 0.63 × swing |

Example: Jokić averages ~41 with a swing of ~11 points (28%). With 2 games left, lock anything
above ~45; otherwise pass.

## 4. Your board for this draft (data as of Oct 18, 2026, Lock-In values)

Numbers come from the bundled consensus (Sleeper/Rotowire + ESPN + FantasyPros, plus last
season). **Expected games** blend the player's career games-played rate (one-off outlier
seasons count at 35% weight, recent seasons weighted more) with ESPN/FantasyPros expected games, minus
current injuries. **Lock/wk** is the expected locked score per week. "% there" is the chance a
player is still available at that pick, from Sleeper ADP. Full tables, including a **preseason watch list** (hints only, not in the rankings), are in
[CHEATSHEET.md](CHEATSHEET.md).

| Player | Career games (recent first; * = outlier, counted at 35% weight) | Expected games | Lock-In rank / ADP |
|---|---|---:|---|
| Tyrese Haliburton | 0* 73 68 56 77 | 65 | 26 / 18 |
| Jayson Tatum | 16* 72 74 74 76 64 66 79 80 | 71 | 6 / 11 |
| Domantas Sabonis | 19* 70 81 79 62 62 62 74 74 | 70 | 10 / 28 |
| Giannis Antetokounmpo | 36* 67 73 63 67 61 63 72 75 | 68 | 4 / 7 |
| Anthony Davis | 20* 51 75 56 40 36 62 56 75 | 61 | 14 / 15 |
| Joel Embiid | 38 19* 39 66 68 51 51 64 63 | 55 | 55 / 56 |
| Ja Morant | 20 50 9* 61 57 63 67 | 60 | 107 / 48 |

**Pick 6.** Take **Giannis** if he's there (41.5 locked/wk, 77% there). Otherwise **Jayson
Tatum** and **Jalen Johnson** are a dead heat in Lock-In: Tatum 36.2/wk over ~71 games, Johnson
38.0/wk over ~66 games, a higher ceiling but less durable. Take **Tatum** at 6, because Johnson
has a ~50% chance of reaching #15 and Tatum only ~10%. If Tatum's Achilles worries you, take
Johnson. **Cade Cunningham** (47% there) and **SGA** (31%) are close behind.

**Pick 15.** **Domantas Sabonis** (rank 10, ADP 28, almost certainly there), **Anthony Davis**
(rank 14, ADP 15, ~60% there) or **Cooper Flagg** (rank 13, 68% there). Sabonis has a ~60% chance
of lasting to #26, and he had a quiet preseason (2 games, well below his projected production
per minute). So the lower-risk play is Davis or Flagg at 15, then Sabonis at 26 if he's there.
**Josh Giddey** (rank 11) is ~93% likely to last to #26, so wait on him.

**Picks 26 and 35.** Take two of **Josh Giddey**, **Bam Adebayo** (16), **Jalen Duren** (21, ADP 48),
**Deni Avdija** (22), **James Harden** (24) and **Walker Kessler** (34, ADP 59).

**Picks 46 and 55: centers slide, and the streaky ones are worth more here.** Targets:
- **Donovan Clingan**: rank 29, ADP 93
- **Kel'el Ware**: rank 41, ADP 76, the most boom-or-bust big
- **Rudy Gobert**: rank 46, ADP 84
- **Damian Lillard**: rank 52, ADP 147
- **Joel Embiid**: rank 55, ADP 56. Fine in Lock-In: he only has to play once a week.

In later rounds, **Zach Edey** (ADP 101) and **Jakob Poeltl** (ADP 118) are high-swing bigs.

**Let someone else draft these at their ADP:**
- Ja Morant, ADP 48 [rank 107]
- Zion Williamson, ADP 51 [86]
- Kristaps Porziņģis, ADP 89 [147]
- Paul George, ADP 86 [99]
- Jimmy Butler, ADP 68: out until ~January. An IR stash only in the last rounds.
- Shaedon Sharpe, Mark Williams, Donte DiVincenzo: out for months. Late IR stashes at most.

Disagree with a player's expected games? Open him in the tool and set your own number. The
rankings update immediately.

## 5. Pick 6 in a 10-team snake: general rules

Your picks: **6, 15, 26, 35, 46, 55, 66, 75, 86, 95, 106, 115, 126.**
You wait 9 picks and 11 picks, alternating. You are mid-board, so you never get the turn's
back-to-back picks, but you never wait 18 picks either.

| Round(s) | Picks | Plan |
|---|---|---|
| 1 | 6 | Take the highest-VORP player left. Five players are gone, and at least one elite big usually remains. If a top big and a top guard are close, take the big. Big-man depth thins out faster than guard depth in this scoring. |
| 2–3 | 15, 26 | Best value, with a lean toward stat-stuffers (rebounds + assists + stocks). Use the **Next** column: if two players are close and one has a <30% chance to reach pick 26, take him now. |
| 4–6 | 35, 46, 55 | By now you should have 2 bigs. Start filling guard slots with **assist + steal** guards rather than scorers. Check the **Positional scarcity** table: if one position has the fewest players left above replacement, that is your next fill. |
| 7–9 | 66, 75, 86 | Fill whatever slot is still empty (often SF or G). The **Fits my lineup** filter shows exactly who would start for you. Favour players who show up most weeks over iron-man role players. |
| 10–13 | 95, 106, 115, 126 | Bench: (a) backup centers who would start if the starter gets hurt, (b) young players with rising minutes, (c) high-stocks role players. Long-term injured stars can go straight to one of your 3 IR slots, so they're fine stashes here. |

### Rules of thumb on the clock

1. **Follow the "Best pick now" card** unless you have news the data doesn't (a late injury,
   a trade, a minutes change).
2. **Rank by Lock-In value** (the default): expected locked score per week × weeks with a game.
   Discount players who miss **long stretches**, not stars who sit a game here and there. If
   your league were a standard points league, you'd switch the ranking to *Season fantasy
   points* under Settings.
3. **Don't draft for ADP value alone.** A big green **+/-** means you can probably wait. It isn't
   a reason to reach early.
4. **Watch tier breaks.** Sort the board by VORP and filter by position. Dashed lines mark tier
   drops. If you are the last pick before a tier drop at a position you need, take it.
5. **Turnovers and technicals:** small, but they break ties. Prefer the cleaner player when values
   are close.

## 6. Draft-day checklist

1. Download the repo (Code → Download ZIP), unzip it and double-click `index.html`. Nothing to
   install. Sleeper's API allows browser requests, so live sync works from a local file.
2. **Settings & data** → **Load from Sleeper**. The league ID and draft ID are pre-filled. Check
   that it shows 10 teams, slot 6 and 3 UTIL.
3. Run 1–2 **mock drafts** (Board → *Start mock draft*).
4. If you disagree with a player's projected games, open him and set your own estimate. Rankings
   update immediately.
5. When the draft starts, turn on **Live sync**. The board drops drafted players and the clock
   counts down to your pick.
6. Optional: refresh the data shortly before the draft with
   `python3 scripts/build_consensus.py && node scripts/cheatsheet.js`.
