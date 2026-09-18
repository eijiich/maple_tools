# Legion Solver

A faster local re-implementation of [Xenogents/LegionSolver](https://github.com/Xenogents/LegionSolver) — the MapleStory Legion-board puzzle solver. Same algorithm, ported to C, compiled to WebAssembly, packaged into a self-contained web UI that runs offline.

## Layout

```
solver/
├── legion.c, legion.h, pieces.c, pieces.h, wasm_bindings.c
│       — C source for the solver (and its WASM bindings)
├── reference/
│       — upstream LegionSolver JS, kept around for cross-checking
├── test.c, test_wasm.mjs
│       — native + Node smoke tests
├── web/
│       — dev source for the UI (served by serve.ps1)
└── dist/
        — shipping artifacts (legion-solver.html, legion-solver.exe)
```

## Builds

Four scripts in `solver/`, each independent:

| Script | What it produces | When to run |
|---|---|---|
| `build.ps1` | `test_legion.exe` — native test binary | After touching `legion.c` / `pieces.c` |
| `build_wasm.ps1` | `web/legion.js` + `web/legion.wasm` | After touching the C, before opening `web/index.html` |
| `build_single_html.ps1` | `dist/legion-solver.html` (~131 KB, self-contained) | When you want a shareable file — double-clickable, no install needed |
| `build_windows_exe.ps1` | `dist/legion-solver.exe` (~7.5 MB) | When you want a shareable EXE — PyInstaller wraps the launcher + assets |

The single-HTML build is the main "ship it" target. It inlines all CSS, all JS, and the WASM binary (base64-decoded at runtime via `atob` into a Blob URL for the worker). Works under `file://` — no server needed by the recipient.

## Dev workflow

```
cd solver/web
./serve.ps1        # Python static server on http://localhost:8765
                   # registers the right MIME types for .mjs / .wasm
```

Edit `.mjs` / `.css` files freely — refresh the browser. The web folder uses three modules:

- `worker.mjs` — runs the C solver in a Web Worker (so the UI stays responsive)
- `wasm.mjs` — main-thread client, tries `new Worker(URL)` first, falls back to a Blob-URL worker for the single-HTML build, falls back further to sync if neither works
- `solve-impl.mjs` — pure helpers shared by both worker and sync paths
- `app.mjs` — UI: board, piece tray, presets, theme, etc.

## Tests

- `solver/build.ps1 -Run` — compiles + runs `test.c` (12 native cases)
- `node solver/test_wasm.mjs` — exercises the WASM module from Node (uses emsdk's bundled node at `C:\_hey\Projects\c\emsdk\node\22.16.0_64bit\bin\node.exe`)

## Landmines worth knowing about

Two paper cuts that consumed real debugging time during the build. Documented so future-you doesn't re-step on them.

### 1. PowerShell `-replace` is regex — including the replacement string

`"text $('foo')" -replace 'pattern', $replacement` interprets `$1`, `$2`, `$&`, `$+`, `$<name>` in `$replacement` as backreferences. So if `$replacement` contains a JS bundle with `$('btnFoo')` in it, PowerShell mangles the substitution and silently corrupts the output.

Fix: use `.Replace()` (the `String` method — pure literal substitution). See [build_single_html.ps1:171](build_single_html.ps1#L171).

### 2. `html.theme-light`, not `body.theme-light`

CSS custom properties cascade *down* the tree. Defining `body.theme-light { --bg-page: white; }` does NOT change the `--bg-page` value seen by `<html>`, because `<html>` is body's *ancestor*, not its descendant.

Symptom: light mode looks fine for everything inside `<body>`, but the `<html>` element stays at the `:root` (dark) default. When body content is shorter than the viewport, html shows through below as a dark band.

Fix: put the theme class on `document.documentElement`. The class lives on `<html>`, the variables override at the root level, and everything cascades correctly. See [style.css:88](style.css#L88) and the relevant comment.

### 3. (bonus) C vs JS object semantics

The upstream LegionSolver caches `piece = pieces[restrictedPieceNumber].restrictedTransformations[...]` as a JS object reference. JS object references survive when you reorder the array around them — `piece.id` still reads the right Piece object. In C, `const PieceTransform *piece = &p->transformations[...]` is a pointer into an array slot that `take_from_list` then *overwrites*. The pointer becomes invalid mid-iteration.

Symptom: `is_placeable()` validates one piece's footprint but `place_piece()` writes a different piece's footprint. Boards come out half-empty.

Fix: snapshot `int placed_id = p->id; PieceTransform placed = *piece;` *before* calling `take_from_list`. Then place from the snapshot. See [legion.c:447-450](legion.c#L447-L450).

## Distribution

- `legion-solver.html` — paste into Discord/email/anywhere. Anyone with a browser can double-click and use it. localStorage is per-file-path, so each recipient has their own saved state.
- `legion-solver.exe` — Windows-only. Double-click → console window opens → browser auto-opens to `http://127.0.0.1:8765/` (or next available port). Close the console window to stop.

Both store presets, piece counts, theme, etc. in localStorage (key `legionSolver.*`).
