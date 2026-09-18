"""Pixel-precise fine-tuning of hexa_regions.json.

Opens a window showing the matrix area with every saved ROI drawn, plus a
zoomed view of the currently-selected ROI on the right. Use the keyboard to
nudge or resize the active ROI one pixel at a time. Save when done.

Controls:
  w / a / s / d   move ROI up / left / down / right  (1 px)
  W / A / S / D   move by 5 px (uppercase = with shift)
  e / c           grow / shrink width                (1 px)
  r / f           grow / shrink height               (1 px)
  n / p           next / previous skill
  Enter           save changes to hexa_regions.json
  ESC or q        quit (warns if unsaved)

Run hexa_calibrate.py first if hexa_regions.json doesn't exist.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
REGIONS_PATH = HERE / "hexa_regions.json"

ZOOM_FACTOR = 12
MATRIX_VIEW_SCALE = 2
PAD = 50

ACTIVE_COLOR = (0, 255, 255)   # cyan
INACTIVE_COLOR = (60, 200, 60)  # green
SKIPPED_COLOR = (60, 60, 200)   # red


def build_canvas(
    img: np.ndarray,
    rois: list[list[int] | None],
    current: int,
    matrix_bounds: list[int],
    saved: bool,
) -> np.ndarray:
    mx, my, mw, mh = matrix_bounds
    x0 = max(0, mx - PAD)
    y0 = max(0, my - PAD)
    x1 = min(img.shape[1], mx + mw + PAD)
    y1 = min(img.shape[0], my + mh + PAD)
    matrix_view = img[y0:y1, x0:x1].copy()

    for i, roi in enumerate(rois):
        if roi is None:
            continue
        x, y, w, h = roi
        rx, ry = x - x0, y - y0
        if i == current:
            color = ACTIVE_COLOR
            thickness = 2
        else:
            color = INACTIVE_COLOR
            thickness = 1
        cv2.rectangle(matrix_view, (rx, ry), (rx + w, ry + h), color, thickness)
        cv2.putText(matrix_view, str(i), (rx, max(8, ry - 2)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)

    matrix_view = cv2.resize(
        matrix_view, None,
        fx=MATRIX_VIEW_SCALE, fy=MATRIX_VIEW_SCALE,
        interpolation=cv2.INTER_LINEAR,
    )

    # Right panel: zoom of current ROI
    roi = rois[current]
    if roi is not None:
        x, y, w, h = roi
        x_c, y_c = max(0, x), max(0, y)
        crop = img[y_c : y + h, x_c : x + w]
        if crop.size > 0:
            zoom = cv2.resize(crop, None, fx=ZOOM_FACTOR, fy=ZOOM_FACTOR,
                              interpolation=cv2.INTER_NEAREST)
        else:
            zoom = np.zeros((220, 220, 3), dtype=np.uint8)
    else:
        zoom = np.zeros((220, 220, 3), dtype=np.uint8)
        cv2.putText(zoom, "<skipped>", (20, 110), cv2.FONT_HERSHEY_SIMPLEX,
                    0.6, (200, 200, 200), 1)

    # Match heights so we can hstack
    target_h = max(matrix_view.shape[0], zoom.shape[0])
    matrix_view = cv2.copyMakeBorder(
        matrix_view, 0, target_h - matrix_view.shape[0], 0, 0,
        cv2.BORDER_CONSTANT, value=0,
    )
    zoom = cv2.copyMakeBorder(
        zoom, 0, target_h - zoom.shape[0], 0, 0,
        cv2.BORDER_CONSTANT, value=0,
    )
    combined = np.hstack([matrix_view, zoom])

    # Status bar
    if roi is not None:
        x, y, w, h = roi
        status = f"S{current:02d}/{len(rois) - 1:02d}  x={x} y={y} w={w} h={h}"
    else:
        status = f"S{current:02d}/{len(rois) - 1:02d}  <skipped>"
    if not saved:
        status += "   * unsaved changes"
    help_text = "wasd=move (shift=5px)  e/c=width  r/f=height  n/p=next/prev  Enter=save  Esc=quit"
    bar = np.zeros((48, combined.shape[1], 3), dtype=np.uint8)
    cv2.putText(bar, status, (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                (255, 255, 255), 1, cv2.LINE_AA)
    cv2.putText(bar, help_text, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.4,
                (180, 180, 180), 1, cv2.LINE_AA)
    return np.vstack([combined, bar])


def clamp_roi(roi: list[int], img_shape: tuple[int, int, int]) -> list[int]:
    h_img, w_img = img_shape[:2]
    x, y, w, h = roi
    x = max(0, min(x, w_img - 1))
    y = max(0, min(y, h_img - 1))
    w = max(1, min(w, w_img - x))
    h = max(1, min(h, h_img - y))
    return [x, y, w, h]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("screenshot", type=Path, nargs="?",
                    default=HERE / "samples" / "hexa_matrix.png")
    args = ap.parse_args()

    if not REGIONS_PATH.exists():
        sys.exit(f"{REGIONS_PATH} missing — run hexa_calibrate.py first")

    data = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
    rois: list[list[int] | None] = data["skill_rois"]
    matrix_bounds: list[int] = data["matrix_bounds"]

    img = cv2.imread(str(args.screenshot))
    if img is None:
        sys.exit(f"can't read {args.screenshot}")

    current = 0
    saved = True
    win = "hexa fine-tune"
    cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)

    def cur_roi() -> list[int] | None:
        return rois[current]

    def mark_dirty() -> None:
        nonlocal saved
        saved = False

    while True:
        cv2.imshow(win, build_canvas(img, rois, current, matrix_bounds, saved))
        k = cv2.waitKey(0)
        if k < 0:
            continue
        k &= 0xFF

        if k == 27 or k == ord("q"):  # ESC or q
            if not saved:
                print("unsaved changes — press Enter to save first, or q again to discard",
                      file=sys.stderr)
                k2 = cv2.waitKey(0) & 0xFF
                if k2 != ord("q") and k2 != 27:
                    continue
            break
        elif k == 13:  # Enter = save
            REGIONS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
            saved = True
            print(f"saved {REGIONS_PATH}", file=sys.stderr)
        elif k == ord("n"):
            current = (current + 1) % len(rois)
        elif k == ord("p"):
            current = (current - 1) % len(rois)
        else:
            roi = cur_roi()
            if roi is None:
                continue
            big = k in (ord("W"), ord("A"), ord("S"), ord("D"))
            delta = 5 if big else 1
            if k in (ord("w"), ord("W")):
                roi[1] -= delta; mark_dirty()
            elif k in (ord("s"), ord("S")):
                roi[1] += delta; mark_dirty()
            elif k in (ord("a"), ord("A")):
                roi[0] -= delta; mark_dirty()
            elif k in (ord("d"), ord("D")):
                roi[0] += delta; mark_dirty()
            elif k == ord("e"):
                roi[2] += 1; mark_dirty()
            elif k == ord("c"):
                roi[2] = max(1, roi[2] - 1); mark_dirty()
            elif k == ord("r"):
                roi[3] += 1; mark_dirty()
            elif k == ord("f"):
                roi[3] = max(1, roi[3] - 1); mark_dirty()
            rois[current] = clamp_roi(roi, img.shape)

    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
