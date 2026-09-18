/* Shared solve implementation, used by:
 *  - worker.mjs  (when running inside a Web Worker)
 *  - wasm.mjs    (sync fallback for single-file/file:// builds where the worker
 *                  can't be spawned)
 * Pure functions over an Emscripten Module instance; no global state. */

export function computeLayout(m) {
  return {
    ROWS:           m._legion_board_rows(),
    COLS:           m._legion_board_cols(),
    MAX_PIECES:     18,
    MAX_CELLS:      m._legion_max_cells_per_piece(),
    RESULT_SIZE:    m._legion_sizeof_result(),
    PLACEMENT_SIZE: m._legion_sizeof_placement(),
    o: {
      success:     m._legion_offset_success(),
      nPlacements: m._legion_offset_n_placements(),
      iterations:  m._legion_offset_iterations(),
      finalBoard:  m._legion_offset_final_board(),
      placements:  m._legion_offset_placements(),
    },
    p: {
      pieceId:   m._legion_placement_offset_piece_id(),
      anchorX:   m._legion_placement_offset_anchor_x(),
      anchorY:   m._legion_placement_offset_anchor_y(),
      transform: m._legion_placement_offset_transformation(),
      dir:       m._legion_placement_offset_direction_free(),
      isRest:    m._legion_placement_offset_is_restricted(),
      nCells:    m._legion_placement_offset_n_cells(),
      cellsX:    m._legion_placement_offset_cells_x(),
      cellsY:    m._legion_placement_offset_cells_y(),
    },
  };
}

/**
 * Run one solve. Pure over (Module, layout); no global state.
 *   board:   Int8Array length ROWS*COLS (input: -1 locked, 0 empty)
 *   counts:  Int32Array length 18       (input: per-piece amounts)
 *   maxIter: number                     (0 = no cap)
 * Returns: { ok, success, iterations, finalBoard, placements, ms }
 */
export function runSolve(m, L, board, counts, maxIter) {
  if (board.length !== L.ROWS * L.COLS) throw new Error(`board must be ${L.ROWS * L.COLS} bytes`);
  if (counts.length !== L.MAX_PIECES)    throw new Error(`counts must be ${L.MAX_PIECES} ints`);

  const boardPtr  = m._malloc(L.ROWS * L.COLS);
  const countsPtr = m._malloc(L.MAX_PIECES * 4);
  const resultPtr = m._malloc(L.RESULT_SIZE);
  try {
    m.HEAP8.set(board, boardPtr);
    m.HEAP32.set(counts, countsPtr >> 2);

    const t0 = performance.now();
    const ok = m._legion_solve_wasm(boardPtr, countsPtr, maxIter, resultPtr);
    const t1 = performance.now();

    const dv = new DataView(m.HEAP8.buffer);
    const success = dv.getInt32(resultPtr + L.o.success, true);
    const nPl     = dv.getInt32(resultPtr + L.o.nPlacements, true);
    const itersLo = dv.getUint32(resultPtr + L.o.iterations,     true);
    const itersHi = dv.getInt32 (resultPtr + L.o.iterations + 4, true);
    const iterations = itersHi === 0
      ? itersLo
      : Number((BigInt(itersHi) << 32n) | BigInt(itersLo));

    const finalBoard = new Int8Array(
      m.HEAP8.buffer, resultPtr + L.o.finalBoard, L.ROWS * L.COLS,
    ).slice();

    const placements = [];
    for (let i = 0; i < nPl; i++) {
      const base = resultPtr + L.o.placements + i * L.PLACEMENT_SIZE;
      const nC = dv.getInt8(base + L.p.nCells);
      const cells = [];
      for (let k = 0; k < nC; k++) {
        cells.push([
          dv.getInt8(base + L.p.cellsX + k),
          dv.getInt8(base + L.p.cellsY + k),
        ]);
      }
      placements.push({
        pieceId:   dv.getInt16(base + L.p.pieceId, true),
        anchorX:   dv.getInt16(base + L.p.anchorX, true),
        anchorY:   dv.getInt16(base + L.p.anchorY, true),
        transform: dv.getInt8 (base + L.p.transform),
        dir:       dv.getInt8 (base + L.p.dir),
        isRestricted: !!dv.getInt8(base + L.p.isRest),
        cells,
      });
    }

    return {
      ok: ok === 1,
      success: success === 1,
      iterations,
      finalBoard,
      placements,
      ms: t1 - t0,
    };
  } finally {
    m._free(boardPtr);
    m._free(countsPtr);
    m._free(resultPtr);
  }
}
