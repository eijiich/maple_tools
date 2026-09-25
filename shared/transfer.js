// shared/transfer.js — one data file for every Ayamushy tool, plus device-to-device transfer.
//
// All tools live on the same site, so they share one localStorage. This module bundles every
// tool's saved data into a single file (export / import), and can hand that bundle straight to
// another device: one screen shows a QR code, the other scans it with its normal camera app,
// and the data goes over a direct WebRTC connection (PeerJS). PeerJS's free public broker only
// introduces the two devices; the data itself never passes through it.
//
// Transfers are one-directional on purpose: "Export to other device" or "Import to this device".
// The receiving side always confirms before anything is replaced, and the previous data is kept
// so the last import can be undone.
//
// A page that owns one of the stores registers live get/set hooks, so export reads its in-memory
// state (fresher than a debounced save) and import goes through its own normalize + re-render.
(function () {
  "use strict";

  var FORMAT = "ayamushy-tools", VERSION = 1;
  var BACKUP_KEY = "ayamushy_backup_before_import";
  var PEER_PREFIX = "ayamushy-";
  // PeerJS's JSON channel rejects messages over ~16 KB. A chunk is JSON text re-encoded inside a
  // JSON message, so escaping can roughly double it (and non-ASCII is up to 3 bytes/char).
  var CHUNK = 4000;
  var LIBS = {
    peer: "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js",
    qr: "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"
  };
  var STORES = [
    { key: "ayamushy_characters_v1", label: "Tracker",
      count: function (v) { return Array.isArray(v) ? v.length : 0; } },
    { key: "ayamushy_boss_week", raw: true },   // weekly-reset marker, so imported boss clears survive
    { key: "maple_gear_progression", label: "Gear Progression",
      count: function (v) { return v && v.chars ? Object.keys(v.chars).length : 0; } }
  ];

  var live = {};   // store key -> {get, set} from the app open on this page
  function register(key, hooks) { live[key] = hooks; }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function deviceLabel() { return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) ? "phone" : "computer"; }

  // ---------------------------------------------------------------- bundle

  function collect() {
    var stores = {};
    STORES.forEach(function (s) {
      if (live[s.key]) { stores[s.key] = live[s.key].get(); return; }
      var raw = lsGet(s.key);
      if (raw == null) return;
      if (s.raw) { stores[s.key] = raw; return; }
      try { stores[s.key] = JSON.parse(raw); } catch (e) { /* corrupt store: skip it */ }
    });
    return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(),
             device: deviceLabel(), stores: stores };
  }

  // Accept the unified bundle, or an older single-tool file (Tracker array / Gear state).
  function toBundle(obj) {
    if (obj && obj.format === FORMAT && obj.stores) return obj;
    if (Array.isArray(obj)) return { stores: { ayamushy_characters_v1: obj } };
    if (obj && obj.chars && typeof obj.chars === "object" && !Array.isArray(obj.chars))
      return { stores: { maple_gear_progression: obj } };
    throw new Error("this isn't an Ayamushy Tools data file");
  }

  function summary(bundle) {
    var parts = [];
    STORES.forEach(function (s) {
      if (!s.label || !(s.key in bundle.stores)) return;
      var n = s.count(bundle.stores[s.key]);
      parts.push(s.label + ": " + n + " character" + (n === 1 ? "" : "s"));
    });
    return parts.length ? parts.join(" · ") : "no tool data";
  }

  // Replace only the stores present in the bundle (an old Tracker-only file leaves Gear alone).
  function apply(bundle, keepBackup) {
    if (keepBackup !== false) lsSet(BACKUP_KEY, JSON.stringify(collect()));
    var s = bundle.stores;
    STORES.forEach(function (st) {   // raw markers first, so the app's own set() sees them
      if (st.raw && st.key in s) lsSet(st.key, String(s[st.key]));
    });
    STORES.forEach(function (st) {
      if (st.raw || !(st.key in s)) return;
      if (live[st.key]) live[st.key].set(s[st.key]);
      else lsSet(st.key, JSON.stringify(s[st.key]));
    });
  }

  function hasBackup() { return !!lsGet(BACKUP_KEY); }
  function undo() {
    var raw = lsGet(BACKUP_KEY);
    if (!raw) return;
    var b = JSON.parse(raw);
    if (!confirm("Undo the last import and go back to the data this device had before it?\n\n" + summary(b))) return;
    apply(b);   // backs up the imported data in turn, so undo can be undone
    toast("Restored the data from before the last import.");
  }

  // ---------------------------------------------------------------- file

  function exportFile() {
    var b = collect();
    var blob = new Blob([JSON.stringify(b, null, 1)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ayamushy-tools-" + b.exportedAt.slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importFile() {
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json,application/json";
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var b = toBundle(JSON.parse(rd.result));
          if (!confirm("Replace this device's data with this file?\n\n" + summary(b))) return;
          apply(b);
          toast("Imported " + summary(b) + ".");
        } catch (err) { alert("Couldn't read that file: " + err.message); }
      };
      rd.readAsText(f);
    };
    inp.click();
  }

  // ---------------------------------------------------------------- UI

  var CSS =
    ".ayx-back{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color-scheme:dark}" +
    ".ayx-box{background:#1b1f27;color:#e6e9ef;border:1px solid #333a47;border-radius:10px;max-width:420px;width:100%;padding:18px 18px 16px;position:relative;box-shadow:0 10px 40px rgba(0,0,0,.5)}" +
    ".ayx-box h3{margin:0 0 12px;font-size:16px}" +
    ".ayx-x{position:absolute;top:8px;right:10px;background:none;border:0;color:#9aa3b2;font-size:20px;cursor:pointer}" +
    ".ayx-btn{display:block;width:100%;text-align:left;background:#252b36;color:#e6e9ef;border:1px solid #3a4252;border-radius:8px;padding:10px 12px;margin:0 0 8px;cursor:pointer;font:inherit}" +
    ".ayx-btn:hover{border-color:#5b9cff}.ayx-btn b{display:block}.ayx-btn span{color:#9aa3b2;font-size:12px}" +
    ".ayx-pri{background:#2f6fd6;border-color:#2f6fd6;text-align:center}.ayx-pri:hover{background:#3b7df0}" +
    ".ayx-row{display:flex;gap:8px;margin-top:6px}.ayx-row .ayx-btn{margin:0}" +
    ".ayx-muted{color:#9aa3b2;font-size:12px}.ayx-sep{border-top:1px solid #333a47;margin:12px 0}" +
    ".ayx-code{display:flex;gap:6px;margin-top:6px}.ayx-code input{flex:1;background:#12151b;color:#e6e9ef;border:1px solid #3a4252;border-radius:6px;padding:7px 9px;font:inherit;text-transform:lowercase;letter-spacing:.1em}" +
    ".ayx-code button{background:#252b36;color:#e6e9ef;border:1px solid #3a4252;border-radius:6px;padding:0 12px;cursor:pointer}" +
    ".ayx-qr{background:#fff;border-radius:8px;padding:10px;width:230px;height:230px;margin:4px auto 10px}.ayx-qr svg{width:100%;height:100%;display:block}" +
    ".ayx-big{font:600 22px/1 ui-monospace,Consolas,monospace;letter-spacing:.18em;text-align:center;margin:0 0 6px}" +
    ".ayx-status{margin-top:10px;padding:8px 10px;background:#12151b;border-radius:6px;font-size:13px}" +
    ".ayx-ok{color:#6fd39a}.ayx-err{color:#ff8a80}" +
    ".ayx-link{background:none;border:0;color:#7fb0ff;cursor:pointer;padding:0;font:inherit;font-size:12px;text-decoration:underline}" +
    ".ayx-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#1b1f27;color:#e6e9ef;border:1px solid #3a4252;border-radius:8px;padding:9px 14px;z-index:10000;font:13px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4)}";
  var styled = false;
  function style() {
    if (styled) return; styled = true;
    var s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function toast(msg) {
    style();
    var t = document.createElement("div"); t.className = "ayx-toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  var modal = null, session = null;
  function openModal() {
    style();
    if (!modal) {
      modal = document.createElement("div"); modal.className = "ayx-back";
      modal.innerHTML = '<div class="ayx-box" role="dialog" aria-modal="true"><button class="ayx-x" aria-label="Close">×</button><div class="ayx-body"></div></div>';
      modal.addEventListener("click", function (e) { if (e.target === modal || e.target.classList.contains("ayx-x")) closeModal(); });
      document.body.appendChild(modal);
    }
    return modal.querySelector(".ayx-body");
  }
  function closeModal() {
    endSession();
    if (modal) { modal.remove(); modal = null; }
  }
  function body(html) { var b = openModal(); b.innerHTML = html; return b; }
  function status(html, cls) {
    var s = modal && modal.querySelector(".ayx-status");
    if (s) { s.className = "ayx-status" + (cls ? " " + cls : ""); s.innerHTML = html; }
  }

  function openDevices() {
    var b = body(
      '<h3>Move data between devices</h3>' +
      '<p class="ayx-muted" style="margin:-6px 0 12px">Moves Tracker and Gear Progression together. Keep this page open on both devices.</p>' +
      '<button class="ayx-btn" data-go="send"><b>Export to other device →</b><span>Show a QR code; the other device scans it and receives this device\'s data.</span></button>' +
      '<button class="ayx-btn" data-go="recv"><b>← Import to this device</b><span>Show a QR code; the other device scans it and sends its data here.</span></button>' +
      '<div class="ayx-sep"></div>' +
      '<div class="ayx-muted">Can\'t scan? Type the code shown on the other device:</div>' +
      '<div class="ayx-code"><input maxlength="6" placeholder="abc234" autocomplete="off" spellcheck="false"><button>Connect</button></div>' +
      (hasBackup() ? '<div class="ayx-sep"></div><button class="ayx-link" data-go="undo">Undo the last import on this device</button>' : ''));
    b.querySelector('[data-go="send"]').onclick = function () { host("send"); };
    b.querySelector('[data-go="recv"]').onclick = function () { host("recv"); };
    var u = b.querySelector('[data-go="undo"]'); if (u) u.onclick = function () { closeModal(); undo(); };
    var inp = b.querySelector(".ayx-code input"), go = b.querySelector(".ayx-code button");
    function connect() { var c = inp.value.trim().toLowerCase(); if (c.length === 6) join(c); else inp.focus(); }
    go.onclick = connect;
    inp.onkeydown = function (e) { if (e.key === "Enter") connect(); };
  }

  // ---------------------------------------------------------------- peer transfer

  var libsLoading = null;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src;
      s.onload = res; s.onerror = function () { rej(new Error("couldn't load " + src.split("/").pop())); };
      document.head.appendChild(s);
    });
  }
  function loadLibs() {
    if (!libsLoading) libsLoading = Promise.all([
      window.Peer ? null : loadScript(LIBS.peer),
      window.qrcode ? null : loadScript(LIBS.qr)
    ]).catch(function (e) { libsLoading = null; throw e; });
    return libsLoading;
  }

  function genCode() {
    var a = "abcdefghjkmnpqrstuvwxyz23456789", s = "", r = new Uint8Array(6);
    crypto.getRandomValues(r);
    for (var i = 0; i < 6; i++) s += a[r[i] % a.length];
    return s;
  }
  function pairUrl(code) { return location.origin + location.pathname + "#aya-pair=" + code; }

  function endSession() {
    if (session) { try { session.peer.destroy(); } catch (e) { /* already gone */ } session = null; }
  }

  function peerError(err) {
    var t = err && err.type;
    if (t === "peer-unavailable") return "No device is waiting with that code. Make sure the other screen still shows its QR code.";
    if (t === "network" || t === "server-error" || t === "socket-error" || t === "socket-closed")
      return "Couldn't reach the pairing service. Check the connection and try again.";
    if (t === "browser-incompatible") return "This browser can't make direct connections. Use the export file instead.";
    return "Connection failed" + (err && err.message ? ": " + esc(err.message) : "") + ".";
  }

  function sendBundle(conn, bundle) {
    var s = JSON.stringify(bundle), n = Math.max(1, Math.ceil(s.length / CHUNK));
    for (var i = 0; i < n; i++) conn.send({ t: "chunk", i: i, n: n, s: s.slice(i * CHUNK, (i + 1) * CHUNK) });
  }

  // Shared message handling. `ask` shows a confirm step inside the modal.
  function wire(conn) {
    var parts = null, got = 0, stall = null;
    function waitData() {                    // fail visibly instead of "Receiving…" forever
      clearTimeout(stall);
      stall = setTimeout(function () {
        status("The transfer stalled. Try again, or use the export file instead.", "ayx-err"); doneButton();
      }, 25000);
    }
    conn.on("data", function (m) {
      if (!m || !m.t) return;
      if (m.t === "hello") {                 // only the device that scanned gets this
        if (m.role === "send") { status("Connected. Receiving data from the " + esc(m.device) + "…"); waitData(); }
        else {
          var b = collect();
          ask("The " + esc(m.device) + " is ready to import. Send this device's data to it?",
              summary(b), "Send", function () { status("Sending…"); sendBundle(conn, b); },
              function () { conn.send({ t: "declined" }); });
        }
      } else if (m.t === "chunk") {
        if (!parts) { parts = new Array(m.n); got = 0; }
        if (parts[m.i] == null) { parts[m.i] = m.s; got++; }
        if (got < parts.length) { status("Receiving… " + Math.round(100 * got / parts.length) + "%"); waitData(); return; }
        clearTimeout(stall);
        status("Received everything from the other device.");
        var bundle;
        try { bundle = toBundle(JSON.parse(parts.join(""))); } catch (e) { status("The data arrived damaged: " + esc(e.message), "ayx-err"); return; }
        parts = null;
        ask("Replace this device's data with the one from the " + esc(bundle.device || "other device") + "?",
            summary(bundle), "Replace", function () {
              apply(bundle);
              conn.send({ t: "done" });
              status("✓ Imported " + esc(summary(bundle)) + ".", "ayx-ok");
              doneButton();
            }, function () { conn.send({ t: "declined" }); });
      } else if (m.t === "done") {
        status("✓ The other device imported the data.", "ayx-ok"); doneButton();
      } else if (m.t === "declined") {
        status("The other device cancelled. Nothing was changed.", "ayx-err"); doneButton();
      }
    });
    conn.on("error", function (e) { status(peerError(e), "ayx-err"); });
  }

  function ask(question, detail, yes, onYes, onNo) {
    var b = modal && modal.querySelector(".ayx-body"); if (!b) return;
    var box = document.createElement("div");
    box.innerHTML = '<div class="ayx-sep"></div><div>' + question + '</div><div class="ayx-muted" style="margin-top:4px">' + esc(detail) +
      '</div><div class="ayx-row"><button class="ayx-btn ayx-pri">' + yes + '</button><button class="ayx-btn" style="text-align:center">Cancel</button></div>';
    b.appendChild(box);
    var btns = box.querySelectorAll("button");
    btns[0].onclick = function () { box.remove(); onYes(); };
    btns[1].onclick = function () { box.remove(); onNo(); status("Cancelled. Nothing was changed."); doneButton(); };
  }

  function doneButton() {
    var b = modal && modal.querySelector(".ayx-body");
    if (!b || b.querySelector(".ayx-done")) return;
    var d = document.createElement("button"); d.className = "ayx-btn ayx-pri ayx-done"; d.style.marginTop = "10px";
    d.textContent = "Close"; d.onclick = closeModal; b.appendChild(d);
    var s = session;   // let a final "done"/"declined" message flush before hanging up
    setTimeout(function () { if (session === s) endSession(); }, 2000);
  }

  // The device showing the QR code. role = what THIS device does: "send" or "recv".
  function host(role, tries) {
    tries = tries || 0;
    body('<h3>' + (role === "send" ? "Export to other device" : "Import to this device") + '</h3>' +
         '<div class="ayx-status">Starting…</div>');
    loadLibs().then(function () {
      endSession();
      var code = genCode(), peer = new window.Peer(PEER_PREFIX + code, { debug: 0 });
      session = { peer: peer };
      peer.on("open", function () {
        var q = window.qrcode(0, "M"); q.addData(pairUrl(code)); q.make();
        body('<h3>' + (role === "send" ? "Export to other device" : "Import to this device") + '</h3>' +
             '<div class="ayx-qr">' + q.createSvgTag(4, 0) + '</div>' +
             '<div class="ayx-big">' + code + '</div>' +
             '<div class="ayx-muted" style="text-align:center">Scan with the other device\'s camera, or type the code on its <b>transfer</b> screen.</div>' +
             '<div class="ayx-status">Waiting for the other device…</div>');
      });
      peer.on("connection", function (conn) {
        if (session.conn) { conn.close(); return; }   // one partner per session
        session.conn = conn;
        wire(conn);
        conn.on("open", function () {
          conn.send({ t: "hello", role: role, device: deviceLabel() });
          if (role === "send") { status("Connected. Sending…"); sendBundle(conn, collect()); }
          else status("Connected. Waiting for the other device to send…");
        });
      });
      peer.on("error", function (err) {
        if (err.type === "unavailable-id" && tries < 3) { host(role, tries + 1); return; }   // code collision
        status(peerError(err), "ayx-err");
      });
    }).catch(function (e) { status(esc(e.message) + ". Check the connection, or use the export file instead.", "ayx-err"); });
  }

  // The device that scanned the QR code (or typed the code).
  function join(code) {
    body('<h3>Connecting to the other device</h3><div class="ayx-status">Connecting…</div>');
    loadLibs().then(function () {
      endSession();
      var peer = new window.Peer({ debug: 0 });
      session = { peer: peer };
      peer.on("open", function () {
        var conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: "json" });
        session.conn = conn;
        wire(conn);
      });
      peer.on("error", function (err) { status(peerError(err), "ayx-err"); doneButton(); });
    }).catch(function (e) { status(esc(e.message) + ". Check the connection, or use the export file instead.", "ayx-err"); });
  }

  // Opened from a scanned QR code: #aya-pair=<code>
  function checkHash() {
    var m = /[#&]aya-pair=([a-z0-9]{6})/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    join(m[1]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(checkHash, 0); });
  else setTimeout(checkHash, 0);
  window.addEventListener("hashchange", checkHash);   // link opened in a tab already on this page

  window.AyaTransfer = { register: register, exportFile: exportFile, importFile: importFile,
                         openDevices: openDevices, undo: undo, collect: collect };
})();
