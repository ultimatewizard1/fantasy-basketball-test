# Draft strategy: 10-team Sleeper points league, pick 6

This plan is built for **your** settings. Other sites' fantasy-point projections use different
scoring (or are category-based), so the draft tool only takes raw stat lines and rescores them.
Treat the reasoning below as the strategy. Use the tool's **Draft plan** tab for current player
names, ADP and availability.

## 1. What your scoring rewards

| Stat | Fantasy pts | Worth this many points scored |
|---|---|---|
| Point | 0.5 | 1 |
| Rebound | 1 | **2** |
| Assist | 1 | **2** |
| Steal | 2 | **4** |
| Block | 2 | **4** |
| Turnover | −1 | −2 |
| Double-double | +1 bonus | |
| Triple-double | +2 bonus | |
| Technical / flagrant | −2 | |

Points scored are worth half as much as everything else, so the box-score "feel" misleads. Some
example stat lines:

| Archetype | Line (pts / reb / ast / stl / blk / TO) | FP/G |
|---|---|---|
| Volume wing scorer | 27 / 5 / 5 / 1.0 / 0.5 / 3.0 | **23.5** |
| Rebounding + passing center | 20 / 12 / 6 / 1.0 / 1.0 / 3.0, 60% DD | **29.6** |
| Rim protector | 14 / 10 / 2 / 0.7 / 2.5 / 1.5, 45% DD | **24.4** |
| Pass-first PG | 20 / 4 / 9 / 1.5 / 0.3 / 3.5, 30% DD | **23.4** |

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

## 3. Pick 6 in a 10-team snake

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

## 4. Draft-day checklist

1. Open the tool → **Settings & data** → League ID `1414370391324950528`, your Sleeper username → **Load from Sleeper**.
2. Confirm that **Teams = 10**, **My slot = 6**, the roster shows 3 UTIL, and the scoring JSON matches your league.
3. Run 2–3 **mock drafts** (Board → *Start mock draft*) to see who tends to reach you at 6, 15 and 26.
4. Re-load the morning of the draft (injuries, ADP and projections update).
5. When the draft starts, turn on **Live sync**. The board drops drafted players and the clock
   counts down to your pick.
