import { initSolver, getLayout, solve, cancelSolve, isAsync } from './wasm.mjs';
import { PIECES, PIECE_COLORS, cellCount, decodeCell } from './pieces.mjs';

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = 'legionSolver.v1';

const state = {
  board: null,        /* Int8Array */
  rows: 0,
  cols: 0,
  counts: new Int32Array(18),
  dragging: false,
  dragValue: 0,
  lastSolution: null, /* full result from solve() */
  bigClick: false,
  groups: [],         /* legionGroups[]: each is array of {r,c} */
  cellToGroup: null,  /* Int16Array, -1 if cell is in no group */
  previewedGroup: -1, /* current hover-highlighted group, -1 = none */
  lastClick: null,    /* { idx, dragValue, time } for custom dblclick detection */
  placementMap: null, /* Int16Array, -1 if cell isn't part of a placed piece;
                         otherwise: index into the last solve's placements[] —
                         lets us draw a separator between adjacent cells that
                         belong to DIFFERENT placements (even when same colour). */
  showMiddle: true,   /* whether to show the white-ish dot on each piece's
                         center cell — toggled via the Middle marker checkbox. */
};

const REGION_DBLCLICK_MS = 400;

/* ---------- persistence ---------- */

function saveState() {
  const data = {
    board: Array.from(state.board),
    counts: Array.from(state.counts),
    bigClick: state.bigClick,
    showMiddle: state.showMiddle,
    maxIter: $('inpMaxIter')?.value || '0',
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

/* ---------- legion groups (ported from upstream board.js) ---------- */

function computeLegionGroups(ROWS, COLS) {
  const groups = Array.from({ length: 16 }, () => []);
  const q = ROWS / 4;     // 5  for 20-row board
  const h = ROWS / 2;     // 10
  const tq = 3 * ROWS / 4;// 15

  for (let i = 0; i < q; i++) {
    for (let j = i; j < h; j++) {
      groups[0].push({ r: j,           c: i });
      groups[1].push({ r: i,           c: j + 1 });
      groups[2].push({ r: i,           c: COLS - 2 - j });
      groups[3].push({ r: j,           c: COLS - 1 - i });
      groups[4].push({ r: ROWS - 1 - j, c: COLS - 1 - i });
      groups[5].push({ r: ROWS - 1 - i, c: COLS - 2 - j });
      groups[6].push({ r: ROWS - 1 - i, c: j + 1 });
      groups[7].push({ r: ROWS - 1 - j, c: i });
    }
  }
  for (let i = q; i < h; i++) {
    for (let j = i; j < h; j++) {
      groups[8].push ({ r: j,             c: i });
      groups[9].push ({ r: i,             c: j + 1 });
      groups[10].push({ r: tq - 1 - j,    c: q + 1 + i });
      groups[11].push({ r: j,             c: COLS - 1 - i });
      groups[12].push({ r: ROWS - 1 - j,  c: COLS - 1 - i });
      groups[13].push({ r: j + q,         c: i + q + 1 });
      groups[14].push({ r: j + q,         c: tq - i });
      groups[15].push({ r: ROWS - j - 1,  c: i });
    }
  }
  return groups;
}

function buildCellToGroup(groups, ROWS, COLS) {
  const t = new Int16Array(ROWS * COLS).fill(-1);
  for (let g = 0; g < groups.length; g++) {
    for (const p of groups[g]) {
      if (p.r >= 0 && p.r < ROWS && p.c >= 0 && p.c < COLS) {
        t[p.r * COLS + p.c] = g;
      }
    }
  }
  return t;
}

/* ---------- board ---------- */

function makeEmptyBoard(rows, cols) {
  return new Int8Array(rows * cols).fill(-1);
}

function buildBoardDom() {
  const tbody = $('boardBody');
  tbody.innerHTML = '';
  const COLS = state.cols;
  for (let r = 0; r < state.rows; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < state.cols; c++) {
      const td = document.createElement('td');
      td.dataset.r = r;
      td.dataset.c = c;

      /* tag the cell with its group, and add a thick edge wherever
       * the neighbour belongs to a different group (or is off the board). */
      const myG = state.cellToGroup[r * COLS + c];
      if (myG >= 0) {
        td.classList.add('g' + myG);
        const diff = (rr, cc) =>
          rr < 0 || rr >= state.rows || cc < 0 || cc >= state.cols ||
          state.cellToGroup[rr * COLS + cc] !== myG;
        if (diff(r - 1, c)) td.classList.add('gb-top');
        if (diff(r + 1, c)) td.classList.add('gb-bot');
        if (diff(r, c - 1)) td.classList.add('gb-left');
        if (diff(r, c + 1)) td.classList.add('gb-right');
      }

      td.addEventListener('mousedown', (e) => {
        e.preventDefault();
        clearPreview();
        const idx = r * state.cols + c;
        const now = performance.now();
        const last = state.lastClick;

        /* Custom double-click: same cell, fast, not already in region-click mode.
         * Spread the FIRST click's chosen value across the whole legion group.
         * (Reliable across rate-limited clicks; replaces the flaky e.detail/dblclick path.) */
        if (last && last.idx === idx
            && (now - last.time) < REGION_DBLCLICK_MS
            && !state.bigClick) {
          const g = state.cellToGroup[idx];
          if (g >= 0) {
            for (const p of state.groups[g]) setCell(p.r, p.c, last.dragValue);
            state.lastClick = null; /* reset so a third click starts fresh */
            saveState();
            return;
          }
        }

        /* Normal single-click — toggle this cell (or whole region if bigClick is on). */
        const v = state.board[idx];
        state.dragValue = v === 0 ? -1 : 0;
        applyAt(r, c, state.dragValue);
        state.dragging = true;
        state.lastClick = { idx, dragValue: state.dragValue, time: now };
      });
      td.addEventListener('mouseover', () => {
        if (state.dragging) {
          applyAt(r, c, state.dragValue);
        } else if (state.bigClick) {
          showPreview(r, c);
        }
      });
      td.addEventListener('mouseout', () => {
        if (!state.dragging && state.bigClick) clearPreview();
      });
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  document.addEventListener('mouseup', () => {
    if (state.dragging) { state.dragging = false; saveState(); }
  });
}

/* Apply a value to (r, c), expanding to the whole legion group when big-click is on. */
function applyAt(r, c, v) {
  if (state.bigClick) {
    const g = state.cellToGroup[r * state.cols + c];
    if (g < 0) {
      setCell(r, c, v);
    } else {
      for (const p of state.groups[g]) setCell(p.r, p.c, v);
    }
  } else {
    setCell(r, c, v);
  }
}

function setCell(r, c, v) {
  const idx = r * state.cols + c;
  if (state.board[idx] === v) return;
  state.board[idx] = v;
  paintCell(r, c);
  updateCounters();
  /* Any user edit invalidates the last-solve attribution AND its per-piece
   * separator map (now stale because placements no longer match the board). */
  if (state.lastSolution || state.placementMap) {
    state.lastSolution = null;
    state.placementMap = null;
    applyPieceSeparators();
  }
}

/* Big-click hover preview: brighten the group the cursor is over. */
function showPreview(r, c) {
  const g = state.cellToGroup[r * state.cols + c];
  if (g === state.previewedGroup) return;
  clearPreview();
  if (g < 0) return;
  state.previewedGroup = g;
  const tbody = $('boardBody');
  for (const p of state.groups[g]) {
    const td = tbody.children[p.r]?.children[p.c];
    if (!td) continue;
    if (state.board[p.r * state.cols + p.c] === -1) td.classList.add('preview-on');
    else td.classList.add('preview-off');
  }
}

function clearPreview() {
  if (state.previewedGroup < 0) return;
  const tbody = $('boardBody');
  for (const p of state.groups[state.previewedGroup]) {
    const td = tbody.children[p.r]?.children[p.c];
    if (td) td.classList.remove('preview-on', 'preview-off');
  }
  state.previewedGroup = -1;
}

const STATE_CLASSES = [
  'locked', 'empty', 'filled', 'middle',
  'sep-r', 'sep-b',
  'no-t', 'no-b', 'no-l', 'no-r',
];

function paintCell(r, c) {
  const tbody = $('boardBody');
  const td = tbody.children[r]?.children[c];
  if (!td) return;
  const v = state.board[r * state.cols + c];
  td.classList.remove(...STATE_CLASSES);
  td.style.background = '';
  if (v === -1) {
    td.classList.add('locked');
  } else if (v === 0) {
    td.classList.add('empty');
  } else {
    const decoded = decodeCell(v);
    if (decoded) {
      td.classList.add('filled');
      td.style.background = PIECE_COLORS[decoded.pieceId] || '#888';
      if (decoded.isMiddle) td.classList.add('middle');
    }
  }
}

function paintAll() {
  for (let r = 0; r < state.rows; r++)
    for (let c = 0; c < state.cols; c++)
      paintCell(r, c);
  applyPieceSeparators();
}

function buildPlacementMap(placements) {
  const map = new Int16Array(state.rows * state.cols).fill(-1);
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    for (const [x, y] of p.cells) {
      if (x >= 0 && x < state.cols && y >= 0 && y < state.rows) {
        map[y * state.cols + x] = i;
      }
    }
  }
  return map;
}

/* Fallback when state.placementMap is unavailable (e.g. on a loaded preset
 * that wasn't saved with placement data). Flood-fills the board grouping
 * connected cells that share the same piece id — treats id=v and id=v+18
 * (middle marker variant) as the same id. Two adjacent pieces of the same
 * type WILL merge into one component; that's an accepted limitation since
 * the raw board doesn't preserve placement boundaries on its own. */
function buildPseudoPlacementMap() {
  const COLS = state.cols, ROWS = state.rows;
  const map = new Int16Array(ROWS * COLS).fill(-1);
  let nextId = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      if (state.board[idx] <= 0 || map[idx] !== -1) continue;
      const seed = state.board[idx];
      const seedId = seed > 18 ? seed - 18 : seed;
      const id = nextId++;
      const stack = [idx];
      while (stack.length) {
        const cur = stack.pop();
        if (map[cur] !== -1) continue;
        const cv = state.board[cur];
        if (cv <= 0) continue;
        const cid = cv > 18 ? cv - 18 : cv;
        if (cid !== seedId) continue;
        map[cur] = id;
        const cr = (cur / COLS) | 0;
        const cc = cur - cr * COLS;
        if (cr > 0)        stack.push((cr - 1) * COLS + cc);
        if (cr < ROWS - 1) stack.push((cr + 1) * COLS + cc);
        if (cc > 0)        stack.push(cr * COLS + (cc - 1));
        if (cc < COLS - 1) stack.push(cr * COLS + (cc + 1));
      }
    }
  }
  return map;
}

/* For each filled cell, mark sep-r / sep-b when the right / bottom neighbour
 * belongs to a DIFFERENT placement than this one. Only checks right + bottom
 * because adjacent cells share an edge — drawing on both sides would paint
 * the same line twice.
 *
 * If state.placementMap is null but the board has filled cells (e.g. on a
 * loaded preset saved without the map), derive one via flood-fill so the
 * boundaries still render. */
function applyPieceSeparators() {
  const tbody = $('boardBody');
  const COLS = state.cols;
  const ROWS = state.rows;
  let map = state.placementMap;
  if (!map) {
    const hasFilled = Array.from(state.board).some((v) => v > 0);
    if (hasFilled) map = buildPseudoPlacementMap();
  }
  if (!map) {
    /* No filled cells at all — clear any leftover sep classes and bail. */
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const td = tbody.children[r]?.children[c];
        if (td) td.classList.remove('sep-r', 'sep-b');
      }
    }
    return;
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const td = tbody.children[r]?.children[c];
      if (!td) continue;
      td.classList.remove('sep-r', 'sep-b', 'no-t', 'no-b', 'no-l', 'no-r');
      const idx = r * COLS + c;
      if (state.board[idx] <= 0) continue;
      const myPl = map[idx];
      if (myPl < 0) continue;

      /* For each side, check the neighbour:
       *   - same placement   : hide the 1px gridline (no-* class) so the piece
       *                        looks like one continuous shape
       *   - different placement : leave gridline + add the 1.5px sep on this
       *                           cell's right/bottom side (only)
       *   - non-piece           : leave gridline (acts as the piece contour) */
      if (r > 0        && map[(r - 1) * COLS + c] === myPl)         td.classList.add('no-t');
      if (r < ROWS - 1 && map[(r + 1) * COLS + c] === myPl)         td.classList.add('no-b');
      if (c > 0        && map[r * COLS + (c - 1)] === myPl)         td.classList.add('no-l');
      if (c < COLS - 1 && map[r * COLS + (c + 1)] === myPl)         td.classList.add('no-r');

      if (c + 1 < COLS) {
        const rPl = map[r * COLS + (c + 1)];
        if (rPl >= 0 && rPl !== myPl) td.classList.add('sep-r');
      }
      if (r + 1 < ROWS) {
        const bPl = map[(r + 1) * COLS + c];
        if (bPl >= 0 && bPl !== myPl) td.classList.add('sep-b');
      }
    }
  }
}

/* ---------- piece tray ---------- */

function buildPieceTray() {
  const wrap = $('pieceTray');
  wrap.innerHTML = '';
  for (const piece of PIECES) {
    const row = document.createElement('div');
    row.className = 'piece-row';

    /* label first (matches upstream layout) */
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = piece.label;
    row.appendChild(label);

    /* shape preview second — just coloured cells, no contour. */
    const tbl = document.createElement('table');
    tbl.className = 'shape';
    for (const sr of piece.shape) {
      const tr = document.createElement('tr');
      for (const v of sr) {
        const td = document.createElement('td');
        if (v !== 0) td.style.background = PIECE_COLORS[piece.id];
        tr.appendChild(td);
      }
      tbl.appendChild(tr);
    }
    row.appendChild(tbl);

    /* count input last */
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = String(state.counts[piece.id - 1] || 0);
    input.dataset.pieceId = piece.id;
    input.addEventListener('input', () => {
      const n = Math.max(0, parseInt(input.value, 10) || 0);
      state.counts[piece.id - 1] = n;
      updateCounters();
      saveState();
    });
    row.appendChild(input);

    wrap.appendChild(row);
  }
}

/* ---------- counters ---------- */

function updateCounters() {
  let pieceCells = 0;
  let characters = 0;
  for (const piece of PIECES) {
    const n = state.counts[piece.id - 1] || 0;
    if (!n) continue;
    pieceCells += n * cellCount(piece.shape);
    characters += n;
  }
  /* "Marked cells" = every cell the user has activated as part of the board,
   * whether it's currently empty (0) or already holding a placed piece (> 0).
   * Counting only `=== 0` would drop to zero after a solve or after loading a
   * solved preset — confusing, since the playable area hasn't changed. */
  let marked = 0;
  for (let i = 0; i < state.board.length; i++) if (state.board[i] !== -1) marked++;
  $('counterCharacters').textContent = String(characters);
  $('counterPieceCells').textContent = String(pieceCells);
  $('counterEmpty').textContent = String(marked);
  const diff = pieceCells - marked;
  const diffEl = $('counterDiff');
  diffEl.textContent = (diff > 0 ? '+' : '') + String(diff);
  diffEl.className = diff === 0 ? 'ok' : (diff > 0 ? 'over' : 'under');
}

/* ---------- actions ---------- */

function readMaxIter() {
  const v = parseInt($('inpMaxIter').value, 10);
  return Number.isFinite(v) && v > 0 ? v : 0; /* 0 = no cap */
}

function fmtInt(n) { return n.toLocaleString('en-US'); }

function fmtTime(ms) {
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${m}m ${s}s`;
}

function setStats(iterations, ms, placements) {
  $('statIter').textContent = iterations == null ? '—' : fmtInt(iterations);
  $('statTime').textContent = ms == null ? '—' : fmtTime(ms);
  $('statPlacements').textContent = placements == null ? '—' : String(placements);
}

let solveInProgress = false;
let solveStartedAt = 0;
let solveTicker = null;

async function actionSolve() {
  if (solveInProgress) return;
  solveInProgress = true;
  $('btnSolve').disabled = true;
  $('btnClearBoard').disabled = true;
  $('btnClearSolution').disabled = true;
  document.body.classList.add('solving');   /* CSS disables the board */

  /* If the board still holds a previous solve's pieces, reset them to "empty"
   * first. Otherwise the C solver sees a board with no 0-valued cells, has
   * nothing to place, returns with an empty placements list — and the visible
   * pieces end up with no placement map, so the seps disappear. */
  let hadFilled = false;
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i] > 0) { state.board[i] = 0; hadFilled = true; }
  }
  if (hadFilled) {
    state.lastSolution = null;
    state.placementMap = null;
    paintAll();
  }

  /* The worker may need to (re)initialize after a previous Stop. Await that
   * BEFORE we decide whether to show the Stop button; otherwise isAsync()
   * still reports false from the cancelled worker's reset state. */
  await initSolver();
  if (isAsync()) $('btnStop').style.visibility = 'visible';

  const cap = readMaxIter();
  const async_ = isAsync();
  $('status').textContent = async_
    ? (cap > 0 ? `solving… (cap ${fmtInt(cap)} iters) — Stop is safe to hit`
               : `solving… (no cap) — Stop is safe to hit`)
    : (cap > 0 ? `solving… (cap ${fmtInt(cap)} iters; page will freeze)`
               : `solving… (no cap; page will freeze until done)`);
  $('status').className = '';
  setStats(null, null, null);

  /* Show a live wall-clock ticker so it's obvious the page isn't dead. */
  solveStartedAt = performance.now();
  if (solveTicker) clearInterval(solveTicker);
  solveTicker = setInterval(() => {
    const ms = performance.now() - solveStartedAt;
    $('statTime').textContent = fmtTime(ms);
  }, 100);

  await new Promise((r) => setTimeout(r, 0));  /* let the status paint */

  try {
    const result = await solve(state.board, state.counts, cap);
    state.lastSolution = result;
    setStats(result.iterations, result.ms, result.placements.length);
    if (result.success) {
      state.board = result.finalBoard;
      state.placementMap = buildPlacementMap(result.placements);
      paintAll();
      $('status').textContent = 'solved';
      $('status').className = 'ok';
    } else {
      $('status').textContent = cap > 0 && result.iterations >= cap
        ? `hit iteration cap (${fmtInt(cap)}) — raise or set to 0`
        : 'no solution exists for these inputs';
      $('status').className = 'err';
    }
    updateCounters();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (msg === 'cancelled') {
      $('status').textContent = 'cancelled';
    } else {
      $('status').textContent = 'error: ' + msg;
    }
    $('status').className = 'err';
    setStats(null, null, null);
  } finally {
    if (solveTicker) { clearInterval(solveTicker); solveTicker = null; }
    solveInProgress = false;
    $('btnSolve').disabled = false;
    $('btnClearBoard').disabled = false;
    $('btnClearSolution').disabled = false;
    $('btnStop').style.visibility = 'hidden';
    document.body.classList.remove('solving');
  }
}

function actionStop() {
  if (!solveInProgress) return;
  cancelSolve();
}

function actionClearSolution() {
  /* Turn filled cells back into empty (0), keep locked cells locked. */
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i] > 0) state.board[i] = 0;
  }
  state.lastSolution = null;
  state.placementMap = null;
  paintAll();
  updateCounters();
  setStats(null, null, null);
  $('status').textContent = '';
  $('status').className = '';
}

function actionClearBoard() {
  state.board = makeEmptyBoard(state.rows, state.cols);
  state.lastSolution = null;
  state.placementMap = null;
  paintAll();
  updateCounters();
  saveState();
  setStats(null, null, null);
  $('status').textContent = '';
}

function actionClearCounts() {
  state.counts.fill(0);
  for (const input of $('pieceTray').querySelectorAll('input')) input.value = '0';
  updateCounters();
  saveState();
}

function setBigClick(on) {
  state.bigClick = !!on;
  clearPreview();
  $('chkBigClick').checked = state.bigClick;
  saveState();
}

function setShowMiddle(on) {
  state.showMiddle = !!on;
  document.body.classList.toggle('hide-middle', !state.showMiddle);
  saveState();
}

function toggleShowMiddle() {
  setShowMiddle(!state.showMiddle);
}

/* ---------- piece-only presets (counts vector, no board) ---------- */

const PIECE_PRESETS_KEY = 'legionSolver.piecePresets.v1';
const PIECE_PRESETS_MAX = 5;

function loadPiecePresets() {
  try {
    const raw = localStorage.getItem(PIECE_PRESETS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function savePiecePresets(arr) {
  try { localStorage.setItem(PIECE_PRESETS_KEY, JSON.stringify(arr)); } catch {}
}

function snapshotPiecePreset(name) {
  return {
    name,
    counts: Array.from(state.counts),
    savedAt: new Date().toISOString(),
  };
}

function actionSavePiecePreset() {
  const presets = loadPiecePresets();
  if (presets.length >= PIECE_PRESETS_MAX) {
    $('status').textContent = `piece-preset limit reached (${PIECE_PRESETS_MAX}) — delete one first`;
    $('status').className = 'err';
    return;
  }
  const existing = new Set(presets.map((p) => p.name));
  let n = presets.length + 1;
  let name = `Pieces ${n}`;
  while (existing.has(name)) { n++; name = `Pieces ${n}`; }
  presets.push(snapshotPiecePreset(name));
  savePiecePresets(presets);
  renderPiecePresets();
}

function actionLoadPiecePreset(idx) {
  const presets = loadPiecePresets();
  const p = presets[idx];
  if (!p || !Array.isArray(p.counts) || p.counts.length !== 18) return;
  state.counts = new Int32Array(p.counts);
  for (const input of $('pieceTray').querySelectorAll('input')) {
    const pid = parseInt(input.dataset.pieceId, 10);
    input.value = String(state.counts[pid - 1] || 0);
  }
  updateCounters();
  saveState();
  $('status').textContent = `loaded piece preset "${p.name}"`;
  $('status').className = 'ok';
}

function actionOverwritePiecePreset(idx) {
  const presets = loadPiecePresets();
  if (!presets[idx]) return;
  const oldName = presets[idx].name;
  presets[idx] = snapshotPiecePreset(oldName);
  savePiecePresets(presets);
  renderPiecePresets();
}

function actionDeletePiecePreset(idx) {
  const presets = loadPiecePresets();
  presets.splice(idx, 1);
  savePiecePresets(presets);
  renderPiecePresets();
}

function actionRenamePiecePreset(idx, newName) {
  const presets = loadPiecePresets();
  if (!presets[idx]) return;
  presets[idx].name = (newName || '').slice(0, 40).trim() || presets[idx].name;
  savePiecePresets(presets);
}

function renderPiecePresets() {
  const presets = loadPiecePresets();
  const list = $('piecePresetsList');
  list.innerHTML = '';
  $('piecePresetsCount').textContent = `(${presets.length}/${PIECE_PRESETS_MAX})`;
  $('btnSavePiecePreset').disabled = presets.length >= PIECE_PRESETS_MAX;

  if (presets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'presets-empty';
    empty.textContent = 'No piece presets yet — saves only your counts (not the board).';
    list.appendChild(empty);
    return;
  }

  presets.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'piece-preset-card';

    const name = document.createElement('input');
    name.className = 'name';
    name.value = p.name;
    name.addEventListener('change', () => actionRenamePiecePreset(idx, name.value));
    card.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const btnLoad = document.createElement('button');
    btnLoad.textContent = 'Load';
    btnLoad.title = 'Replace your current counts with this preset';
    btnLoad.addEventListener('click', () => actionLoadPiecePreset(idx));
    actions.appendChild(btnLoad);

    const btnSave = document.createElement('button');
    btnSave.textContent = 'Save';
    btnSave.title = 'Overwrite this preset with your current counts';
    btnSave.addEventListener('click', () => actionOverwritePiecePreset(idx));
    actions.appendChild(btnSave);

    const btnDel = document.createElement('button');
    btnDel.textContent = '✕';
    btnDel.className = 'danger';
    btnDel.title = 'Delete this piece preset';
    let armTimer = null;
    const disarm = () => {
      btnDel.classList.remove('armed');
      btnDel.textContent = '✕';
      btnDel.title = 'Delete this piece preset';
      if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    };
    btnDel.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btnDel.classList.contains('armed')) {
        disarm();
        actionDeletePiecePreset(idx);
        return;
      }
      btnDel.classList.add('armed');
      btnDel.textContent = '?';
      btnDel.title = 'Click again to confirm';
      armTimer = setTimeout(disarm, 2500);
    });
    btnDel.addEventListener('blur', disarm);
    actions.appendChild(btnDel);

    card.appendChild(actions);
    list.appendChild(card);
  });
}

/* ---------- saved presets (board + counts together) ---------- */

const PRESETS_KEY = 'legionSolver.presets.v1';
const PRESETS_MAX = 10;

function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function savePresets(arr) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(arr)); } catch {}
}

function snapshotPreset(name) {
  const snap = {
    name,
    board: Array.from(state.board),
    counts: Array.from(state.counts),
    savedAt: new Date().toISOString(),
  };
  /* Attach the most-recent solve stats if they still match the board. We invalidate
   * state.lastSolution on any manual edit, so its presence implies the board IS
   * the solved one (or the just-loaded preset's solved snapshot). */
  if (state.lastSolution) {
    snap.iterations  = state.lastSolution.iterations;
    snap.solveMs     = state.lastSolution.ms;
    snap.placements  = state.lastSolution.placements ? state.lastSolution.placements.length : null;
  }
  /* Save the per-cell placement map too — without it, two adjacent pieces of
   * the same type would merge into one blob when the preset is reloaded
   * (flood-fill can't tell them apart from the board alone). */
  if (state.placementMap) {
    snap.placementMap = Array.from(state.placementMap);
  }
  return snap;
}

function actionSavePreset() {
  const presets = loadPresets();
  if (presets.length >= PRESETS_MAX) {
    $('status').textContent = `preset limit reached (${PRESETS_MAX}) — delete one first`;
    $('status').className = 'err';
    return;
  }
  /* Auto-name: if any cell is filled, label it "Solved <n>"; else "Setup <n>". */
  const hasSolution = Array.from(state.board).some((v) => v > 0);
  const baseName = hasSolution ? 'Solved' : 'Setup';
  let n = presets.length + 1;
  let name = `${baseName} ${n}`;
  const existing = new Set(presets.map((p) => p.name));
  while (existing.has(name)) { n++; name = `${baseName} ${n}`; }

  presets.push(snapshotPreset(name));
  savePresets(presets);
  renderPresets();
}

function actionDeletePreset(idx) {
  const presets = loadPresets();
  presets.splice(idx, 1);
  savePresets(presets);
  renderPresets();
}

/* Overwrite slot idx with the current state, keeping its existing name. */
function actionOverwritePreset(idx) {
  const presets = loadPresets();
  if (!presets[idx]) return;
  const oldName = presets[idx].name;
  presets[idx] = snapshotPreset(oldName);
  savePresets(presets);
  renderPresets();
}

function actionLoadPreset(idx) {
  const presets = loadPresets();
  const p = presets[idx];
  if (!p) return;
  if (Array.isArray(p.board) && p.board.length === state.rows * state.cols) {
    state.board = new Int8Array(p.board);
  }
  if (Array.isArray(p.counts) && p.counts.length === 18) {
    state.counts = new Int32Array(p.counts);
    for (const input of $('pieceTray').querySelectorAll('input')) {
      const pid = parseInt(input.dataset.pieceId, 10);
      input.value = String(state.counts[pid - 1] || 0);
    }
  }
  /* Restore the exact per-cell placement map if it was saved with the preset
   * (recent saves include it). Falling back to null means applyPieceSeparators
   * will flood-fill from board values — same-type pieces touching would merge,
   * so older presets show that, newer ones don't. */
  if (Array.isArray(p.placementMap) && p.placementMap.length === state.rows * state.cols) {
    state.placementMap = new Int16Array(p.placementMap);
  } else {
    state.placementMap = null;
  }
  paintAll();
  updateCounters();
  saveState();

  /* Restore the solve attribution so the stats panel + a re-Save will carry
   * the original numbers forward. */
  if (typeof p.iterations === 'number') {
    state.lastSolution = {
      iterations: p.iterations,
      ms:         typeof p.solveMs    === 'number' ? p.solveMs    : 0,
      placements: typeof p.placements === 'number' ? new Array(p.placements) : [],
    };
    setStats(p.iterations, p.solveMs ?? null, p.placements ?? null);
  } else {
    state.lastSolution = null;
    setStats(null, null, null);
  }
  $('status').textContent = `loaded "${p.name}"`;
  $('status').className = 'ok';
}

function actionRenamePreset(idx, newName) {
  const presets = loadPresets();
  if (!presets[idx]) return;
  presets[idx].name = (newName || '').slice(0, 40).trim() || presets[idx].name;
  savePresets(presets);
  /* Update only the count badge — DOM input keeps user's cursor in place. */
  $('presetsCount').textContent = `(${presets.length}/${PRESETS_MAX})`;
}

/* Read the current theme's board-bg colours so thumbnails match the page
 * (white background in light mode, near-black in dark mode). Falls back to
 * the dark defaults if the variables aren't readable for any reason. */
function readThumbColors() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  return {
    /* "locked" cells (-1) render as the canvas bg — same colour the board
     * shows for inactive cells, so the thumb reads as a mini board. */
    locked: get('--bg-locked', '#1a1c20'),
    empty:  get('--bg-empty',  '#353945'),
  };
}

/* Render a tiny preview of a saved board onto a canvas. */
function drawPresetThumb(canvas, boardArr) {
  const COLS = state.cols;
  const ROWS = state.rows;
  const scale = 4;  /* 22*4 = 88 wide; 20*4 = 80 tall */
  const w = canvas.width  = COLS * scale;
  const h = canvas.height = ROWS * scale;
  const ctx = canvas.getContext('2d');
  const colors = readThumbColors();
  ctx.fillStyle = colors.locked;
  ctx.fillRect(0, 0, w, h);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = boardArr[r * COLS + c];
      let color;
      if (v === -1) continue;       /* leave canvas bg = locked colour */
      else if (v === 0) color = colors.empty;
      else {
        const d = decodeCell(v);
        color = d ? (PIECE_COLORS[d.pieceId] || '#888') : '#888';
      }
      ctx.fillStyle = color;
      ctx.fillRect(c * scale, r * scale, scale, scale);
    }
  }
}

function renderPresets() {
  const presets = loadPresets();
  const list = $('presetsList');
  list.innerHTML = '';
  $('presetsCount').textContent = `(${presets.length}/${PRESETS_MAX})`;
  $('btnSavePreset').disabled = presets.length >= PRESETS_MAX;

  if (presets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'presets-empty';
    empty.textContent = 'No saved presets yet — hit “Save current” to remember this board + counts.';
    list.appendChild(empty);
    return;
  }

  presets.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'preset-card';

    /* corner ✕ — sits absolutely in the top-right, so it doesn't compete with
     * Load/Save for action-row space. */
    const btnDel = document.createElement('button');
    btnDel.textContent = '✕';
    btnDel.className = 'corner-delete';
    btnDel.title = 'Delete this preset';
    let armTimer = null;
    const disarm = () => {
      btnDel.classList.remove('armed');
      btnDel.textContent = '✕';
      btnDel.title = 'Delete this preset';
      if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    };
    btnDel.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btnDel.classList.contains('armed')) {
        disarm();
        actionDeletePreset(idx);
        return;
      }
      btnDel.classList.add('armed');
      btnDel.textContent = '?';
      btnDel.title = 'Click again to confirm';
      armTimer = setTimeout(disarm, 2500);
    });
    btnDel.addEventListener('blur', disarm);
    card.appendChild(btnDel);

    const canvas = document.createElement('canvas');
    drawPresetThumb(canvas, p.board);
    card.appendChild(canvas);

    const meta = document.createElement('div');
    meta.className = 'meta';

    const name = document.createElement('input');
    name.className = 'name';
    name.value = p.name;
    name.addEventListener('change', () => actionRenamePreset(idx, name.value));
    meta.appendChild(name);

    const sub = document.createElement('div');
    sub.className = 'sub';
    const when = p.savedAt ? new Date(p.savedAt) : null;
    sub.textContent = when ? when.toLocaleString() : '';
    meta.appendChild(sub);

    /* solve stats — only if the preset was saved after a successful solve */
    if (typeof p.iterations === 'number') {
      const stats = document.createElement('div');
      stats.className = 'solve-stats';
      const t = typeof p.solveMs === 'number' ? ` · ${fmtTime(p.solveMs)}` : '';
      stats.textContent = `${fmtInt(p.iterations)} iter${t}`;
      meta.appendChild(stats);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const btnLoad = document.createElement('button');
    btnLoad.textContent = 'Load';
    btnLoad.title = 'Replace the current board with this preset';
    btnLoad.addEventListener('click', () => actionLoadPreset(idx));
    actions.appendChild(btnLoad);
    const btnSave = document.createElement('button');
    btnSave.textContent = 'Save';
    btnSave.title = 'Overwrite this preset with the current board + counts';
    btnSave.addEventListener('click', () => actionOverwritePreset(idx));
    actions.appendChild(btnSave);
    meta.appendChild(actions);

    card.appendChild(meta);
    list.appendChild(card);
  });
}

/* ---------- boot ---------- */

async function main() {
  $('status').textContent = 'loading wasm…';
  await initSolver();
  const L = getLayout();
  state.rows = L.ROWS;
  state.cols = L.COLS;

  state.groups = computeLegionGroups(L.ROWS, L.COLS);
  state.cellToGroup = buildCellToGroup(state.groups, L.ROWS, L.COLS);

  const saved = loadState();
  console.log('[legion-solver] localStorage on boot:', {
    storageKey: 'legionSolver.v1',
    rawAvailable: !!localStorage.getItem('legionSolver.v1'),
    parsed: saved,
    countsSum: saved && Array.isArray(saved.counts) ? saved.counts.reduce((a, b) => a + b, 0) : null,
  });
  if (saved && Array.isArray(saved.board) && saved.board.length === L.ROWS * L.COLS) {
    state.board = new Int8Array(saved.board);
    /* Drop any filled-cell values from a previous solve. We don't restore
     * the placement map across reloads, so the pieces would render without
     * per-piece contours (adjacent same-piece cells would merge). Reverting
     * to the locked/empty input is cleaner — user can re-solve to see it. */
    for (let i = 0; i < state.board.length; i++) {
      if (state.board[i] > 0) state.board[i] = 0;
    }
  } else {
    state.board = makeEmptyBoard(L.ROWS, L.COLS);
  }
  if (saved && Array.isArray(saved.counts) && saved.counts.length === 18) {
    state.counts = new Int32Array(saved.counts);
  }
  if (saved && typeof saved.bigClick === 'boolean') {
    state.bigClick = saved.bigClick;
  }
  if (saved && typeof saved.showMiddle === 'boolean') {
    state.showMiddle = saved.showMiddle;
  }
  if (saved && typeof saved.maxIter === 'string') {
    $('inpMaxIter').value = saved.maxIter;
  }

  buildBoardDom();
  buildPieceTray();
  paintAll();
  updateCounters();
  $('chkBigClick').checked = state.bigClick;
  document.body.classList.toggle('hide-middle', !state.showMiddle);
  $('status').textContent = 'ready';

  $('btnSolve').addEventListener('click', actionSolve);
  $('btnStop').addEventListener('click', actionStop);
  $('btnClearSolution').addEventListener('click', actionClearSolution);
  $('btnClearBoard').addEventListener('click', actionClearBoard);
  $('btnClearCounts').addEventListener('click', actionClearCounts);
  $('chkBigClick').addEventListener('change', (e) => setBigClick(e.target.checked));
  $('middleToggle').addEventListener('click', toggleShowMiddle);
  $('inpMaxIter').addEventListener('change', saveState);
  $('btnSavePreset').addEventListener('click', actionSavePreset);
  $('btnSavePiecePreset').addEventListener('click', actionSavePiecePreset);
  $('themeToggle').addEventListener('click', toggleTheme);

  renderPresets();
  renderPiecePresets();
}

const THEME_KEY = 'legionSolver.theme';
function toggleTheme() {
  /* Class lives on <html> (not <body>) so CSS custom-property overrides
   * reach the html element itself — see style.css for why. */
  const isLight = document.documentElement.classList.toggle('theme-light');
  try { localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark'); } catch {}
  /* Saved-preset thumbnails are baked into canvases with the OLD theme's
   * background. Re-render so they match the new theme. */
  renderPresets();
}

main().catch((err) => {
  $('status').textContent = 'load failed: ' + (err && err.message ? err.message : String(err));
  $('status').className = 'err';
  console.error(err);
});
