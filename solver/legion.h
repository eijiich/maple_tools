#ifndef LEGION_H
#define LEGION_H

#include <stdint.h>

#define LEGION_BOARD_ROWS 20
#define LEGION_BOARD_COLS 22
#define LEGION_BOARD_CELLS (LEGION_BOARD_ROWS * LEGION_BOARD_COLS)
#define LEGION_MAX_PLACEMENTS 256
#define LEGION_MAX_CELLS_PER_PIECE 5

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int16_t piece_id;          /* 1..18 */
    int16_t anchor_x;          /* board column of the placement anchor */
    int16_t anchor_y;          /* board row of the placement anchor */
    int8_t  transformation;    /* index into the piece's transformations array */
    int8_t  direction_free;    /* solver "directionFree" applied on top (0..5) */
    int8_t  is_restricted;     /* placed via restricted-spot branch */
    int8_t  n_cells;           /* number of (x,y) cells this piece occupies */
    int8_t  cells_x[LEGION_MAX_CELLS_PER_PIECE];
    int8_t  cells_y[LEGION_MAX_CELLS_PER_PIECE];
} LegionPlacement;

typedef struct {
    int             success;
    int             n_placements;
    int64_t         iterations;
    int8_t          final_board[LEGION_BOARD_CELLS];
    LegionPlacement placements[LEGION_MAX_PLACEMENTS];
} LegionResult;

/*
 * Solve the board.
 *   board: row-major LEGION_BOARD_ROWS x LEGION_BOARD_COLS, values -1 (locked) or 0 (empty).
 *   piece_counts: array of LEGION_MAX_PIECES amounts (piece IDs 1..18, index 0 = id 1).
 *   max_iterations: cap on inner-loop iterations; 0 means no cap.
 *   out: populated with the result; must not be NULL.
 * Returns 1 on success, 0 on failure / no solution / iteration cap hit.
 */
int legion_solve(const int8_t *board,
                 const int *piece_counts,
                 int64_t max_iterations,
                 LegionResult *out);

#ifdef __cplusplus
}
#endif

#endif
