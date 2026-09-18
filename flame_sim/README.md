# Flame Reset Simulator

The game's *"Select which Bonus stats to use"* dialog, driven by the same tables
the gear-progression ranking uses. Press Reset, pay 3,000,000 mesos, see what
you rolled, keep it or not — and find out what "270 resets expected, median 187"
feels like before spending 810m on it.

Standalone: `index.html` here loads `../gear_progression/js/value.js` and
`flames.js` directly; `python build_sim.py` inlines them into `dist/index.html`,
which is what gets deployed at `/simulator/`.

To run the dev page over HTTP, serve from the **repo root** (`maple_tools/`), not
from this folder — `python -m http.server` won't serve `../gear_progression/`
from inside `flame_sim/`. Opening `index.html` straight from disk works too, as
does `dist/index.html` from anywhere, since it has no external references.

## What it reproduces, and from where

Built from a recording of the real dialog (`data/video/2026-09-10 10-28-21.mkv`):

| in the game | here |
| --- | --- |
| BEFORE / AFTER columns with the lines and a *Total Value* box | same |
| the number beside the flame icon (23, 20, 22 …) | **tier total** — the sum of the four line tiers, max 28 |
| *Combat Power Change*, green with ▲ when AFTER is better | **Flame score change** in main-stat points, same colouring |
| Reset ×1 → confirm popup → AFTER refreshes, 3m gone | same; `Space` = Reset, `Enter` = Confirm / Reset, `Esc` = Cancel |
| *"Pressing Reset will automatically use the BEFORE stats"* | same — **Use AFTER** is how you keep a roll |

Combat Power isn't replicated because it needs the game's formula and the
whole character. Flame score is the better number for the decision anyway: the
recording caught the tier total going **23 → 22 on a roll that was +60,107
combat power better**, because the tier total ignores which stats a class
actually uses. Both are shown so that lesson is visible.

The keyboard mapping is how the player in the recording drives it — Space once,
then hold Enter. With no popup open, Enter is the dialog's default button
(Reset), so a held Enter alternates Reset → Confirm → Reset, exactly as in-game.

**One deliberate departure:** in-game, the Reset that follows a good roll under a
held Enter discards that roll. Here a *held* key (auto-repeat, or still down
without a keyup — some Android keyboards never set `e.repeat`) stops the moment
AFTER beats BEFORE and leaves the roll up. A fresh press still resets, and `U`
keeps the roll. The checkbox *hold stops on a better roll* (on by default,
persisted) restores the raw game behaviour if you want it.

## Auto-roll

Three policies, all of which a player can actually follow in-game (you only
ever see the latest AFTER and can only keep that one):

- **stop at the first roll that beats BEFORE** — the policy the ranking prices;
  the run reports how many resets it took against the expected and median.
- **take every improvement as it comes** — greedy; BEFORE ratchets upward.
- **just roll, keep BEFORE** — watch the distribution.

A run that ends with AFTER better than BEFORE opens a dialog — the roll's lines,
the score change, the tier totals — with **Use AFTER** (a fresh `Enter`, or `U`)
and **Keep BEFORE** (`Esc`). Keeping BEFORE leaves the roll up, so nothing is
discarded by the dialog itself. A held Enter does not choose, for the same reason
it does not reset past a good roll. Greedy never opens it: it took the
improvement already.

Neither popup closes on a click outside it. That click is almost always the mouse
still spamming the button that opened it — Reset, or ×1000 — and closing on it
meant Reset never rolled and the end-of-run decision vanished under the hand that
asked for it. Only the buttons and the keys act, as with the game's own modals.

## The sampler is the ranking's distribution, provably

`flameSample` in `gear_progression/js/flames.js` rolls a flame the way the game
does: an advantaged item draws exactly 4 lines, non-advantaged 1–4 at
40/40/15/5%; lines are a uniform subset of the 19-line pool (21 on a weapon);
each tier is independent, from the flame type's table, shifted down two when
non-advantaged. The valued lines use the same per-tier amounts as
`flameTrackedSlots`, and a sample is worth `flameCurrentValue` of the flame-table
inputs it maps to — so it sits on the ranking's scale by construction.

`gear_progression/tools/check_js.py` asserts it: 60,000 seeded rolls must
average within 1% of `flameReroll(dist).expected` and match one exact tail
probability within 0.01, every pool line must appear ≈ 4/19 of the time, and the
non-advantaged line counts must land at 40/40/15/5.

The "junk" lines the ranking never needed (Speed, Jump, Defense, Max MP, level
requirement) are display-only — they carry weight 0 for every class. Their
per-tier amounts come from StrategyWiki and were checked against the recording
on a lv160 item: DEF +54 = 6×9, Speed +5 = tier 5, level −25 = 5×5, Max MP
+2880 = 6×480.

## Weights

Same MapleScouter paste as the gear tool, prefilled with its mage example. The
Flame score is main-stat points regardless of whether the paste is in stat or
Final Damage units (a %fd paste also shows the %fd figure underneath). Clear the
paste and Reset is disabled — there is no honest score without weights.

## Rates

The meso reset uses the **eternal (Black Rebirth)** table, per the patch note.
The rates selector exists only to compare what a red or abyssal flame would have
done; advantage is a property of the item and your class, not of the flame.
