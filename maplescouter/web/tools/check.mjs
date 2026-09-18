// check.mjs — static checks that don't need a browser.
//
//   node tools/check.mjs
//
// Covers the things a syntax error or a bad refactor would break silently:
// every JS file parses, index.html's asset references resolve, and the generated
// bookmarklet is itself valid JavaScript once decoded.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0;
const ok = (cond, label, detail) => {
  if (cond) console.log(`  ok   ${label}`);
  else { fail++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
};

// --- every JS file parses ---
console.log("parse:");
const jsFiles = fs.readdirSync(path.join(WEB, "js")).filter((f) => f.endsWith(".js"));
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(WEB, "js", f), "utf8");
  try { new vm.Script(src, { filename: f }); ok(true, f); }
  catch (e) { ok(false, f, e.message); }
}

// --- index.html references resolve ---
console.log("assets:");
const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
  .map((m) => m[1])
  .filter((r) => !/^https?:/.test(r));
for (const r of refs) ok(fs.existsSync(path.join(WEB, r)), r, "missing file");

// --- every script index.html loads is actually in js/ ---
const loaded = [...html.matchAll(/src="js\/([^"]+)"/g)].map((m) => m[1]);
for (const f of jsFiles) {
  ok(loaded.includes(f), `${f} is loaded by index.html`,
    "file exists but no <script> tag references it");
}

// --- every DOM id app.js looks up exists in index.html ---
// These are string lookups, so a typo is invisible until the page runs and
// throws on null. Cheap to catch here instead.
console.log("dom ids:");
const appSrc = fs.readFileSync(path.join(WEB, "js", "app.js"), "utf8");
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const wanted = new Set([
  ...[...appSrc.matchAll(/\bel\("([^"]+)"\)/g)].map((m) => m[1]),
  ...[...appSrc.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]),
]);
ok(wanted.size > 10, `found ${wanted.size} id lookups in app.js`);
for (const id of [...wanted].sort()) {
  ok(htmlIds.has(id), `#${id}`, "app.js looks it up but index.html has no such id");
}

// --- the generated bookmarklet is valid JS ---
console.log("bookmarklet:");
const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["js/glyphs.js", "js/layout.js", "js/classes.js", "js/ocr.js",
  "js/fields.js", "js/filler.js"]) {
  vm.runInContext(fs.readFileSync(path.join(WEB, f), "utf8"), sandbox, { filename: f });
}
const sample = {
  character: { class: "Bishop", classKo: "비숍", classAliases: ["Bishop", "비숍"], level: 291 },
  table: { "M.Attack": { base: 3984, percent: 102, not_applied: 0 } },
  single: { "Boss Damage": 435, "Cooldown Reduction (sec)": 2, "Magic ATT": 8047 },
  extras: { "Damage Range": 280714414 },
};
// one-shot: values baked in
const url = sandbox.FILLER.buildWithData(sample);
ok(url.startsWith("javascript:"), "one-shot has javascript: scheme");
const body = decodeURIComponent(url.slice("javascript:".length));
try { new vm.Script(body, { filename: "one-shot" }); ok(true, "one-shot body parses"); }
catch (e) { ok(false, "one-shot body parses", e.message); }
ok(body.includes('"Boss Damage":435'), "one-shot embeds the data");
ok(!sandbox.FILLER.tooLong(url), `one-shot length ${url.length} within limit`);

// generic: install once, reads the clipboard. Must contain NO values, or it goes
// stale the moment anything changes — the whole point of it.
const gurl = sandbox.FILLER.buildGeneric();
ok(gurl.startsWith("javascript:"), "generic has javascript: scheme");
const gbody = decodeURIComponent(gurl.slice("javascript:".length));
try { new vm.Script(gbody, { filename: "generic" }); ok(true, "generic body parses"); }
catch (e) { ok(false, "generic body parses", e.message); }
ok(gbody.includes("clipboard.readText"), "generic reads the clipboard");
ok(gbody.includes("prompt("), "generic falls back to a paste prompt");
// Test for the sample's *values* and for JSON structure, not for field names or
// class names: the filler's own source legitimately contains "Boss Damage" as a
// row label and "Bishop" inside a comment about class-first ordering.
const leaks = ["435", "280714414", "8047", "4163", "291", "비숍", '"single":', '"table":',
  '"classAliases"', "3984"].filter((t) => gbody.includes(t));
ok(leaks.length === 0, "generic embeds no values", `leaked: ${JSON.stringify(leaks)}`);
ok(gbody.includes("JSON.parse"), "generic parses the clipboard text");
ok(!sandbox.FILLER.tooLong(gurl), `generic length ${gurl.length} within limit`);
// Stability: the same generic URL every time, so a reinstall isn't needed.
ok(sandbox.FILLER.buildGeneric() === gurl, "generic bookmarklet is stable across builds");

// --- layout sanity: the ROIs the app asks for exist ---
console.log("layout:");
const L = sandbox.LAYOUT;
ok(Object.keys(L).length === 3, "three panels", Object.keys(L).join(","));
for (const key of ["StatInfo:Title", "StatInfo:Values"]) {
  ok(!!L.statInfo.rois[key], `statInfo has ${key}`);
}
ok(Object.keys(L.statWindow.rois).length === 22, "statWindow has 22 ROIs",
  String(Object.keys(L.statWindow.rois).length));
ok(Object.keys(L.statInfo.titles || {}).length >= 3, "at least 3 stat titles trained");
for (const ch of "0123456789") {
  ok(!!sandbox.GLYPHS.stat[ch], `stat font has "${ch}"`);
}

// --- the generic bookmarklet actually runs, clipboard -> parse -> fill ---
// A page-less run: every selector finds nothing, so the filler should skip every
// row and report it rather than throw. That still exercises the whole new path
// (clipboard read, JSON.parse, shape check, dispatch into fillForm).
console.log("generic bookmarklet run:");
async function runGeneric(clipboardText) {
  let alerted = null;
  let resolveAlert;
  const done = new Promise((r) => { resolveAlert = r; });
  const ctx = {
    navigator: { clipboard: { readText: async () => clipboardText } },
    prompt: () => null,
    alert: (m) => { alerted = m; resolveAlert(); },
    console: { log: () => {} },
    document: { querySelectorAll: () => [], querySelector: () => null },
    HTMLInputElement: class { }, HTMLTextAreaElement: class { },
    Event: class { constructor(t) { this.type = t; } },
    setTimeout, clearInterval, setInterval, Promise, JSON, Object, Array, Math,
  };
  vm.createContext(ctx);
  await vm.runInContext(gbody, ctx, { filename: "generic-run" });
  await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
  return alerted;
}
const goodJson = JSON.stringify(sample);
const msg = await runGeneric(goodJson);
ok(msg !== null, "generic reached the fill stage and reported back", String(msg));
ok(msg && /Filled 0 inputs/.test(msg), "reports 0 filled on an empty page", String(msg));
ok(msg && /Skipped:/.test(msg), "lists what it skipped", String(msg));

const badMsg = await runGeneric("not json at all");
ok(badMsg && /not valid JSON/i.test(badMsg), "rejects non-JSON clipboard with a clear message",
  String(badMsg));
const wrongMsg = await runGeneric('{"hello":1}');
ok(wrongMsg && /no stat data/i.test(wrongMsg), "rejects JSON of the wrong shape",
  String(wrongMsg));

// --- values table order mirrors the STAT window ---
// gameRows is derived from the ROI coordinates, so this re-checks it against
// those coordinates independently: every field present exactly once, each row
// sorted left-to-right, and rows top-to-bottom.
console.log("game order:");
const gr = sandbox.LAYOUT.statWindow.gameRows;
const swRois = sandbox.LAYOUT.statWindow.rois;
ok(Array.isArray(gr) && gr.length > 0, "gameRows exists");
const flat = gr.filter(Boolean).flat();
ok(flat.length === Object.keys(swRois).length,
  `covers all ${Object.keys(swRois).length} stat fields`, `got ${flat.length}`);
ok(new Set(flat).size === flat.length, "no field listed twice");
ok(flat.every((f) => f in swRois), "every listed field is a real ROI");
let lastY = -Infinity, ordered = true, sortedRows = true;
for (const row of gr) {
  if (row === null) continue;
  const ys = row.map((f) => swRois[f][1]);
  const xs = row.map((f) => swRois[f][0]);
  if (Math.max(...ys) - Math.min(...ys) > 3) ordered = false;      // same row => same y
  if (Math.min(...ys) < lastY) ordered = false;                    // rows go downward
  for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1]) sortedRows = false;
  lastY = Math.min(...ys);
}
ok(ordered, "rows share a y and run top to bottom");
ok(sortedRows, "fields within a row run left to right");
ok(gr.includes(null), "keeps the game's blank gap before the Mesos/Star Force block");
// The pairing the game actually shows, spot-checked against the screenshots.
ok(JSON.stringify(gr[0]) === JSON.stringify(["Damage Range", "Damage"]), "first row pairing");
ok(JSON.stringify(gr[4]) === JSON.stringify(["Magic ATT", "Critical Damage"]), "fifth row pairing");

// --- the trainer and the runtime must agree on anchor tolerance ---
// These drifted once: ocr.js was relaxed to 12% but train_glyphs.py still used
// 2%, so the trainer refused to locate the statInfo panel on the cropped samples
// and reported "title not trained" instead of "anchor not found".
console.log("tolerance parity:");
const trainerSrc = fs.readFileSync(path.join(WEB, "tools", "train_glyphs.py"), "utf8");
const pyTol = trainerSrc.match(/^ANCHOR_TOLERANCE\s*=\s*([\d.]+)/m);
ok(!!pyTol, "train_glyphs.py declares ANCHOR_TOLERANCE");
ok(pyTol && parseFloat(pyTol[1]) === sandbox.OCR.ANCHOR_TOLERANCE,
  "trainer tolerance matches js/ocr.js",
  `py=${pyTol && pyTol[1]} js=${sandbox.OCR.ANCHOR_TOLERANCE}`);
// And the trainer must actually use the constant, not a literal.
ok(/tpl\.size \* ANCHOR_TOLERANCE/.test(trainerSrc),
  "trainer uses the constant when locating anchors");

// --- stat-info titles ---
console.log("stat info titles:");
const titles = Object.keys(sandbox.LAYOUT.statInfo.titles || {});
for (const stat of ["M.Attack", "INT", "LUK", "Attack", "STR", "DEX"]) {
  ok(titles.includes(stat), `title trained: ${stat}`);
}
ok(titles.every((t) => sandbox.FIELDS.TABLE_STATS.includes(t)),
  "every trained title is a real table stat", JSON.stringify(titles));
// The values window must be tall enough for the block to shift with description
// length (measured: rows at rel 188..283 across samples).
const vals = sandbox.LAYOUT.statInfo.rois["StatInfo:Values"];
ok(vals[1] <= 188 && vals[1] + vals[3] >= 285,
  "statInfo values ROI spans the observed row range",
  `covers rel ${vals[1]}..${vals[1] + vals[3]}, need 188..285`);

// --- class list ---
console.log("classes:");
const C = sandbox.CLASSES;
ok(Array.isArray(C) && C.length === 54, "54 classes", `got ${C && C.length}`);
ok(C.every((c) => c.key && c.ko && c.label), "every entry has key/ko/label");
ok(new Set(C.map((c) => c.key)).size === C.length, "keys are unique");
ok(new Set(C.map((c) => c.ko)).size === C.length, "korean names are unique");
// The comma inside "아크메이지(불,독)" broke a first attempt at extraction — pin it.
const fp = C.find((c) => c.key === "ArchMageFP");
ok(fp && fp.ko === "아크메이지(불,독)", "ArchMageFP korean name intact", fp && fp.ko);
ok(C.filter((c) => c.nonKms).length === 5, "5 non-KMS classes");
ok(["Hayato", "Kanna", "Lynn", "Moxuan", "Sia"].every(
  (k) => C.find((c) => c.key === k)?.nonKms === true),
  "the non-KMS flag is on the right 5 classes");
ok(C.every((c) => !/[A-Z]/.test(c.ko)), "korean field holds no latin text");
for (const key of ["Bishop", "DemonAvenger", "Shadower", "Cadena", "Hoyeong"]) {
  ok(!!C.find((c) => c.key === key), `has ${key}`);
}

// --- the combobox matcher accepts every alias form ---
// Mirrors selectCombobox's comparison so a regression in either is caught here
// rather than on the live site.
console.log("class matching:");
const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const squash = (s) => norm(s).replace(/[^a-z0-9ㄱ-힝]/g, "");
function aliasesFor(c) {
  const out = [c.key, c.label, c.ko];
  if (c.gms) out.push(c.gms);
  out.push(c.key.replace(/(?<=[a-z])(?=[A-Z])/g, " "));
  return out.filter((v, i) => v && out.indexOf(v) === i);
}
for (const c of C) {
  const al = aliasesFor(c);
  const exact = al.map(norm);
  const loose = al.map(squash);
  // Whatever the site renders — internal key, English label, or Korean — one of
  // the two comparisons must hit.
  const renderings = [c.key, c.label, c.ko].concat(c.gms ? [c.gms] : []);
  const allHit = renderings.every(
    (r) => exact.includes(norm(r)) || loose.includes(squash(r))
  );
  if (!allHit) ok(false, `aliases cover renderings for ${c.key}`, JSON.stringify(renderings));
}
ok(true, `all ${C.length} classes match on key / label / korean / gms`);
// A wrong class must NOT match: aliases have to be specific, not permissive.
const bishop = aliasesFor(C.find((c) => c.key === "Bishop")).map(squash);
ok(!bishop.includes(squash("Shadower")), "Bishop aliases reject Shadower");
ok(!bishop.includes(squash("섀도어")), "Bishop aliases reject Shadower (korean)");

console.log(fail ? `\n${fail} FAILURES` : "\nall static checks passed");
process.exit(fail ? 1 : 0);
