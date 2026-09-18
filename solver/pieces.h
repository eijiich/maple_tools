#ifndef LEGION_PIECES_H
#define LEGION_PIECES_H

#include <stdint.h>

#define LEGION_MAX_PIECES        18
#define LEGION_DEFAULT_PIECES    15
#define LEGION_GMS_PIECES        3
#define LEGION_MAX_SHAPE         5
#define LEGION_MAX_CELLS         5
#define LEGION_MAX_TRANSFORMS    8

typedef struct {
    uint8_t rows;
    uint8_t cols;
    uint8_t shape[LEGION_MAX_SHAPE][LEGION_MAX_SHAPE];
} LegionRawShape;

extern const LegionRawShape legion_raw_shapes[LEGION_MAX_PIECES];

#endif
