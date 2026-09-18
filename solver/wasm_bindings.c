#include "legion.h"

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

/*
 * Thin wrapper around legion_solve that uses int32 instead of int64 for
 * max_iterations (avoiding JS BigInt across the boundary).
 *
 * board:        int8_t[LEGION_BOARD_CELLS]  (input, row-major, -1/0)
 * counts:       int32_t[LEGION_MAX_PIECES]  (input, 18 amounts)
 * max_iter:     int32_t                     (input, 0 = no cap)
 * out:          LegionResult*               (output, ~5.5 KB, pre-allocated by caller)
 * returns:      1 on success, 0 on failure
 */
EXPORT
int legion_solve_wasm(const int8_t *board,
                      const int *counts,
                      int max_iter,
                      LegionResult *out)
{
    return legion_solve(board, counts, (int64_t)max_iter, out);
}

/* Layout introspection — lets JS read the result struct without hardcoding offsets. */
EXPORT int legion_sizeof_result(void)     { return (int)sizeof(LegionResult); }
EXPORT int legion_sizeof_placement(void)  { return (int)sizeof(LegionPlacement); }
EXPORT int legion_max_placements(void)    { return LEGION_MAX_PLACEMENTS; }
EXPORT int legion_max_cells_per_piece(void) { return LEGION_MAX_CELLS_PER_PIECE; }
EXPORT int legion_board_rows(void)        { return LEGION_BOARD_ROWS; }
EXPORT int legion_board_cols(void)        { return LEGION_BOARD_COLS; }

EXPORT int legion_offset_success(void)      { return (int)offsetof(LegionResult, success); }
EXPORT int legion_offset_n_placements(void) { return (int)offsetof(LegionResult, n_placements); }
EXPORT int legion_offset_iterations(void)   { return (int)offsetof(LegionResult, iterations); }
EXPORT int legion_offset_final_board(void)  { return (int)offsetof(LegionResult, final_board); }
EXPORT int legion_offset_placements(void)   { return (int)offsetof(LegionResult, placements); }

EXPORT int legion_placement_offset_piece_id(void)       { return (int)offsetof(LegionPlacement, piece_id); }
EXPORT int legion_placement_offset_anchor_x(void)       { return (int)offsetof(LegionPlacement, anchor_x); }
EXPORT int legion_placement_offset_anchor_y(void)       { return (int)offsetof(LegionPlacement, anchor_y); }
EXPORT int legion_placement_offset_transformation(void) { return (int)offsetof(LegionPlacement, transformation); }
EXPORT int legion_placement_offset_direction_free(void) { return (int)offsetof(LegionPlacement, direction_free); }
EXPORT int legion_placement_offset_is_restricted(void)  { return (int)offsetof(LegionPlacement, is_restricted); }
EXPORT int legion_placement_offset_n_cells(void)        { return (int)offsetof(LegionPlacement, n_cells); }
EXPORT int legion_placement_offset_cells_x(void)        { return (int)offsetof(LegionPlacement, cells_x); }
EXPORT int legion_placement_offset_cells_y(void)        { return (int)offsetof(LegionPlacement, cells_y); }
