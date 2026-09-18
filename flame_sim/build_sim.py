"""
Inline the simulator's three scripts into one self-contained dist/index.html.

The multi-file page (index.html loading ../gear_progression/js/value.js,
flames.js and sim.js) is the one you edit; dist/index.html is generated from it
and is what gets copied to the Pages repo as /simulator/index.html. The gear
tool's check_js.py rebuilds this in memory and fails if dist/ has drifted, for
the same reason it does that for its own standalone: a stale single file that
still opens and quietly simulates with last week's tables is worse than none.

Run: python build_sim.py
"""

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "index.html"
OUT = HERE / "dist" / "index.html"

BANNER = """<!--
  GENERATED FILE -- do not edit.

  Every script from flame_sim/index.html is inlined here so this one file runs on
  its own. Edit the sources, then regenerate:  python flame_sim/build_sim.py

  Built from: {files}
-->"""

SCRIPT_SRC = re.compile(r'[ \t]*<script src="([^"]+)"></script>\n')


def build():
    """Return (html, [inlined paths]). Raises if a src can't be resolved."""
    html = SRC.read_text(encoding="utf-8")
    inlined = []

    def replace(match):
        rel = match.group(1)
        path = (HERE / rel).resolve()
        code = path.read_text(encoding="utf-8")
        # A literal </script inside the JS would end the block early.
        code = code.replace("</script", r"<\/script")
        inlined.append(rel)
        return f"<script>\n/* ==== {rel} ==== */\n{code.rstrip()}\n</script>\n"

    html = SCRIPT_SRC.sub(replace, html)
    if not inlined:
        raise SystemExit("index.html: no <script src> tags found")
    html = html.replace("<!DOCTYPE html>", "<!DOCTYPE html>\n" + BANNER.format(files=", ".join(inlined)), 1)
    # LF throughout: the Pages repo normalises to LF and the diff there should be
    # the change, not the line endings.
    return html.replace("\r\n", "\n"), inlined


def main():
    html, inlined = build()
    OUT.parent.mkdir(exist_ok=True)
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else None
    if old != html:
        OUT.write_text(html, encoding="utf-8", newline="\n")
    kb = len(html.encode("utf-8")) / 1024
    print(f"  {'unchanged' if old == html else 'written':9} {OUT.relative_to(HERE)}  "
          f"{kb:.0f} KB, {len(inlined)} scripts inlined")
    return 0


if __name__ == "__main__":
    sys.exit(main())
