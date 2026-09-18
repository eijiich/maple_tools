"""OCR HEXA Matrix levels using ROIs from hexa_calibrate.py.

Run hexa_calibrate.py once to define the ROIs, then this script crops each
saved ROI from the screenshot and OCRs it with tesseract.

Usage:
    python hexa_ocr.py                          # uses samples/hexa_matrix.png
    python hexa_ocr.py path/to/shot.png         # different screenshot
    python hexa_ocr.py path/to/shot.png --debug # crops + per-PSM raw text +
                                                # annotated overlay
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np
import pytesseract

HERE = Path(__file__).parent
REGIONS_PATH = HERE / "hexa_regions.json"

# Indices into the 14-slot website hexa grid that don't exist in the global game.
# Calibrator output already in site order; this just maps N user-ordered values
# back into the 14-slot grid with nulls at locked positions.
LOCKED_SITE_INDICES = [10, 11, 12]

# MapleStory's stylized digits get misread as similar-looking letters; map back.
LETTER_TO_DIGIT = str.maketrans({
    "O": "0", "o": "0",
    "I": "1", "l": "1", "i": "1",
    "Z": "2", "z": "2",
    "S": "5", "s": "5",
    "G": "6", "b": "6",
    "T": "7",
    "B": "8",
    "g": "9", "q": "9",
})
WHITELIST = "0123456789OoIliZzSsGbTBgq"


def _pad(binary: np.ndarray, pad: int = 25) -> np.ndarray:
    return cv2.copyMakeBorder(binary, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=255)


def _upscale(image: np.ndarray, factor: int = 6) -> np.ndarray:
    return cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)


def preprocess_hsv(image: np.ndarray) -> np.ndarray:
    """Fixed HSV mask. Works well on dark-fill hexes (most of them) but eats
    vertical strokes on bright-fill hexes."""
    img = _upscale(image)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array([0, 0, 160]), np.array([180, 80, 255]))
    return _pad(cv2.bitwise_not(mask))


def preprocess_otsu(image: np.ndarray) -> np.ndarray:
    """Otsu auto-threshold. Adapts to per-crop brightness, good for bright-fill."""
    img = _upscale(image)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return _pad(cv2.bitwise_not(mask))


def preprocess_adaptive(image: np.ndarray) -> np.ndarray:
    """Adaptive (local) threshold — handles strong fill-color gradients."""
    img = _upscale(image)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    mask = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, -15
    )
    return _pad(cv2.bitwise_not(mask))


# Two independent preprocessors with equal weight. Adaptive was dropped because
# its binaries correlate with HSV's and ended up double-voting. HSV nails the
# common "30" badges; Otsu picks up cases where HSV misreads (e.g. stylized
# "9" → "s"). The no-whitelist pass is the real workhorse for Otsu — without
# it, the whitelist suppresses correct reads.
PREPROCESSORS = {
    "hsv":  (preprocess_hsv,  1),
    "otsu": (preprocess_otsu, 1),
}


def preprocess_badge(image: np.ndarray) -> np.ndarray:
    """Default preprocessing (HSV) — kept for backward compat / single-pass debug."""
    return preprocess_hsv(image)


def _candidates_from_text(cleaned: str) -> list[int]:
    """Pull plausible level values (0-30) out of an OCR string.

    For numbers > 30 (OCR added a leading or trailing digit), vote for BOTH
    first-2 and last-2 slices so the voting can disambiguate (e.g. "230" votes
    for 23 AND 30; "320" votes for 32 AND 20). Skip "00" which usually
    means we sliced a real "30"/"20" rather than legitimate level 0.
    """
    out: list[int] = []
    for n_str in re.findall(r"\d+", cleaned):
        n = int(n_str)
        if n <= 30:
            out.append(n)
            continue
        if len(n_str) < 2:
            continue
        seen_slices: set[str] = set()
        for slice_str in (n_str[:2], n_str[-2:]):
            if slice_str in seen_slices or slice_str == "00":
                continue
            seen_slices.add(slice_str)
            v = int(slice_str)
            if v <= 30:
                out.append(v)
    return out


def ocr_level(
    crop: np.ndarray, method: str = "auto",
) -> tuple[int | None, list[tuple[str, int, str, str, str]]]:
    """Read a level number from a badge crop.

    `method` selects the preprocessor strategy:
      - "auto": run all preprocessors × PSMs × whitelist modes, vote.
      - "hsv" or "otsu": run only that preprocessor (still all PSMs and both
        whitelist modes). Use this when a hex's background color is known and
        consistent so one preprocessor is always correct for it.

    Returns (winner, attempts) where attempts is a list of
    (preprocessor_name, psm, whitelist_tag, raw_text, cleaned_text).
    """
    from collections import Counter

    if method == "auto":
        active_preprocessors = list(PREPROCESSORS.items())
    elif method in PREPROCESSORS:
        active_preprocessors = [(method, PREPROCESSORS[method])]
    else:
        raise ValueError(f"unknown OCR method {method!r}; expected one of "
                         f"'auto', {list(PREPROCESSORS.keys())}")

    attempts: list[tuple[str, int, str, str, str]] = []
    votes: Counter[int] = Counter()
    whitelist_modes = [
        ("wl", f"-c tessedit_char_whitelist={WHITELIST}"),
        ("free", ""),
    ]
    for prep_name, (prep_fn, weight) in active_preprocessors:
        pre = prep_fn(crop)
        for psm in (7, 8, 13):
            for wl_tag, wl_config in whitelist_modes:
                raw = pytesseract.image_to_string(
                    pre, config=f"--psm {psm} {wl_config}"
                ).strip()
                cleaned = raw.translate(LETTER_TO_DIGIT)
                attempts.append((prep_name, psm, wl_tag, raw, cleaned))
                for val in _candidates_from_text(cleaned):
                    votes[val] += weight

    if not votes:
        return None, attempts
    winner = max(votes.items(), key=lambda kv: (kv[1], kv[0]))[0]
    return winner, attempts


def to_site_slots(game_levels: list[int | None]) -> list[int | None]:
    result: list[int | None] = [None] * 14
    game_idx = 0
    for site_idx in range(14):
        if site_idx in LOCKED_SITE_INDICES:
            continue
        if game_idx < len(game_levels):
            result[site_idx] = game_levels[game_idx]
            game_idx += 1
    return result


def annotate(image: np.ndarray, regions, game_levels) -> np.ndarray:
    """Draw each ROI on a copy of the screenshot with the value tesseract read.
    Green = read a value; red = returned null."""
    out = image.copy()
    bounds = regions.get("matrix_bounds")
    if bounds:
        mx, my, mw, mh = bounds
        cv2.rectangle(out, (mx, my), (mx + mw, my + mh), (255, 200, 0), 2)
    for i, (roi, level) in enumerate(zip(regions["skill_rois"], game_levels)):
        if roi is None:
            continue
        x, y, w, h = roi
        color = (0, 255, 0) if level is not None else (0, 0, 255)
        cv2.rectangle(out, (x, y), (x + w, y + h), color, 2)
        label = f"{i}:{level if level is not None else '?'}"
        cv2.putText(out, label, (x, max(0, y - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)
    # Crop to the matrix area so the saved PNG is readable
    if bounds:
        mx, my, mw, mh = bounds
        pad = 30
        x0, y0 = max(0, mx - pad), max(0, my - pad)
        x1 = min(out.shape[1], mx + mw + pad)
        y1 = min(out.shape[0], my + mh + pad)
        return out[y0:y1, x0:x1]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("screenshot", type=Path, nargs="?",
                    default=HERE / "samples" / "hexa_matrix.png")
    ap.add_argument("--debug", action="store_true",
                    help="dump per-ROI crops, raw OCR per PSM, and annotated overlay")
    ap.add_argument("--methods", action="store_true",
                    help="print a side-by-side table of what each preprocessor "
                         "returns for each skill — use to pick the right method "
                         "per ROI group")
    args = ap.parse_args()

    if not REGIONS_PATH.exists():
        sys.exit(f"missing {REGIONS_PATH} — run `python hexa_calibrate.py` first")

    regions = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
    skill_rois: list[list[int] | None] = regions["skill_rois"]
    # Optional per-skill OCR method. Falls back to "auto" (voting) per slot
    # if omitted or missing for that index. Add to hexa_regions.json like:
    #   "skill_methods": ["hsv","hsv","hsv","hsv","otsu","otsu","hsv","hsv","hsv","hsv","otsu"]
    skill_methods: list[str] = regions.get("skill_methods") or []

    img = cv2.imread(str(args.screenshot))
    if img is None:
        sys.exit(f"can't read {args.screenshot}")

    debug_dir = HERE / "samples" / "hexa_debug"
    if args.debug:
        debug_dir.mkdir(parents=True, exist_ok=True)
        for old in debug_dir.glob("*"):
            old.unlink()

    game_levels: list[int | None] = []
    debug_rows: list[str] = []
    for i, roi in enumerate(skill_rois):
        if roi is None:
            game_levels.append(None)
            debug_rows.append(f"S{i:02d} [skipped]")
            continue
        x, y, w, h = roi
        crop = img[y : y + h, x : x + w]
        if crop.size == 0:
            game_levels.append(None)
            debug_rows.append(f"S{i:02d} EMPTY CROP at ({x},{y},{w}x{h})")
            continue
        method = skill_methods[i] if i < len(skill_methods) and skill_methods[i] else "auto"
        level, attempts = ocr_level(crop, method=method)
        game_levels.append(level)
        if args.debug:
            cv2.imwrite(str(debug_dir / f"S{i:02d}_crop.png"), crop)
            for prep_name, (prep_fn, _) in PREPROCESSORS.items():
                cv2.imwrite(str(debug_dir / f"S{i:02d}_pre_{prep_name}.png"), prep_fn(crop))
            attempt_strs = " | ".join(
                f"{prep}/psm{psm}/{wl}: raw={raw!r} clean={cleaned!r}"
                for prep, psm, wl, raw, cleaned in attempts
            )
            debug_rows.append(f"S{i:02d} ({method}) = {level}\n    {attempt_strs}")

    if args.debug:
        cv2.imwrite(str(debug_dir / "_annotated.png"), annotate(img, regions, game_levels))
        for row in debug_rows:
            print(row, file=sys.stderr)
        print("", file=sys.stderr)

    if args.methods:
        print("\nPer-method results (helps choose skill_methods per group):", file=sys.stderr)
        method_names = ["auto", *PREPROCESSORS.keys()]
        header = f"{'slot':<6}" + "".join(f"{m:>10}" for m in method_names)
        print(header, file=sys.stderr)
        print("-" * len(header), file=sys.stderr)
        for i, roi in enumerate(skill_rois):
            if roi is None:
                print(f"S{i:02d}   {'<skipped>':>10}", file=sys.stderr)
                continue
            x, y, w, h = roi
            crop = img[y : y + h, x : x + w]
            if crop.size == 0:
                continue
            cells = []
            for m in method_names:
                v, _ = ocr_level(crop, method=m)
                cells.append(f"{'-' if v is None else v!s:>10}")
            print(f"S{i:02d}   " + "".join(cells), file=sys.stderr)
        print("", file=sys.stderr)

    site_slots = to_site_slots(game_levels)
    print(json.dumps({
        "hexa_game_order": game_levels,
        "hexa_site_slots": site_slots,
    }, indent=2))


if __name__ == "__main__":
    main()
