# MapleStory stat reader (browser)

Reads your in-game **STAT window** off a screenshot and hands the numbers to
[maplescouter.com/en/input](https://maplescouter.com/en/input). Static page, no
build step, no dependencies, nothing uploaded — drop it on GitHub Pages and it works.

This is a port of the Python tools one directory up (`ocr_stats.py`,
`field_mapping.py`, `fill_form.js`), which needed Python + OpenCV + Tesseract
installed locally and so couldn't be shared as a link.

## Why there's no OCR library here

MapleStory draws its UI with a **fixed bitmap font at a fixed pixel size**. Every
`3` is the same 5×9 arrangement of pixels, every time. So reading it is a table
lookup, not recognition:

```
colour-key the text out of the background
  -> split the mask into glyph columns
  -> look each glyph up in a table of known bitmaps
```

That replaces the entire Tesseract stack the Python needed (2 preprocessors × 3
PSM modes × 2 whitelist modes = 12 passes per value, then voting) and is *more*
accurate, not less — a correct read is bit-exact, and an unknown glyph is
reported as unknown instead of quietly becoming a plausible digit.

Three workarounds in the Python became unnecessary as a result:

| Python | Why it existed | Here |
| --- | --- | --- |
| `remove_left_indicator` | Tesseract fused the `▲` upgrade arrow into the first digit | arrow is a recognised glyph, skipped by baseline |
| `fix_arrow_prefix` + `FIELD_MAX` | the arrow was read as a leading `2`, so values had to be capped and un-prefixed | can't happen — digits are never contaminated |
| per-ROI `skill_methods` | picking a preprocessor per hex by background colour | one mask works for all |

Also gone: a ~6–17 MB `tesseract.js` + `eng.traineddata` download, which is what
a naive port would have shipped.

## Three panels, not one coordinate space

`regions.json` in the Python tool stores every ROI as an absolute 1920×1080
screen coordinate. But the values live in **three independently draggable
windows**, so those coordinates only ever matched the author's exact layout:

| Panel | Holds | Anchor text |
| --- | --- | --- |
| Character Info | class, level | `CHARACTER INFO` |
| Stat | the 22 numeric stats | `COMBAT POWER` |
| Stat Info | Base / % / % Not Applied | `STAT INFO` |

Each panel is located independently by template-matching a unique patch of its
title text, and its ROIs are stored as offsets from that anchor. That's what
makes the page work on someone else's window arrangement.

`COMBAT POWER` is the Stat anchor rather than the `STAT` title bar because it has
362 set pixels against the title's 66 — a bigger anchor is far less likely to
false-positive.

### Anchor matching has to tolerate a near-miss

A correct anchor is usually pixel-perfect, but not always. Screenshots taken over
a darker background flip a handful of anti-aliased edge pixels on the *yellow*
title text, and that is enough to put a genuine match several percent away:

| anchor | worst match over 9 samples | margin to nearest wrong location |
| --- | --- | --- |
| `CHARACTER INFO` | 1.2% | 39.7% |
| `COMBAT POWER` | 2.6% | 27.6% |
| `STAT INFO` | **7.4%** | 21.4% |

The accept threshold is **12%**, which sits in the empty band between the two
columns. It was originally 2%, and `findAnchor` additionally required *every*
probe point to match exactly — so a near-miss never even reached the distance
check. The result was the Stat Info panel reporting "not found" on perfectly good
screenshots, and the app then silently falling back to a stale manual position.

The search is two-pass: strict probes accepting only a pixel-perfect hit (~20ms,
what a clean frame takes), and only if that finds nothing, a tolerant pass that
allows a few probe misses and takes the best match within tolerance (~200ms).

`tools/train_glyphs.py` prints the table above on every run, so an anchor that is
weak on some screenshot is visible at training time rather than as a mystery in
the browser. The trainer shares the threshold with the runtime, and
`tools/check.mjs` asserts the two agree — they drifted once, and the symptom was
misleading: the trainer silently failed to *locate* the Stat Info panel on the
cropped samples and reported it as "title not trained".

### The panel's internal layout is not fixed

The Stat Info value rows sit *below* the description prose, so their offset from
the anchor depends on how many lines that description takes — measured at rel 188
for Attack Power (7 lines) and rel 203 for STR/DEX (8 lines), with the bottom row
reaching rel 283:

```
Attack Power          STR / DEX
 rel 188 Current       rel 203 Current
 rel 213 Base          rel 228 Base
 rel 235 %             rel 250 %
 (no 4th row)          rel 272 % Value Not Applied   <- was clipped
```

A tight 182..272 window therefore cut off STR's and DEX's `% Value Not Applied`
row, which then read as **0** — the row was never absent, just outside the box.
The window is now 150..300 and rows are picked by "the rightmost group parses as a
number", which across all nine samples selects exactly Base / % / Not Applied: the
prose, the lime Current Value row, and the `Legendary Ability` banner below all
fail that test. That makes it self-correcting for layouts not yet seen rather than
tuned to the ones that were.

Note that `% Value Not Applied` genuinely doesn't exist for every stat — absent
for Attack Power and M.Attack, present for STR, DEX, INT and LUK — so `0` is
sometimes the right answer. The tests pin both cases.

## What's read vs. typed

**Read** — all 22 stat-window numbers, and the Stat Info Base / % / % Not Applied
rows. Verified exactly against nine real screenshots across three capture
sessions: two months apart on a mage (Critical Damage is white in one set and
yellow in the other), plus a cropped 947x753 set from a different, less progressed
character where Attack Power exceeds M.Attack.

### If a panel is located wrongly

Every panel row offers **Set manually / Redo** whether or not detection succeeded
— an automatic match can still land in the wrong place, and a bad manual pick has
to be undoable. Dragging a box shows you the text it captured and waits for **Use
this**; nothing is committed on mouse-up. A manual pick applies to **that
screenshot only** unless you tick *Remember for other screenshots*, and there are
`Use auto`, `Forget saved`, and `Forget saved locations` controls to get back out.

That combination is deliberate. A remembered position is an absolute pixel
coordinate, only meaningful while the in-game windows stay put — so a single wrong
pick used to spread to every later screenshot with no way to clear it. Precedence
is now: this screenshot's manual pick → automatic detection → a remembered
position, and the UI says which one it used.

**Picked / typed** (remembered in `localStorage`) — Class and Level. This is a
deliberate choice, not a gap left to fix:

- *Class* is a dropdown of maplescouter's **own 54 options** (see below), so there
  is nothing to guess or fuzzy-match. Reading it instead would need a letter
  alphabet and would still have to be reconciled against that vocabulary.
- *Level* — the `Lv.` badge uses a larger font variant and its `Lv.` prefix is dim
  grey the mask only partly catches. All six samples show only `291` or `292`,
  yielding just the digits `1`, `2` and `9`, so most levels would be unreadable.

## The class list

`js/classes.js` is generated from maplescouter's own bundle (module `60516` of
`/_next/static/chunks/app/[locale]/(pages)/input/page-*.js`), which exports two
maps and a list of the classes it groups separately:

```js
u9 = { 비숍: "Bishop", ... }        // Korean -> English, 54 entries
NX = { Bishop: "비숍", ... }        // English -> Korean
E7 = ["Hayato","Kanna","Lynn","Moxuan","Sia"]   // not in Korean MapleStory
```

`E7` is the **non-KMS** classes — Hayato and Kanna are JMS, Lynn/Moxuan/Sia are
CMS/TMS — so the dropdown puts them in their own group under that name.

The important discovery is that **the site stores class as the Korean name** —
its own calculations compare against it directly (`"데몬어벤져" === myClass`) —
and English is only ever a display label. So what a `<div role="option">` renders
depends on the site's locale, and the bookmarklet clicks options by their text.

Rather than bet on one spelling, each entry carries every alias the option could
show, and the matcher tries exact comparison across all of them, then a
punctuation/space-insensitive pass:

| field | example | purpose |
| --- | --- | --- |
| `key` | `DemonAvenger` | internal English identifier |
| `ko` | `데몬어벤져` | the value the site actually stores |
| `label` | `Demon Avenger` | readable text for our own dropdown |
| `gms` | `Dawn Warrior` | GMS name where it differs, for `SoulMaster` etc. |
| `nonKms` | `true` | not in Korean MapleStory; grouped separately in the dropdown |

`tools/check.mjs` asserts that all 54 classes match on every one of those forms,
*and* that the aliases stay specific — Bishop's set must not match Shadower. When
no option matches, the bookmarklet logs both what it tried and every option it
actually saw, so a site rename is diagnosable instead of silent.

11 classes carry a GMS alias because the site uses the romanised KMS name:
`SoulMaster`→Dawn Warrior, `FlameWizard`→Blaze Wizard, `WindBreaker`→Wind Archer,
`Striker`→Thunder Breaker, `Viper`→Buccaneer, `Captain`→Corsair,
`CannonMaster`→Cannoneer, `Eunwol`→Shade, `Hoyeong`→Hoyoung,
`Palladin`→Paladin (the site's own spelling), `DualBlader`→Dual Blade.

To refresh after a site update, re-download that chunk and re-extract; the
generator lives in the commit history for this file rather than in `tools/`, since
it depends on a downloaded bundle rather than anything in the repo.

## Known gaps

- **Stat Info titles.** Matched as whole-word bitmaps against a closed set of 7
  stat names. Trained: `M.Attack`, `INT`, `LUK`, `Attack`, `STR`, `DEX`. Only `HP`
  is left (Demon Avenger); until someone supplies that screenshot you pick the
  stat from a dropdown once and the page learns the title permanently. Note the
  panel titles the stat "Attack Power" while the site's table row is `Attack`.
- **Hexa badge font is incomplete.** `hexa_matrix.png` only contains the digits
  `0,1,2,3,5,9`; `4,6,7,8` are missing. Any unknown glyph surfaces in the UI with
  a "type what this shows" box and is remembered, so it self-heals on first use.
- ~~Auto-detection is unverified for displacement.~~ **Resolved.** The cropped
  session-3 set puts all three panels at entirely different coordinates — and each
  of its three shots is cropped slightly differently again — and every panel is
  still located correctly:

  | | charInfo | statWindow | statInfo |
  | --- | --- | --- | --- |
  | sessions 1-2 | `14,12` | `24,280` | `485,243` |
  | `_3_with_atk` | `236,37` | `246,305` | `707,268` |
  | `_3_with_str` | `239,36` | `249,304` | `710,267` |
  | `_3_with_dex` | `243,29` | `253,297` | `714,260` |

  Cropped input working is the useful part: it shows the anchor-relative ROI
  scheme earning its keep over `regions.json`'s absolute screen coordinates.
  Cropping is fine as long as each panel is fully inside the crop.
- **`% Value Not Applied` only renders for some stats** — present for STR, DEX,
  INT, LUK; absent for Attack Power and M.Attack — which is why row identity is
  anchored on the `%` suffix rather than row position.
- **Current Value is intentionally not read** — it's drawn in a lime highlight
  outside the yellow colour key, and the site computes it from base and % anyway.

## Layout

```
web/
  index.html          the page
  css/styles.css
  js/glyphs.js        GENERATED — glyph bitmap templates
  js/layout.js        GENERATED — panel anchors, ROI offsets, STAT window row order
  js/classes.js       GENERATED — maplescouter's 54 classes + aliases
  js/ocr.js           mask -> segment -> match
  js/fields.js        game label -> site field, value parsing
  js/filler.js        builds the maplescouter bookmarklet
  js/app.js           UI
  tools/train_glyphs.py   regenerates the two GENERATED files
  tools/verify.py         algorithm check in Python
  tools/selftest.mjs      runs the shipping JS against the sample PNGs
  tools/check.mjs         parse / asset / DOM-id / bookmarklet checks
```

## Development

Retrain the generated files after adding a sample or when the game's font or
window layout changes (needs the Python tool's `cv2`):

```bash
python tools/train_glyphs.py          # writes js/glyphs.js and js/layout.js
python tools/train_glyphs.py --check  # report only
```

Tests — Node comes from `fnm` (see `frontend/_utilities/node_aux.txt`):

```bash
fnm use 24
node tools/selftest.mjs   # real js/ocr.js vs. the real PNGs, 321 assertions
node tools/check.mjs      # parses, assets, DOM ids, bookmarklet validity
python tools/verify.py    # same algorithm in Python, catches HSV drift
```

`selftest.mjs` decodes the PNGs with Node's built-in `zlib`, so there's nothing
to install and no large binary fixtures in the repo.

### Why both `selftest.mjs` and `verify.py`

`selftest.mjs` exercises the exact code the page loads. `verify.py` mirrors the
algorithm independently and exists to catch **mask drift**: the templates are
harvested in Python, and OpenCV's `cvtColor` rounds H and S to integers while
`ocr.js` computes them as floats. On anti-aliased yellow text a few pixels land
on opposite sides of the threshold, which silently broke two panel anchors until
the trainer was switched to the same float maths. Keep them agreeing.

## Hosting

Any static host. For GitHub Pages, serve this directory (or copy it to `/docs`).
Scripts are plain `<script>` tags rather than ES modules and the generated data is
assigned to `window` rather than fetched, so `file://` works too — open
`index.html` directly with no server.

## Usage

1. In game, open **STAT**, click a stat to open its **Stat Info** panel, screenshot.
2. Repeat per stat you want in the table (typically your main stat, secondary, and attack).
3. Drop the screenshots on the page, or press <kbd>Ctrl</kbd>+<kbd>V</kbd>.
4. Pick your Class and enter your Level once.
5. Check the values against your screen &mdash; the table is laid out in the same two
   columns and the same order as the in-game STAT window &mdash; and correct anything wrong.
6. Drag **Fill maplescouter** to your bookmarks bar — **once**.
7. Press **Copy JSON**, then click that bookmark on `maplescouter.com/en/input`.

## The bookmarklet

It exists because a page on `github.io` can't write into `maplescouter.com` —
different origin. Only a script running *on* that site can.

The main one is **generic**: it contains no values, reads its data from the
clipboard, and therefore never goes stale. Install it once and repeat step 7
whenever the numbers change. A check asserts it embeds no values, since a single
leaked number would quietly turn it back into a stale one-shot.

Clicking a bookmarklet counts as a user gesture, so clipboard reads are permitted
— but Firefox still gates `navigator.clipboard.readText()` in page content, where
it falls back to a paste prompt. For that case there's also a **one-shot** link
under "If your browser blocks clipboard reading" with the current values baked in:
no clipboard access needed, but it must be re-dragged whenever anything changes.

Bad input is reported rather than silently ignored: non-JSON, JSON of the wrong
shape, and a class that matches no option each produce a specific message, and the
class failure logs both what it tried and every option it found on the page.
