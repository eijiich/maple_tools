import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import legionInit from './web/legion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let failed = 0, passed = 0;

const Module = await legionInit({
  locateFile: (path) => resolve(__dirname, 'web', path),
});

const ROWS = Module._legion_board_rows();
const COLS = Module._legion_board_cols();
const CELLS = ROWS * COLS;
const MAX_PIECES = 18;
const RESULT_SIZE = Module._legion_sizeof_result();
const PLACEMENT_SIZE = Module._legion_sizeof_placement();
console.log(`board ${ROWS}x${COLS}  result=${RESULT_SIZE}B  placement=${PLACEMENT_SIZE}B`);

// Offsets — read once
const O = {
  success:      Module._legion_offset_success(),
  nPlacements:  Module._legion_offset_n_placements(),
  iterations:   Module._legion_offset_iterations(),
  finalBoard:   Module._legion_offset_final_board(),
  placements:   Module._legion_offset_placements(),
};
const P = {
  pieceId:    Module._legion_placement_offset_piece_id(),
  anchorX:    Module._legion_placement_offset_anchor_x(),
  anchorY:    Module._legion_placement_offset_anchor_y(),
  transform:  Module._legion_placement_offset_transformation(),
  dir:        Module._legion_placement_offset_direction_free(),
  isRest:     Module._legion_placement_offset_is_restricted(),
  nCells:     Module._legion_placement_offset_n_cells(),
  cellsX:     Module._legion_placement_offset_cells_x(),
  cellsY:     Module._legion_placement_offset_cells_y(),
};

function solve(boardArr, counts, maxIter = 5_000_000) {
  const boardPtr = Module._malloc(CELLS);
  const countsPtr = Module._malloc(MAX_PIECES * 4);
  const resultPtr = Module._malloc(RESULT_SIZE);
  Module.HEAP8.set(boardArr, boardPtr);
  Module.HEAP32.set(counts, countsPtr >> 2);

  const t0 = performance.now();
  const ok = Module._legion_solve_wasm(boardPtr, countsPtr, maxIter, resultPtr);
  const t1 = performance.now();

  const dv = new DataView(Module.HEAP8.buffer);
  const success = dv.getInt32(resultPtr + O.success, true);
  const nPl     = dv.getInt32(resultPtr + O.nPlacements, true);
  const itersLo = dv.getUint32(resultPtr + O.iterations,     true);
  const itersHi = dv.getInt32 (resultPtr + O.iterations + 4, true);
  const iterations = itersHi === 0 ? itersLo : Number((BigInt(itersHi) << 32n) | BigInt(itersLo));

  const finalBoard = new Int8Array(Module.HEAP8.buffer, resultPtr + O.finalBoard, CELLS).slice();

  const placements = [];
  for (let i = 0; i < nPl; i++) {
    const base = resultPtr + O.placements + i * PLACEMENT_SIZE;
    const nC = dv.getInt8(base + P.nCells);
    const cells = [];
    for (let k = 0; k < nC; k++) {
      cells.push([dv.getInt8(base + P.cellsX + k), dv.getInt8(base + P.cellsY + k)]);
    }
    placements.push({
      pieceId:   dv.getInt16(base + P.pieceId, true),
      anchorX:   dv.getInt16(base + P.anchorX, true),
      anchorY:   dv.getInt16(base + P.anchorY, true),
      transform: dv.getInt8 (base + P.transform),
      dir:       dv.getInt8 (base + P.dir),
      isRest:    !!dv.getInt8(base + P.isRest),
      cells,
    });
  }

  Module._free(boardPtr);
  Module._free(countsPtr);
  Module._free(resultPtr);
  return { ok, success, nPlacements: nPl, iterations, finalBoard, placements, ms: t1 - t0 };
}

function openRegion(row, col, h, w) {
  const b = new Int8Array(CELLS).fill(-1);
  for (let r = row; r < row + h; r++)
    for (let c = col; c < col + w; c++)
      b[r * COLS + c] = 0;
  return b;
}

function makeCounts(spec) {
  const c = new Int32Array(MAX_PIECES);
  for (const [pieceId, n] of Object.entries(spec)) c[+pieceId - 1] = n;
  return c;
}

function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`PASS ${name}`); }
  else      { failed++; console.log(`FAIL ${name}  ${detail}`); }
}

// T1: 1x1, 1xLvl60 (piece 1)
{
  const r = solve(openRegion(0, 0, 1, 1), makeCounts({ 1: 1 }));
  check('T1 success',       r.success === 1);
  check('T1 placements==1', r.nPlacements === 1);
  check('T1 cell filled',   r.finalBoard[0] === 19, `got ${r.finalBoard[0]}`);
}

// T8: 6x6 mixed
{
  const r = solve(openRegion(4, 4, 6, 6), makeCounts({ 1: 4, 2: 4, 5: 6 }));
  check('T8 success', r.success === 1);
  let emptiesAfter = 0;
  for (let i = 4; i < 10; i++)
    for (let j = 4; j < 10; j++)
      if (r.finalBoard[i * COLS + j] === 0) emptiesAfter++;
  check('T8 region fully filled', emptiesAfter === 0, `empties=${emptiesAfter}`);
  // Verify each placement's reported cells match the board
  for (const p of r.placements) {
    for (const [x, y] of p.cells) {
      const v = r.finalBoard[y * COLS + x];
      if (v !== p.pieceId && v !== p.pieceId + 18) {
        check(`T8 placement piece=${p.pieceId} cell ok`, false,
              `(${x},${y})=${v} expected ${p.pieceId} or ${p.pieceId + 18}`);
        break;
      }
    }
  }
  check('T8 all placements internally consistent', true);
  console.log(`  T8 iter=${r.iterations}  ms=${r.ms.toFixed(2)}`);
}

// T8 again to check warm-cache perf
{
  const r = solve(openRegion(4, 4, 6, 6), makeCounts({ 1: 4, 2: 4, 5: 6 }));
  check('T8 (re-run) success', r.success === 1);
  console.log(`  T8 re-run iter=${r.iterations}  ms=${r.ms.toFixed(2)}`);
}

// T11-style heavier: 8x8 mixed
{
  const r = solve(openRegion(2, 2, 8, 8), makeCounts({ 1: 8, 2: 4, 4: 4, 5: 9 }));
  check('T11 success', r.success === 1, `iter=${r.iterations}`);
  console.log(`  T11 iter=${r.iterations}  ms=${r.ms.toFixed(2)}`);
}

console.log(`\nPASSED ${passed} / FAILED ${failed}`);
process.exit(failed === 0 ? 0 : 1);
