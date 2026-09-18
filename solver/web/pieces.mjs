/* Piece definitions — order matches the C side (pieces.c).
 * shape values: 0 empty, 1 filled, 2 filled+middle marker.
 * id is 1-based (matches the WASM piece id). */

export const PIECES = [
  { id: 1,  label: 'Lv 60',                shape: [[2]],                                 },
  { id: 2,  label: 'Lv 100',               shape: [[2, 2]],                               },
  { id: 3,  label: 'Lv 140 Warrior/Pirate', shape: [[1, 0], [2, 1]],                       },
  { id: 4,  label: 'Lv 140 Mage/Thief/Archer', shape: [[1, 2, 1]],                         },
  { id: 5,  label: 'Lv 200 Warrior',       shape: [[2, 2], [2, 2]],                       },
  { id: 6,  label: 'Lv 200 Archer',        shape: [[1, 2, 2, 1]],                         },
  { id: 7,  label: 'Lv 200 Thief/Lab',     shape: [[1, 0, 0], [1, 2, 1]],                 },
  { id: 8,  label: 'Lv 200 Mage',          shape: [[0, 1, 0], [1, 2, 1]],                 },
  { id: 9,  label: 'Lv 200 Pirate',        shape: [[1, 2, 0], [0, 2, 1]],                 },
  { id: 10, label: 'Lv 250 Warrior',       shape: [[1, 1, 2], [0, 1, 1]],                 },
  { id: 11, label: 'Lv 250 Archer',        shape: [[1, 1, 2, 1, 1]],                      },
  { id: 12, label: 'Lv 250 Thief',         shape: [[0, 0, 1], [1, 2, 1], [0, 0, 1]],      },
  { id: 13, label: 'Lv 250 Mage',          shape: [[0, 1, 0], [1, 2, 1], [0, 1, 0]],      },
  { id: 14, label: 'Lv 250 Pirate',        shape: [[1, 2, 0, 0], [0, 1, 1, 1]],           },
  { id: 15, label: 'Lv 250 Xenon',         shape: [[1, 1, 0], [0, 2, 0], [0, 1, 1]],      },
  { id: 16, label: 'Lv 200 Enhanced Lab',  shape: [[1, 0, 0, 0], [0, 1, 2, 1]],           },
  { id: 17, label: 'Lv 250 Enhanced Lab',  shape: [[1, 0, 0, 0, 1], [0, 1, 2, 1, 0]],     },
  { id: 18, label: 'Lv 250 Lab',           shape: [[1, 0, 1], [1, 2, 1]],                 },
];

/* Colors lifted from LegionSolver's pieces.js. Index by piece id. */
export const PIECE_COLORS = {
  1:  'lightpink',
  2:  'lightcoral',
  3:  'indianred',
  4:  'darkseagreen',
  5:  'firebrick',
  6:  'mediumseagreen',
  7:  'purple',
  8:  'dodgerblue',
  9:  'lightsteelblue',
  10: 'maroon',
  11: 'green',
  12: 'indigo',
  13: 'blue',
  14: 'cadetblue',
  15: 'mediumpurple',
  16: 'aquamarine',
  17: 'aquamarine',
  18: 'aquamarine',
};

export function cellCount(shape) {
  let n = 0;
  for (const row of shape) for (const v of row) if (v !== 0) n++;
  return n;
}

/* Resolve a board cell value to {pieceId, isMiddle} or null for empty/locked. */
export function decodeCell(v) {
  if (v <= 0) return null;
  if (v > 18) return { pieceId: v - 18, isMiddle: true };
  return { pieceId: v, isMiddle: false };
}
