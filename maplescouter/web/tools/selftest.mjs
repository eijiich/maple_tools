// selftest.mjs — run the shipping js/ocr.js against the real sample PNGs.
//
// This exercises the exact code the page loads, not a reimplementation, which is
// the point: tools/verify.py mirrors the algorithm in Python and can drift from
// it, whereas this cannot.
//
//   fnm use 24 && node tools/selftest.mjs
//
// PNGs are decoded with node:zlib rather than a dependency, so there is nothing
// to install and no multi-megabyte raw fixtures to commit.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..");
const SAMPLES = path.resolve(WEB, "..", "samples");

// ------------------------------------------------------------------ PNG

/** Minimal 8-bit non-interlaced PNG decoder -> {width, height, data:RGBA}. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));

  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;      // left
      const b = prev ? prev[i] : 0;               // up
      const c = prev && i >= bpp ? prev[i - bpp] : 0;  // up-left
      let v = line[i];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`bad filter ${filter} on row ${y}`);
      }
      cur[i] = v & 0xff;
    }
  }

  // Normalise to RGBA so the mask code always sees 4 bytes per pixel.
  if (channels === 4) return { width, height, data: out };
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0, n = width * height; i < n; i++) {
    if (channels === 3) {
      rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2];
    } else if (channels === 1) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[i];
    } else {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[i * 2];
      rgba[i * 4 + 3] = out[i * 2 + 1];
    }
  }
  return { width, height, data: rgba };
}

// ------------------------------------------------------- load the real JS

const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["js/glyphs.js", "js/layout.js", "js/ocr.js", "js/fields.js"]) {
  vm.runInContext(fs.readFileSync(path.join(WEB, f), "utf8"), sandbox, { filename: f });
}
const { OCR, FIELDS, GLYPHS, LAYOUT } = sandbox;
OCR.loadFonts(GLYPHS);

// ------------------------------------------------------------- expectations

// Two capture sessions months apart, so the character's numbers differ. All
// transcribed by eye from magnified crops.
const SESSION1 = {
  "Damage Range": 280714414,
  "Final Damage": 383.56,
  "Ignore Enemy Defense": 98.49,
  "Attack Power": 3243,
  "Magic ATT": 8047,
  "Cooldown Reduction": [2, 6],
  "Cooldown Skip": 7.5,
  "Additional Status Damage": 22,
  "Mesos Obtained": 680,
  "Item Drop Rate": 55,
  "Additional EXP Obtained": 218,
  "Damage": 75,
  "Boss Damage": 435,
  "Normal Enemy Damage": 12,
  "Critical Rate": 122,
  "Critical Damage": 140.9,
  "Buff Duration": 145,
  "Ignore Elemental Resistance": 15,
  "Summon Duration": 10,
  "Star Force": 438,
  "Arcane Force": 1370,
  "Sacred Force": 820,
};
// Critical Damage is yellow here and white in session 1 — the colour key has to
// cover both without the read changing.
const SESSION2 = {
  "Damage Range": 289685204,
  "Final Damage": 383.56,
  "Ignore Enemy Defense": 97.82,
  "Attack Power": 3424,
  "Magic ATT": 8409,
  "Cooldown Reduction": [2, 6],
  "Cooldown Skip": 7.5,
  "Additional Status Damage": 22,
  "Mesos Obtained": 686,
  "Item Drop Rate": 26,
  "Additional EXP Obtained": 260,
  "Damage": 72,
  "Boss Damage": 406,
  "Normal Enemy Damage": 12,
  "Critical Rate": 112,
  "Critical Damage": 138.9,
  "Buff Duration": 159,
  "Ignore Elemental Resistance": 15,
  "Summon Duration": 20,
  "Star Force": 450,
  "Arcane Force": 1370,
  "Sacred Force": 780,
};
// Session 3: a different, less progressed character (Attack Power 3,692 above
// M.Attack 1,601, where the mage is the other way round). Only Damage and Damage
// Range differ between its three shots — a buff was ticking between captures.
const SESSION3 = {
  "Final Damage": 93,
  "Ignore Enemy Defense": 97.97,
  "Attack Power": 3692,
  "Magic ATT": 1601,
  "Cooldown Reduction": [4, 6],
  "Cooldown Skip": 27.5,
  "Additional Status Damage": 15,
  "Mesos Obtained": 602,
  "Item Drop Rate": 12,
  "Additional EXP Obtained": 64,
  "Boss Damage": 466,
  "Normal Enemy Damage": 12,
  "Critical Rate": 92,
  "Critical Damage": 97.5,
  "Buff Duration": 126,
  "Ignore Elemental Resistance": 4,
  "Summon Duration": 20,
  "Star Force": 375,
  "Arcane Force": 1370,
  "Sacred Force": 170,
};
const SESSION3_PER_SHOT = {
  stat_window_3_with_atk: { "Damage": 106, "Damage Range": 53161255 },
  stat_window_3_with_str: { "Damage": 112, "Damage Range": 54709641 },
  stat_window_3_with_dex: { "Damage": 109, "Damage Range": 53935448 },
};

function expectedFor(name) {
  if (name.includes("_3_")) return { ...SESSION3, ...SESSION3_PER_SHOT[name] };
  return name.includes("_2_") ? SESSION2 : SESSION1;
}
// Per-sample anchor positions — and this is the point of the session-3 set.
// Sessions 1 and 2 have the in-game windows in identical places, so they can't
// show that a *moved* panel is located correctly. Session 3 is cropped to
// 947x753 from a different character, which puts all three panels at completely
// different coordinates, and each shot is cropped slightly differently again.
// Every panel is still found, which is what makes the anchor-relative ROI scheme
// (rather than absolute screen coordinates) demonstrably worth having.
const EXPECTED_ANCHORS = {
  stat_window_with_matt: { charInfo: [14, 12], statWindow: [24, 280], statInfo: [485, 243] },
  stat_window_with_int: { charInfo: [14, 12], statWindow: [24, 280], statInfo: [485, 243] },
  stat_window_with_luk: { charInfo: [14, 12], statWindow: [24, 280], statInfo: [485, 243] },
  stat_window_2_with_matt: { charInfo: [14, 12], statWindow: [24, 280], statInfo: [485, 243] },
  stat_window_2_with_int: { charInfo: [14, 12], statWindow: [24, 280], statInfo: [485, 243] },
  stat_window_2_with_luk: { charInfo: [14, 12], statWindow: [24, 280], statInfo: [485, 243] },
  stat_window_3_with_atk: { charInfo: [236, 37], statWindow: [246, 305], statInfo: [707, 268] },
  stat_window_3_with_str: { charInfo: [239, 36], statWindow: [249, 304], statInfo: [710, 267] },
  stat_window_3_with_dex: { charInfo: [243, 29], statWindow: [253, 297], statInfo: [714, 260] },
};

// Samples where a *correct* statInfo match is not pixel-perfect: the `_2_` set
// sits over a darker background and `_3_` is cropped, both of which flip
// anti-aliased pixels on the yellow "STAT INFO" title. These used to report the
// panel as simply "not found" under the old 2% threshold.
const INEXACT_STATINFO = new Set([
  "stat_window_2_with_matt", "stat_window_2_with_int", "stat_window_2_with_luk",
  "stat_window_3_with_atk", "stat_window_3_with_str", "stat_window_3_with_dex",
]);

const STAT_SAMPLES = Object.keys(EXPECTED_ANCHORS);

// Transcribed from magnified crops of the Stat Info popup. M.Attack shows no
// "% Value Not Applied" row at all while INT/LUK do — the case that makes
// positional row indexing unsafe and forces the "%"-suffix anchor.
const EXPECTED_STATINFO = {
  stat_window_with_matt: { stat: "M.Attack", base: 3984, percent: 102, not_applied: 0, rowCount: 2 },
  stat_window_with_int: { stat: "INT", base: 7332, percent: 600, not_applied: 31250, rowCount: 3 },
  stat_window_with_luk: { stat: "LUK", base: 4397, percent: 192, not_applied: 390, rowCount: 3 },
  stat_window_2_with_matt: { stat: "M.Attack", base: 4163, percent: 102, not_applied: 0, rowCount: 2 },
  stat_window_2_with_int: { stat: "INT", base: 7332, percent: 603, not_applied: 31280, rowCount: 3 },
  stat_window_2_with_luk: { stat: "LUK", base: 4409, percent: 205, not_applied: 420, rowCount: 3 },
  // Attack Power's description is 7 lines and STR's/DEX's are 8, which shifts the
  // value block down 15px. A fixed-height values ROI clipped the bottom row, so
  // STR and DEX silently reported not_applied 0 — these three pin that: Attack
  // genuinely has no such row, STR and DEX do.
  stat_window_3_with_atk: { stat: "Attack", base: 2529, percent: 46, not_applied: 0, rowCount: 2 },
  stat_window_3_with_str: { stat: "STR", base: 2945, percent: 255, not_applied: 540, rowCount: 3 },
  stat_window_3_with_dex: { stat: "DEX", base: 5135, percent: 501, not_applied: 18130, rowCount: 3 },
};

// Regression guard for the anchor-tolerance bug. On the session-2 and -3 frames
// the "STAT INFO" title is a genuine match but sits several percent away, which
// the old 2% threshold rejected outright — the panel reported as "not found" and
// the app silently fell back to a saved manual position. Pinning the band both
// ways means a return to a too-tight threshold fails here, and so does a
// reckless one.
const STATINFO_RATIO_BAND = { min: 0.02, max: 0.12 };

let pass = 0, fail = 0;
const missing = [];
const check = (ok, label, detail) => {
  if (ok) { pass++; } else { fail++; console.log(`  FAIL ${label} ${detail ?? ""}`); }
};

for (const name of STAT_SAMPLES) {
  const file = path.join(SAMPLES, `${name}.png`);
  if (!fs.existsSync(file)) { missing.push(`${name}.png`); continue; }
  console.log("=".repeat(72));
  console.log(name);

  const t0 = Date.now();
  const img = decodePng(fs.readFileSync(file));
  const tDecode = Date.now() - t0;

  const t1 = Date.now();
  const full = OCR.fullMask(img, "stat");
  const tMask = Date.now() - t1;

  // --- anchors ---
  const found = {};
  const t2 = Date.now();
  const anchors = EXPECTED_ANCHORS[name];
  for (const key of Object.keys(LAYOUT).sort()) {
    const hit = OCR.findAnchor(full, LAYOUT[key].anchor);
    found[key] = hit;
    const want = anchors[key];
    // Position must be exact; distance need only be inside tolerance.
    check(
      hit && hit.x === want[0] && hit.y === want[1] && hit.ratio <= OCR.ANCHOR_TOLERANCE,
      `anchor ${key}`,
      hit ? `got (${hit.x},${hit.y}) dist=${hit.dist} ratio=${(hit.ratio * 100).toFixed(1)}% want (${want})`
        : "not found"
    );
  }
  if (INEXACT_STATINFO.has(name)) {
    const r = found.statInfo ? found.statInfo.ratio : -1;
    check(r > STATINFO_RATIO_BAND.min && r <= STATINFO_RATIO_BAND.max,
      "statInfo is an inexact-but-valid match (regression guard)",
      `ratio=${(r * 100).toFixed(1)}% must be inside ` +
      `(${STATINFO_RATIO_BAND.min * 100}%, ${STATINFO_RATIO_BAND.max * 100}%]`);
  }
  const tAnchors = Date.now() - t2;

  // --- values ---
  const t3 = Date.now();
  const anchor = found.statWindow;
  const rois = LAYOUT.statWindow.rois;
  const readings = {};
  const EXPECTED = expectedFor(name);
  for (const [field, expected] of Object.entries(EXPECTED)) {
    const [dx, dy, w, h] = rois[field];
    const r = OCR.readRoi(full, [anchor.x + dx, anchor.y + dy, w, h], "stat");
    const parsed = FIELDS.parse(field, r.text);
    readings[field] = parsed;
    const got = parsed.values ?? parsed.value;
    const ok = Array.isArray(expected)
      ? JSON.stringify(got) === JSON.stringify(expected)
      : got !== null && Math.abs(got - expected) < 1e-9;
    check(ok && r.unknown === 0, field,
      `raw=${JSON.stringify(r.text)} got=${JSON.stringify(got)} want=${JSON.stringify(expected)}` +
      (r.unknown ? ` unknown=${r.unknown}` : ""));
  }
  const tRead = Date.now() - t3;

  // --- Stat Info popup ---
  const si = LAYOUT.statInfo;
  const siAnchor = found.statInfo;
  const abs = (r) => [siAnchor.x + r[0], siAnchor.y + r[1], r[2], r[3]];
  const info = OCR.readStatInfo(
    full, abs(si.rois["StatInfo:Title"]), abs(si.rois["StatInfo:Values"]), si.titles
  );
  const table = FIELDS.parseStatInfo(info.rows, info.stat);
  const wantInfo = EXPECTED_STATINFO[name];
  check(info.stat === wantInfo.stat, `statinfo title`, `got ${info.stat} want ${wantInfo.stat}`);
  check(table.base === wantInfo.base, `statinfo base`, `got ${table.base} want ${wantInfo.base}`);
  check(table.percent === wantInfo.percent, `statinfo percent`,
    `got ${table.percent} want ${wantInfo.percent}`);
  check(table.not_applied === wantInfo.not_applied, `statinfo not_applied`,
    `got ${table.not_applied} want ${wantInfo.not_applied}`);
  // The unread "Current Value" row must be discarded, not accepted as a number —
  // otherwise it shifts base/percent/not_applied by one.
  check(table.rows.length === wantInfo.rowCount, `statinfo kept-row count`,
    `got ${JSON.stringify(table.rows)} want ${wantInfo.rowCount} rows`);
  console.log(`  statinfo: ${info.stat} rows=${JSON.stringify(info.rows)} -> ` +
    `base=${table.base} pct=${table.percent} notApplied=${table.not_applied}`);

  // Site-field mapping should route the calculated/ignored ones to extras.
  const mapped = FIELDS.toSiteFields(readings);
  check(mapped.single["Boss Damage"] === EXPECTED["Boss Damage"], "map Boss Damage",
    JSON.stringify(mapped.single["Boss Damage"]));
  const cdr = EXPECTED["Cooldown Reduction"];
  check(mapped.single["Cooldown Reduction (sec)"] === cdr[0], "map CDR sec",
    `got ${mapped.single["Cooldown Reduction (sec)"]} want ${cdr[0]}`);
  check(mapped.single["Cooldown Reduction (%)"] === cdr[1], "map CDR pct",
    `got ${mapped.single["Cooldown Reduction (%)"]} want ${cdr[1]}`);
  check(!("Damage Range" in mapped.single), "Damage Range stays out of site fields");
  check(mapped.extras["Damage Range"] === EXPECTED["Damage Range"], "Damage Range in extras",
    JSON.stringify(mapped.extras["Damage Range"]));

  console.log(`  timing: decode ${tDecode}ms  mask ${tMask}ms  ` +
    `anchors ${tAnchors}ms (3)  read ${tRead}ms (22)`);
}

console.log("=".repeat(72));
// An absent fixture used to skip quietly, which is worse than failing: the
// published copy of this tool ships without samples/, so a clone would report
// "all checks passed" having read no pixels at all. Missing samples now count
// as a failure, because a green run that tested nothing is a lie.
if (missing.length) {
  console.log(`${missing.length} sample(s) missing from ${SAMPLES}:`);
  for (const name of missing) console.log(`  MISSING ${name}`);
}
console.log(
  fail ? `${fail} FAILURES, ${pass} passed`
  : missing.length ? `INCOMPLETE: ${missing.length} sample(s) missing, only ${pass} checks ran`
  : `all ${pass} checks passed`
);
process.exit(fail || missing.length ? 1 : 0);
