"""Verify the generated glyphs.js / layout.js against the sample screenshots.

This mirrors js/ocr.js step for step — including its float HSV conversion rather
than OpenCV's integer one — so it catches two classes of problem the browser
selftest would otherwise be the first to see:

  * templates that don't actually match the pixels they were harvested from,
  * drift between the training mask (cv2.inRange, integer HSV) and the runtime
    mask (hand-rolled float HSV in ocr.js).

    python tools/verify.py

Exits non-zero if any expected value fails to read.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
WEB = HERE.parent
PY = WEB.parent
SAMPLES = PY / "samples"

GROUP_GAP = 6
MAX_GLYPH_DIST = 0.2

# Transcribed by eye from magnified crops of stat_window_with_matt.png.
EXPECTED = {
    "Damage Range": 280714414,
    "Final Damage": 383.56,
    "Ignore Enemy Defense": 98.49,
    "Attack Power": 3243,
    "Magic ATT": 8047,
    "Cooldown Reduction": [2, 6],
    "Cooldown Skip": 7.50,
    "Additional Status Damage": 22.00,
    "Mesos Obtained": 680,
    "Item Drop Rate": 55,
    "Additional EXP Obtained": 218.00,
    "Damage": 75.00,
    "Boss Damage": 435.00,
    "Normal Enemy Damage": 12.00,
    "Critical Rate": 122,
    "Critical Damage": 140.90,
    "Buff Duration": 145,
    "Ignore Elemental Resistance": 15.00,
    "Summon Duration": 10,
    "Star Force": 438,
    "Arcane Force": 1370,
    "Sacred Force": 820,
}
EXPECTED_ANCHORS = {"charInfo": (14, 12), "statWindow": (24, 280), "statInfo": (485, 243)}


def load_js_object(path: Path, var: str) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.search(r"window\." + var + r"\s*=\s*(\{.*\});\s*$", text, re.S)
    if not m:
        sys.exit(f"can't parse {var} out of {path}")
    return json.loads(m.group(1))


def to_hsv(r: int, g: int, b: int) -> tuple[float, float, float]:
    """Exactly js/ocr.js toHsv — OpenCV's 8-bit convention, float maths."""
    v = max(r, g, b)
    mn = min(r, g, b)
    d = v - mn
    s = 0.0 if v == 0 else (255.0 * d) / v
    if d == 0:
        h = 0.0
    elif v == r:
        h = (30.0 * (g - b)) / d
    elif v == g:
        h = 60 + (30.0 * (b - r)) / d
    else:
        h = 120 + (30.0 * (r - g)) / d
    if h < 0:
        h += 180
    return h, s, float(v)


def mask(img_bgr: np.ndarray, kind: str = "stat") -> np.ndarray:
    """Vectorised equivalent of ocr.js mask() for the whole image."""
    b = img_bgr[:, :, 0].astype(np.float64)
    g = img_bgr[:, :, 1].astype(np.float64)
    r = img_bgr[:, :, 2].astype(np.float64)
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
    h = np.where(h < 0, h + 180, h)
    if kind == "hexa":
        return ((s <= 80) & (v >= 160)).astype(np.uint8)
    white = (s <= 60) & (v >= 170)
    yellow = (h >= 15) & (h <= 35) & (s >= 80) & (v >= 150)
    return (white | yellow).astype(np.uint8)


def segment(m: np.ndarray) -> list[tuple[int, int]]:
    cols = m.sum(axis=0)
    runs, start = [], None
    for i, val in enumerate(cols):
        if val > 0 and start is None:
            start = i
        elif val == 0 and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(cols)))
    return runs


def group(runs):
    groups = []
    for run in runs:
        if groups and run[0] - groups[-1][-1][1] <= GROUP_GAP:
            groups[-1].append(run)
        else:
            groups.append([run])
    return groups


def cut(m: np.ndarray, x0: int, x1: int):
    """Returns (bitmap, top) — mirrors ocr.js cut()."""
    sub = m[:, x0:x1]
    rows = np.where(sub.sum(axis=1) > 0)[0]
    if len(rows) == 0:
        return None
    return sub[rows.min():rows.max() + 1, :], int(rows.min())


def mark_decorations(cuts):
    """Mirrors ocr.js markDecorations — baseline test, not a height test."""
    bottoms = [top + bm.shape[0] - 1 for bm, top in cuts]
    counts: dict[int, int] = {}
    modal, best = bottoms[0], 0
    for b in bottoms:
        counts[b] = counts.get(b, 0) + 1
        if counts[b] > best:
            best, modal = counts[b], b
    return [b < modal - 2 for b in bottoms]


def hamming(a: np.ndarray, b: np.ndarray) -> int:
    h, w = max(a.shape[0], b.shape[0]), max(a.shape[1], b.shape[1])
    pa = np.zeros((h, w), np.uint8); pa[:a.shape[0], :a.shape[1]] = a
    pb = np.zeros((h, w), np.uint8); pb[:b.shape[0], :b.shape[1]] = b
    return int((pa != pb).sum())


def build_font(raw: dict) -> list[tuple[str, np.ndarray]]:
    out = []
    for ch, gl in raw.items():
        bm = np.array([1 if c == "1" else 0 for c in gl["bits"]], np.uint8)
        out.append((ch, bm.reshape(gl["h"], gl["w"])))
    return out


def match_glyph(g: np.ndarray, font):
    best = None
    for ch, t in font:
        if abs(t.shape[1] - g.shape[1]) > 1 or abs(t.shape[0] - g.shape[0]) > 1:
            continue
        d = hamming(g, t)
        if best is None or d < best[1]:
            best = (ch, d, t)
    if best is None:
        return None
    area = max(g.size, best[2].size)
    ratio = best[1] / area
    if ratio > MAX_GLYPH_DIST:
        return None
    return best[0], best[1], ratio


def read_roi(m_full: np.ndarray, roi, font):
    x, y, w, h = roi
    m = m_full[y:y + h, x:x + w]
    groups = group(segment(m))
    if not groups:
        return "", 0, 0
    pick = groups[0]
    for gr in groups[1:]:
        if len(gr) > len(pick):
            pick = gr

    cuts = [c for c in (cut(m, a, b) for a, b in pick) if c is not None]
    if not cuts:
        return "", 0, 0
    deco = mark_decorations(cuts)

    text, unknown, decorations = "", 0, 0
    for (bm, _top), is_deco in zip(cuts, deco):
        if is_deco:
            decorations += 1
            continue
        hit = match_glyph(bm, font)
        if hit is None:
            unknown += 1
            continue
        text += hit[0]
    return text, unknown, decorations


def parse_value(name: str, text: str):
    s = text.replace("^", "")
    if name == "Cooldown Reduction":
        ints = re.findall(r"\d+", s)
        return [int(ints[0]), int(ints[1])] if len(ints) >= 2 else None
    nums = re.findall(r"-?[\d,]*\.?\d+", s)
    if not nums:
        return None
    chosen = max(nums, key=lambda t: len(t.replace(",", "").replace(".", "")))
    return float(chosen.replace(",", ""))


def find_anchor(m_full: np.ndarray, anchor: dict):
    tpl = np.array([1 if c == "1" else 0 for c in anchor["bits"]], np.uint8)
    tpl = tpl.reshape(anchor["h"], anchor["w"])
    res = cv2.matchTemplate(m_full.astype(np.float32), tpl.astype(np.float32), cv2.TM_SQDIFF)
    # Inputs are 0/1, so SQDIFF is a count of differing pixels. It comes back as
    # float32 though, so a perfect match reads as ~3e-05 rather than exactly 0 —
    # round before comparing or an exact match looks like a failure.
    mn = int(round(float(res.min())))
    ys, xs = np.where(res <= res.min() + 0.5)
    near = int((res <= tpl.size * 0.02).sum())
    return (int(xs[0]), int(ys[0])), mn, near


def main() -> None:
    glyphs = load_js_object(WEB / "js" / "glyphs.js", "GLYPHS")
    layout = load_js_object(WEB / "js" / "layout.js", "LAYOUT")
    stat_font = build_font(glyphs["stat"])

    failures = 0

    for sample in ["stat_window_with_matt", "stat_window_with_int", "stat_window_with_luk"]:
        img = cv2.imread(str(SAMPLES / f"{sample}.png"))
        if img is None:
            print(f"[skip] {sample}.png not found")
            continue
        m_full = mask(img, "stat")
        print("=" * 72)
        print(sample)

        # --- anchors ---
        for key, panel in sorted(layout.items()):
            (ax, ay), dist, near = find_anchor(m_full, panel["anchor"])
            want = EXPECTED_ANCHORS.get(key)
            ok = (ax, ay) == want and dist == 0 and near == 1
            if not ok:
                failures += 1
            print(f"  {'OK ' if ok else 'FAIL'} anchor {key:11s} at ({ax},{ay}) "
                  f"dist={dist:.0f} near={near} want={want}")

        # --- values ---
        rois = layout["statWindow"]["rois"]
        ax, ay = find_anchor(m_full, layout["statWindow"]["anchor"])[0]
        for name, expected in EXPECTED.items():
            dx, dy, w, h = rois[name]
            text, unknown, deco = read_roi(m_full, [ax + dx, ay + dy, w, h], stat_font)
            got = parse_value(name, text)
            if isinstance(expected, list):
                ok = got == expected
            else:
                ok = got is not None and abs(got - expected) < 1e-9
            if not ok or unknown:
                failures += 1
            flag = "OK " if (ok and not unknown) else "FAIL"
            extra = f" unknown={unknown}" if unknown else ""
            if deco:
                extra += f" [{deco} arrow]"
            print(f"  {flag} {name:30s} raw={text!r:20s} -> {got!r:14s} want={expected!r}{extra}")

    print("=" * 72)
    if failures:
        print(f"{failures} FAILURES")
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()
