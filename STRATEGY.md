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

## 3. Your board for this draft (data as of Oct 18, 2026)

Numbers come from the bundled consensus (Sleeper/Rotowire + ESPN + FantasyPros, plus last
season). **Expected games** = 50% the player's career games-played rate + 50% the ESPN and
FantasyPros expected games, minus games lost to current injuries. The career rate ignores
one-off outlier seasons (a season under 55% of his own median) and weights recent seasons more.
"% there" is the chance a player is still available at that pick, based on Sleeper ADP. Full
tables are in [CHEATSHEET.md](CHEATSHEET.md).

**Effect of ignoring outlier seasons.** Single-injury years no longer sink healthy players, but
chronic absences still count:

| Player | Career games (recent first; * = outlier ignored) | Expected games | Rank / ADP |
|---|---|---:|---|
| Tyrese Haliburton | 0* 73 68 56 77 | 68 | 22 / 18 |
| Jayson Tatum | 16* 72 74 74 76 64 66 79 80 | 72 | 6 / 11 |
| Domantas Sabonis | 19* 70 81 79 62 62 62 74 74 | 72 | 9 / 28 |
| Trae Young | 15* 76 53 73 76 63 60 81 | 71 | 35 / 22 |
| Giannis Antetokounmpo | 36* 67 73 63 67 61 63 72 75 | 69 | 4 / 7 |
| Joel Embiid | 38 19* 39 66 68 51 51 64 63 | 56 | 64 / 56 |
| Ja Morant | 20 50 9* 61 57 63 67 | 61 | 103 / 48 |

**Pick 6.** Take **Giannis** if he's there (34.0 FP/G, ~69 games, 77% there). Otherwise take
**Jayson Tatum** (30.1 FP/G, ~72 games, rank 6). He is ~99% likely there at #6 and ~90% likely
gone by #15. Next in line: **Jalen Johnson** (30.9, ~67 g) and **Cade Cunningham**
(29.6, ~68 g).

**Pick 15.** **Domantas Sabonis** is the standout. He ranks 9th for you (28.5 FP/G, ~72 games
outside his 19-game season), but his ADP is 28, so he's almost certainly there at #15. If you'd
rather wait, he's still ~60% likely to last to #26. Other options: **Cooper Flagg** (68% there),
**Anthony Davis** (rank 18; ~62 games is the risk), and **Haliburton** (rank 22, ADP 18; fair
value now).

**Picks 26 and 35.** Take two of **Bam Adebayo** (rank 13), **Josh Giddey** (15), **James Harden**
(21) and **Deni Avdija** (25). All four have ADPs of 36–38 and are ~90% likely there at #26.
**Pascal Siakam**, **Derrick White** and **Walker Kessler** (ADP 59, rank 34) are ~90% likely to
last to #35.

**Picks 46 and 55: centers slide.** **Donovan Clingan** (ADP 93, rank 32), **Rudy Gobert** (ADP 84,
rank 45), **Julius Randle** and **Onyeka Okongwu** are each 70–99% likely to still be there at
#46–55. **Damian Lillard** (ADP 147, rank 47) missed all of last season but projects for ~68
games. He's a strong value pick in rounds 6–8.

**Let someone else draft these at their ADP** (rank in your format in brackets):
- Trae Young, ADP 22 [35]
- Ja Morant, ADP 48 [103]
- Zion Williamson, ADP 51 [91]
- Joel Embiid, ADP 56 [64]
- Jimmy Butler, ADP 68 [246]: torn ACL, return ~January
- Shaedon Sharpe, ADP 100: torn meniscus, ~March
- Mark Williams, ADP 125: shoulder, ~February
- Donte DiVincenzo, ADP 130: Achilles, ~April

Disagree with a player's expected games? Open him in the tool and set your own number. The
rankings update immediately.

## 4. Pick 6 in a 10-team snake: general rules

Your picks: **6, 15, 26, 35, 46, 55, 66, 75, 86, 95, 106, 115, 126.**
You wait 9 picks and 11 picks, alternating. You are mid-board, so you never get the turn's
back-to-back picks, but you never wait 18 picks either.

| Round(s) | Picks | Plan |
|---|---|---|
| 1 | 6 | Take the highest-VORP player left. Five players are gone, and at least one elite big usually remains. If a top big and a top guard are close, take the big. Big-man depth thins out faster than guard depth in this scoring. |
| 2–3 | 15, 26 | Best value, with a lean toward stat-stuffers (rebounds + assists + stocks). Use the **Next** column: if two players are close and one has a <30% chance to reach pick 26, take him now. |
| 4–6 | 35, 46, 55 | By now you should have 2 bigs. Start filling guard slots with **assist + steal** guards rather than scorers. Check the **Positional scarcity** table: if one position has the fewest players left above replacement, that is your next fill. |
| 7–9 | 66, 75, 86 | Fill whatever slot is still empty (often SF or G). The **Fits my lineup** filter shows exactly who would start for you. Favour players projected for 70+ games. |
| 10–13 | 95, 106, 115, 126 | Bench: (a) backup centers who would start if the starter gets hurt, (b) young players with rising minutes, (c) high-stocks role players. Skip anyone already ruled out for months unless he's a true star. |

### Rules of thumb on the clock

1. **Follow the "Best pick now" card** unless you have news the data doesn't (a late injury,
   a trade, a minutes change).
2. **Season points > per-game points**, because games played count. The default ranking uses
   season totals. Discount stars with a history of missing 20+ games. Switch to per-game ranking
   under Settings if you believe a player will stay healthy.
3. **Don't draft for ADP value alone.** A big green **+/-** means you can probably wait. It isn't
   a reason to reach early.
4. **Watch tier breaks.** Sort the board by VORP and filter by position. Dashed lines mark tier
   drops. If you are the last pick before a tier drop at a position you need, take it.
5. **Turnovers and technicals:** small, but they break ties. Prefer the cleaner player when values
   are close.

## 5. Draft-day checklist

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
