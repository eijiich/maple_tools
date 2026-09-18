#include "legion.h"
#include "pieces.h"

#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdio.h>

#ifndef LEGION_DEBUG
#define LEGION_DEBUG 0
#endif

#if LEGION_DEBUG
static FILE *legion_dbg_fp = NULL;
static void legion_dbg_open(void) {
    if (!legion_dbg_fp) legion_dbg_fp = fopen("legion_trace.log", "w");
}
#define DBG(...) do { legion_dbg_open(); if (legion_dbg_fp) { fprintf(legion_dbg_fp, __VA_ARGS__); fflush(legion_dbg_fp); } } while (0)
#else
#define DBG(...) ((void)0)
#endif

#define ROWS LEGION_BOARD_ROWS
#define COLS LEGION_BOARD_COLS
#define BOARD(s, y, x) ((s)->board[(y) * COLS + (x)])
#define IN_BOUNDS(y, x) ((y) >= 0 && (y) < ROWS && (x) >= 0 && (x) < COLS)

/* -------- piece runtime data -------- */

typedef struct {
    int8_t  x, y;
    uint8_t is_middle;
} PiecePoint;

typedef struct {
    PiecePoint points[LEGION_MAX_CELLS];
    uint8_t    n_points;
    int8_t     offCenter;
    uint8_t    rows, cols;
    uint8_t    shape[LEGION_MAX_SHAPE][LEGION_MAX_SHAPE];
} PieceTransform;

typedef struct {
    int16_t id;
    int16_t amount;
    int16_t cellCount;
    uint8_t n_transformations;
    PieceTransform transformations[LEGION_MAX_TRANSFORMS];
    uint8_t restricted_idx[LEGION_MAX_TRANSFORMS];
    uint8_t n_restricted;
} Piece;

/* -------- spots -------- */

typedef struct { int8_t x, y; } Point;
typedef struct { int8_t x, y; uint8_t spotsFilled; } RestrictedPoint;

/* -------- solver state -------- */

typedef struct {
    int8_t board[ROWS * COLS];

    Piece pieces[LEGION_MAX_PIECES + 1];
    int   n_pieces;
    int   pieceLength;

    Point middle[4];
    int   n_middle;

    Point emptySpots[LEGION_BOARD_CELLS];
    int   n_emptySpots;

    RestrictedPoint restrictedSpots[LEGION_BOARD_CELLS];
    int             n_restrictedSpots;

    Point longSpaces[LEGION_BOARD_CELLS];
    int   n_longSpaces;

    int pieceNumber, transformationNumber;
    int restrictedPieceNumber, restrictedTransformationNumber;
    int directionFree;
    int valid;
    int firstAlgorithm;

    int64_t iterations;
    int64_t max_iterations;

    LegionPlacement live[LEGION_MAX_PLACEMENTS];
    int             n_live;
} Solver;

/* -------- stack frame for backtracking -------- */

typedef struct {
    int pieceNumber, transformationNumber;
    int spotsMoved;
    RestrictedPoint restrictedSpots[LEGION_BOARD_CELLS];
    int             n_restrictedSpots;
    Point point;
    int restrictedPieceNumber, restrictedTransformationNumber;
    int directionFree;
    Point longSpaces[LEGION_BOARD_CELLS];
    int   n_longSpaces;
    int position;
    int valid;
    int is_restricted_branch;
} StackFrame;

/* -------- shape utilities (init time only) -------- */

static int shapes_equal(const PieceTransform *a, const PieceTransform *b) {
    if (a->rows != b->rows || a->cols != b->cols) return 0;
    for (int i = 0; i < a->rows; i++)
        for (int j = 0; j < a->cols; j++)
            if (a->shape[i][j] != b->shape[i][j]) return 0;
    return 1;
}

static void compute_derived(PieceTransform *t) {
    t->n_points = 0;
    t->offCenter = 0;
    for (int j = 0; j < t->cols; j++) {
        if (t->shape[0][j] != 0) { t->offCenter = (int8_t)j; break; }
    }
    for (int i = 0; i < t->rows; i++) {
        for (int j = 0; j < t->cols; j++) {
            uint8_t v = t->shape[i][j];
            if (v == 1 || v == 2) {
                t->points[t->n_points].x = (int8_t)j;
                t->points[t->n_points].y = (int8_t)i;
                t->points[t->n_points].is_middle = (v == 2);
                t->n_points++;
            }
        }
    }
}

static void rotate_cw(const PieceTransform *src, PieceTransform *dst) {
    dst->rows = src->cols;
    dst->cols = src->rows;
    memset(dst->shape, 0, sizeof(dst->shape));
    for (int k = 0; k < src->rows; k++) {
        for (int l = 0; l < src->cols; l++) {
            if (src->shape[k][l] != 0) {
                dst->shape[src->cols - l - 1][k] = src->shape[k][l];
            }
        }
    }
    compute_derived(dst);
}

static void flip_v(const PieceTransform *src, PieceTransform *dst) {
    dst->rows = src->rows;
    dst->cols = src->cols;
    memset(dst->shape, 0, sizeof(dst->shape));
    for (int k = 0; k < src->rows; k++) {
        for (int l = 0; l < src->cols; l++) {
            if (src->shape[k][l] != 0) {
                dst->shape[src->rows - k - 1][l] = src->shape[k][l];
            }
        }
    }
    compute_derived(dst);
}

static void init_piece(Piece *p, int id, int amount, const LegionRawShape *raw) {
    p->id = (int16_t)id;
    p->amount = (int16_t)amount;
    p->n_transformations = 0;
    p->n_restricted = 0;

    PieceTransform shape;
    shape.rows = raw->rows;
    shape.cols = raw->cols;
    memset(shape.shape, 0, sizeof(shape.shape));
    for (int i = 0; i < raw->rows; i++)
        for (int j = 0; j < raw->cols; j++)
            shape.shape[i][j] = raw->shape[i][j];
    compute_derived(&shape);

    p->cellCount = (int16_t)shape.n_points;

    /* matches piece.js: 2 mirror states × 4 rotations, dedupe shapes */
    for (int mirror = 0; mirror < 2; mirror++) {
        for (int rot = 0; rot < 4; rot++) {
            PieceTransform rotated;
            rotate_cw(&shape, &rotated);
            shape = rotated;

            int dup = 0;
            for (int t = 0; t < p->n_transformations; t++) {
                if (shapes_equal(&p->transformations[t], &shape)) { dup = 1; break; }
            }
            if (!dup && p->n_transformations < LEGION_MAX_TRANSFORMS) {
                p->transformations[p->n_transformations++] = shape;
            }
        }
        PieceTransform flipped;
        flip_v(&shape, &flipped);
        shape = flipped;
    }

    for (int t = 0; t < p->n_transformations; t++) {
        const PieceTransform *tr = &p->transformations[t];
        int off = tr->offCenter;
        int right = off + 1;
        uint8_t neighbor = (right < tr->cols) ? tr->shape[0][right] : 0;
        if (neighbor == 0) {
            p->restricted_idx[p->n_restricted++] = (uint8_t)t;
        }
    }
}

/* -------- determinePoint / isPlaceable / placePiece / takeBackPiece -------- */

static void determine_point(int dir, Point pos, const PieceTransform *piece,
                            const PiecePoint *pt, int *out_x, int *out_y) {
    int x, y;
    int off = piece->offCenter;
    if (dir == 0 || dir == 3 || dir == 5) {
        x = pos.x + pt->x - off;
        y = pos.y + pt->y;
    } else if (dir == 1) {
        x = pos.x - pt->x + off;
        y = pos.y - pt->y;
    } else if (dir == 2) {
        x = pos.x + pt->y;
        y = pos.y + pt->x - off;
    } else {
        x = pos.x - pt->y;
        y = pos.y - pt->x + off;
    }
    *out_x = x;
    *out_y = y;
}

static int is_placeable(const Solver *s, Point pos, const PieceTransform *piece) {
    if (piece == NULL || piece->n_points == 0) return 0;
    for (int i = 0; i < piece->n_points; i++) {
        int x, y;
        determine_point(s->directionFree, pos, piece, &piece->points[i], &x, &y);
        if (!IN_BOUNDS(y, x)) return 0;
        if (s->board[y * COLS + x] != 0) return 0;
    }
    return 1;
}

static void search_surroundings(Solver *s, int x, int y) {
    if (!IN_BOUNDS(y, x)) return;
    if (BOARD(s, y, x) != 0) return;
    int free_neighbors = 0;
    if (IN_BOUNDS(y + 1, x) && BOARD(s, y + 1, x) == 0) free_neighbors++;
    if (IN_BOUNDS(y - 1, x) && BOARD(s, y - 1, x) == 0) free_neighbors++;
    if (IN_BOUNDS(y, x + 1) && BOARD(s, y, x + 1) == 0) free_neighbors++;
    if (IN_BOUNDS(y, x - 1) && BOARD(s, y, x - 1) == 0) free_neighbors++;
    if (free_neighbors <= 1) {
        RestrictedPoint *rp = &s->restrictedSpots[s->n_restrictedSpots++];
        rp->x = (int8_t)x;
        rp->y = (int8_t)y;
        rp->spotsFilled = (uint8_t)(4 - free_neighbors);
    }
}

/* "vertical": vertical neighbors empty, horizontal neighbors filled.
 * "horizontal": horizontal neighbors empty, vertical neighbors filled.
 * Returns 1 if matched (added to longSpaces), 0 otherwise. */
static int check_long_space(const Solver *s, int x, int y) {
    int up    = IN_BOUNDS(y - 1, x) && BOARD(s, y - 1, x) == 0;
    int down  = IN_BOUNDS(y + 1, x) && BOARD(s, y + 1, x) == 0;
    int left  = IN_BOUNDS(y, x - 1) && BOARD(s, y, x - 1) == 0;
    int right = IN_BOUNDS(y, x + 1) && BOARD(s, y, x + 1) == 0;
    if (!IN_BOUNDS(y, x)) return 0;
    /* upstream checks `!= 0` (i.e. truthy) for the filled sides, matching out-of-bounds too */
    int left_filled = !left;
    int right_filled = !right;
    int up_filled = !up;
    int down_filled = !down;
    if (down && up && right_filled && left_filled) return 1;
    if (down_filled && up_filled && right && left) return 1;
    return 0;
}

static int cmp_restricted_desc(const void *a, const void *b) {
    const RestrictedPoint *ra = a;
    const RestrictedPoint *rb = b;
    return (int)rb->spotsFilled - (int)ra->spotsFilled;
}

static void is_valid_check(Solver *s) {
    if (s->n_middle == 0) { s->valid = 1; return; }
    int normal = 0;
    for (int i = 0; i < s->n_middle; i++) {
        int8_t v = BOARD(s, s->middle[i].y, s->middle[i].x);
        if (v > 0 && v <= s->pieceLength) normal++;
    }
    s->valid = (normal != s->n_middle);
}

static void place_piece(Solver *s, Point pos, const PieceTransform *piece, int piece_id) {
    int8_t placed_x[LEGION_MAX_CELLS];
    int8_t placed_y[LEGION_MAX_CELLS];
    int n_placed = 0;

#if LEGION_DEBUG
    DBG( "PLACE piece_id=%d at (%d,%d) dir=%d cells=", piece_id, pos.x, pos.y, s->directionFree);
#endif
    for (int i = 0; i < piece->n_points; i++) {
        int x, y;
        determine_point(s->directionFree, pos, piece, &piece->points[i], &x, &y);
#if LEGION_DEBUG
        DBG( "(%d,%d) ", x, y);
#endif
        if (piece->points[i].is_middle) {
            BOARD(s, y, x) = (int8_t)(piece_id + 18);
        } else {
            BOARD(s, y, x) = (int8_t)piece_id;
        }
        placed_x[n_placed] = (int8_t)x;
        placed_y[n_placed] = (int8_t)y;
        n_placed++;

        for (int k = 0; k < s->n_restrictedSpots; ) {
            if (s->restrictedSpots[k].x == x && s->restrictedSpots[k].y == y) {
                s->restrictedSpots[k] = s->restrictedSpots[--s->n_restrictedSpots];
            } else {
                k++;
            }
        }
        for (int k = 0; k < s->n_longSpaces; ) {
            if (s->longSpaces[k].x == x && s->longSpaces[k].y == y) {
                s->longSpaces[k] = s->longSpaces[--s->n_longSpaces];
            } else {
                k++;
            }
        }
        if (s->n_longSpaces == 0) s->firstAlgorithm = 0;
    }
#if LEGION_DEBUG
    DBG( "\n");
#endif

    for (int i = 0; i < n_placed; i++) {
        search_surroundings(s, placed_x[i], placed_y[i] + 1);
        search_surroundings(s, placed_x[i], placed_y[i] - 1);
        search_surroundings(s, placed_x[i] + 1, placed_y[i]);
        search_surroundings(s, placed_x[i] - 1, placed_y[i]);
    }

    /* upstream dedup (faithful 1:1 port — replicates upstream behavior) */
    int marks[LEGION_BOARD_CELLS];
    int n_marks = 0;
    for (int i = 0; i + 1 < s->n_restrictedSpots; i++) {
        for (int j = i + 1; j < s->n_restrictedSpots; j++) {
            if (s->restrictedSpots[i].x == s->restrictedSpots[j].x &&
                s->restrictedSpots[i].y == s->restrictedSpots[j].y) {
                marks[n_marks++] = i;
            }
        }
    }
    for (int m = n_marks - 1; m >= 0; m--) {
        int idx = marks[m];
        for (int k = idx + 1; k < s->n_restrictedSpots; k++) {
            s->restrictedSpots[k - 1] = s->restrictedSpots[k];
        }
        s->n_restrictedSpots--;
    }

    qsort(s->restrictedSpots, (size_t)s->n_restrictedSpots,
          sizeof(RestrictedPoint), cmp_restricted_desc);
}

static void take_back_piece(Solver *s, Point pos, const PieceTransform *piece) {
#if LEGION_DEBUG
    DBG( "UNDO at (%d,%d) dir=%d cells=", pos.x, pos.y, s->directionFree);
#endif
    for (int i = 0; i < piece->n_points; i++) {
        int x, y;
        determine_point(s->directionFree, pos, piece, &piece->points[i], &x, &y);
#if LEGION_DEBUG
        DBG( "(%d,%d) ", x, y);
#endif
        if (IN_BOUNDS(y, x)) BOARD(s, y, x) = 0;
    }
#if LEGION_DEBUG
    DBG( "\n");
#endif
}

/* -------- piece-list maintenance: takeFromList / returnToList -------- */

static int weight(const Piece *p) {
    return (int)p->amount * (int)p->cellCount;
}

static int take_from_list(Solver *s, int placement) {
    s->pieces[placement].amount--;
    int index = placement + 1;
    while (index < s->n_pieces &&
           weight(&s->pieces[placement]) < weight(&s->pieces[index])) {
        index++;
    }
    int target = index - 1;
    Piece tmp = s->pieces[placement];
    s->pieces[placement] = s->pieces[target];
    s->pieces[target] = tmp;
    return target - placement;
}

static void return_to_list(Solver *s, int placement, int spotsMoved) {
    int target = placement + spotsMoved;
    Piece tmp = s->pieces[placement];
    s->pieces[placement] = s->pieces[target];
    s->pieces[target] = tmp;
    s->pieces[placement].amount++;
}

/* -------- changeIndex / determineDirectionFree -------- */

static void change_index(Solver *s, int restricted) {
    if (restricted) {
        const Piece *p = &s->pieces[s->restrictedPieceNumber];
        if (s->restrictedTransformationNumber < (int)p->n_restricted - 1) {
            s->restrictedTransformationNumber++;
        } else {
            s->restrictedPieceNumber++;
            s->restrictedTransformationNumber = 0;
        }
    } else {
        const Piece *p = &s->pieces[s->pieceNumber];
        if (s->transformationNumber < (int)p->n_transformations - 1) {
            s->transformationNumber++;
        } else {
            s->pieceNumber++;
            s->transformationNumber = 0;
        }
    }
}

static void determine_direction_free(Solver *s, Point pt) {
    if (IN_BOUNDS(pt.y - 1, pt.x) && BOARD(s, pt.y - 1, pt.x) == 0) {
        s->directionFree = 1;
    } else if (IN_BOUNDS(pt.y, pt.x + 1) && BOARD(s, pt.y, pt.x + 1) == 0) {
        s->directionFree = 2;
    } else if (IN_BOUNDS(pt.y + 1, pt.x) && BOARD(s, pt.y + 1, pt.x) == 0) {
        s->directionFree = 3;
    } else if (IN_BOUNDS(pt.y, pt.x - 1) && BOARD(s, pt.y, pt.x - 1) == 0) {
        s->directionFree = 4;
    } else {
        s->directionFree = 5;
    }
}

static const PieceTransform *current_transformation(const Piece *p, int t_idx, int restricted) {
    if (restricted) {
        if (t_idx < 0 || t_idx >= (int)p->n_restricted) return NULL;
        return &p->transformations[p->restricted_idx[t_idx]];
    }
    if (t_idx < 0 || t_idx >= (int)p->n_transformations) return NULL;
    return &p->transformations[t_idx];
}

/* -------- piece comparator (weight desc, stable by id) -------- */

static int cmp_pieces_desc(const void *a, const void *b) {
    const Piece *pa = a;
    const Piece *pb = b;
    int wa = weight(pa);
    int wb = weight(pb);
    if (wa != wb) return wb - wa;
    return pa->id - pb->id;
}

/* -------- main solver -------- */

static int solve_internal(Solver *s, StackFrame *stack, LegionResult *out) {
    int stack_top = 0;
    int position = 0;
    Point point = { 0, 0 };

    while (s->pieces[0].amount > 0 || !s->valid) {
        int restricted_branch_taken = -1;
        DBG("ITER %lld | rPN=%d rTN=%d pN=%d tN=%d dir=%d rSpots=%d lSp=%d firstAlg=%d valid=%d p0.id=%d p0.amount=%d\n",
            (long long)s->iterations,
            s->restrictedPieceNumber, s->restrictedTransformationNumber,
            s->pieceNumber, s->transformationNumber,
            s->directionFree, s->n_restrictedSpots, s->n_longSpaces,
            s->firstAlgorithm, s->valid,
            s->pieces[0].id, s->pieces[0].amount);

        if (s->valid && s->n_restrictedSpots != 0 &&
            s->pieces[s->restrictedPieceNumber].amount > 0 &&
            s->directionFree != 5 && !s->firstAlgorithm)
        {
            DBG("  branch=RESTRICTED rPiece.id=%d rPiece.n_restricted=%d rTN=%d\n",
                s->pieces[s->restrictedPieceNumber].id,
                s->pieces[s->restrictedPieceNumber].n_restricted,
                s->restrictedTransformationNumber);
            if (s->restrictedPieceNumber != s->pieceLength) {
                point = (Point){ s->restrictedSpots[0].x, s->restrictedSpots[0].y };
                const Piece *p = &s->pieces[s->restrictedPieceNumber];
                const PieceTransform *piece =
                    current_transformation(p, s->restrictedTransformationNumber, 1);
                determine_direction_free(s, point);
                if (is_placeable(s, point, piece)) {
                    /* take_from_list will swap s->pieces[restrictedPieceNumber] with another
                     * slot. Snapshot id + transform here so they survive the reorder. */
                    int placed_id = p->id;
                    PieceTransform placed = *piece;
                    int placed_trans_idx = p->restricted_idx[s->restrictedTransformationNumber];
                    int placed_dir = s->directionFree;

                    StackFrame *fr = &stack[stack_top++];
                    fr->pieceNumber = 0;
                    fr->transformationNumber = 0;
                    fr->spotsMoved = take_from_list(s, s->restrictedPieceNumber);
                    fr->n_restrictedSpots = s->n_restrictedSpots;
                    memcpy(fr->restrictedSpots, s->restrictedSpots,
                           (size_t)s->n_restrictedSpots * sizeof(RestrictedPoint));
                    fr->point = point;
                    fr->restrictedPieceNumber = s->restrictedPieceNumber;
                    fr->restrictedTransformationNumber = s->restrictedTransformationNumber;
                    fr->directionFree = s->directionFree;
                    fr->n_longSpaces = 0;
                    fr->position = 0;
                    fr->valid = s->valid;
                    fr->is_restricted_branch = 1;

                    for (int k = 1; k < s->n_restrictedSpots; k++) {
                        s->restrictedSpots[k - 1] = s->restrictedSpots[k];
                    }
                    s->n_restrictedSpots--;

                    place_piece(s, point, &placed, placed_id);
                    is_valid_check(s);

                    LegionPlacement *pl = &s->live[s->n_live++];
                    pl->piece_id = (int16_t)placed_id;
                    pl->anchor_x = (int16_t)point.x;
                    pl->anchor_y = (int16_t)point.y;
                    pl->transformation = (int8_t)placed_trans_idx;
                    pl->direction_free = (int8_t)placed_dir;
                    pl->is_restricted = 1;
                    pl->n_cells = (int8_t)placed.n_points;
                    for (int i = 0; i < placed.n_points; i++) {
                        int x, y;
                        determine_point(placed_dir, point, &placed, &placed.points[i], &x, &y);
                        pl->cells_x[i] = (int8_t)x;
                        pl->cells_y[i] = (int8_t)y;
                    }

                    s->restrictedPieceNumber = 0;
                    s->restrictedTransformationNumber = 0;
                    restricted_branch_taken = 1;
                } else {
                    change_index(s, 1);
                }
            }
        }
        else if (s->valid && s->pieces[s->pieceNumber].amount > 0 &&
                 (s->firstAlgorithm || s->n_restrictedSpots == 0) &&
                 s->directionFree != 5)
        {
            DBG("  branch=FREE pPiece.id=%d pPiece.n_trans=%d tN=%d\n",
                s->pieces[s->pieceNumber].id,
                s->pieces[s->pieceNumber].n_transformations,
                s->transformationNumber);
            s->directionFree = 0;
            if (!s->firstAlgorithm) {
                position = 0;
                while (position < s->n_emptySpots &&
                       BOARD(s, s->emptySpots[position].y, s->emptySpots[position].x) != 0) {
                    position++;
                }
            }
            if (position == s->n_emptySpots) {
                goto success;
            }
            point = s->emptySpots[position];
            const Piece *p = &s->pieces[s->pieceNumber];
            const PieceTransform *piece =
                current_transformation(p, s->transformationNumber, 0);
            if (is_placeable(s, point, piece)) {
                int placed_id = p->id;
                PieceTransform placed = *piece;
                int placed_trans_idx = s->transformationNumber;
                int placed_dir = 0;

                StackFrame *fr = &stack[stack_top++];
                fr->pieceNumber = s->pieceNumber;
                fr->transformationNumber = s->transformationNumber;
                fr->spotsMoved = take_from_list(s, s->pieceNumber);
                fr->n_restrictedSpots = s->n_restrictedSpots;
                memcpy(fr->restrictedSpots, s->restrictedSpots,
                       (size_t)s->n_restrictedSpots * sizeof(RestrictedPoint));
                fr->point = point;
                fr->restrictedPieceNumber = 0;
                fr->restrictedTransformationNumber = 0;
                fr->directionFree = 0;
                fr->n_longSpaces = s->n_longSpaces;
                memcpy(fr->longSpaces, s->longSpaces,
                       (size_t)s->n_longSpaces * sizeof(Point));
                fr->position = position;
                fr->valid = s->valid;
                fr->is_restricted_branch = 0;

                place_piece(s, point, &placed, placed_id);
                is_valid_check(s);

                LegionPlacement *pl = &s->live[s->n_live++];
                pl->piece_id = (int16_t)placed_id;
                pl->anchor_x = (int16_t)point.x;
                pl->anchor_y = (int16_t)point.y;
                pl->transformation = (int8_t)placed_trans_idx;
                pl->direction_free = (int8_t)placed_dir;
                pl->is_restricted = 0;
                pl->n_cells = (int8_t)placed.n_points;
                for (int i = 0; i < placed.n_points; i++) {
                    int x, y;
                    determine_point(placed_dir, point, &placed, &placed.points[i], &x, &y);
                    pl->cells_x[i] = (int8_t)x;
                    pl->cells_y[i] = (int8_t)y;
                }

                if (s->firstAlgorithm) {
                    while (position < s->n_emptySpots &&
                           BOARD(s, s->emptySpots[position].y, s->emptySpots[position].x) != 0) {
                        position++;
                    }
                    if (position == s->n_emptySpots) {
                        goto success;
                    }
                }

                s->pieceNumber = 0;
                s->transformationNumber = 0;
                restricted_branch_taken = 0;
            } else {
                change_index(s, 0);
            }
        }
        else {
            DBG("  branch=BACKTRACK stack_top=%d\n", stack_top);
            if (stack_top == 0) {
                /* nothing left to pop — failure */
                s->iterations++;
                return 0;
            }
            if (!s->valid) s->valid = 1;

            StackFrame *fr = &stack[--stack_top];
            s->pieceNumber = fr->pieceNumber;
            s->transformationNumber = fr->transformationNumber;
            memcpy(s->restrictedSpots, fr->restrictedSpots,
                   (size_t)fr->n_restrictedSpots * sizeof(RestrictedPoint));
            s->n_restrictedSpots = fr->n_restrictedSpots;
            point = fr->point;
            s->restrictedPieceNumber = fr->restrictedPieceNumber;
            s->restrictedTransformationNumber = fr->restrictedTransformationNumber;
            s->directionFree = fr->directionFree;
            memcpy(s->longSpaces, fr->longSpaces, (size_t)fr->n_longSpaces * sizeof(Point));
            s->n_longSpaces = fr->n_longSpaces;
            position = fr->position;
            s->valid = fr->valid;

            if (fr->directionFree == 0) {
                return_to_list(s, s->pieceNumber, fr->spotsMoved);
                const Piece *p = &s->pieces[s->pieceNumber];
                const PieceTransform *piece =
                    current_transformation(p, s->transformationNumber, 0);
                if (piece) take_back_piece(s, point, piece);
            } else {
                return_to_list(s, s->restrictedPieceNumber, fr->spotsMoved);
                const Piece *p = &s->pieces[s->restrictedPieceNumber];
                const PieceTransform *piece =
                    current_transformation(p, s->restrictedTransformationNumber, 1);
                if (piece) take_back_piece(s, point, piece);
            }

            if (s->n_live > 0) s->n_live--;

            s->firstAlgorithm = (s->n_longSpaces != 0);
            if (!s->firstAlgorithm) {
                /* upstream: `!this.restrictedSpots.length == 0`
                 * which is `(!len) == 0` -> true iff len != 0. */
                change_index(s, s->n_restrictedSpots != 0);
            } else {
                change_index(s, 0);
            }
        }

        s->iterations++;
        if (s->max_iterations > 0 && s->iterations >= s->max_iterations) {
            return 0;
        }
        (void)restricted_branch_taken; /* reserved for future progress reporting */
    }

success:
    /* board is fully placed — extract history from board cells */
    return 1;
}

/* -------- public entry point -------- */

int legion_solve(const int8_t *board, const int *piece_counts,
                 int64_t max_iterations, LegionResult *out)
{
    if (!board || !piece_counts || !out) return 0;
    memset(out, 0, sizeof(*out));

    Solver *s = (Solver *)calloc(1, sizeof(Solver));
    if (!s) return 0;
    StackFrame *stack = (StackFrame *)calloc(LEGION_MAX_PLACEMENTS, sizeof(StackFrame));
    if (!stack) { free(s); return 0; }

    memcpy(s->board, board, (size_t)LEGION_BOARD_CELLS);

    /* include all 18 piece definitions (matches JS: pieces array carries
     * zero-amount entries too, and pieceLength = pieces.length). */
    for (int i = 0; i < LEGION_MAX_PIECES; i++) {
        init_piece(&s->pieces[i], i + 1, piece_counts[i], &legion_raw_shapes[i]);
    }
    s->pieceLength = LEGION_MAX_PIECES;
    qsort(s->pieces, LEGION_MAX_PIECES, sizeof(Piece), cmp_pieces_desc);
    Piece sentinel = {0};
    sentinel.id = -1;
    s->pieces[LEGION_MAX_PIECES] = sentinel;
    s->n_pieces = LEGION_MAX_PIECES + 1;

    /* middle cells */
    s->n_middle = 0;
    for (int i = ROWS / 2 - 1; i < ROWS / 2 + 1; i++) {
        for (int j = COLS / 2 - 1; j < COLS / 2 + 1; j++) {
            if (s->board[i * COLS + j] != -1) {
                s->middle[s->n_middle].x = (int8_t)j;
                s->middle[s->n_middle].y = (int8_t)i;
                s->n_middle++;
            }
        }
    }

    /* empty spots — row-major scan order */
    s->n_emptySpots = 0;
    for (int i = 0; i < ROWS; i++) {
        for (int j = 0; j < COLS; j++) {
            if (s->board[i * COLS + j] == 0) {
                s->emptySpots[s->n_emptySpots].x = (int8_t)j;
                s->emptySpots[s->n_emptySpots].y = (int8_t)i;
                s->n_emptySpots++;
            }
        }
    }

    /* initial restricted spots scan */
    s->n_restrictedSpots = 0;
    for (int i = 0; i < ROWS; i++) {
        for (int j = 0; j < COLS; j++) {
            search_surroundings(s, j, i);
        }
    }

    /* long spaces */
    s->n_longSpaces = 0;
    for (int i = 0; i < ROWS; i++) {
        for (int j = 0; j < COLS; j++) {
            if (check_long_space(s, j, i)) {
                s->longSpaces[s->n_longSpaces].x = (int8_t)j;
                s->longSpaces[s->n_longSpaces].y = (int8_t)i;
                s->n_longSpaces++;
            }
        }
    }
    s->firstAlgorithm = (s->n_longSpaces > 0);

    /* sort restrictedSpots by spotsFilled desc */
    qsort(s->restrictedSpots, (size_t)s->n_restrictedSpots,
          sizeof(RestrictedPoint), cmp_restricted_desc);

    s->valid = 1;
    s->iterations = 0;
    s->max_iterations = max_iterations;

    int result = solve_internal(s, stack, out);

    out->success = result;
    out->iterations = s->iterations;
    memcpy(out->final_board, s->board, (size_t)LEGION_BOARD_CELLS);

    int n = s->n_live;
    if (n > LEGION_MAX_PLACEMENTS) n = LEGION_MAX_PLACEMENTS;
    out->n_placements = n;
    memcpy(out->placements, s->live, (size_t)n * sizeof(LegionPlacement));

    free(stack);
    free(s);
    return result;
}
