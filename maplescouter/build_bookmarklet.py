"""Minify fill_form.js into a single-line `javascript:` bookmarklet.

Usage:
    python build_bookmarklet.py            # prints the bookmarklet to stdout
    python build_bookmarklet.py --copy     # also copies to clipboard
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SRC = Path(__file__).parent / "fill_form.js"


def minify(text: str) -> str:
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)        # block comments
    text = re.sub(r"(?m)^\s*//.*$", "", text)         # line comments (line-start only)
    text = re.sub(r"\s+", " ", text).strip()          # collapse whitespace
    return text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--copy", action="store_true", help="copy result to clipboard")
    args = ap.parse_args()

    bookmarklet = "javascript:" + minify(SRC.read_text(encoding="utf-8"))
    print(bookmarklet)
    if args.copy:
        try:
            import pyperclip
            pyperclip.copy(bookmarklet)
            print(f"[copied {len(bookmarklet)} chars to clipboard]", file=sys.stderr)
        except ImportError:
            print("[install pyperclip for --copy]", file=sys.stderr)


if __name__ == "__main__":
    main()
