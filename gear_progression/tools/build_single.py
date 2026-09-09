"""
Inline every <script src="js/..."> into a single self-contained HTML file.

The multi-file version stays the one you edit; these are generated from it, so the
two can never say different things. `check_js.py` re-runs this in memory and fails
if what's on disk has drifted -- a stale standalone file that still opens and
silently ranks with last week's engine is worse than no standalone file at all.

Writes:
  gear-progression-standalone.html   the tool
  selftest-standalone.html           the checks, so a single file can be verified

Run: python tools/build_single.py
"""

import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
JS = BASE / "js"

TARGETS = [
    ("index.html", "gear-progression-standalone.html", "Gear Progression"),
    ("selftest.html", "selftest-standalone.html", "Gear Progression — self test"),
]

BANNER = """<!--
  GENERATED FILE -- do not edit.

  Every script from {src} is inlined here so this one file runs on its own.
  Edit js/*.js and {src}, then regenerate:  python tools/build_single.py

  Built from: {files}
-->"""

SCRIPT_SRC = re.compile(r'[ \t]*<script src="js/([^"]+)"></script>\n')


def build(src_name):
    """Return (html, [inlined file names]). Raises if a src can't be resolved."""
    html = (BASE / src_name).read_text(encoding="utf-8")
    names = SCRIPT_SRC.findall(html)
    if not names:
        raise SystemExit(f"{src_name}: no <script src=\"js/...\"> tags found")

    inlined = []

    def replace(match):
        name = match.group(1)
        code = (JS / name).read_text(encoding="utf-8")
        # A literal </script inside the JS would end the block early. None exists
        # today, but escaping it costs nothing and only ever appears inside a string
        # or comment, where the backslash is harmless.
        code = code.replace("</script", r"<\/script")
        inlined.append(name)
        return f"<script>\n/* ==== js/{name} ==== */\n{code.rstrip()}\n</script>\n"

    html = SCRIPT_SRC.sub(replace, html)

    banner = BANNER.format(src=src_name, files=", ".join(f"js/{n}" for n in inlined))
    html = html.replace("<!DOCTYPE html>", "<!DOCTYPE html>\n" + banner, 1)
    return html, inlined


def main():
    written = []
    for src_name, out_name, _ in TARGETS:
        html, inlined = build(src_name)
        out = BASE / out_name
        # only touch the file when it actually differs, so mtimes stay meaningful
        old = out.read_text(encoding="utf-8") if out.exists() else None
        if old != html:
            out.write_text(html, encoding="utf-8")
        kb = len(html.encode("utf-8")) / 1024
        state = "unchanged" if old == html else "written"
        print(f"  {state:9} {out_name}  {kb:.0f} KB, {len(inlined)} scripts inlined")
        written.append(out_name)

    print(f"\n{len(written)} file(s). Each opens on its own with no js/ folder.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
