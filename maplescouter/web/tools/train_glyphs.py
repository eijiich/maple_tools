"""Generate js/glyphs.js and js/layout.js for the browser OCR.

MapleStory renders its UI text as a fixed bitmap font at a fixed pixel size, so
"OCR" here is exact template matching, not statistical recognition. This script
harvests one labelled bitmap per glyph from the sample screenshots and bakes
them into a JS file the page loads directly (no fetch, so file:// works).

It also emits layout.js: the three in-game windows we read from are dragged
independently, so each gets its own anchor (a unique patch of title text) and
its ROIs are stored as offsets from that anchor. That's what lets the page work
on someone else's window arrangement instead of only the author's.

Run after adding a new sample or when the game's font/layout changes:

    python tools/train_glyphs.py            # writes ../js/{glyphs,layout}.js
    python tools/train_glyphs.py --check    # verify only, don't write

Ground truth below was transcribed by eye from magnified crops. '^' is the
in-game upgrade arrow, which the engine recognises so it can skip it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
WEB = HERE.parent
PY = WEB.parent                      # maplescouter/ (the python tool)
SAMPLES = PY / "samples"
OUT = WEB / "js" / "glyphs.js"
LAYOUT_OUT = WEB / "js" / "layout.js"

# --- panels ---------------------------------------------------------------
# Each in-game window is dragged independently, so ROIs are stored relative to
# an anchor: a patch of title text that is unique in the frame. Search boxes
# below are generous; the exact anchor bitmap is trimmed out of them.
# Verified on all three stat samples: distance 0, exactly one near-match each.
PANELS = {
    "charInfo": {
        "label": "Character Info",
        "anchor_search": [10, 6, 110, 18],      # "CHARACTER INFO"
        "rois": ["Character:Class", "Character:Level"],
    },
    "statWindow": {
        "label": "Stat",
        # "COMBAT POWER" (362 on-pixels) rather than the "STAT" title (only 66)
        # — a bigger anchor is far less likely to false-positive.
        "anchor_search": [20, 272, 130, 26],
        "rois": None,                            # filled with "everything else"
    },
    "statInfo": {
        "label": "Stat Info",
        "anchor_search": [480, 236, 90, 18],     # "STAT INFO"
        "rois": ["StatInfo:Panel"],
        # regions.json's single StatInfo:Panel box clips the row labels on the
        # left and cuts off the bottom value row. These anchor-relative boxes
        # replace it.
        #
        # The values box is deliberately generous. The value rows sit *below the
        # description prose*, so their offset depends on how many lines that
        # description takes: measured at rel 188 for Attack Power (7 lines) and
        # rel 203 for STR/DEX (8 lines), with the last row reaching rel 283. A
        # tight 182..272 window clipped STR's and DEX's "% Value Not Applied"
        # row, which then silently read as 0.
        #
        # 150..300 covers every observed layout while still excluding the prose
        # above and the "Legendary Ability" banner below (rel 307+). Rows are then
        # picked by "the rightmost group parses as a number", which across all 9
        # samples selects exactly Base/%/NotApplied — the prose, the lime Current
        # Value row and the banner all fail it.
        "extra_rois": {
            "StatInfo:Title":  [-7, 22, 212, 20],     # centred stat name
            "StatInfo:Values": [-7, 150, 212, 150],
        },
    },
}
ANCHOR_SAMPLE = "stat_window_with_matt"

# The Stat Info title is one of 7 fixed strings, so it is matched as a whole
# word-bitmap instead of needing an alphabet of letter templates. Only the three
# stats we have screenshots for can be trained; the rest fall back to the
# in-page picker, which can teach them.
TITLE_SAMPLES = {
    "stat_window_with_matt": "M.Attack",
    "stat_window_with_int": "INT",
    "stat_window_with_luk": "LUK",
    # The panel titles this stat as "Attack Power"; the site's table row is
    # "Attack" (see TABLE_ALIASES in js/fields.js).
    "stat_window_3_with_atk": "Attack",
    "stat_window_3_with_str": "STR",
    "stat_window_3_with_dex": "DEX",
}

# Glyphs inside a value sit 2-6px apart; bleed-in label text from a neighbouring
# row is 16-20px away. Anything past this splits into a separate group.
GROUP_GAP = 6

# Keep in step with ANCHOR_TOLERANCE in js/ocr.js. A correct anchor measures
# 0-8% of its pixels differing depending on the background behind the window;
# the nearest wrong location in a frame measures 21%+.
ANCHOR_TOLERANCE = 0.12

# --- ground truth ---------------------------------------------------------
# ROI name -> expected glyph sequence of the value. If the segmented group has
# MORE glyphs than this, leading ones are dropped: an ROI whose left edge clips
# the upgrade arrow leaves a 2-4px fragment there, and we never want to train on
# a partial arrow.
STAT_GT = {
    "Damage Range":                "^280,714,414",
    "Final Damage":                "^383.56%",
    "Ignore Enemy Defense":        "98.49%",
    "Attack Power":                "^3,243",
    "Magic ATT":                   "^8,047",
    "Cooldown Reduction":          "2sec/6%",
    "Cooldown Skip":               "7.50%",
    "Additional Status Damage":    "22.00%",
    "Mesos Obtained":              "680%",
    "Item Drop Rate":              "55%",
    "Additional EXP Obtained":     "218.00%",
    "Damage":                      "^75.00%",
    "Boss Damage":                 "435.00%",
    "Normal Enemy Damage":         "12.00%",
    "Critical Rate":               "122%",
    "Critical Damage":             "140.90%",
    "Buff Duration":               "145%",
    "Ignore Elemental Resistance": "15.00%",
    "Summon Duration":             "10%",
    "Star Force":                  "438",
    "Arcane Force":                "^1,370",
    "Sacred Force":                "820",
}
STAT_SAMPLE = "stat_window_with_matt"

# The hexa badge font is a smaller variant. One sample only yields 0,1,2,3,5,9 —
# 4,6,7,8 are missing and must be taught in-page (or add another screenshot with
# those digits and extend this table).
HEXA_GT = ["30", "30", "30", "30", "30", "25", "30", "12", "19", "30", "20"]
HEXA_SAMPLE = "hexa_matrix"

# Rows of the site's class-specific Base / % / % Not Applied table. Mirrors
# FIELDS.TABLE_STATS in js/fields.js — used only to report which titles are
# still untrained.
FIELD_TABLE_STATS = ["STR", "DEX", "INT", "LUK", "Attack", "M.Attack", "HP"]


def _hsv(bgr: np.ndarray):
    """OpenCV's 8-bit HSV convention computed in float — identical to
    js/ocr.js toHsv().

    Deliberately not cv2.cvtColor: that rounds H and S to integers, and on
    anti-aliased yellow title text a handful of pixels land on the other side of
    the threshold than the browser computes. Templates harvested with rounded
    HSV then fail to match at runtime, which is exactly the drift that showed up
    on the two yellow panel anchors.
    """
    b = bgr[:, :, 0].astype(np.float64)
    g = bgr[:, :, 1].astype(np.float64)
    r = bgr[:, :, 2].astype(np.float64)
    v = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = v - mn
    with np.errstate(divide="ignore", invalid="ignore"):
        s = np.where(v == 0, 0.0, 255.0 * d / v)
        h = np.zeros_like(v)
        nz = d > 0
        rmax = nz & (v == r)
        gmax = nz & (v == g) & ~rmax
        bmax = nz & ~rmax & ~gmax
        h[rmax] = 30.0 * (g[rmax] - b[rmax]) / d[rmax]
        h[gmax] = 60 + 30.0 * (b[gmax] - r[gmax]) / d[gmax]
        h[bmax] = 120 + 30.0 * (r[bmax] - g[bmax]) / d[bmax]
    return np.where(h < 0, h + 180, h), s, v


def mask_stat(bgr: np.ndarray) -> np.ndarray:
    """White + yellow text mask. Yellow marks buffed/upgraded values."""
    h, s, v = _hsv(bgr)
    white = (s <= 60) & (v >= 170)
    yellow = (h >= 15) & (h <= 35) & (s >= 80) & (v >= 150)
    return ((white | yellow) * 255).astype(np.uint8)


def mask_hexa(bgr: np.ndarray) -> np.ndarray:
    """Hexa badges are near-white digits over a saturated fill of any hue."""
    _, s, v = _hsv(bgr)
    return (((s <= 80) & (v >= 160)) * 255).astype(np.uint8)


def segment(m: np.ndarray) -> list[tuple[int, int]]:
    """Split a mask into glyph column-runs."""
    cols = m.sum(axis=0)
    runs: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(cols):
        if v > 0 and start is None:
            start = i
        elif v == 0 and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(cols)))
    return runs


def group_runs(runs: list[tuple[int, int]]) -> list[list[tuple[int, int]]]:
    """Cluster glyph runs into words by horizontal gap."""
    groups: list[list[tuple[int, int]]] = []
    for run in runs:
        if groups and run[0] - groups[-1][-1][1] <= GROUP_GAP:
            groups[-1].append(run)
        else:
            groups.append([run])
    return groups


def trim(g: np.ndarray) -> tuple[np.ndarray, int]:
    """Trim blank rows. Returns (bitmap, top offset within the ROI)."""
    rows = np.where(g.sum(axis=1) > 0)[0]
    if len(rows) == 0:
        return g[:0], 0
    return g[rows.min():rows.max() + 1, :], int(rows.min())


def bits(g: np.ndarray) -> str:
    """Row-major '0'/'1' string — compact and diffable in git."""
    return "".join("1" if v else "0" for v in (g > 0).ravel())


def harvest(mask: np.ndarray, expected: str) -> list[tuple[str, np.ndarray]]:
    """Align a value's expected glyph sequence to the segmented bitmaps."""
    groups = group_runs(segment(mask))
    if not groups:
        return []
    # The value is the group with the most glyphs; ties go to the leftmost.
    group = max(groups, key=lambda g: (len(g), -g[0][0]))
    if len(group) < len(expected):
        raise ValueError(f"segmented {len(group)} glyphs, expected {len(expected)}")
    group = group[len(group) - len(expected):]      # drop leading fragments
    out = []
    for ch, (a, b) in zip(expected, group):
        g, _ = trim(mask[:, a:b])
        if g.size == 0:
            raise ValueError(f"empty glyph for {ch!r}")
        out.append((ch, g))
    return out


def build_font(pairs: list[tuple[str, np.ndarray]], name: str) -> dict:
    """Collapse harvested glyphs into one template per character."""
    font: dict[str, dict] = {}
    conflicts: list[str] = []
    for ch, g in pairs:
        key = bits(g)
        entry = font.get(ch)
        if entry is None:
            font[ch] = {"w": g.shape[1], "h": g.shape[0], "bits": key, "n": 1}
        elif entry["bits"] != key:
            conflicts.append(
                f"  {name}:{ch!r} inconsistent — {entry['w']}x{entry['h']} vs {g.shape[1]}x{g.shape[0]}"
            )
        else:
            entry["n"] += 1
    if conflicts:
        print(f"[warn] {len(conflicts)} glyph conflicts in {name}:", file=sys.stderr)
        for c in conflicts:
            print(c, file=sys.stderr)
    return font


def harvest_anchor(img: np.ndarray, search: list[int]) -> tuple[dict, tuple[int, int]]:
    """Trim the anchor bitmap out of a generous search box.

    Returns (template, (abs_x, abs_y)). Verifies the template occurs exactly
    once in the frame — an ambiguous anchor would silently mislocate the panel.
    """
    x, y, w, h = search
    m = (mask_stat(img[y:y + h, x:x + w]) > 0).astype(np.uint8)
    rows = np.where(m.sum(axis=1) > 0)[0]
    cols = np.where(m.sum(axis=0) > 0)[0]
    if len(rows) == 0 or len(cols) == 0:
        raise ValueError(f"no text in anchor search box {search}")
    patch = m[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
    ax, ay = x + int(cols.min()), y + int(rows.min())

    full = (mask_stat(img) > 0).astype(np.float32)
    res = cv2.matchTemplate(full, patch.astype(np.float32), cv2.TM_SQDIFF)
    hits = int((res <= patch.size * 0.02).sum())
    if hits != 1:
        raise ValueError(f"anchor at {(ax, ay)} is not unique — {hits} near-matches")
    return {"w": patch.shape[1], "h": patch.shape[0], "bits": bits(patch)}, (ax, ay)


def derive_game_rows(rois: dict) -> list:
    """Reproduce the STAT window's on-screen layout from the ROI coordinates.

    The window is two columns of stat rows, so the page can show the values in the
    same arrangement instead of alphabetically — much easier to check against the
    game. Derived from the geometry rather than hand-listed, so it can't drift out
    of step with the ROIs.

    Returns a list of rows, each a list of field names left-to-right, with a null
    row marking the blank gap the game leaves before the Mesos/Star Force block.
    """
    items = [(name, roi[0], roi[1]) for name, roi in rois.items()]
    # Group by y with a small tolerance — paired rows are within a pixel or two.
    items.sort(key=lambda t: (t[2], t[1]))
    rows: list[list] = []
    for name, x, y in items:
        if rows and abs(y - rows[-1][0][2]) <= 3:
            rows[-1].append((name, x, y))
        else:
            rows.append([(name, x, y)])

    out: list = []
    prev_y = None
    for row in rows:
        row.sort(key=lambda t: t[1])            # left column first
        y = row[0][2]
        # The game separates the damage stats from Mesos/Star Force with a gap;
        # a jump much larger than the usual row pitch is that divider.
        if prev_y is not None and y - prev_y > 30:
            out.append(None)
        out.append([name for name, _, _ in row])
        prev_y = y
    return out


def build_layout(img: np.ndarray, regions: dict) -> dict:
    """Group ROIs by panel and rebase them onto each panel's anchor."""
    claimed = {name for p in PANELS.values() for name in (p["rois"] or [])}
    all_rois = [k for k, v in regions.items()
                if isinstance(v, list) and len(v) == 4]
    out: dict = {}
    for key, spec in PANELS.items():
        names = spec["rois"] if spec["rois"] is not None else [
            n for n in all_rois if n not in claimed
        ]
        template, (ax, ay) = harvest_anchor(img, spec["anchor_search"])
        rois = {}
        for n in names:
            x, y, w, h = regions[n]
            rois[n] = [x - ax, y - ay, w, h]     # offsets may be negative
        rois.update(spec.get("extra_rois") or {})   # already anchor-relative
        out[key] = {
            "label": spec["label"],
            "anchor": template,
            "anchorAt": [ax, ay],                # where it sat in the sample
            "rois": rois,
        }
        if key == "statWindow":
            out[key]["gameRows"] = derive_game_rows(rois)
        print(f"{key:11s} anchor {template['w']}x{template['h']} at {(ax, ay)} "
              f"-> {len(rois)} ROIs", file=sys.stderr)
    return out


def harvest_titles(layout: dict) -> dict:
    """Whole-word bitmaps for the Stat Info panel titles we have samples for."""
    titles: dict[str, dict] = {}
    panel = layout["statInfo"]
    dx, dy, w, h = panel["rois"]["StatInfo:Title"]
    for sample, stat in TITLE_SAMPLES.items():
        img = cv2.imread(str(SAMPLES / f"{sample}.png"))
        if img is None:
            continue
        m = (mask_stat(img) > 0).astype(np.uint8)
        found = harvest_anchor_in_mask(m, panel["anchor"])
        if found is None:
            print(f"[warn] {sample}: statInfo anchor not found", file=sys.stderr)
            continue
        ax, ay = found
        sub = m[ay + dy:ay + dy + h, ax + dx:ax + dx + w]
        rows = np.where(sub.sum(axis=1) > 0)[0]
        cols = np.where(sub.sum(axis=0) > 0)[0]
        if len(rows) == 0:
            print(f"[warn] {sample}: no title text", file=sys.stderr)
            continue
        patch = sub[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
        titles[stat] = {"w": patch.shape[1], "h": patch.shape[0], "bits": bits(patch)}
        print(f"title {stat:10s} {patch.shape[1]}x{patch.shape[0]} from {sample}", file=sys.stderr)
    return titles


def report_anchor_quality(layout: dict) -> None:
    """Score every anchor against every stat sample.

    An anchor harvested from one screenshot can be much weaker on another — the
    yellow title text has anti-aliased edges that shift across the colour
    threshold when the scene behind the window is darker. Printing the worst
    ratio, and the margin to the nearest wrong location, keeps that visible here
    instead of surfacing as a mysterious "panel not found" in the browser.
    """
    samples = sorted(SAMPLES.glob("stat_window*.png"))
    print("anchor quality (worst match across %d samples):" % len(samples), file=sys.stderr)
    for key, panel in sorted(layout.items()):
        a = panel["anchor"]
        tpl = np.array([1 if c == "1" else 0 for c in a["bits"]], np.uint8)
        tpl = tpl.reshape(a["h"], a["w"]).astype(np.float32)
        area = a["w"] * a["h"]
        worst, worst_name, tightest = 0.0, "", 1.0
        for p in samples:
            img = cv2.imread(str(p))
            if img is None:
                continue
            m = (mask_stat(img) > 0).astype(np.float32)
            res = cv2.matchTemplate(m, tpl, cv2.TM_SQDIFF)
            best = int(round(float(res.min())))
            ratio = best / area
            if ratio > worst:
                worst, worst_name = ratio, p.stem
            # nearest wrong location: mask out a neighbourhood of the winner
            ys, xs = np.where(res <= res.min() + 0.5)
            blocked = res.copy()
            y0, x0 = int(ys[0]), int(xs[0])
            blocked[max(0, y0 - 40):y0 + 40, max(0, x0 - 40):x0 + 40] = np.inf
            impostor = int(round(float(blocked.min()))) / area
            tightest = min(tightest, impostor - ratio)
        flag = "" if worst <= 0.10 else "   <-- weak"
        print(f"  {key:11s} worst {worst * 100:5.1f}% ({worst_name}), "
              f"smallest margin to a wrong location {tightest * 100:5.1f}%{flag}",
              file=sys.stderr)


def harvest_anchor_in_mask(m: np.ndarray, anchor: dict):
    """Locate an already-trained anchor template inside a mask.

    Uses the same tolerance as js/ocr.js ANCHOR_TOLERANCE. A 2% threshold here
    silently refused the cropped session-3 screenshots, whose yellow "STAT INFO"
    title matches at ~7% — which then looked like "title not trained" rather than
    "anchor not located".
    """
    tpl = np.array([1 if c == "1" else 0 for c in anchor["bits"]], np.uint8)
    tpl = tpl.reshape(anchor["h"], anchor["w"])
    res = cv2.matchTemplate(m.astype(np.float32), tpl.astype(np.float32), cv2.TM_SQDIFF)
    if int(round(float(res.min()))) > tpl.size * ANCHOR_TOLERANCE:
        return None
    ys, xs = np.where(res <= res.min() + 0.5)
    return int(xs[0]), int(ys[0])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only, don't write")
    args = ap.parse_args()

    regions = json.loads((PY / "regions.json").read_text(encoding="utf-8"))

    # --- stat font ---
    img = cv2.imread(str(SAMPLES / f"{STAT_SAMPLE}.png"))
    if img is None:
        sys.exit(f"missing sample {STAT_SAMPLE}.png")
    stat_pairs: list[tuple[str, np.ndarray]] = []
    for name, gt in STAT_GT.items():
        x, y, w, h = regions[name]
        try:
            stat_pairs.extend(harvest(mask_stat(img[y:y + h, x:x + w]), gt))
        except ValueError as e:
            print(f"[warn] {name}: {e}", file=sys.stderr)
    stat_font = build_font(stat_pairs, "stat")

    # --- hexa font ---
    hexa_font: dict = {}
    hexa_regions_path = PY / "hexa_regions.json"
    hexa_img = cv2.imread(str(SAMPLES / f"{HEXA_SAMPLE}.png"))
    if hexa_img is not None and hexa_regions_path.exists():
        hexa_rois = json.loads(hexa_regions_path.read_text(encoding="utf-8"))["skill_rois"]
        hexa_pairs: list[tuple[str, np.ndarray]] = []
        for roi, gt in zip(hexa_rois, HEXA_GT):
            if roi is None:
                continue
            x, y, w, h = roi
            try:
                hexa_pairs.extend(harvest(mask_hexa(hexa_img[y:y + h, x:x + w]), gt))
            except ValueError as e:
                print(f"[warn] hexa {gt}: {e}", file=sys.stderr)
        hexa_font = build_font(hexa_pairs, "hexa")

    digits = set("0123456789")
    stat_missing = sorted(digits - set(stat_font))
    hexa_missing = sorted(digits - set(hexa_font))
    print(f"stat font: {len(stat_font)} glyphs {sorted(stat_font)}", file=sys.stderr)
    print(f"  missing digits: {stat_missing or 'none'}", file=sys.stderr)
    print(f"hexa font: {len(hexa_font)} glyphs {sorted(hexa_font)}", file=sys.stderr)
    print(f"  missing digits: {hexa_missing or 'none'} (teach in-page)", file=sys.stderr)

    # --- layout / anchors / stat-info titles ---
    layout = build_layout(cv2.imread(str(SAMPLES / f"{ANCHOR_SAMPLE}.png")), regions)
    layout["statInfo"]["titles"] = harvest_titles(layout)
    untrained = [s for s in FIELD_TABLE_STATS if s not in layout["statInfo"]["titles"]]
    print(f"  untrained titles: {untrained or 'none'} (in-page picker teaches these)",
          file=sys.stderr)
    report_anchor_quality(layout)

    if args.check:
        return

    payload = {"stat": stat_font, "hexa": hexa_font}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// GENERATED by tools/train_glyphs.py — do not edit by hand.\n"
        "// Each glyph: {w, h, bits} where bits is a row-major '0'/'1' string.\n"
        "// `n` records how many times the glyph was seen while training.\n"
        "window.GLYPHS = " + json.dumps(payload, indent=1, sort_keys=True) + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT}", file=sys.stderr)

    LAYOUT_OUT.write_text(
        "// GENERATED by tools/train_glyphs.py — do not edit by hand.\n"
        "// Each panel is an independently-dragged in-game window. `anchor` is a\n"
        "// unique patch of its title text; `rois` are [dx, dy, w, h] offsets from\n"
        "// where that anchor is found (dx/dy may be negative).\n"
        "window.LAYOUT = " + json.dumps(layout, indent=1, sort_keys=True) + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {LAYOUT_OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
