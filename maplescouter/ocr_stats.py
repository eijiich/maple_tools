"""OCR MapleStory full-screen screenshots into maplescouter input JSON.

Usage:
    python ocr_stats.py <img1> [img2 ...]
    python ocr_stats.py <img1> [img2 ...] --clipboard
    python ocr_stats.py <img1> --debug      # dump preprocessed crops + raw text

Pipeline:
  - Crop each ROI from regions.json (one per stat).
  - Preprocess (HSV mask: white + yellow text).
  - Tesseract with PSM 7 (single text line) for tight per-field crops, PSM 11
    for the Stat Info panel crop.
  - Parse a single number per ROI.

Multiple screenshots are merged. Single-value fields dedupe; table rows
accumulate one row per Stat Info panel.

Output: JSON to stdout. With --clipboard, also copies to OS clipboard.
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

from field_mapping import (
    SINGLE_VALUE_FIELDS,
    TABLE_STAT_ALIASES,
    normalize,
)

HERE = Path(__file__).parent
REGIONS_PATH = HERE / "regions.json"

NUMBER = r"(-?[\d,]+(?:\.\d+)?)"
COOLDOWN = r"(\d+)\s*sec\w*\s*[/.,]\s*(\d+)\s*%"


def to_number(s: str) -> float | int:
    s = s.replace(",", "").strip()
    return float(s) if "." in s else int(s)


def preprocess(image: np.ndarray, upscale: int = 4, white_v_min: int = 140, pad: int = 20) -> np.ndarray:
    """HSV mask for white + yellow text, return black-text-on-white binary.

    A white border of `pad` pixels is added around the result — tesseract is
    known to misread digits on tight crops because it expects whitespace
    context, so we give it some.
    """
    image = cv2.resize(image, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    white = cv2.inRange(hsv, np.array([0, 0, white_v_min]), np.array([180, 60, 255]))
    yellow = cv2.inRange(hsv, np.array([15, 80, 150]), np.array([35, 255, 255]))
    mask = cv2.bitwise_or(white, yellow)
    inverted = cv2.bitwise_not(mask)
    if pad > 0:
        inverted = cv2.copyMakeBorder(inverted, pad, pad, pad, pad,
                                       cv2.BORDER_CONSTANT, value=255)
    return inverted


def remove_left_indicator(binary: np.ndarray) -> np.ndarray:
    """Erase a leftmost isolated component if it looks like the '▲' upgrade arrow.

    MapleStory's UI prefixes upgraded values with a small triangle indicator.
    Tesseract misreads it as 2, -, *, or fuses it to the leading digit. We detect
    it as: the leftmost connected component, smaller than the next one over,
    with a clear gap between them. Paint it white when matched.
    """
    inv = cv2.bitwise_not(binary)
    n, _, stats, _ = cv2.connectedComponentsWithStats(inv)
    if n < 3:
        return binary
    comps = [tuple(stats[i]) for i in range(1, n)]
    comps.sort(key=lambda c: c[0])  # ascending x
    lx, ly, lw, lh, _ = comps[0]
    nx, _, _, next_h, _ = comps[1]
    gap = nx - (lx + lw)
    # Two conditions identify the arrow without eating thin digits:
    # - meaningful gap between leftmost and the rest
    # - leftmost is much shorter than the next component (arrow is ~half-height;
    #   even thin digits like '1' keep full height)
    if gap > lw // 2 and lh < next_h * 0.7:
        binary = binary.copy()
        binary[ly : ly + lh, lx : lx + lw] = 255
    return binary


def ocr_text(image: np.ndarray, psm: int = 7, digits_only: bool = False) -> str:
    config = f"--psm {psm}"
    if digits_only:
        config += " -c tessedit_char_whitelist=0123456789,.%"
    return pytesseract.image_to_string(image, config=config)


def crop(image: np.ndarray, roi: list[int]) -> np.ndarray:
    x, y, w, h = roi
    return image[y : y + h, x : x + w]


# ---------- per-ROI value parsing ----------

PERCENT_FIELDS = {
    "Damage", "Boss Damage", "Final Damage", "Normal Enemy Damage",
    "Ignore Enemy Defense", "Critical Rate", "Critical Damage",
    "Cooldown Reduction", "Cooldown Skip", "Buff Duration",
    "Ignore Elemental Resistance", "Additional Status Damage", "Summon Duration",
}

FIELD_MAX = {
    "Critical Rate": 100,
    "Final Damage": 100,
    "Ignore Enemy Defense": 100,
    "Ignore Elemental Resistance": 100,
    "Cooldown Reduction": 100,
    "Cooldown Skip": 100,
    "Additional Status Damage": 100,
    "Summon Duration": 100,
}
DEFAULT_FIELD_MAX = 500


def fix_arrow_prefix(value, site_label):
    """Strip a stray leading '2' from a percent value if it exceeds the field's max
    (OCR may misread the '▲' upgrade arrow as the digit 2)."""
    if site_label not in PERCENT_FIELDS or not isinstance(value, (int, float)):
        return value
    cap = FIELD_MAX.get(site_label, DEFAULT_FIELD_MAX)
    if value <= cap:
        return value
    s = f"{int(value)}" if value == int(value) else f"{value}"
    if s.startswith("2"):
        try:
            stripped = to_number(s[1:])
            if stripped <= cap:
                return stripped
        except ValueError:
            pass
    return value


def parse_value(text: str, field_name: str) -> float | int | None:
    """Extract a single number from a per-ROI OCR result.

    Tight ROIs should yield one number per crop, but tesseract often emits stray
    glyphs around it (e.g. '* 280,714,414 0D'). We pick the longest detected
    number — robust to leading/trailing noise.
    """
    if field_name == "Cooldown Reduction":
        # Format is "<sec> sec / <percent>%". OCR can mangle the separator, so
        # just take the second integer we find.
        nums = re.findall(r"\d+", text)
        if len(nums) >= 2:
            return int(nums[1])
        if nums:
            return int(nums[0])
        return None
    nums = re.findall(NUMBER, text)
    if not nums:
        return None
    chosen = max(nums, key=lambda s: len(s.replace(",", "").replace(".", "")))
    value = to_number(chosen)
    if field_name in PERCENT_FIELDS and isinstance(value, (int, float)) and value < 0:
        value = -value
    return fix_arrow_prefix(value, field_name)


def parse_class(text: str) -> str | None:
    """Extract a class name from a Character Info crop. Returns first alpha word
    only, so trailing noise like 'Bishop e' becomes just 'Bishop'.
    """
    m = re.search(r"[A-Za-z][A-Za-z.]+", text)
    return m.group(0) if m else None


# ---------- Stat Info panel parsing (re-used from before) ----------

_VALUE_LINE = re.compile(r"^[+\-]?[\d,]+(?:\.\d+)?%?$")


def parse_stat_info(text: str) -> dict | None:
    """Extract {stat, base, percent, not_applied} from Stat Info panel text.

    Title detection: scan lines for known stat aliases (description format varies
    by stat — 'Displays the X of' for Magic ATT, 'X is a very important stat for
    Magician jobs' for INT, etc — so we look for the alias directly).

    Value extraction: the OCR mangles 'Base Value', '% Value', '% Value Not Applied'
    badly enough that label-anchored search fails. Instead we collect every
    number-only line in vertical order — they appear as Current, Base, %, % Not
    Applied — and use the '%' suffix on row 3 to anchor the layout.
    """
    title = None
    for line in text.splitlines():
        for alias, key in TABLE_STAT_ALIASES.items():
            if alias in normalize(line):
                title = key
                break
        if title:
            break
    if title is None:
        return None

    # Strip OCR fluff and trailing spaces, then keep only lines that look like a number.
    candidates: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        compact = re.sub(r"\s+", "", line)
        if _VALUE_LINE.match(compact):
            candidates.append(compact)

    if not candidates:
        return {"stat": title, "base": None, "percent": None, "not_applied": 0}

    # Find the '%' row — it's the only one with a percent suffix and it sits
    # between Base (row above) and % Not Applied (row below).
    percent_idx = next((i for i, s in enumerate(candidates) if s.endswith("%")), None)

    def at(idx: int):
        if idx is None or idx < 0 or idx >= len(candidates):
            return None
        return to_number(candidates[idx].rstrip("%"))

    if percent_idx is None:
        # No % row detected — fall back to positional [Current, Base, ?, ?]
        return {
            "stat": title,
            "base": at(1),
            "percent": None,
            "not_applied": at(3) or 0,
        }

    return {
        "stat": title,
        "base": at(percent_idx - 1),
        "percent": at(percent_idx),
        "not_applied": at(percent_idx + 1) or 0,
    }


# ---------- screenshot processing ----------

def load_regions() -> dict[str, list[int]]:
    raw = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if isinstance(v, list) and len(v) == 4}


def process_screenshot(path: Path, regions: dict, debug_dir: Path | None = None) -> dict:
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(path)

    out = {"fields": {}, "table": None, "character": {}}

    for name, roi in regions.items():
        region = crop(image, roi)
        if region.size == 0:
            continue

        if name == "StatInfo:Panel":
            pre = preprocess(region, white_v_min=140)
            text = ocr_text(pre, psm=11)
            info = parse_stat_info(text)
            if info:
                out["table"] = info
            if debug_dir is not None:
                _dump_debug(debug_dir, path.stem, name, pre, text)
            continue

        pre = preprocess(region, white_v_min=180)

        if name == "Character:Class":
            text = ocr_text(pre, psm=7)
            cls = parse_class(text)
            if cls:
                out["character"]["class"] = cls
        elif name == "Character:Level":
            text = ocr_text(pre, psm=7)
            nums = re.findall(NUMBER, text)
            if nums:
                out["character"]["level"] = int(to_number(max(nums, key=len)))
        else:
            # Strip the "▲" upgrade arrow before OCR — fixes wrong leading digits
            # on upgraded values (Damage, Magic ATT, Critical Rate, etc.).
            pre = remove_left_indicator(pre)
            text = ocr_text(pre, psm=7)

            if name == "Cooldown Reduction":
                # Format "X sec / Y%" — emit both as separate fields.
                nums = re.findall(r"\d+", text)
                if len(nums) >= 2:
                    out["fields"]["Cooldown Reduction (sec)"] = int(nums[0])
                    out["fields"]["Cooldown Reduction (%)"] = int(nums[1])
                elif nums:
                    out["fields"]["Cooldown Reduction (%)"] = int(nums[0])
            else:
                value = parse_value(text, name)
                if value is not None:
                    out["fields"][name] = value

        if debug_dir is not None:
            _dump_debug(debug_dir, path.stem, name, pre, text)

    return out


def _dump_debug(debug_dir: Path, stem: str, name: str, pre, text: str) -> None:
    debug_dir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", name)
    cv2.imwrite(str(debug_dir / f"{stem}__{safe}.pre.png"), pre)
    (debug_dir / f"{stem}__{safe}.txt").write_text(text, encoding="utf-8")


def merge_screenshots(paths: list[Path], regions: dict, debug: bool = False) -> dict:
    """Merge results from N screenshots into the final JSON shape.

    Output:
        {
          "character": {class, level}
          "table":     table-stat-name -> {base, percent, not_applied}
          "single":    site-field-name -> value     (only fields the site accepts)
          "extras":    other OCR'd values (sanity / non-form)
        }
    """
    single: dict = {}
    table: dict = {}
    character: dict = {}
    extras: dict = {}

    site_single_fields = set(SINGLE_VALUE_FIELDS.values())
    site_single_fields.discard("Cooldown Reduction")  # site has 2 inputs, see below
    site_single_fields.update({"Cooldown Reduction (sec)", "Cooldown Reduction (%)"})

    debug_dir = HERE / "samples" / "debug" if debug else None

    for p in paths:
        res = process_screenshot(p, regions, debug_dir=debug_dir)
        for field, value in res["fields"].items():
            if field in site_single_fields:
                single[field] = value
            else:
                extras[field] = value
        if res["table"]:
            stat = res["table"]["stat"]
            table[stat] = {
                "base": res["table"]["base"],
                "percent": res["table"]["percent"],
                "not_applied": res["table"]["not_applied"],
            }
        for k, v in res["character"].items():
            if v is not None:
                character[k] = v

    return {"character": character, "table": table, "single": single, "extras": extras}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("screenshots", nargs="+", type=Path)
    ap.add_argument("--clipboard", action="store_true")
    ap.add_argument("--debug", action="store_true",
                    help="dump preprocessed crops + raw OCR text to samples/debug/")
    args = ap.parse_args()

    regions = load_regions()
    result = merge_screenshots(args.screenshots, regions, debug=args.debug)
    out = json.dumps(result, indent=2)
    print(out)
    if args.clipboard:
        try:
            import pyperclip
            pyperclip.copy(out)
            print("[copied to clipboard]", file=sys.stderr)
        except ImportError:
            print("[install pyperclip for --clipboard]", file=sys.stderr)


if __name__ == "__main__":
    main()
