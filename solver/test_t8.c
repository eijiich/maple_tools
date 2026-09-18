#include "legion.h"
#include "pieces.h"

#include <stdio.h>
#include <string.h>
#include <stdlib.h>

int main(void) {
    int8_t board[LEGION_BOARD_CELLS];
    for (int i = 0; i < LEGION_BOARD_CELLS; i++) board[i] = -1;
    for (int i = 4; i < 10; i++)
        for (int j = 4; j < 10; j++)
            board[i * LEGION_BOARD_COLS + j] = 0;

    int counts[LEGION_MAX_PIECES] = {0};
    counts[0] = 4;   /* 4 x 1-cell  */
    counts[1] = 4;   /* 4 x 2-cells */
    counts[4] = 6;   /* 6 x 4-cells */

    LegionResult res = {0};
    int ok = legion_solve(board, counts, 5000000, &res);
    printf("Result: %s | iter=%lld\n", ok ? "SUCCESS" : "FAILURE", (long long)res.iterations);

    printf("Final region (row 4..9 col 4..9):\n");
    for (int i = 4; i < 10; i++) {
        for (int j = 4; j < 10; j++) {
            int v = res.final_board[i * LEGION_BOARD_COLS + j];
            if (v == -1) printf(" . ");
            else if (v == 0) printf(" _ ");
            else printf("%2d ", v);
        }
        printf("\n");
    }

    printf("\nFull board (showing only non-(-1) cells):\n");
    for (int i = 0; i < LEGION_BOARD_ROWS; i++) {
        for (int j = 0; j < LEGION_BOARD_COLS; j++) {
            int v = res.final_board[i * LEGION_BOARD_COLS + j];
            if (v != -1) {
                printf("(r=%d,c=%d)=%d ", i, j, v);
            }
        }
    }
    printf("\n");
    return 0;
}
