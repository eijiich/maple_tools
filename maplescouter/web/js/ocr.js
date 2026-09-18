// ocr.js — bitmap-font template matching for MapleStory UI text.
//
// MapleStory draws its UI with a fixed bitmap font at a fixed pixel size, which
// means reading it is exact template matching rather than statistical OCR. The
// whole pipeline is: colour-key the text out of the background, split the mask
// into glyph columns, and look each glyph up in a table of known bitmaps.
//
// There is deliberately no thresholding/PSM/voting machinery here. The Python
// version needed it because Tesseract guesses at 7px-tall stylised digits; a
// table lookup does not guess, so a correct read is bit-exact and an unknown
// glyph is reported as unknown instead of silently becoming a plausible digit.

window.OCR = (function () {
  "use strict";

  // Glyphs inside one value sit 2-6px apart. Text bleeding in from a
  // neighbouring row is 16px+ away, so this gap cleanly separates them.
  var GROUP_GAP = 6;

  // Above this fraction of differing pixels a glyph is called unknown rather
  // than snapped to the nearest template. Real matches measure 0.
  var MAX_GLYPH_DIST = 0.2;

  // ---------------------------------------------------------------- masks

  // OpenCV's 8-bit HSV convention (H 0-180, S/V 0-255) so the thresholds
  // carry over from the Python unchanged.
  function toHsv(r, g, b) {
    var v = r > g ? (r > b ? r : b) : (g > b ? g : b);
    var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    var d = v - mn;
    var s = v === 0 ? 0 : (255 * d) / v;
    var h;
    if (d === 0) h = 0;
    else if (v === r) h = (30 * (g - b)) / d;
    else if (v === g) h = 60 + (30 * (b - r)) / d;
    else h = 120 + (30 * (r - g)) / d;
    if (h < 0) h += 180;
    return [h, s, v];
  }

  // Stat window text is white, or yellow when the value is buffed/upgraded.
  function keyStat(h, s, v) {
    return (s <= 60 && v >= 170) || (h >= 15 && h <= 35 && s >= 80 && v >= 150);
  }

  // Hexa badges are near-white digits over a saturated fill of any hue.
  function keyHexa(h, s, v) {
    return s <= 80 && v >= 160;
  }

  var KEYS = { stat: keyStat, hexa: keyHexa };

  /**
   * Colour-key a whole ImageData into a binary mask.
   *
   * Done once per screenshot and then sliced: anchor location and all 22 ROI
   * reads share one mask rather than each re-keying pixels. On a 1920x1080 frame
   * that is ~2M HSV conversions instead of ~2M per panel.
   */
  function fullMask(img, kind) {
    var key = KEYS[kind || "stat"];
    var w = img.width, h = img.height;
    var bits = new Uint8Array(w * h);
    var data = img.data;
    for (var p = 0, i = 0; i < bits.length; i++, p += 4) {
      var hsv = toHsv(data[p], data[p + 1], data[p + 2]);
      if (key(hsv[0], hsv[1], hsv[2])) bits[i] = 1;
    }
    return { w: w, h: h, bits: bits };
  }

  /**
   * Slice a rectangle out of a mask. Out-of-bounds pixels read as background,
   * so a partly off-screen ROI degrades instead of throwing.
   */
  function subMask(m, x, y, w, h) {
    var bits = new Uint8Array(w * h);
    for (var j = 0; j < h; j++) {
      var sy = y + j;
      if (sy < 0 || sy >= m.h) continue;
      for (var i = 0; i < w; i++) {
        var sx = x + i;
        if (sx < 0 || sx >= m.w) continue;
        bits[j * w + i] = m.bits[sy * m.w + sx];
      }
    }
    return { w: w, h: h, bits: bits };
  }

  // ------------------------------------------------------------ segmenting

  /** Column runs of set pixels — one per glyph, given the font has no kerning overlap. */
  function segment(m) {
    var runs = [];
    var start = -1;
    for (var i = 0; i < m.w; i++) {
      var on = false;
      for (var j = 0; j < m.h; j++) {
        if (m.bits[j * m.w + i]) { on = true; break; }
      }
      if (on && start < 0) start = i;
      else if (!on && start >= 0) { runs.push([start, i]); start = -1; }
    }
    if (start >= 0) runs.push([start, m.w]);
    return runs;
  }

  /** Cluster glyph runs into words by horizontal gap. */
  function group(runs) {
    var groups = [];
    for (var i = 0; i < runs.length; i++) {
      var last = groups[groups.length - 1];
      if (last && runs[i][0] - last[last.length - 1][1] <= GROUP_GAP) last.push(runs[i]);
      else groups.push([runs[i]]);
    }
    return groups;
  }

  /**
   * Slice one glyph out of a mask and trim blank rows.
   * Rows in the lower stat block sit 1px higher than the upper block, so
   * matching must ignore absolute vertical position — hence the trim.
   */
  function cut(m, x0, x1) {
    var w = x1 - x0;
    var top = -1, bottom = -1;
    for (var j = 0; j < m.h; j++) {
      var on = false;
      for (var i = x0; i < x1; i++) {
        if (m.bits[j * m.w + i]) { on = true; break; }
      }
      if (on) { if (top < 0) top = j; bottom = j; }
    }
    if (top < 0) return null;
    var h = bottom - top + 1;
    var bits = new Uint8Array(w * h);
    for (var jj = 0; jj < h; jj++) {
      for (var ii = 0; ii < w; ii++) {
        bits[jj * w + ii] = m.bits[(top + jj) * m.w + (x0 + ii)];
      }
    }
    return { w: w, h: h, bits: bits, top: top, x: x0 };
  }

  // ------------------------------------------------------------- matching

  var fonts = {};   // name -> [{ch, w, h, bits}]

  function loadFonts(raw) {
    fonts = {};
    Object.keys(raw || {}).forEach(function (name) {
      fonts[name] = Object.keys(raw[name]).map(function (ch) {
        var g = raw[name][ch];
        var bits = new Uint8Array(g.w * g.h);
        for (var i = 0; i < g.bits.length; i++) bits[i] = g.bits[i] === "1" ? 1 : 0;
        return { ch: ch, w: g.w, h: g.h, bits: bits };
      });
    });
    return fonts;
  }

  /** Hamming distance with both bitmaps padded to a common box, top-left aligned. */
  function distance(a, b) {
    var w = Math.max(a.w, b.w), h = Math.max(a.h, b.h);
    var d = 0;
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var av = i < a.w && j < a.h ? a.bits[j * a.w + i] : 0;
        var bv = i < b.w && j < b.h ? b.bits[j * b.w + i] : 0;
        if (av !== bv) d++;
      }
    }
    return d;
  }

  /**
   * Nearest template. Returns {ch, dist, ratio, exact} or null when nothing is
   * close enough — an unknown glyph must stay unknown, never become a guess.
   */
  function matchGlyph(g, fontName, extra) {
    var table = (fonts[fontName] || []).concat(extra || []);
    var best = null;
    for (var i = 0; i < table.length; i++) {
      var t = table[i];
      if (Math.abs(t.w - g.w) > 1 || Math.abs(t.h - g.h) > 1) continue;
      var d = distance(g, t);
      if (!best || d < best.dist) best = { ch: t.ch, dist: d, template: t };
    }
    if (!best) return null;
    var area = Math.max(g.w * g.h, best.template.w * best.template.h);
    var ratio = best.dist / area;
    if (ratio > MAX_GLYPH_DIST) return null;
    return { ch: best.ch, dist: best.dist, ratio: ratio, exact: best.dist === 0 };
  }

  /**
   * Decide which glyphs of a value are decoration rather than content.
   *
   * Every character of a value shares a baseline: digits, "%", "." and the
   * lowercase "sec" all bottom out on it, and "," descends just below. The
   * in-game upgrade arrow sits mid-height, bottoming ~3px above it. Filtering on
   * the baseline — not on height — is what separates them, because height alone
   * would also throw away the 1px-tall "." and 3px-tall ",".
   *
   * This matters for ROIs whose left edge clips the arrow: the leftover 2-3px
   * fragment matches no template, and without this it would be reported as an
   * unknown glyph and wrongly flag an otherwise perfect read.
   */
  function markDecorations(cuts) {
    if (!cuts.length) return;
    var bottoms = cuts.map(function (c) { return c.top + c.h - 1; });
    var counts = {}, modal = bottoms[0], bestN = 0;
    bottoms.forEach(function (b) {
      counts[b] = (counts[b] || 0) + 1;
      if (counts[b] > bestN) { bestN = counts[b]; modal = b; }
    });
    cuts.forEach(function (c, i) { c.decoration = bottoms[i] < modal - 2; });
  }

  /**
   * Read one ROI into a glyph string.
   *
   * Picks the group with the most glyphs as the value, which is what discards
   * the label text that bleeds into several of the stat-window ROIs. Glyphs
   * that match nothing are dropped and counted in `unknown` so the UI can
   * flag the field rather than emit a wrong number.
   */
  function readRoi(full, roi, kind, extra) {
    var m = subMask(full, roi[0], roi[1], roi[2], roi[3]);
    var groups = group(segment(m));
    if (!groups.length) {
      return { text: "", glyphs: [], unknown: 0, decorations: 0, mask: m };
    }

    var pick = groups[0];
    for (var i = 1; i < groups.length; i++) {
      if (groups[i].length > pick.length) pick = groups[i];
    }

    var cuts = [];
    for (var k = 0; k < pick.length; k++) {
      var g = cut(m, pick[k][0], pick[k][1]);
      if (g) cuts.push(g);
    }
    markDecorations(cuts);

    var glyphs = [], unknown = 0, decorations = 0, text = "";
    cuts.forEach(function (g) {
      if (g.decoration) {
        decorations++;
        glyphs.push({ ch: null, decoration: true, bitmap: g });
        return;
      }
      var hit = matchGlyph(g, kind, extra);
      if (!hit) { unknown++; glyphs.push({ ch: null, bitmap: g }); return; }
      glyphs.push({ ch: hit.ch, dist: hit.dist, exact: hit.exact, bitmap: g });
      text += hit.ch;
    });
    return { text: text, glyphs: glyphs, unknown: unknown, decorations: decorations, mask: m };
  }

  // ------------------------------------------------- multi-row panel reading

  /** Horizontal bands of set pixels — one per line of text. */
  function rowBands(m, minHeight) {
    var min = minHeight || 3;
    var bands = [], start = -1;
    for (var j = 0; j < m.h; j++) {
      var on = false;
      for (var i = 0; i < m.w; i++) {
        if (m.bits[j * m.w + i]) { on = true; break; }
      }
      if (on && start < 0) start = j;
      else if (!on && start >= 0) {
        if (j - start >= min) bands.push([start, j]);
        start = -1;
      }
    }
    if (start >= 0 && m.h - start >= min) bands.push([start, m.h]);
    return bands;
  }

  /** Tight-crop a mask to its set pixels. Returns null when empty. */
  function tighten(m) {
    var top = -1, bottom = -1, left = -1, right = -1;
    for (var j = 0; j < m.h; j++) {
      for (var i = 0; i < m.w; i++) {
        if (!m.bits[j * m.w + i]) continue;
        if (top < 0) top = j;
        bottom = j;
        if (left < 0 || i < left) left = i;
        if (i > right) right = i;
      }
    }
    if (top < 0) return null;
    var w = right - left + 1, h = bottom - top + 1;
    var bits = new Uint8Array(w * h);
    for (var jj = 0; jj < h; jj++) {
      for (var ii = 0; ii < w; ii++) bits[jj * w + ii] = m.bits[(top + jj) * m.w + (left + ii)];
    }
    return { w: w, h: h, bits: bits, top: top, left: left };
  }

  /**
   * Read the right-hand value out of a label/value row.
   *
   * Stat Info rows are "Base Value            3984" — label left, number right,
   * with ~80px of gap. Taking the rightmost group means the label's letters are
   * never fed to a digit-only font, where an "l" could otherwise come back as a
   * "1". The ROI also clips the labels' left edge, so they are unreadable anyway.
   */
  function readRowValue(m, band, fontName, extra) {
    var row = subMask(m, 0, band[0], m.w, band[1] - band[0]);
    var groups = group(segment(row));
    if (!groups.length) return { text: "", unknown: 0 };
    var last = groups[groups.length - 1];

    var cuts = [];
    for (var k = 0; k < last.length; k++) {
      var g = cut(row, last[k][0], last[k][1]);
      if (g) cuts.push(g);
    }
    markDecorations(cuts);

    var text = "", unknown = 0;
    cuts.forEach(function (g) {
      if (g.decoration) return;
      var hit = matchGlyph(g, fontName, extra);
      if (!hit) { unknown++; return; }
      text += hit.ch;
    });
    return { text: text, unknown: unknown };
  }

  /**
   * Read the Stat Info popup: which stat it is, plus its value rows.
   *
   * The title is matched as a whole word-bitmap against the 7 known stat names
   * rather than letter by letter — the set is closed, so this needs no alphabet.
   * An unrecognised title returns stat:null and the UI asks which stat it is.
   */
  function readStatInfo(full, titleRoi, valuesRoi, titles, extraTitles) {
    var titleMask = tighten(subMask(full, titleRoi[0], titleRoi[1], titleRoi[2], titleRoi[3]));
    var stat = null, titleDist = null;
    if (titleMask) {
      var table = Object.keys(titles || {}).map(function (k) {
        return { ch: k, w: titles[k].w, h: titles[k].h, bits: titles[k].bits };
      }).concat(extraTitles || []);
      var best = null;
      table.forEach(function (t) {
        if (Math.abs(t.w - titleMask.w) > 1 || Math.abs(t.h - titleMask.h) > 1) return;
        var bits = new Uint8Array(t.w * t.h);
        for (var i = 0; i < t.bits.length; i++) bits[i] = t.bits[i] === "1" ? 1 : 0;
        var d = distance(titleMask, { w: t.w, h: t.h, bits: bits });
        if (!best || d < best.dist) best = { ch: t.ch, dist: d, area: t.w * t.h };
      });
      if (best && best.dist / Math.max(best.area, titleMask.w * titleMask.h) <= MAX_GLYPH_DIST) {
        stat = best.ch;
        titleDist = best.dist;
      }
    }

    var vm = subMask(full, valuesRoi[0], valuesRoi[1], valuesRoi[2], valuesRoi[3]);
    var rows = rowBands(vm, 5).map(function (band) {
      return readRowValue(vm, band, "stat").text;
    }).filter(function (t) { return t.length > 0; });

    return { stat: stat, titleDist: titleDist, titleBitmap: titleMask, rows: rows };
  }

  // ------------------------------------------------------- anchor location

  // A correct anchor measures 0-6% of its pixels differing; the nearest wrong
  // place in the frame measures 22-33%. 12% sits in that gap with room on both
  // sides. Screenshots taken over a darker background flip a few anti-aliased
  // edge pixels of the yellow title text, which is enough to push a genuine
  // match to ~6% — the old 2% threshold rejected those outright.
  var ANCHOR_TOLERANCE = 0.12;

  /**
   * Find a panel anchor in a full frame.
   *
   * Brute force over ~2M positions is too slow, so probe points (pixels that must
   * be on, and must be off) reject almost every candidate in a few reads before
   * any full comparison. Two passes:
   *
   *   1. probes must all match, accept only a pixel-perfect hit. Fast, and this
   *      is what a clean screenshot takes.
   *   2. only if that found nothing: allow a few probe misses and accept the best
   *      match within ANCHOR_TOLERANCE. Costs more but runs on the rare frame.
   *
   * Requiring every probe to match with no fallback was a bug: a near-miss never
   * reached the distance check at all, so a slightly different background made
   * the panel simply "not found".
   */
  function findAnchor(full, anchor, tolerance) {
    var tol = tolerance == null ? ANCHOR_TOLERANCE : tolerance;
    var w = anchor.w, h = anchor.h, area = w * h;
    var tpl = new Uint8Array(area);
    for (var i = 0; i < anchor.bits.length; i++) tpl[i] = anchor.bits[i] === "1" ? 1 : 0;

    var on = [], off = [];
    for (var j = 0; j < h; j++) {
      for (var ii = 0; ii < w; ii++) (tpl[j * w + ii] ? on : off).push([ii, j]);
    }
    // Spread the probes across the patch instead of taking a contiguous corner.
    function spread(arr, n) {
      var out = [], step = arr.length / n;
      for (var k = 0; k < n && k * step < arr.length; k++) out.push(arr[Math.floor(k * step)]);
      return out;
    }
    var probes = spread(on, 8).map(function (p) { return [p[0], p[1], 1]; })
      .concat(spread(off, 8).map(function (p) { return [p[0], p[1], 0]; }));

    function distanceAt(x, y) {
      var d = 0;
      for (var jj = 0; jj < h; jj++) {
        var row = (y + jj) * full.w + x, trow = jj * w;
        for (var kk = 0; kk < w; kk++) if (full.bits[row + kk] !== tpl[trow + kk]) d++;
      }
      return d;
    }

    function pass(maxMiss, acceptDist) {
      var best = null;
      for (var y = 0; y + h <= full.h; y++) {
        for (var x = 0; x + w <= full.w; x++) {
          var miss = 0;
          for (var p = 0; p < probes.length; p++) {
            if (full.bits[(y + probes[p][1]) * full.w + (x + probes[p][0])] !== probes[p][2]) {
              if (++miss > maxMiss) break;
            }
          }
          if (miss > maxMiss) continue;
          var d = distanceAt(x, y);
          if (!best || d < best.dist) best = { x: x, y: y, dist: d };
          if (best.dist === 0) return best;
        }
      }
      return best && best.dist <= acceptDist ? best : null;
    }

    var hit = pass(0, 0);
    if (!hit) hit = pass(3, Math.floor(area * tol));
    if (!hit) return null;
    hit.ratio = hit.dist / area;
    hit.exact = hit.dist === 0;
    return hit;
  }

  return {
    toHsv: toHsv, fullMask: fullMask, subMask: subMask,
    segment: segment, group: group, cut: cut, markDecorations: markDecorations,
    rowBands: rowBands, tighten: tighten, readRowValue: readRowValue,
    loadFonts: loadFonts, matchGlyph: matchGlyph, distance: distance,
    readRoi: readRoi, readStatInfo: readStatInfo, findAnchor: findAnchor,
    get fonts() { return fonts; },
    GROUP_GAP: GROUP_GAP, MAX_GLYPH_DIST: MAX_GLYPH_DIST,
    ANCHOR_TOLERANCE: ANCHOR_TOLERANCE,
  };
})();
