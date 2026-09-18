// fields.js — in-game STAT window labels -> maplescouter.com/en/input fields,
// and the rules for turning a recognised glyph string into a number.
//
// Ported from field_mapping.py / ocr_stats.py. Two things the Python needed are
// gone here because template matching removed the need for them:
//
//   * fix_arrow_prefix / FIELD_MAX — Tesseract read the "▲" upgrade arrow as a
//     leading "2", so values had to be sanity-capped and un-prefixed. The arrow
//     is now a recognised glyph ("^") that we simply skip, so the digits are
//     never contaminated in the first place.
//   * remove_left_indicator — same reason; no connected-component surgery needed.

window.FIELDS = (function () {
  "use strict";

  // Directly writable single-number inputs on the site.
  var SINGLE = {
    "Damage": "Damage",
    "Boss Damage": "Boss Damage",
    "Ignore Enemy Defense": "Ignore Enemy Defense",
    "Critical Rate": "Critical Rate",
    "Critical Damage": "Critical Damage",
    "Cooldown Skip": "Cooldown Skip",
    "Buff Duration": "Buff Duration",
    "Ignore Elemental Resistance": "Ignore Elemental Resistance",
    "Additional Status Damage": "Additional Status Damage",
    "Summon Duration": "Summon Duration",
    "Arcane Force": "Arcane Force",
    "Sacred Force": "Sacred Force",
    // Read as one "X sec / Y%" row in game, two inputs on the site.
    "Cooldown Reduction": ["Cooldown Reduction (sec)", "Cooldown Reduction (%)"],
  };

  // Stats the site computes from other inputs — read for sanity, never submitted.
  var CALCULATED = ["Damage Range", "Final Damage", "Normal Enemy Damage"];

  // Unrelated to damage calculation.
  var IGNORED = ["Mesos Obtained", "Item Drop Rate", "Additional EXP Obtained", "Star Force"];

  // Percent-typed fields: a negative read is a mis-segmented minus, not a real
  // negative, so magnitude is taken.
  var PERCENT = [
    "Damage", "Boss Damage", "Final Damage", "Normal Enemy Damage",
    "Ignore Enemy Defense", "Critical Rate", "Critical Damage",
    "Cooldown Skip", "Buff Duration", "Ignore Elemental Resistance",
    "Additional Status Damage", "Summon Duration",
  ];

  // Rows of the site's class-specific Base / % / % Not Applied table.
  var TABLE_STATS = ["STR", "DEX", "INT", "LUK", "Attack", "M.Attack", "HP"];

  var TABLE_ALIASES = {
    "str": "STR", "dex": "DEX", "int": "INT", "luk": "LUK",
    "attack power": "Attack", "magic att": "M.Attack",
    "magic attack": "M.Attack", "hp": "HP",
  };

  function isPercent(name) { return PERCENT.indexOf(name) >= 0; }

  /** Strip the upgrade arrow and any stray non-value glyphs. */
  function clean(text) {
    return (text || "").replace(/\^/g, "");
  }

  /**
   * Turn a recognised glyph string into a value.
   *
   * Returns {value} or {values:[sec, pct]} for Cooldown Reduction, plus `raw`.
   * A field whose glyphs didn't resolve returns value null so the UI can flag
   * it rather than submit a wrong number.
   */
  function parse(name, text) {
    var s = clean(text);

    if (name === "Cooldown Reduction") {
      // "2sec/6%" — the two integers are seconds then percent.
      var ints = s.match(/\d+/g) || [];
      if (ints.length >= 2) return { values: [parseInt(ints[0], 10), parseInt(ints[1], 10)], raw: s };
      if (ints.length === 1) return { values: [null, parseInt(ints[0], 10)], raw: s };
      return { values: [null, null], raw: s };
    }

    // Longest numeric run wins — robust to a stray glyph at either end.
    var nums = s.match(/-?[\d,]*\.?\d+/g);
    if (!nums || !nums.length) return { value: null, raw: s };
    var chosen = nums.reduce(function (a, b) {
      return b.replace(/[,.]/g, "").length > a.replace(/[,.]/g, "").length ? b : a;
    });
    var value = parseFloat(chosen.replace(/,/g, ""));
    if (!isFinite(value)) return { value: null, raw: s };
    if (isPercent(name) && value < 0) value = -value;
    return { value: value, raw: s };
  }

  /**
   * Map parsed ROI results onto the site's field names.
   * Returns {single, extras} — `extras` holds values the site computes itself
   * or that aren't damage-related, kept visible for sanity checking.
   */
  function toSiteFields(readings) {
    var single = {}, extras = {};
    Object.keys(readings).forEach(function (name) {
      var r = readings[name];
      var target = SINGLE[name];
      if (!target) { extras[name] = r.value; return; }
      if (Array.isArray(target)) {
        if (r.values) {
          if (r.values[0] != null) single[target[0]] = r.values[0];
          if (r.values[1] != null) single[target[1]] = r.values[1];
        }
        return;
      }
      if (r.value != null) single[target] = r.value;
    });
    return { single: single, extras: extras };
  }

  /**
   * Turn the Stat Info panel's value rows into {base, percent, not_applied}.
   *
   * `rows` is the right-hand number of each row, top to bottom, as read by
   * OCR.readStatInfo — normally [Current, Base, %, % Not Applied]. The last row
   * only renders for some stats (present for INT/LUK, absent for M.Attack), so
   * positional indexing alone is unsafe. Anchoring on the first row carrying a
   * "%" suffix identifies the layout regardless of how many rows are shown.
   *
   * `stat` comes from the title bitmap match, or from the user's picker when the
   * title is one we have no template for yet.
   */
  function parseStatInfo(rows, stat) {
    // Must start with a digit. The "Current Value" row is deliberately not read:
    // it is drawn in a lime highlight outside the yellow key, and the site
    // computes it from base/% anyway. That leaves a stray fragment like "," or
    // ",5" on that row, and a looser pattern would accept ",5" as the number 5
    // and shift every row that follows.
    var values = (rows || [])
      .map(function (r) { return (r || "").replace(/\s+/g, ""); })
      .filter(function (r) { return /^\d[\d,]*(\.\d+)?%?$/.test(r); });

    if (!values.length) return { stat: stat || null, base: null, percent: null, not_applied: 0 };

    var num = function (s) {
      if (s == null) return null;
      var v = parseFloat(s.replace(/%$/, "").replace(/,/g, ""));
      return isFinite(v) ? v : null;
    };

    var pctIdx = -1;
    for (var k = 0; k < values.length; k++) {
      if (values[k].slice(-1) === "%") { pctIdx = k; break; }
    }
    if (pctIdx < 0) {
      // No % row read — fall back to positional [Current, Base, ...].
      return {
        stat: stat || null,
        base: num(values[1]),
        percent: null,
        not_applied: num(values[3]) || 0,
        rows: values,
      };
    }
    return {
      stat: stat || null,
      base: num(values[pctIdx - 1]),
      percent: num(values[pctIdx]),
      not_applied: num(values[pctIdx + 1]) || 0,
      rows: values,
    };
  }

  return {
    SINGLE: SINGLE, CALCULATED: CALCULATED, IGNORED: IGNORED,
    PERCENT: PERCENT, TABLE_STATS: TABLE_STATS, TABLE_ALIASES: TABLE_ALIASES,
    isPercent: isPercent, parse: parse, toSiteFields: toSiteFields,
    parseStatInfo: parseStatInfo,
  };
})();
