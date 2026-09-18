#include "legion.h"
#include "pieces.h"

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>

static void make_locked_board(int8_t *b) {
    for (int i = 0; i < LEGION_BOARD_CELLS; i++) b[i] = -1;
}

static void open_rect(int8_t *b, int row, int col, int h, int w) {
    for (int i = row; i < row + h; i++)
        for (int j = col; j < col + w; j++)
            b[i * LEGION_BOARD_COLS + j] = 0;
}

static void print_board_region(const int8_t *b, int row, int col, int h, int w) {
    for (int i = row; i < row + h; i++) {
        for (int j = col; j < col + w; j++) {
            int8_t v = b[i * LEGION_BOARD_COLS + j];
            if (v == -1)      printf(" . ");
            else if (v == 0)  printf(" _ ");
            else              printf("%2d ", v);
        }
        printf("\n");
    }
}

static int empty_cells(const int8_t *b) {
    int n = 0;
    for (int i = 0; i < LEGION_BOARD_CELLS; i++) if (b[i] == 0) n++;
    return n;
}

static int total_piece_cells(const int *counts) {
    int total = 0;
    for (int i = 0; i < LEGION_MAX_PIECES; i++) {
        if (counts[i] <= 0) continue;
        int cells = 0;
        const LegionRawShape *r = &legion_raw_shapes[i];
        for (int y = 0; y < r->rows; y++)
            for (int x = 0; x < r->cols; x++)
                if (r->shape[y][x] != 0) cells++;
        total += cells * counts[i];
    }
    return total;
}

static int run_case(const char *name,
                    int8_t *board,
                    const int *piece_counts,
                    int region_row, int region_col, int region_h, int region_w,
                    int expect_success)
{
    int empties = empty_cells(board);
    int piece_cells = total_piece_cells(piece_counts);
    printf("\n=== %s ===\n", name);
    printf("Empty cells: %d, Total piece cells available: %d, Expect: %s\n",
           empties, piece_cells, expect_success ? "SUCCESS" : "FAILURE");
    printf("Initial board (region):\n");
    print_board_region(board, region_row, region_col, region_h, region_w);

    LegionResult res = {0};
    clock_t t0 = clock();
    int ok = legion_solve(board, piece_counts, 5000000, &res);
    clock_t t1 = clock();
    double ms = 1000.0 * (double)(t1 - t0) / CLOCKS_PER_SEC;

    printf("Result: %s | iterations: %lld | time: %.2fms | placements: %d\n",
           ok ? "SUCCESS" : "FAILURE",
           (long long)res.iterations, ms, res.n_placements);
    printf("Final board (region):\n");
    print_board_region(res.final_board, region_row, region_col, region_h, region_w);

    int pass = (ok == expect_success);

    /* Sanity-check placements: every cell listed must be filled by that piece's id (or +18 for middle). */
    if (ok) {
        int cells_used = 0;
        for (int p = 0; p < res.n_placements; p++) {
            const LegionPlacement *pl = &res.placements[p];
            cells_used += pl->n_cells;
            for (int c = 0; c < pl->n_cells; c++) {
                int x = pl->cells_x[c], y = pl->cells_y[c];
                int8_t v = res.final_board[y * LEGION_BOARD_COLS + x];
                int expected_plain = pl->piece_id;
                int expected_mid   = pl->piece_id + 18;
                if (v != expected_plain && v != expected_mid) {
                    printf("  !! placement %d cell (%d,%d) has value %d, expected %d or %d\n",
                           p, x, y, v, expected_plain, expected_mid);
                    pass = 0;
                }
            }
        }
        if (cells_used != piece_cells) {
            printf("  !! placements report %d cells, expected %d\n", cells_used, piece_cells);
            pass = 0;
        }
    }

    printf("Test %s\n", pass ? "PASSED" : "FAILED");
    return pass;
}

int main(void) {
    int passed = 0, total = 0;
    int8_t board[LEGION_BOARD_CELLS];

    /* Test 1: single 1x1 cell, one piece of id 1 */
    {
        make_locked_board(board);
        open_rect(board, 0, 0, 1, 1);
        int counts[LEGION_MAX_PIECES] = {0};
        counts[0] = 1;  /* piece id 1 = single cell */
        total++; passed += run_case("T1: 1x1 + 1xLvl60", board, counts, 0, 0, 1, 1, 1);
    }

    /* Test 2: 2x2 region, one piece of id 5 (2x2 square) */
    {
        make_locked_board(board);
        open_rect(board, 5, 5, 2, 2);
        int counts[LEGION_MAX_PIECES] = {0};
        counts[4] = 1;  /* piece id 5 = 2x2 square */
        total++; passed += run_case("T2: 2x2 + 1xWarrior200", board, counts, 5, 5, 2, 2, 1);
    }

    /* Test 3: 2x2 region with 4 single-cell pieces */
    {
        make_locked_board(board);
        open_rect(board, 5, 5, 2, 2);
        int counts[LEGION_MAX_PIECES] = {0};
        counts[0] = 4;
        total++; passed += run_case("T3: 2x2 + 4xLvl60", board, counts, 5, 5, 2, 2, 1);
    }

    /* Test 4: 1x1 region, one 1x2 piece -> impossible */
    {
        make_locked_board(board);
        open_rect(board, 5, 5, 1, 1);
        int counts[LEGION_MAX_PIECES] = {0};
        counts[1] = 1;  /* piece id 2 = 1x2 */
        total++; passed += run_case("T4: 1x1 + 1xLvl100 (impossible)", board, counts, 5, 5, 1, 1, 0);
    }

    /* Test 5: 4x4 region, four 2x2 squares (16 cells, fits exactly) */
    {
        make_locked_board(board);
        open_rect(board, 5, 5, 4, 4);
        int counts[LEGION_MAX_PIECES] = {0};
        counts[4] = 4;
        total++; passed += run_case("T5: 4x4 + 4xWarrior200", board, counts, 5, 5, 4, 4, 1);
    }

    /* Test 6: 1x3 + 1xMageThiefArcher140 (piece id 4, 1x3 row) */
    {
        make_locked_board(board);
        open_rect(board, 5, 5, 1, 3);
        int counts[LEGION_MAX_PIECES] = {0};
        counts[3] = 1;
        total++; passed += run_case("T6: 1x3 + 1xMageThiefArcher140", board, counts, 5, 5, 1, 3, 1);
    }

    /* Test 7: 1x2 region, 2 single cells */
    {
        make_locked_board(board);
        open_rect(board, 5, 5, 1, 2);
        int counts[LEGION_MAX_PIECES] = {0};
        counts[0] = 2;
        total++; passed += run_case("T7: 1x2 + 2xLvl60", board, counts, 5, 5, 1, 2, 1);
    }

    /* Test 8: a 6x6 region with mixed pieces (1x60 = 4, 1x100 = 4, 2x2 = 7) */
    {
        make_locked_board(board);
        open_rect(board, 4, 4, 6, 6);
        int counts[LEGION_MAX_PIECES] = {0};
        counts[0] = 4;   /* 4 x 1-cell  =  4 cells */
        counts[1] = 4;   /* 4 x 2-cells =  8 cells */
        counts[4] = 6;   /* 6 x 4-cells = 24 cells */
        /* total = 36 cells = 6x6 */
        total++; passed += run_case("T8: 6x6 mixed", board, counts, 4, 4, 6, 6, 1);
    }

    /* T9: 1x3 region, 1 L (3 cells, non-collinear) - cannot fit a straight line. */
    {
        make_locked_board(board);
        open_rect(board, 5, 5, 1, 3);
        int counts[LEGION_MAX_PIECES] = {0};
        counts[2] = 1;
        total++; passed += run_case("T9: 1x3 + 1xL (impossible)", board, counts, 5, 5, 1, 3, 0);
    }

    /* T10: 4x4 region with one L (3 cells) + one 1-cell + three 2x2 = 3+1+12=16 cells */
    {
        make_locked_board(board);
        open_rect(board, 5, 5, 4, 4);
        int counts[LEGION_MAX_PIECES] = {0};
        counts[2] = 1;
        counts[0] = 1;
        counts[4] = 3;
        total++; passed += run_case("T10: 4x4 + L + 1cell + 3x2x2", board, counts, 5, 5, 4, 4, 1);
    }

    /* T11: 8x8 with a chunky mix that requires real backtracking */
    {
        make_locked_board(board);
        open_rect(board, 2, 2, 8, 8);
        int counts[LEGION_MAX_PIECES] = {0};
        counts[0] = 8;   /* 8 x 1   =  8 */
        counts[1] = 4;   /* 4 x 2   =  8 */
        counts[3] = 4;   /* 4 x 3 (1x3)=12 */
        counts[4] = 9;   /* 9 x 4   = 36 */
        /* total = 64 = 8x8 */
        total++; passed += run_case("T11: 8x8 mixed (heavy)", board, counts, 2, 2, 8, 8, 1);
    }

    /* T12: L-shaped region using piece 7 (thief/lab200 = [[1,0,0],[1,2,1]]) */
    {
        make_locked_board(board);
        /* an L-shaped open region: 3 cells horizontal at row 5 cols 5..7, plus row 6 col 5 */
        board[5 * LEGION_BOARD_COLS + 5] = 0;
        board[5 * LEGION_BOARD_COLS + 6] = 0;
        board[5 * LEGION_BOARD_COLS + 7] = 0;
        board[6 * LEGION_BOARD_COLS + 5] = 0;
        int counts[LEGION_MAX_PIECES] = {0};
        counts[6] = 1; /* piece 7, exactly that L shape (or a rotation) */
        total++; passed += run_case("T12: L-shape + piece7", board, counts, 5, 5, 2, 3, 1);
    }

    printf("\n==================\nPASSED: %d / %d\n==================\n", passed, total);
    return (passed == total) ? 0 : 1;
}
