// app.js — UI for the MapleStory stat reader.
//
// Flow: drop screenshots -> locate each in-game panel by its anchor -> read the
// values by template matching -> review/correct -> hand off to maplescouter.com.
//
// Two things are deliberately typed rather than read, because reading them would
// be less reliable than asking:
//   * Class — needs an alphabet we don't have, and it must match the site's
//     dropdown vocabulary exactly to be usable anyway.
//   * Level — the "Lv." badge uses a larger font variant, and all six samples show
//     only 291 or 292, yielding just the digits 1/2/9. Most levels would be
//     unreadable.
// Both are remembered in localStorage since they rarely change.

(function () {
  "use strict";

  var LS = {
    character: "maplescouter.character",
    glyphs: "maplescouter.taughtGlyphs",
    titles: "maplescouter.taughtTitles",
    anchors: "maplescouter.anchorOverrides",
  };

  var state = {
    shots: [],        // {name, img, mask, panels, readings, statInfo}
    single: {},       // site field -> value
    extras: {},       // read but not submitted (site computes these)
    table: {},        // stat -> {base, percent, not_applied}
    edited: {},       // field -> user-corrected value
  };

  // ------------------------------------------------------------- storage

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  /** Glyphs the user taught us, in the same shape as the generated font table. */
  function taughtGlyphs(fontName) {
    var all = loadJson(LS.glyphs, {});
    var set = all[fontName] || {};
    return Object.keys(set).map(function (ch) {
      var g = set[ch];
      var bits = new Uint8Array(g.w * g.h);
      for (var i = 0; i < g.bits.length; i++) bits[i] = g.bits[i] === "1" ? 1 : 0;
      return { ch: ch, w: g.w, h: g.h, bits: bits };
    });
  }

  function teachGlyph(fontName, ch, bitmap) {
    var all = loadJson(LS.glyphs, {});
    all[fontName] = all[fontName] || {};
    var s = "";
    for (var i = 0; i < bitmap.bits.length; i++) s += bitmap.bits[i] ? "1" : "0";
    all[fontName][ch] = { w: bitmap.w, h: bitmap.h, bits: s };
    saveJson(LS.glyphs, all);
  }

  function taughtTitles() {
    var set = loadJson(LS.titles, {});
    return Object.keys(set).map(function (k) {
      return { ch: k, w: set[k].w, h: set[k].h, bits: set[k].bits };
    });
  }

  function teachTitle(stat, bitmap) {
    var set = loadJson(LS.titles, {});
    var s = "";
    for (var i = 0; i < bitmap.bits.length; i++) s += bitmap.bits[i] ? "1" : "0";
    set[stat] = { w: bitmap.w, h: bitmap.h, bits: s };
    saveJson(LS.titles, set);
  }

  // -------------------------------------------------------------- reading

  function imageDataFrom(bitmap) {
    var c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  /**
   * Locate every panel in a frame.
   *
   * Precedence: a position the user picked for *this* screenshot, then automatic
   * detection, then a position remembered from an earlier screenshot.
   *
   * Per-shot beats remembered deliberately. A remembered position is an absolute
   * pixel coordinate, so it is only meaningful while the in-game windows stay put
   * — applying one to every screenshot is how a single wrong pick used to spread
   * silently. It stays a last resort, is labelled as such in the UI, and can be
   * cleared.
   */
  function locatePanels(mask, shot) {
    var remembered = loadJson(LS.anchors, {});
    var found = {};
    Object.keys(window.LAYOUT).forEach(function (key) {
      var pick = shot && shot.manual && shot.manual[key];
      if (pick) {
        found[key] = { x: pick.x, y: pick.y, source: "manual" };
        return;
      }
      var hit = OCR.findAnchor(mask, window.LAYOUT[key].anchor);
      if (hit) {
        hit.source = hit.exact ? "auto" : "auto-approx";
        found[key] = hit;
        return;
      }
      found[key] = remembered[key]
        ? { x: remembered[key][0], y: remembered[key][1], source: "remembered" }
        : null;
    });
    return found;
  }

  function readShot(shot) {
    var extraGlyphs = taughtGlyphs("stat");
    if (!shot.mask) shot.mask = OCR.fullMask(shot.img, "stat");
    shot.panels = locatePanels(shot.mask, shot);

    shot.readings = {};
    var sw = shot.panels.statWindow;
    if (sw) {
      var rois = window.LAYOUT.statWindow.rois;
      Object.keys(rois).forEach(function (field) {
        var r = rois[field];
        var read = OCR.readRoi(shot.mask, [sw.x + r[0], sw.y + r[1], r[2], r[3]], "stat", extraGlyphs);
        shot.readings[field] = {
          parsed: FIELDS.parse(field, read.text),
          raw: read.text,
          unknown: read.unknown,
          glyphs: read.glyphs,
        };
      });
    }

    shot.statInfo = null;
    var si = shot.panels.statInfo;
    if (si) {
      var panel = window.LAYOUT.statInfo;
      var abs = function (r) { return [si.x + r[0], si.y + r[1], r[2], r[3]]; };
      var info = OCR.readStatInfo(
        shot.mask,
        abs(panel.rois["StatInfo:Title"]),
        abs(panel.rois["StatInfo:Values"]),
        panel.titles,
        taughtTitles()
      );
      shot.statInfo = {
        detected: info.stat,
        stat: shot.statInfoOverride || info.stat,
        titleBitmap: info.titleBitmap,
        rows: info.rows,
        table: FIELDS.parseStatInfo(info.rows, shot.statInfoOverride || info.stat),
      };
    }
    return shot;
  }

  /** Merge every shot into one result set. Later shots win on conflict. */
  function merge() {
    var readings = {};
    state.table = {};
    state.shots.forEach(function (shot) {
      Object.keys(shot.readings || {}).forEach(function (field) {
        var p = shot.readings[field].parsed;
        var has = p.values ? p.values.some(function (v) { return v != null; }) : p.value != null;
        if (has) readings[field] = p;
      });
      if (shot.statInfo && shot.statInfo.stat && shot.statInfo.table) {
        var t = shot.statInfo.table;
        if (t.base != null || t.percent != null) {
          state.table[shot.statInfo.stat] = {
            base: t.base, percent: t.percent, not_applied: t.not_applied,
          };
        }
      }
    });
    var mapped = FIELDS.toSiteFields(readings);
    state.single = mapped.single;
    state.extras = mapped.extras;
    Object.keys(state.edited).forEach(function (k) {
      if (state.edited[k] === null) delete state.single[k];
      else state.single[k] = state.edited[k];
    });
  }

  function classByKey(key) {
    for (var i = 0; i < window.CLASSES.length; i++) {
      if (window.CLASSES[i].key === key) return window.CLASSES[i];
    }
    return null;
  }

  /**
   * Every name the site's option might render for this class.
   *
   * maplescouter stores class as the Korean name and treats English as a display
   * label, so the option text depends on its locale. Sending all the aliases lets
   * the bookmarklet match whichever one is on screen instead of us betting on it.
   */
  function classAliases(key) {
    var c = classByKey(key);
    if (!c) return [];
    var out = [c.key, c.label, c.ko];
    if (c.gms) out.push(c.gms);
    // "DemonAvenger" -> "Demon Avenger" is usually c.label already, but keep the
    // raw de-camelCased form too in case label was overridden for readability.
    out.push(c.key.replace(/(?<=[a-z])(?=[A-Z])/g, " "));
    return out.filter(function (v, i) { return v && out.indexOf(v) === i; });
  }

  function payload() {
    var ch = loadJson(LS.character, {});
    var out = { character: {}, table: state.table, single: state.single, extras: state.extras };
    if (ch.class) {
      var c = classByKey(ch.class);
      out.character.class = ch.class;                  // site's internal key
      out.character.classAliases = classAliases(ch.class);
      if (c) out.character.classKo = c.ko;             // the value the site stores
    }
    if (ch.level) out.character.level = Number(ch.level);
    return out;
  }

  // ------------------------------------------------------------ rendering

  var el = function (id) { return document.getElementById(id); };

  function bitmapToCanvas(bm, scale) {
    var z = scale || 6;
    var c = document.createElement("canvas");
    c.width = bm.w * z;
    c.height = bm.h * z;
    c.className = "glyph";
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#12161c";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#e8eef7";
    for (var j = 0; j < bm.h; j++) {
      for (var i = 0; i < bm.w; i++) {
        if (bm.bits[j * bm.w + i]) ctx.fillRect(i * z, j * z, z, z);
      }
    }
    return c;
  }

  function renderPanels() {
    var box = el("panels");
    box.innerHTML = "";
    if (!state.shots.length) return;
    state.shots.forEach(function (shot) {
      var card = document.createElement("div");
      card.className = "shotcard";
      var title = document.createElement("div");
      title.className = "shotname";
      title.textContent = shot.name + "  (" + shot.img.width + "x" + shot.img.height + ")";
      card.appendChild(title);

      var remembered = loadJson(LS.anchors, {});
      Object.keys(window.LAYOUT).forEach(function (key) {
        var hit = shot.panels[key];
        var row = document.createElement("div");
        var tone = !hit ? "bad"
          : (hit.source === "auto" ? "ok" : (hit.source === "auto-approx" ? "ok" : "warn"));
        row.className = "panelrow " + tone;

        var what;
        if (!hit) {
          what = "not found";
        } else if (hit.source === "auto") {
          what = "found at " + hit.x + "," + hit.y + " (exact)";
        } else if (hit.source === "auto-approx") {
          what = "found at " + hit.x + "," + hit.y +
            " (" + (100 - hit.ratio * 100).toFixed(0) + "% match)";
        } else if (hit.source === "manual") {
          what = "at " + hit.x + "," + hit.y + " — you picked this";
        } else {
          what = "at " + hit.x + "," + hit.y +
            " — reused from an earlier screenshot, not detected here";
        }
        var text = document.createElement("span");
        text.textContent = window.LAYOUT[key].label + ": " + what;
        row.appendChild(text);

        // Always offered, not just on failure: an automatic match can still be
        // the wrong place, and a bad manual pick has to be redoable.
        var btn = document.createElement("button");
        btn.className = "mini ghost";
        btn.textContent = hit ? (hit.source === "manual" ? "Redo" : "Set manually") : "Locate manually";
        btn.onclick = function () { startManual(shot, key); };
        row.appendChild(btn);

        if (shot.manual && shot.manual[key]) {
          var undo = document.createElement("button");
          undo.className = "mini ghost";
          undo.textContent = "Use auto";
          undo.onclick = function () {
            delete shot.manual[key];
            readShot(shot);
            refresh();
          };
          row.appendChild(undo);
        }
        if (remembered[key]) {
          var forget = document.createElement("button");
          forget.className = "mini ghost";
          forget.textContent = "Forget saved";
          forget.onclick = function () {
            var r = loadJson(LS.anchors, {});
            delete r[key];
            saveJson(LS.anchors, r);
            state.shots.forEach(readShot);
            refresh();
          };
          row.appendChild(forget);
        }
        card.appendChild(row);
      });

      if (shot.statInfo) {
        var si = document.createElement("div");
        si.className = "panelrow " + (shot.statInfo.stat ? "ok" : "bad");
        si.textContent = "Stat Info: " +
          (shot.statInfo.detected
            ? shot.statInfo.detected + " (recognised)"
            : "title not recognised — pick the stat");
        var sel = document.createElement("select");
        sel.className = "mini";
        var blank = document.createElement("option");
        blank.value = ""; blank.textContent = "—";
        sel.appendChild(blank);
        FIELDS.TABLE_STATS.forEach(function (s) {
          var o = document.createElement("option");
          o.value = s; o.textContent = s;
          if (shot.statInfo.stat === s) o.selected = true;
          sel.appendChild(o);
        });
        sel.onchange = function () {
          shot.statInfoOverride = sel.value || null;
          // Teaching the title makes the next screenshot of this stat automatic.
          if (sel.value && shot.statInfo.titleBitmap && !shot.statInfo.detected) {
            teachTitle(sel.value, shot.statInfo.titleBitmap);
          }
          readShot(shot);
          refresh();
        };
        si.appendChild(sel);
        if (shot.statInfo.titleBitmap) si.appendChild(bitmapToCanvas(shot.statInfo.titleBitmap, 2));
        card.appendChild(si);
      }
      box.appendChild(card);
    });
  }

  /** One editable input bound to a site field. */
  function valueInput(siteField, width) {
    var inp = document.createElement("input");
    inp.type = "text";
    var v = state.single[siteField];
    inp.value = v == null ? "" : v;
    if (width) inp.className = "narrow";
    inp.oninput = function () {
      var t = inp.value.trim();
      state.edited[siteField] = t === "" ? null : (isFinite(Number(t)) ? Number(t) : t);
      merge();
      renderExport();
    };
    return inp;
  }

  /**
   * The cell for one game field.
   *
   * A field with no site target is one maplescouter computes itself (Damage Range,
   * Final Damage) or that isn't damage-related (Mesos, Star Force) — shown dimmed
   * and read-only for sanity checking. Cooldown Reduction is a single "4 sec / 6%"
   * row in game but two inputs on the site, so it gets two boxes in one cell.
   */
  function valueCell(gameField) {
    var td = document.createElement("td");
    td.className = "fval";
    var target = FIELDS.SINGLE[gameField];
    if (!target) {
      td.classList.add("readonly");
      var x = state.extras[gameField];
      td.textContent = x == null ? "—" : x;
      td.title = "maplescouter computes this — shown for checking only";
      return td;
    }
    if (Array.isArray(target)) {
      target.forEach(function (t, i) {
        var tag = document.createElement("span");
        tag.className = "subtag";
        tag.textContent = i === 0 ? "sec" : "%";
        td.appendChild(valueInput(t, true));
        td.appendChild(tag);
      });
      return td;
    }
    td.appendChild(valueInput(target));
    return td;
  }

  /**
   * Values laid out the way the STAT window is: same two columns, same order, same
   * blank gap before the Mesos/Star Force block. Rows come from layout.js, derived
   * from the ROI coordinates, so they can't drift from the game.
   */
  function renderValues() {
    var tbody = el("values");
    tbody.innerHTML = "";

    var read = Object.keys(state.single).length + Object.keys(state.extras).length;
    if (!read) {
      var tr0 = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.colSpan = 4;
      td0.className = "empty";
      td0.textContent = "No values read yet.";
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
      return;
    }

    (window.LAYOUT.statWindow.gameRows || []).forEach(function (row) {
      var tr = document.createElement("tr");
      if (row === null) {
        tr.className = "spacer";
        var pad = document.createElement("td");
        pad.colSpan = 4;
        tr.appendChild(pad);
        tbody.appendChild(tr);
        return;
      }
      row.forEach(function (gameField) {
        var name = document.createElement("td");
        name.className = "fname";
        name.textContent = gameField;
        if (!FIELDS.SINGLE[gameField]) name.classList.add("readonly");
        tr.appendChild(name);
        tr.appendChild(valueCell(gameField));
      });
      while (tr.children.length < 4) tr.appendChild(document.createElement("td"));
      tbody.appendChild(tr);
    });
  }

  function renderTable() {
    var tbody = el("statTable");
    tbody.innerHTML = "";
    var stats = Object.keys(state.table);
    if (!stats.length) {
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 4;
      td.className = "empty";
      td.textContent = "Drop one screenshot per stat with its Stat Info panel open.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    stats.sort().forEach(function (stat) {
      var t = state.table[stat];
      var tr = document.createElement("tr");
      [stat, t.base, t.percent, t.not_applied].forEach(function (v, i) {
        var td = document.createElement("td");
        td.textContent = v == null ? "—" : v;
        if (i === 0) td.className = "statname";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function renderProblems() {
    var box = el("problems");
    box.innerHTML = "";
    var issues = [];
    state.shots.forEach(function (shot) {
      Object.keys(shot.readings || {}).forEach(function (field) {
        var r = shot.readings[field];
        if (!r.unknown) return;
        issues.push({ shot: shot, field: field, reading: r });
      });
    });
    if (!issues.length) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    var h = document.createElement("h3");
    h.textContent = "Unrecognised glyphs (" + issues.length + ")";
    box.appendChild(h);
    var p = document.createElement("p");
    p.className = "hint";
    p.textContent = "A glyph matched no template. Type the character it shows and " +
      "it is remembered for every future screenshot.";
    box.appendChild(p);

    issues.forEach(function (issue) {
      var row = document.createElement("div");
      row.className = "issue";
      var lbl = document.createElement("span");
      lbl.textContent = issue.field + " read as \"" + issue.reading.raw + "\":";
      row.appendChild(lbl);
      issue.reading.glyphs.forEach(function (g) {
        if (g.ch !== null || g.decoration) return;
        var wrap = document.createElement("span");
        wrap.className = "teach";
        wrap.appendChild(bitmapToCanvas(g.bitmap, 8));
        var inp = document.createElement("input");
        inp.className = "teachinput";
        inp.maxLength = 1;
        inp.placeholder = "?";
        inp.onchange = function () {
          if (!inp.value) return;
          teachGlyph("stat", inp.value, g.bitmap);
          state.shots.forEach(readShot);
          refresh();
        };
        wrap.appendChild(inp);
        row.appendChild(wrap);
      });
      box.appendChild(row);
    });
  }

  function renderExport() {
    var data = payload();
    el("json").value = JSON.stringify(data, null, 2);

    // The one-shot link carries the current values, so it is rebuilt on every
    // change. The generic one is wired once in wire() and never changes.
    var oneShot = FILLER.buildWithData(data);
    el("bookmarkletOneShot").href = oneShot;
    el("bmnote2").textContent = FILLER.tooLong(oneShot)
      ? "Warning: " + oneShot.length + " chars — some browsers may truncate this."
      : oneShot.length + " chars.";
  }

  function refresh() {
    merge();
    var remembered = loadJson(LS.anchors, {});
    el("forgetSaved").classList.toggle("hidden", !Object.keys(remembered).length);
    renderPanels();
    renderValues();
    renderTable();
    renderProblems();
    renderExport();
    el("results").classList.toggle("hidden", !state.shots.length);
  }

  // --------------------------------------------------- manual panel location

  var manual = null;   // {shot, panelKey, pending}

  function anchorBitmap(anchor) {
    var b = new Uint8Array(anchor.w * anchor.h);
    for (var i = 0; i < anchor.bits.length; i++) b[i] = anchor.bits[i] === "1" ? 1 : 0;
    return { w: anchor.w, h: anchor.h, bits: b };
  }

  function startManual(shot, panelKey) {
    manual = { shot: shot, panelKey: panelKey, pending: null };
    el("manual").classList.remove("hidden");
    el("manualConfirm").classList.add("hidden");
    el("manualRemember").checked = false;

    var anchor = window.LAYOUT[panelKey].anchor;
    el("manualLabel").textContent =
      "Drag a box around this text (" + window.LAYOUT[panelKey].label + ")";
    var ref = el("manualRef");
    ref.innerHTML = "";
    ref.appendChild(bitmapToCanvas(anchorBitmap(anchor), 3));

    var canvas = el("manualCanvas");
    canvas.width = shot.img.width;
    canvas.height = shot.img.height;
    var ctx = canvas.getContext("2d");
    var repaint = function () { ctx.putImageData(shot.img, 0, 0); };
    repaint();

    var box = null;
    var toImage = function (ev) {
      var r = canvas.getBoundingClientRect();
      return [
        Math.round((ev.clientX - r.left) * (canvas.width / r.width)),
        Math.round((ev.clientY - r.top) * (canvas.height / r.height)),
      ];
    };
    canvas.onmousedown = function (ev) { box = { a: toImage(ev) }; };
    canvas.onmousemove = function (ev) {
      if (!box) return;
      box.b = toImage(ev);
      repaint();
      ctx.strokeStyle = "#5eead4";
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.min(box.a[0], box.b[0]), Math.min(box.a[1], box.b[1]),
        Math.abs(box.b[0] - box.a[0]), Math.abs(box.b[1] - box.a[1]));
    };
    canvas.onmouseup = function (ev) {
      if (!box) return;
      box.b = toImage(ev);
      var x = Math.min(box.a[0], box.b[0]), y = Math.min(box.a[1], box.b[1]);
      var w = Math.abs(box.b[0] - box.a[0]), h = Math.abs(box.b[1] - box.a[1]);
      box = null;
      if (w < 4 || h < 4) return;

      // Tighten to the text inside the box: that top-left corner is where the
      // anchor sits, which is all the ROI offsets need.
      var sub = OCR.tighten(OCR.subMask(shot.mask, x, y, w, h));
      if (!sub) {
        el("manualLabel").textContent =
          "No text in that box — drag around the words shown on the right.";
        return;
      }
      // Show what was captured and wait for confirmation. Committing on mouseup
      // was the bug: a mis-drag was saved instantly with no way back.
      manual.pending = { x: x + sub.left, y: y + sub.top, bitmap: sub };
      var prev = el("manualPreview");
      prev.innerHTML = "";
      prev.appendChild(bitmapToCanvas(sub, 3));
      el("manualConfirm").classList.remove("hidden");
    };
  }

  function commitManual() {
    if (!manual || !manual.pending) return;
    var shot = manual.shot, key = manual.panelKey, p = manual.pending;
    shot.manual = shot.manual || {};
    shot.manual[key] = { x: p.x, y: p.y };
    if (el("manualRemember").checked) {
      var r = loadJson(LS.anchors, {});
      r[key] = [p.x, p.y];
      saveJson(LS.anchors, r);
    }
    closeManual();
    readShot(shot);
    refresh();
  }

  function closeManual() {
    manual = null;
    el("manual").classList.add("hidden");
    el("manualConfirm").classList.add("hidden");
  }

  // ------------------------------------------------------------- ingestion

  async function addFiles(files) {
    var list = Array.prototype.slice.call(files).filter(function (f) {
      return f.type.indexOf("image/") === 0;
    });
    if (!list.length) return;
    el("status").textContent = "Reading " + list.length + " screenshot(s)…";
    for (var i = 0; i < list.length; i++) {
      var bitmap = await createImageBitmap(list[i]);
      var shot = { name: list[i].name || "pasted image", img: imageDataFrom(bitmap) };
      readShot(shot);
      state.shots.push(shot);
    }
    el("status").textContent = state.shots.length + " screenshot(s) loaded.";
    refresh();
  }

  function wire() {
    var drop = el("drop");
    el("file").onchange = function (e) { addFiles(e.target.files); };
    drop.onclick = function () { el("file").click(); };
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("hover"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("hover"); });
    });
    drop.addEventListener("drop", function (e) { addFiles(e.dataTransfer.files); });
    document.addEventListener("paste", function (e) {
      if (e.clipboardData && e.clipboardData.files.length) addFiles(e.clipboardData.files);
    });

    el("clear").onclick = function () {
      state.shots = []; state.edited = {};
      el("status").textContent = "";
      refresh();
    };
    // The generic bookmarklet contains no values, so it is built once and stays
    // valid for every future Copy JSON.
    var generic = FILLER.buildGeneric();
    el("bookmarklet").href = generic;
    el("bmnote").textContent =
      "The bookmark holds no data (" + generic.length + " chars) — install it once " +
      "and it always uses whatever you last copied.";

    el("copyJson").onclick = function () {
      var btn = el("copyJson");
      navigator.clipboard.writeText(el("json").value).then(function () {
        btn.textContent = "Copied — now click the bookmark";
        setTimeout(function () { btn.textContent = "Copy JSON"; }, 2500);
      }, function () {
        // Clipboard write refused: select the textarea so Ctrl+C still works.
        el("json").select();
        btn.textContent = "Press Ctrl+C";
        setTimeout(function () { btn.textContent = "Copy JSON"; }, 2500);
      });
    };
    el("manualClose").onclick = closeManual;
    el("manualUse").onclick = commitManual;
    el("manualRedraw").onclick = function () {
      if (!manual) return;
      manual.pending = null;
      el("manualConfirm").classList.add("hidden");
      el("manualLabel").textContent =
        "Drag a box around this text (" + window.LAYOUT[manual.panelKey].label + ")";
      var canvas = el("manualCanvas");
      canvas.getContext("2d").putImageData(manual.shot.img, 0, 0);
    };
    el("forgetSaved").onclick = function () {
      saveJson(LS.anchors, {});
      state.shots.forEach(function (s) { s.manual = {}; readShot(s); });
      refresh();
    };

    // Class dropdown, from maplescouter's own option list.
    var sel = el("class");
    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "— pick your class —";
    sel.appendChild(blank);
    var main = document.createElement("optgroup");
    main.label = "Classes";
    var nonKms = document.createElement("optgroup");
    nonKms.label = "Non-KMS classes";
    window.CLASSES.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.key;
      o.textContent = c.gms && c.gms !== c.label ? c.label + " (" + c.gms + ")" : c.label;
      (c.nonKms ? nonKms : main).appendChild(o);
    });
    sel.appendChild(main);
    if (nonKms.children.length) sel.appendChild(nonKms);

    var ch = loadJson(LS.character, {});
    sel.value = ch.class || "";
    el("level").value = ch.level || "";
    var saveChar = function () {
      saveJson(LS.character, { class: sel.value, level: el("level").value.trim() });
      var c = classByKey(sel.value);
      el("classNote").textContent = c
        ? "maplescouter stores this as “" + c.ko + "”; the bookmarklet will " +
          "match any of: " + classAliases(c.key).join(", ")
        : "";
      renderExport();
    };
    sel.onchange = saveChar;
    el("level").oninput = saveChar;
    saveChar();

    var untrained = FIELDS.TABLE_STATS.filter(function (s) {
      return !(window.LAYOUT.statInfo.titles || {})[s];
    });
    if (untrained.length) {
      el("trainNote").textContent =
        "Stat Info titles known from samples: " +
        Object.keys(window.LAYOUT.statInfo.titles || {}).join(", ") +
        ". Not yet known: " + untrained.join(", ") +
        " — pick the stat once and it is remembered.";
    }
  }

  OCR.loadFonts(window.GLYPHS);
  wire();
  refresh();
})();
