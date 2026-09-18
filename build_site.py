#!/usr/bin/env python3
"""Assemble the deployable Ayamushy Tools site from the three app sources.

Copies each web app into a clean deploy tree, injects a shared nav header, and
writes a hub landing page at the root. Re-run after editing any app.

    python build_site.py [--out ../ayamushy_tools] [--serve]

The --out folder is meant to be the working tree of the GitHub Pages repo
(ayamushy/ayamushy_tools), served at https://ayamushy.github.io/ayamushy_tools/ :

    ayamushy_tools/
      index.html            hub landing page
      .nojekyll
      gear_progression/     -> /ayamushy_tools/gear_progression
      scouter/              -> /ayamushy_tools/scouter
      solver/               -> /ayamushy_tools/solver

Nav links are relative, so the same tree also works when served from any base
(e.g. `python build_site.py --serve` runs a local server rooted at --out).
"""
import argparse
import http.server
import re
import shutil
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# (slug, source dir, items to copy, nav label, hub blurb)
APPS = [
    ('gear_progression', 'gear_progression',
     ['index.html', 'js'],
     'Gear Progression',
     'Rank your next upgrade — star force, potential cubes and flames priced on one scale.'),
    ('scouter', 'maplescouter/web',
     ['index.html', 'css', 'js'],
     'Scouter',
     'Read your STAT window straight off a screenshot and fill maplescouter.com.'),
    ('solver', 'solver/web',
     ['index.html', 'style.css', 'app.mjs', 'wasm.mjs', 'pieces.mjs',
      'solve-impl.mjs', 'worker.mjs', 'legion.js', 'legion.wasm'],
     'Solver',
     'Legion board solver — place your pieces and let the WASM search fill the board.'),
]

NAV = [(slug, label) for slug, _s, _i, label, _b in APPS]

NAV_CSS = """<style id="mtnav-style">
.mtnav{display:flex;flex-wrap:wrap;gap:4px;align-items:center;
  background:#12141a;border-bottom:1px solid #2c313d;padding:8px 14px;margin:0;
  font:13px/1.4 ui-monospace,"SF Mono",Menlo,Consolas,monospace;}
.mtnav .mtnav-brand{color:#e6e8ee;font-weight:700;letter-spacing:.5px;
  text-transform:uppercase;font-size:12px;text-decoration:none;margin-right:12px;}
.mtnav .mtnav-brand:hover{color:#6ea8fe;}
.mtnav a.mtnav-link{color:#8b93a7;text-decoration:none;padding:5px 10px;
  border-radius:4px;border:1px solid transparent;}
.mtnav a.mtnav-link:hover{color:#6ea8fe;border-color:#6ea8fe;}
.mtnav a.mtnav-link.active{color:#6ea8fe;border-color:#6ea8fe;background:#1a1d26;}
/* solver ships a light theme (class on <html>); match it there only */
html.theme-light .mtnav{background:#f4f5f7;border-bottom-color:#d7dbe2;}
html.theme-light .mtnav .mtnav-brand{color:#1a1d26;}
html.theme-light .mtnav a.mtnav-link{color:#5b6376;}
html.theme-light .mtnav a.mtnav-link.active{background:#e7ecf3;color:#2b6cb0;border-color:#2b6cb0;}
</style>"""


def nav_html(active, base):
    """base: prefix to the site root ('' from the hub, '../' from an app)."""
    out = [f'<a class="mtnav-brand" href="{base or "./"}">Ayamushy</a>']
    for slug, label in NAV:
        cls = 'mtnav-link active' if slug == active else 'mtnav-link'
        out.append(f'<a class="{cls}" href="{base}{slug}/">{label}</a>')
    nav = '<nav id="mtnav" class="mtnav">' + ''.join(out) + '</nav>'
    # Each app styles <body> differently (scouter has padding, gear/solver don't).
    # Cancel the host body's padding on the bar so it's flush and full-width
    # everywhere, without knowing the value ahead of time.
    fix = ("<script>(function(){var n=document.getElementById('mtnav');if(!n)return;"
           "var s=getComputedStyle(document.body);n.style.marginTop='-'+s.paddingTop;"
           "n.style.marginLeft='-'+s.paddingLeft;n.style.marginRight='-'+s.paddingRight;"
           "})();</script>")
    return nav + fix


def inject(html, active, base):
    snippet = '\n' + NAV_CSS + '\n' + nav_html(active, base) + '\n'
    m = re.search(r'<body[^>]*>', html, re.IGNORECASE)
    if not m:
        raise SystemExit('no <body> tag found in an app index.html')
    return html[:m.end()] + snippet + html[m.end():]


def copy_item(src, dst):
    if src.is_dir():
        shutil.copytree(src, dst)
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def hub_html():
    cards = []
    for slug, _s, _i, label, blurb in APPS:
        cards.append(
            f'<a class="mt-card" href="{slug}/">'
            f'<span class="mt-card-title">{label}</span>'
            f'<span class="mt-card-blurb">{blurb}</span></a>')
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ayamushy Tools</title>
<style>
  :root{{--bg:#12141a;--panel:#1a1d26;--line:#2c313d;--fg:#e6e8ee;--dim:#8b93a7;--acc:#6ea8fe;}}
  *{{box-sizing:border-box;}}
  body{{margin:0;background:var(--bg);color:var(--fg);
    font:14px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace;}}
  .wrap{{max-width:820px;margin:0 auto;padding:40px 16px;}}
  h1{{font-size:20px;letter-spacing:.5px;margin:0 0 4px;}}
  .sub{{color:var(--dim);margin:0 0 28px;}}
  .mt-grid{{display:grid;gap:12px;}}
  a.mt-card{{display:block;background:var(--panel);border:1px solid var(--line);
    border-radius:8px;padding:16px 18px;text-decoration:none;color:var(--fg);}}
  a.mt-card:hover{{border-color:var(--acc);}}
  .mt-card-title{{display:block;font-size:15px;color:var(--acc);margin-bottom:4px;}}
  .mt-card-blurb{{display:block;color:var(--dim);font-size:13px;}}
</style>
</head>
<body>
{NAV_CSS}
{nav_html('', '')}
<div class="wrap">
  <h1>Ayamushy Tools</h1>
  <p class="sub">A small set of MapleStory helpers.</p>
  <div class="mt-grid">
{chr(10).join('    ' + c for c in cards)}
  </div>
</div>
</body>
</html>
"""


def build(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    # clean generated content but keep .git and .nojekyll
    for slug, *_ in APPS:
        d = out / slug
        if d.exists():
            shutil.rmtree(d)
    for slug, src_rel, items, _label, _blurb in APPS:
        src = ROOT / src_rel
        dst = out / slug
        dst.mkdir(parents=True, exist_ok=True)
        for item in items:
            copy_item(src / item, dst / item)
        idx = dst / 'index.html'
        idx.write_text(inject(idx.read_text(encoding='utf-8'), slug, '../'),
                       encoding='utf-8', newline='\n')
        print(f'  {slug:16s} <- {src_rel}  ({len(items)} items)')
    (out / 'index.html').write_text(hub_html(), encoding='utf-8', newline='\n')
    (out / '.nojekyll').write_text('', encoding='utf-8')
    print(f'  hub + .nojekyll')
    print(f'built -> {out}')


def serve(out: Path, port=8000):
    import functools
    import mimetypes
    # Browsers reject ES modules served as text/plain; GitHub Pages gets this
    # right, but Python's default map doesn't always -- set it for local testing.
    mimetypes.add_type('text/javascript', '.mjs')
    mimetypes.add_type('text/javascript', '.js')
    mimetypes.add_type('application/wasm', '.wasm')
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(out))
    with socketserver.TCPServer(('', port), handler) as httpd:
        print(f'serving {out} at http://localhost:{port}/  (Ctrl+C to stop)')
        httpd.serve_forever()


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT.parent / 'ayamushy_tools'))
    ap.add_argument('--serve', action='store_true')
    ap.add_argument('--port', type=int, default=8000)
    args = ap.parse_args()
    out = Path(args.out).resolve()
    build(out)
    if args.serve:
        serve(out, args.port)
