#!/usr/bin/env python3
"""
maple_item_extractor.py

Template-based star detection + OCR-based text extraction for MapleStory item screenshots.

Usage:
  python maple_item_extractor.py --image item.png \
    --filled-template star_filled.png \
    --empty-template star_empty.png \
    --debug

If empty-template is not provided, the script will attempt to detect total star slots
by contour detection in the top bar.

Outputs:
  - prints JSON to stdout
  - writes item.json in the same folder as the input image
  - if --debug, writes debug_*.png images to show detections
"""

import argparse
import json
from pathlib import Path
from typing import List, Tuple, Dict, Optional

import cv2
import numpy as np
import pytesseract
import re
import math
import sys

# -------------------------
# Utility: Non-Max Suppression
# -------------------------
def non_max_suppression(boxes: List[Tuple[int,int,int,int]], scores: List[float], iou_thresh: float = 0.3) -> List[int]:
    """
    boxes: list of (x,y,w,h)
    scores: list of scores (same length)
    returns: indices of boxes kept
    """
    if len(boxes) == 0:
        return []

    arr = np.array([[x, y, x + w, y + h] for (x, y, w, h) in boxes], dtype=float)
    scores = np.array(scores, dtype=float)
    x1 = arr[:, 0]
    y1 = arr[:, 1]
    x2 = arr[:, 2]
    y2 = arr[:, 3]
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]

    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])

        w = np.maximum(0.0, xx2 - xx1 + 1)
        h = np.maximum(0.0, yy2 - yy1 + 1)
        inter = w * h
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-9)

        inds = np.where(iou <= iou_thresh)[0]
        order = order[inds + 1]

    return keep

# -------------------------
# Template matching helper
# -------------------------
def match_template_with_mask(image_bgr: np.ndarray, template_path: Path, threshold: float = 0.8) -> List[Tuple[int,int,int,int,float]]:
    """
    Performs template matching using a template that may have alpha channel.
    Returns list of (x, y, w, h, score)
    """
    template = cv2.imread(str(template_path), cv2.IMREAD_UNCHANGED)
    if template is None:
        return []

    # Split alpha if present
    if template.shape[2] == 4:
        templ_rgb = template[:, :, :3]
        templ_alpha = template[:, :, 3]
        _, mask = cv2.threshold(templ_alpha, 1, 255, cv2.THRESH_BINARY)
        # matchTemplate requires template and image to be same depth
        img_for_match = image_bgr.copy()
        # matchTemplate with mask only works with TM_CCOEFF_NORMED and CV >= 3.2
        method = cv2.TM_CCOEFF_NORMED
        try:
            res = cv2.matchTemplate(img_for_match, templ_rgb, method, mask=mask)
        except TypeError:
            # Some OpenCV builds don't accept mask; fallback to grayscale matching
            templ_gray = cv2.cvtColor(templ_rgb, cv2.COLOR_BGR2GRAY)
            img_gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
            res = cv2.matchTemplate(img_gray, templ_gray, cv2.TM_CCOEFF_NORMED)
    else:
        templ_rgb = template
        # no mask
        img_for_match = image_bgr.copy()
        res = cv2.matchTemplate(img_for_match, templ_rgb, cv2.TM_CCOEFF_NORMED)

    h, w = templ_rgb.shape[:2]
    loc = np.where(res >= threshold)
    boxes = []
    scores = []
    for (y, x) in zip(*loc):
        # score is res[y,x]
        score = float(res[y, x])
        boxes.append((int(x), int(y), int(w), int(h)))
        scores.append(score)

    # Apply NMS
    keep_idx = non_max_suppression(boxes, scores, iou_thresh=0.3)
    results = []
    for idx in keep_idx:
        x, y, wi, hi = boxes[idx]
        results.append((x, y, wi, hi, scores[idx]))
    return results

# -------------------------
# Fallback: detect star slots by contour detection of small icons in top area
# -------------------------
def detect_star_slots_by_contours(image_bgr: np.ndarray, top_frac: float = 0.0, bottom_frac: float = 0.12) -> List[Tuple[int,int,int,int]]:
    h, w = image_bgr.shape[:2]
    y1 = int(h * top_frac)
    y2 = int(h * bottom_frac)
    crop = image_bgr[y1:y2, :]
    if crop.size == 0:
        return []

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    # pick bright / high-saturation ranges to capture icons (tune if needed)
    lower = np.array([0, 0, 120])
    upper = np.array([180, 255, 255])
    mask = cv2.inRange(hsv, lower, upper)
    # morphological clean
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3,3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        area = cv2.contourArea(c)
        # heuristics for icon-like shape
        if 6 <= cw <= 80 and 6 <= ch <= 80 and area > 20:
            # convert to global coordinates
            boxes.append((x, y + y1, cw, ch))
    # Sort left-to-right
    boxes = sorted(boxes, key=lambda b: b[0])
    return boxes

# -------------------------
# OCR helpers
# -------------------------
def ocr_crop(image_bgr: np.ndarray, top_frac: float, bottom_frac: float, scale: float = 2.0, psm: int = 6, whitelist: Optional[str]=None) -> str:
    h, w = image_bgr.shape[:2]
    y1 = int(h * top_frac)
    y2 = int(h * bottom_frac)
    crop = image_bgr[y1:y2, :]
    if crop.size == 0:
        return ""
    # enlarge to help OCR
    crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    # a small blur helps sometimes
    gray = cv2.medianBlur(gray, 3)
    # adaptive thresholding often helps on UI text
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    config = f'--oem 3 --psm {psm}'
    if whitelist:
        config += f" -c tessedit_char_whitelist={whitelist}"
    try:
        text = pytesseract.image_to_string(th, config=config)
    except Exception:
        # fallback to raw gray
        text = pytesseract.image_to_string(gray, config=config)
    return text.strip()

# -------------------------
# Parsing utilities
# -------------------------
def parse_stats_and_potential(header_text: str, body_text: str) -> Dict:
    # Combine normalized text
    lines = [ln.strip() for ln in (header_text + "\n" + body_text).splitlines() if ln.strip()]
    text = "\n".join(lines)
    parsed = {}
    # Name usually first header line
    parsed['name'] = lines[0] if lines else ""

    # Item type guess
    m_type = re.search(r"\b(Armor|Weapon|Accessory)\b", text, re.IGNORECASE)
    subtype = re.search(r"\b(Top|Bottom|Hat|Gloves|Shoes|Cape|Robe|Armour|Armor Top|Armor Bottom)\b", text, re.IGNORECASE)
    item_type = []
    if m_type:
        item_type.append(m_type.group(1).capitalize())
    if subtype:
        item_type.append(subtype.group(1).capitalize())
    parsed['item_type'] = " ".join(item_type) if item_type else "Unknown"

    # Potential tier
    pot_tier = None
    # many UIs show "Potential" then tier word like Epic on next line or same line
    m_p = re.search(r"Potential[:\s-]*\n?\s*([A-Za-z]+)", text, re.IGNORECASE)
    if m_p:
        pot_tier = m_p.group(1).strip().capitalize()
    parsed['potential_tier'] = pot_tier or "None"

    # Potential lines: get up to 4 lines after the 'Potential' marker
    pot_lines = []
    for i, ln in enumerate(lines):
        if "potential" in ln.lower():
            for j in range(i + 1, min(i + 5, len(lines))):
                if lines[j] and not re.search(r"(required|set|equip|level)", lines[j], re.IGNORECASE):
                    pot_lines.append(lines[j])
            break
    parsed['potential_lines'] = pot_lines

    # Stats patterns
    stats = {}
    def find_first(pats):
        for p in pats:
            m = re.search(p, text, re.IGNORECASE)
            if m:
                return m.group(1).replace(",", "")
        return None

    stats_patterns = {
        "INT": [r"INT[:\s]*\+?([0-9,]+)"],
        "LUK": [r"LUK[:\s]*\+?([0-9,]+)"],
        "All Stats": [r"All Stats[:\s]*\+?([0-9]+%)", r"All Stats[:\s]*\+?([0-9]+) %"],
        "Max HP": [r"Max HP[:\s]*\+?([0-9,]+)"],
        "Max MP": [r"Max MP[:\s]*\+?([0-9,]+)"],
        "Magic ATT": [r"Magic ATT[:\s]*\+?([0-9,]+)", r"M\.ATT[:\s]*\+?([0-9,]+)"],
        "Defense": [r"Defense[:\s]*\+?([0-9,]+)"],
        "Enemy DEF Ignored": [r"Enemy DEF Ignored[:\s]*\+?([0-9]+%)", r"Enemy DEF[:\s]*Ignored[:\s]*\+?([0-9]+%)"]
    }

    for k, pats in stats_patterns.items():
        v = find_first(pats)
        if v:
            stats[k] = v

    parsed['stats'] = stats
    parsed['raw_lines'] = lines
    parsed['raw_text'] = text
    return parsed

# -------------------------
# Main flow
# -------------------------
def extract_item(image_path: Path,
                 filled_template: Optional[Path] = None,
                 empty_template: Optional[Path] = None,
                 debug: bool = False) -> Dict:
    image = cv2.imread(str(image_path))
    if image is None:
        raise FileNotFoundError(f"Could not read image: {image_path}")

    h, w = image.shape[:2]

    # 1) Template-match for filled stars
    filled_boxes = []
    if filled_template is not None and filled_template.exists():
        filled_matches = match_template_with_mask(image, filled_template, threshold=0.78)
        filled_boxes = [(x, y, wi, hi, sc) for x, y, wi, hi, sc in filled_matches]

    # 2) Template-match for empty stars (optional)
    empty_boxes = []
    if empty_template is not None and empty_template.exists():
        empty_matches = match_template_with_mask(image, empty_template, threshold=0.78)
        empty_boxes = [(x, y, wi, hi, sc) for x, y, wi, hi, sc in empty_matches]

    # 3) If empty_boxes empty, attempt contour-based detection for slots
    contour_slots = []
    if not empty_boxes:
        contour_boxes = detect_star_slots_by_contours(image, top_frac=0.0, bottom_frac=0.12)
        contour_slots = contour_boxes

    # Postprocess: infer star layout (slots and counts)
    # Prefer empty_box count if present, else use contour detection count, else derive slots by clustering filled boxes
    filled_count = len(filled_boxes)
    empty_count = len(empty_boxes)

    if empty_count > 0:
        # To compute current filled, we should only count filled boxes (filled template)
        # Some UI fonts use both templates; return sums accordingly
        total_slots = filled_count + empty_count
    elif len(contour_slots) > 0:
        # We have slot positions; now try to determine which of those slots are filled:
        # For each contour slot, sample the region and decide if filled by color (gold/yellow)
        total_slots = len(contour_slots)
        # sample each slot center
        filled_guess = 0
        for (x, y, wi, hi) in contour_slots:
            cx = int(x + wi / 2)
            cy = int(y + hi / 2)
            # small box around center
            sx1 = max(0, cx - max(1, wi//4))
            sy1 = max(0, cy - max(1, hi//4))
            sx2 = min(w, cx + max(1, wi//4))
            sy2 = min(h, cy + max(1, hi//4))
            roi = image[sy1:sy2, sx1:sx2]
            if roi.size == 0:
                continue
            hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
            # yellow/gold thresholds
            lower_y = np.array([10, 80, 120])
            upper_y = np.array([40, 255, 255])
            mask = cv2.inRange(hsv, lower_y, upper_y)
            filled_ratio = (mask > 0).sum() / float(max(1, roi.shape[0]*roi.shape[1]))
            if filled_ratio > 0.06:
                filled_guess += 1
        # If we also matched filled templates, prefer stronger evidence
        if filled_count > 0:
            # use filled template count (more precise)
            current = filled_count
        else:
            current = filled_guess
    else:
        # worst fallback: use filled template count and assume common max of 25
        total_slots = 25
        current = filled_count

    # if previous branches didn't set current:
    if 'current' not in locals():
        current = filled_count

    # If empty template found, more robust approach: treat empty boxes as slots and use filled template count as current
    if empty_count > 0:
        current = filled_count
        total_slots = max(total_slots, filled_count + empty_count)

    # Final safety:
    try:
        current = int(current)
        total_slots = int(total_slots)
    except Exception:
        current = filled_count
        total_slots = max(25, filled_count)

    # Debug image drawing
    if debug:
        dbg = image.copy()
        for (x, y, wi, hi, sc) in filled_boxes:
            cv2.rectangle(dbg, (x, y), (x+wi, y+hi), (0,255,0), 2)
        for (x, y, wi, hi, sc) in empty_boxes:
            cv2.rectangle(dbg, (x, y), (x+wi, y+hi), (255,0,0), 1)
        for (x, y, wi, hi) in contour_slots:
            cv2.rectangle(dbg, (x, y), (x+wi, y+hi), (0,0,255), 1)
        cv2.imwrite("debug_star_detections.png", dbg)

    # 4) OCR: crop header and body
    header_text = ocr_crop(image, 0.07, 0.22, scale=3.0, psm=7)
    body_text = ocr_crop(image, 0.20, 0.85, scale=2.0, psm=6)

    # Also attempt a "stats-only" run: sometimes finer threshold helps
    stats_text_extra = ocr_crop(image, 0.28, 0.75, scale=2.0, psm=6)

    parsed = parse_stats_and_potential(header_text, body_text + "\n" + stats_text_extra)

    # Build result
    result = {
        "name": parsed.get("name", ""),
        "item_type": parsed.get("item_type", ""),
        "stars": {
            "current": current,
            "detected_slots": total_slots,
            "max": 25  # choose 25 as a safe maplestory top cap default; you can change if you want 15
        },
        "stats": parsed.get("stats", {}),
        "potential": {
            "tier": parsed.get("potential_tier"),
            "lines": parsed.get("potential_lines", [])
        },
        "raw_ocr_header": header_text,
        "raw_ocr_body": body_text + "\n" + stats_text_extra
    }
    return result

# -------------------------
# CLI runner
# -------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, help="Path to the item screenshot")
    parser.add_argument("--filled-template", required=False, help="Path to filled-star template (png, keep alpha)")
    parser.add_argument("--empty-template", required=False, help="Path to empty-star template (optional)")
    parser.add_argument("--debug", action="store_true", help="Write debug images")
    args = parser.parse_args()

    image_path = Path(args.image)
    if not image_path.exists():
        print("Image not found:", image_path, file=sys.stderr)
        sys.exit(2)

    filled_template = Path(args.filled_template) if args.filled_template else None
    empty_template = Path(args.empty_template) if args.empty_template else None

    res = extract_item(image_path, filled_template, empty_template, debug=args.debug)
    out_path = image_path.parent / "item.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2, ensure_ascii=False)
    print(json.dumps(res, indent=2, ensure_ascii=False))
    print("Wrote", out_path)

if __name__ == "__main__":
    main()
