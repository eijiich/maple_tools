// filler.js — builds the bookmarklet that types the read values into
// maplescouter.com/en/input.
//
// A page on github.io cannot touch maplescouter.com directly (different origin),
// so a bookmarklet running *on* that site is the only way to automate the entry.
// The selector logic is the proven one from fill_form.js: the site lays out rows
// of (label-text, input[, input...]) with no <label> elements, so rows are found
// by their leading text and inputs assigned by position.
//
// The filler is written as a real function and stringified with toString(), so
// there's no build step or minifier and it stays debuggable as source.

window.FILLER = (function () {
  "use strict";

  // Runs inside maplescouter.com. `DATA` is injected as the first argument.
  function fillForm(DATA) {
    var norm = function (s) { return (s || "").toLowerCase().replace(/\s+/g, " ").trim(); };

    // React tracks its own value; assigning .value directly is ignored on
    // re-render, so go through the prototype setter and fire the events.
    function setReactInput(el, value) {
      var proto = el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Strip everything but letters/digits so "Arch Mage (Fire/Poison)",
    // "ArchMage(Fire/Poison)" and "archmagefirepoison" all compare equal.
    var squash = function (s) { return norm(s).replace(/[^a-z0-9ㄱ-힝]/g, ""); };

    /**
     * Class is a Radix-style <button role="combobox">; options render as
     * <div role="option"> in a portal, so open it and poll for the match.
     *
     * `aliases` is every name the option might display. The site stores class as
     * the Korean name and uses English purely as a label, so what's rendered
     * depends on the site's locale — matching one spelling would break the other.
     * Exact comparison is tried across all aliases first, then a punctuation- and
     * space-insensitive one, so nothing hinges on guessing the exact rendering.
     */
    function selectCombobox(trigger, aliases) {
      var exact = aliases.map(norm).filter(Boolean);
      var loose = aliases.map(squash).filter(Boolean);
      trigger.scrollIntoView({ block: "center" });
      trigger.focus();
      if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
      return new Promise(function (resolve) {
        var tries = 0;
        var tick = setInterval(function () {
          var opts = document.querySelectorAll('[role="option"]');
          var pick = null;
          for (var i = 0; i < opts.length && !pick; i++) {
            if (exact.indexOf(norm(opts[i].textContent)) >= 0) pick = opts[i];
          }
          for (var j = 0; j < opts.length && !pick; j++) {
            if (loose.indexOf(squash(opts[j].textContent)) >= 0) pick = opts[j];
          }
          if (pick) {
            pick.click();
            clearInterval(tick);
            return resolve(true);
          }
          if (++tries > 30) {
            clearInterval(tick);
            // Report what was on offer — far more useful than a bare failure if
            // the site renames or re-localises its options.
            resolve({
              failed: true,
              tried: aliases,
              saw: Array.prototype.map.call(
                document.querySelectorAll('[role="option"]'),
                function (o) { return o.textContent.trim(); }
              ).slice(0, 60),
            });
          }
        }, 50);
      });
    }

    function findRow(textPrefix, expectedInputCount) {
      var all = document.querySelectorAll("body *");
      for (var i = 0; i < all.length; i++) {
        var inputs = all[i].querySelectorAll("input,select,textarea");
        if (inputs.length !== expectedInputCount) continue;
        if (norm(all[i].textContent).indexOf(textPrefix) === 0) return all[i];
      }
      return null;
    }

    function findInputByLabelText(labelText) {
      var target = norm(labelText);
      var all = document.querySelectorAll("body *");
      for (var i = 0; i < all.length; i++) {
        var inputs = all[i].querySelectorAll("input,select,textarea");
        if (inputs.length !== 1) continue;
        var t = norm(all[i].textContent);
        if (t === target || t.indexOf(target + " ") === 0) return inputs[0];
      }
      return null;
    }

    var STAT_ROWS = [
      { prefix: "general range", fields: ["General Range", "Damage"] },
      { prefix: "final damage", fields: ["Final Damage", "Boss Damage"] },
      { prefix: "ignore enemy defense", fields: ["Ignore Enemy Defense", "Normal Enemy Damage"] },
      { prefix: "attack", fields: ["Attack Power", "Critical Rate"] },
      { prefix: "m.attack", fields: ["Magic ATT", "Critical Damage"] },
      { prefix: "cooldown reduction", fields: ["Cooldown Reduction (sec)", "Cooldown Reduction (%)", "Buff Duration"] },
      { prefix: "cooldown skip", fields: ["Cooldown Skip", "Ignore Elemental Resistance"] },
      { prefix: "additional status damage", fields: ["Additional Status Damage", "Summon Duration"] },
      { prefix: "arcane force", fields: ["Arcane Force", "Sacred Force"] },
    ];
    var TABLE_STATS = ["STR", "DEX", "INT", "LUK", "HP", "Attack", "M.Attack"];

    (async function () {
      var single = DATA.single || {};
      var table = DATA.table || {};
      var character = DATA.character || {};
      var filled = 0;
      var skipped = [];

      for (var i = 0; i < STAT_ROWS.length; i++) {
        var layout = STAT_ROWS[i];
        var row = findRow(layout.prefix, layout.fields.length);
        if (!row) { skipped.push("row:" + layout.prefix); continue; }
        var inputs = row.querySelectorAll("input,select,textarea");
        for (var f = 0; f < layout.fields.length; f++) {
          var name = layout.fields[f];
          if (!(name in single) || inputs[f].disabled) continue;
          setReactInput(inputs[f], single[name]);
          filled++;
        }
      }

      // Class first: picking it swaps which rows the table shows (Bishop ->
      // INT/LUK/M.Attack, Warrior -> STR/DEX/Attack), so the table fill below
      // must run against the correct row set.
      if (character.classAliases && character.classAliases.length) {
        var trigger = document.querySelector('[role="combobox"]');
        var res = trigger ? await selectCombobox(trigger, character.classAliases) : null;
        if (res === true) {
          filled++;
          await new Promise(function (r) { setTimeout(r, 250); });
        } else {
          skipped.push("character:class");
          if (res && res.failed) {
            console.log("[maplescouter-fill] class not matched. tried:", res.tried,
              "\noptions on the page:", res.saw);
          }
        }
      }
      if (character.level != null) {
        var lv = findInputByLabelText("level");
        if (lv && !lv.disabled) { setReactInput(lv, character.level); filled++; }
        else skipped.push("character:level");
      }

      for (var s = 0; s < TABLE_STATS.length; s++) {
        var stat = TABLE_STATS[s];
        if (!table[stat]) continue;
        var trow = findRow(stat.toLowerCase(), 3);
        if (!trow) { skipped.push("table:" + stat); continue; }
        var tin = trow.querySelectorAll("input,select,textarea");
        var vals = [table[stat].base, table[stat].percent, table[stat].not_applied];
        for (var v = 0; v < vals.length; v++) {
          if (vals[v] == null || tin[v].disabled) continue;
          setReactInput(tin[v], vals[v]);
          filled++;
        }
      }

      var msg = "Filled " + filled + " inputs.\nSkipped: " +
        (skipped.length ? skipped.join(", ") : "none");
      if (skipped.length) console.log("[maplescouter-fill]", msg);
      alert(msg);
    })();
  }

  /**
   * The generic bookmarklet: install once, reads its data from the clipboard.
   *
   * This is the one to keep in your bookmarks bar. It contains no values, so it
   * never goes stale — press Copy JSON on the reader whenever the numbers change
   * and click the same bookmark again.
   *
   * Clicking a bookmarklet counts as a user gesture, so clipboard reads are
   * allowed, but Firefox still gates navigator.clipboard.readText() in page
   * content. It falls back to a paste prompt there rather than failing.
   */
  function buildGeneric() {
    var body = "(async function(){" +
      "var F=" + fillForm.toString() + ";" +
      "var t=null;" +
      "try{t=await navigator.clipboard.readText();}catch(e){}" +
      "if(!t){t=prompt('Paste the JSON you copied from the stat reader:');}" +
      "if(!t)return;" +
      "var d;try{d=JSON.parse(t);}catch(e){" +
      "alert('That is not valid JSON.\\n\\n'+e.message+'\\n\\nPress Copy JSON on the " +
      "stat reader, then click this bookmark again.');return;}" +
      "if(!d||(!d.single&&!d.table)){" +
      "alert('That JSON has no stat data in it — expected the object Copy JSON produces.');return;}" +
      "F(d);" +
      "})();";
    return "javascript:" + encodeURIComponent(body);
  }

  /**
   * One-shot variant with the values baked in. Needs no clipboard access, but
   * goes out of date the moment anything changes, so it has to be re-dragged.
   * Useful when the browser blocks clipboard reads.
   */
  function buildWithData(data) {
    var body = "(" + fillForm.toString() + ")(" + JSON.stringify(data) + ");";
    return "javascript:" + encodeURIComponent(body);
  }

  /**
   * Rough browser limit on bookmarklet length. Chrome/Firefox handle far more
   * than we generate (~5-10KB), but warn rather than silently produce a URL that
   * some browser truncates.
   */
  function tooLong(url) { return url.length > 60000; }

  return {
    buildGeneric: buildGeneric,
    buildWithData: buildWithData,
    tooLong: tooLong,
    source: fillForm,
  };
})();
