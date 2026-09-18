"""Interactive HEXA Matrix ROI calibrator.

Run once per resolution / UI layout. Workflow:
  1. Drag a box around the entire HEXA Matrix panel.
  2. Drag a box around each skill's level number, in the order you want them
     output (typically the order that matches the website's slot indices,
     skipping the 3 locked-in-global slots).
  3. ROIs save to hexa_regions.json. Re-run hexa_ocr.py to OCR using them.

Controls (during cv2.selectROI):
  - Drag with the mouse to draw a box.
  - Enter / Space to confirm.
  - C to cancel a draw and re-do.
  - ESC to skip this skill (saves null for that slot).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2

HERE = Path(__file__).parent
REGIONS_PATH = HERE / "hexa_regions.json"
DEFAULT_SKILL_COUNT = 11


def select_box(window_title: str, image, instruction: str) -> tuple[int, int, int, int] | None:
    print(f"\n>>> {instruction}", file=sys.stderr)
    print("    drag a box, Enter/Space to confirm, ESC to skip", file=sys.stderr)
    cv2.namedWindow(window_title, cv2.WINDOW_NORMAL)
    cv2.imshow(window_title, image)
    roi = cv2.selectROI(window_title, image, showCrosshair=True, fromCenter=False)
    cv2.destroyWindow(window_title)
    x, y, w, h = [int(v) for v in roi]
    if w == 0 or h == 0:
        return None
    return (x, y, w, h)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("screenshot", type=Path, nargs="?",
                    default=HERE / "samples" / "hexa_matrix.png")
    ap.add_argument("--count", type=int, default=DEFAULT_SKILL_COUNT,
                    help=f"number of skills to calibrate (default {DEFAULT_SKILL_COUNT})")
    args = ap.parse_args()

    img = cv2.imread(str(args.screenshot))
    if img is None:
        sys.exit(f"can't read {args.screenshot}")
    print(f"Loaded {args.screenshot}: {img.shape[1]}x{img.shape[0]}", file=sys.stderr)

    # Step 1 — matrix bounds
    matrix = select_box("Step 1: HEXA Matrix bounds", img,
                        "Drag a box around the whole HEXA Matrix panel.")
    if matrix is None:
        sys.exit("aborted: no matrix bounds selected")
    mx, my, mw, mh = matrix
    print(f"Matrix bounds: x={mx} y={my} w={mw} h={mh}", file=sys.stderr)

    # Crop for clarity in subsequent selections (faster + only shows the panel)
    matrix_crop = img[my : my + mh, mx : mx + mw].copy()

    # Step 2 — per-skill level ROIs
    print(f"\n>>> Now select {args.count} level-number boxes in slot order.", file=sys.stderr)
    print(">>> (Same order as the website fills them — skipping the locked slots.)", file=sys.stderr)
    skill_rois: list[list[int] | None] = []
    annotated = matrix_crop.copy()
    for i in range(args.count):
        roi = select_box(
            f"Step 2: Skill {i + 1}/{args.count} level box",
            annotated,
            f"Skill {i + 1}/{args.count}: drag a box around the level number.",
        )
        if roi is None:
            skill_rois.append(None)
            print(f"  Skill {i + 1}: skipped", file=sys.stderr)
            continue
        x, y, w, h = roi
        # Translate to original-image coordinates so the OCR step can crop directly.
        skill_rois.append([x + mx, y + my, w, h])
        cv2.rectangle(annotated, (x, y), (x + w, y + h), (0, 255, 0), 1)
        cv2.putText(annotated, str(i + 1), (x, max(0, y - 2)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1, cv2.LINE_AA)
        print(f"  Skill {i + 1}: [{x + mx}, {y + my}, {w}, {h}]", file=sys.stderr)

    # Show final overlay for visual confirmation
    cv2.imshow("Calibration done — close to save", annotated)
    print("\nClose the preview window to save.", file=sys.stderr)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    out = {
        "screen_resolution": [img.shape[1], img.shape[0]],
        "matrix_bounds": [mx, my, mw, mh],
        "skill_rois": skill_rois,
    }
    REGIONS_PATH.write_text(json.dumps(out, indent=2), encoding="utf-8")
    filled = sum(1 for r in skill_rois if r is not None)
    print(f"\nSaved {REGIONS_PATH} ({filled}/{args.count} ROIs).", file=sys.stderr)


if __name__ == "__main__":
    main()
