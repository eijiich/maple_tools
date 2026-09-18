// fill_form.js — Bookmarklet for filling maplescouter.com/en/input from
// clipboard JSON produced by ocr_stats.py.
//
// The site doesn't use <label> elements for stat inputs; instead it lays out
// rows of (label-text, input[, input...]) inside a container div. We find each
// row by the first label text and assign inputs by position.
//
// To install: run `python build_bookmarklet.py --copy` and paste the result
// into a bookmark URL. Click the bookmark on maplescouter.com/en/input with
// the OCR JSON already on your clipboard.
//
// If the clipboard contains the literal text "INSPECT", the bookmarklet
// dumps page structure into an overlay for selector debugging.

(async function () {
  const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

  function setReactInput(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // The class trigger is a Radix-style <button role="combobox">, not an <input>.
  // The options render as <div role="option"> inside a portal/listbox. We open
  // the popup (if closed), then poll for the matching option and click it.
  async function selectCombobox(trigger, value) {
    const target = norm(value);
    trigger.scrollIntoView({ block: "center" });
    trigger.focus();
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 50));
      for (const el of document.querySelectorAll('[role="option"]')) {
        if (norm(el.textContent) === target) {
          el.click();
          return true;
        }
      }
    }
    return false;
  }

  // Layout of the stat rows — confirmed via INSPECT dump. Each entry is the
  // text the row starts with, followed by the JSON field names mapped to
  // each input in the row, in order.
  const STAT_ROWS = [
    { textPrefix: "general range",            fields: ["General Range", "Damage"] },
    { textPrefix: "final damage",             fields: ["Final Damage", "Boss Damage"] },
    { textPrefix: "ignore enemy defense",     fields: ["Ignore Enemy Defense", "Normal Enemy Damage"] },
    { textPrefix: "attack",                   fields: ["Attack Power", "Critical Rate"] },
    { textPrefix: "m.attack",                 fields: ["Magic ATT", "Critical Damage"] },
    { textPrefix: "cooldown reduction",       fields: ["Cooldown Reduction (sec)", "Cooldown Reduction (%)", "Buff Duration"] },
    { textPrefix: "cooldown skip",            fields: ["Cooldown Skip", "Ignore Elemental Resistance"] },
    { textPrefix: "additional status damage", fields: ["Additional Status Damage", "Summon Duration"] },
    { textPrefix: "arcane force",             fields: ["Arcane Force", "Sacred Force"] },
  ];

  // The class-specific table at the top of the form: 3 rows of (Base / % / NotApplied).
  // Which rows show up depends on class; we attempt all stats from data.table.
  const TABLE_STATS = ["STR", "DEX", "INT", "LUK", "HP", "Attack", "M.Attack"];

  function findRow(textPrefix, expectedInputCount) {
    const all = document.querySelectorAll("body *");
    for (const el of all) {
      const inputs = el.querySelectorAll("input,select,textarea");
      if (inputs.length !== expectedInputCount) continue;
      if (norm(el.textContent).startsWith(textPrefix)) return el;
    }
    return null;
  }

  // Find an input by an adjacent label text — for fields with no <label> element
  // and no row container (Level, Class). Tries two strategies in order:
  //   1. smallest container with exactly 1 input whose text starts with target;
  //   2. a leaf text node matching exactly, then climb to find a nearby input.
  function findInputByLabelText(labelText) {
    const target = norm(labelText);
    const all = Array.from(document.querySelectorAll("body *"));
    for (const el of all) {
      const inputs = el.querySelectorAll("input,select,textarea");
      if (inputs.length !== 1) continue;
      const t = norm(el.textContent);
      if (t === target || t.startsWith(target + " ")) return inputs[0];
    }
    for (const el of all) {
      if (el.children.length !== 0) continue;
      if (norm(el.textContent) !== target) continue;
      let cur = el.parentElement;
      for (let depth = 0; depth < 4 && cur; depth++) {
        const input = cur.querySelector("input,select,textarea");
        if (input) return input;
        cur = cur.parentElement;
      }
    }
    return null;
  }

  // ---------- inspect mode ----------
  function showOverlay(text) {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:5%;background:#111;color:#eee;z-index:2147483647;" +
      "padding:1em;border:2px solid #888;border-radius:8px;font-family:monospace;" +
      "font-size:12px;display:flex;flex-direction:column;gap:8px";
    const header = document.createElement("div");
    header.textContent = "maplescouter fill — diagnostic dump (Esc or click X to close)";
    const close = document.createElement("button");
    close.textContent = "X";
    close.style.cssText = "position:absolute;top:8px;right:8px;cursor:pointer";
    close.onclick = () => overlay.remove();
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "flex:1;width:100%;background:#000;color:#0f0;font-family:monospace";
    overlay.appendChild(close);
    overlay.appendChild(header);
    overlay.appendChild(ta);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", esc);
      }
    });
  }

  function inspectPage() {
    const out = [];
    out.push("=== LABELS ===");
    document.querySelectorAll("label").forEach((l, i) => {
      out.push(`L${i}: "${norm(l.textContent)}" for=${l.htmlFor || ""}`);
    });
    out.push("");
    out.push("=== INPUTS ===");
    document.querySelectorAll("input,select,textarea").forEach((el, i) => {
      const attrs = [
        el.tagName.toLowerCase(),
        el.type ? `type=${el.type}` : "",
        el.id ? `id=${el.id}` : "",
        el.name ? `name=${el.name}` : "",
        el.placeholder ? `placeholder="${el.placeholder}"` : "",
        el.getAttribute("aria-label") ? `aria-label="${el.getAttribute("aria-label")}"` : "",
        el.disabled ? "disabled" : "",
      ].filter(Boolean).join(" ");
      out.push(`I${i}: ${attrs}`);
    });
    out.push("");
    out.push("=== ROWS (containers with 2-4 inputs) ===");
    document.querySelectorAll("body *").forEach((el, i) => {
      const inputs = el.querySelectorAll("input,select,textarea");
      if (inputs.length >= 2 && inputs.length <= 4) {
        out.push(`R${i}: inputs=${inputs.length} text="${norm(el.textContent).slice(0, 100)}"`);
      }
    });
    out.push("");
    out.push("=== DROPDOWN MACHINERY (open a dropdown first to see options) ===");
    const seen = new Set();
    function dumpEl(el, tag) {
      if (seen.has(el)) return;
      seen.add(el);
      const role = el.getAttribute("role") || "";
      const expanded = el.getAttribute("aria-expanded") || "";
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      out.push(
        `${tag}: <${el.tagName.toLowerCase()}> role="${role}" aria-expanded="${expanded}" ` +
          `visible=${visible} text="${norm(el.textContent).slice(0, 60)}"`
      );
    }
    document.querySelectorAll('[role="option"]').forEach((el, i) => dumpEl(el, `OPT${i}`));
    document.querySelectorAll('[role="listbox"]').forEach((el, i) => dumpEl(el, `LB${i}`));
    document.querySelectorAll('[role="combobox"]').forEach((el, i) => dumpEl(el, `CB${i}`));
    document.querySelectorAll('[aria-expanded]').forEach((el, i) => dumpEl(el, `EXP${i}`));
    document.querySelectorAll('[aria-haspopup]').forEach((el, i) => dumpEl(el, `POP${i}`));
    showOverlay(out.join("\n"));
  }

  // ---------- main ----------
  let clipboardText;
  try {
    clipboardText = await navigator.clipboard.readText();
  } catch (e) {
    const pasted = prompt("Could not read clipboard. Paste JSON (or INSPECT):");
    if (!pasted) return;
    clipboardText = pasted;
  }

  if (norm(clipboardText).startsWith("inspect")) {
    inspectPage();
    return;
  }

  let data;
  try {
    data = JSON.parse(clipboardText);
  } catch (e) {
    alert("Clipboard isn't valid JSON: " + e.message);
    return;
  }

  const single = { ...(data.single || {}), ...(data.extras || {}) };
  const table = data.table || {};

  let filled = 0;
  const skipped = [];

  // Fill each stat row.
  for (const layout of STAT_ROWS) {
    const row = findRow(layout.textPrefix, layout.fields.length);
    if (!row) {
      skipped.push(`row:${layout.textPrefix}`);
      continue;
    }
    const inputs = row.querySelectorAll("input,select,textarea");
    layout.fields.forEach((fieldName, i) => {
      if (!(fieldName in single)) return;
      if (inputs[i].disabled) return;
      setReactInput(inputs[i], single[fieldName]);
      filled++;
    });
  }

  // Fill Class first — selecting it swaps the table rows on the site
  // (Bishop → INT/LUK/M.Attack; Warrior → STR/DEX/Attack), so the table fill
  // below sees the correct row set. Wait for re-render after.
  const character = data.character || {};
  if (character.class) {
    // The class trigger is the first <[role="combobox"]>. (The page has another
    // one for an unrelated toggle, which renders second.)
    const trigger = document.querySelector('[role="combobox"]');
    if (trigger) {
      const ok = await selectCombobox(trigger, character.class);
      if (ok) {
        filled++;
        await new Promise((r) => setTimeout(r, 250));
      } else {
        skipped.push("character:class");
      }
    } else {
      skipped.push("character:class");
    }
  }
  if (character.level != null) {
    const input = findInputByLabelText("level");
    if (input && !input.disabled) {
      setReactInput(input, character.level);
      filled++;
    } else {
      skipped.push("character:level");
    }
  }

  // Fill the class-specific Base/%/NotApplied table.
  for (const stat of TABLE_STATS) {
    if (!table[stat]) continue;
    const row = findRow(stat.toLowerCase(), 3);
    if (!row) {
      skipped.push(`table:${stat}`);
      continue;
    }
    const inputs = row.querySelectorAll("input,select,textarea");
    const values = [table[stat].base, table[stat].percent, table[stat].not_applied];
    values.forEach((v, i) => {
      if (v == null || inputs[i].disabled) return;
      setReactInput(inputs[i], v);
      filled++;
    });
  }

  const msg = `Filled ${filled} inputs.\nSkipped: ${skipped.length ? skipped.join(", ") : "none"}`;
  if (skipped.length) {
    console.log("[maplescouter-fill]", msg);
    if (confirm(msg + "\n\nDump page structure for debugging?")) inspectPage();
  } else {
    alert(msg);
  }
})();
