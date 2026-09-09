"""
Parse-check every JS file, and smoke-test app.js against a stub DOM.

Why this exists: a blind string replacement once left `if (cell) const g = ...` in
app.js, which is a SyntaxError. selftest.html never caught it because that page
does not load app.js -- so 175 checks passed while index.html rendered nothing.
A parse check over ALL files, app.js included, closes that gap.

Needs quickjs:  pip install quickjs

Run: python tools/check_js.py
"""

import re
import sys
from pathlib import Path

try:
    import quickjs
except ImportError:
    sys.exit("pip install quickjs")

BASE = Path(__file__).resolve().parent.parent
JS = BASE / "js"

# load order, same as index.html
ORDER = ["sf-stats.js", "sf.js", "cubing.js",
         "value.js", "flames.js", "app.js"]

# Minimal DOM so app.js can run top-to-bottom. It only needs to be shaped enough
# that getElementById().addEventListener() and the render calls don't throw.
DOM_STUB = r"""
var __els = {};
var __focused = null;
var __listeners = [];

// Tracks parentNode and exposes closest / querySelector / sibling getters, which
// is the minimum needed to exercise gridNav's column traversal for real rather
// than just asserting the handler got attached.
function __mkEl(tag) {
  var el = {
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, dataset: {}, files: [], checked: false, value: '', type: '',
    textContent: '', className: '', innerHTML: '', colSpan: 1,
    children: [], parentNode: null, disabled: false,
    // Backed by className rather than a private set: el() assigns className
    // directly, so a separate set would drift from it the first time both are used.
    // Real enough to assert that a view toggle actually lit its button, which a
    // no-op stub reported as false forever.
    classList: null,
    appendChild(c) {
      if (c && typeof c === 'object') c.parentNode = this;
      this.children.push(c); return c;
    },
    append() {
      for (var i = 0; i < arguments.length; i++) this.appendChild(arguments[i]);
    },
    replaceChildren() {
      this.children = [];
      for (var i = 0; i < arguments.length; i++) this.appendChild(arguments[i]);
    },
    addEventListener(type, fn) { __listeners.push({ el: this, type: type, fn: fn }); },
    // register by id so getElementById finds elements built by el(), not a phantom.
    // Without this, refreshFlameRow's lookup silently returned an empty stub and the
    // in-place-refresh behaviour could not be tested at all.
    setAttribute(k, v) { this[k] = v; if (k === 'id') __els[v] = this; },
    querySelectorAll() { return []; },
    querySelector(sel) {
      var wants = sel.split(',').map(function (s) { return s.trim().toUpperCase(); });
      function find(n) {
        for (var i = 0; i < n.children.length; i++) {
          var c = n.children[i];
          if (!c || typeof c !== 'object') continue;
          if (wants.indexOf(c.tagName) >= 0) return c;
          var r = find(c);
          if (r) return r;
        }
        return null;
      }
      return find(this);
    },
    closest(sel) {
      var want = sel.toUpperCase();
      var n = this;
      while (n) { if (n.tagName === want) return n; n = n.parentNode; }
      return null;
    },
    focus() { __focused = this; },
    select() {},
    insertRow() { return this.appendChild(__mkEl('tr')); },
    insertCell() { return this.appendChild(__mkEl('td')); },
    click() {},
  };
  function sib(offset) {
    if (!el.parentNode) return null;
    var i = el.parentNode.children.indexOf(el);
    return i < 0 ? null : (el.parentNode.children[i + offset] || null);
  }
  Object.defineProperty(el, 'nextElementSibling', { get: function () { return sib(1); } });
  Object.defineProperty(el, 'previousElementSibling', { get: function () { return sib(-1); } });
  el.classList = {
    _all: function () { return (el.className || '').split(/\s+/).filter(Boolean); },
    _set: function (list) { el.className = list.join(' '); },
    contains: function (c) { return this._all().indexOf(c) >= 0; },
    add: function (c) { if (!this.contains(c)) this._set(this._all().concat([c])); },
    remove: function (c) {
      this._set(this._all().filter(function (x) { return x !== c; }));
    },
    toggle: function (c, on) {
      var want = on === undefined ? !this.contains(c) : !!on;
      if (want) this.add(c); else this.remove(c);
      return want;
    },
  };
  return el;
}

// fire a listener registered on `el` for `type`
function __fire(el, type, evt) {
  for (var i = 0; i < __listeners.length; i++) {
    var L = __listeners[i];
    if (L.el === el && L.type === type) L.fn(evt);
  }
}
var document = {
  getElementById: function (id) {
    if (!__els[id]) { __els[id] = __mkEl('div'); __els[id].id = id; }
    return __els[id];
  },
  createElement: __mkEl,
  createTextNode: function (t) { var n = __mkEl('#text'); n.textContent = t; return n; },
  createDocumentFragment: function () { return __mkEl('#fragment'); },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  body: __mkEl('body'), documentElement: __mkEl('html'),
};
var localStorage = {
  _d: {},
  getItem: function (k) { return this._d[k] === undefined ? null : this._d[k]; },
  setItem: function (k, v) { this._d[k] = String(v); },
};
var window = { devicePixelRatio: 1, scrollTo: function () {} };
var console = { log: function(){}, warn: function(){}, error: function(){} };
var setTimeout = function (fn) { return 0; };      // never fire the save debounce
var clearTimeout = function () {};
var alert = function () {}, confirm = function () { return false; };
var prompt = function () { return null; };
var URL = { createObjectURL: function(){ return ''; }, revokeObjectURL: function(){} };
var Blob = function () {};
"""


def main():
    ctx = quickjs.Context()
    failed = []

    # 1. parse each file in isolation
    print("parse check")
    for name in ORDER:
        src = (JS / name).read_text(encoding="utf-8")
        try:
            quickjs.Context().eval("(function(){" + src + "\n})")
            print(f"  ok    {name}")
        except Exception as e:
            failed.append(name)
            print(f"  FAIL  {name}\n          {str(e).strip().splitlines()[0]}")

    if failed:
        print(f"\n{len(failed)} file(s) failed to parse")
        return 1

    # 2. run the whole bundle against a stub DOM, which also executes app.js's
    #    top-level render pass -- catching runtime errors, not just syntax ones
    print("\nload + initial render against a stub DOM")
    try:
        ctx.eval(DOM_STUB)
        for name in ORDER:
            ctx.eval((JS / name).read_text(encoding="utf-8"))
        print(f"  ok    all {len(ORDER)} files loaded and renderAll() completed")
    except Exception as e:
        print(f"  FAIL  {str(e).strip()}")
        return 1

    # 3. a few smoke assertions through the loaded bundle
    print("\nsmoke")
    for label, expr, want in [
        ("SLOTS length", "SLOTS.length", 23),
        ("lv130 is offered", "LEVELS.indexOf(130) >= 0", True),
        ("  ... and is the lowest", "Math.min.apply(null, LEVELS)", 130),
        ("a lv130 accessory caps at 20 stars", "sfCap(130,'armor')", 20),
        ("milestones above the cap drop out",
         "state.milestones.filter(m => m <= sfCap(130,'armor')).join(',')", "15,17,18"),
        ("pocket has no cube pool", "String(SLOTS.find(s=>s.key==='pocket').cube)", "null"),
        ("flameable count", "FLAMEABLE.size", 15),
        ("lv160 bumps main stat", "cubeLineValue('main_stats',12,160)", 13),
        ("lv150 does not", "cubeLineValue('main_stats',12,150)", 12),
        ("cube pools intact", "CUBE_POOL_ERRORS.length", 0),
        ("gloves offer Crit DMG first, since it is the line worth having there",
         "cubeLineOptions('gloves',150,[]).filter(l=>l[0]!=='Zero')[0][0]", "Crit DMG"),
        ("  ... and every other category still leads with the stat line",
         "['hat','top','acc','weapon'].map(c=>"
         "cubeLineOptions(c,150,[]).filter(l=>l[0]!=='Zero')[0][0]).join(',')",
         "main_stats,main_stats,main_stats,ATT"),
        ("  ... ordering did not disturb the odds",
         "Math.abs(cubeCombos('red','gloves',150,[])"
         ".reduce((a,c)=>a+c.prob,0) - 1) < 1e-12", True),
        ("swapping the pendants moves the whole item",
         "(function(){var a=cur().slots.pend1,b=cur().slots.pend2;"
         "a.level=160;a.star=22;a.fINT=40;b.level=140;b.star=12;b.fINT=7;"
         "swapSlots('pend1','pend2');"
         "var ok=cur().slots.pend1.level===140 && cur().slots.pend1.star===12 &&"
         " cur().slots.pend1.fINT===7 && cur().slots.pend2.level===160;"
         "swapSlots('pend1','pend2');"
         "return ok && cur().slots.pend1.level===160 && cur().slots.pend1.fINT===40;})()", True),
        ("only the pendants offer a swap",
         "Object.keys(PENDANT_SWAP).join(',')", "pend1"),
        ("the flame distribution cache separates weight sets that differ only in hpFlat",
         "(function(){"
         "var a = buildWeights(parseScouter(SCOUTER_EXAMPLE));"
         "var b = buildWeights(parseScouter(SCOUTER_EXAMPLE + String.fromCharCode(10) + 'HP\\t\\t2'));"
         "var da = flameDistributionCached('armor', 160, a, {flameType:'eternal'});"
         "var db = flameDistributionCached('armor', 160, b, {flameType:'eternal'});"
         "return a.hpFlat !== b.hpFlat && da !== db;})()", True),
        ("the settings panel has the Astra toggle",
         "(function(){var n=0;function w(e){if(!e||typeof e!=='object')return;"
         "if(e.type==='checkbox')n++;(e.children||[]).forEach(w);}"
         "w(document.getElementById('sfSettings'));return n;})() >= 5", True),
        ("Astra prices spares at 1b",
         "(function(){cur().secondaryKind='astra';"
         "var m=SLOTS.find(s=>s.key==='secondary');"
         "var c=sfCfgFor(m,cur().slots.secondary).itemCost;"
         "cur().secondaryKind='none';return c;})()", 1e9),
        ("a weapon rule and Astra are independent",
         "(function(){cur().weaponKind='destiny2';cur().secondaryKind='astra';"
         "var ok=cur().weaponKind==='destiny2'&&cur().secondaryKind==='astra';"
         "cur().weaponKind='none';cur().secondaryKind='none';return ok;})()", True),
        ("legacy fMain/fSub saves migrate to per-stat fields",
         "(function(){var s={chars:{c1:newChar('x')},active:'c1'};"
         "s.chars.c1.scouter=SCOUTER_EXAMPLE;"
         "s.chars.c1.slots.hat.fMain=45;s.chars.c1.slots.hat.fSub=20;"
         "var m=migrate(s);var h=m.chars.c1.slots.hat;"
         "return [h.fINT,h.fLUK,('fMain' in h)].join(',');})()", "45,20,false"),
        ("flame mass is 1",
         "Math.abs(flameDistribution('armor',160,buildWeights(parseScouter(SCOUTER_EXAMPLE)),"
         "{flameType:'eternal'}).reduce((a,x)=>a+x.prob,0) - 1) < 1e-9", True),
    ]:
        got = ctx.eval(expr)
        ok = got == want
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}: {got}")
        if not ok:
            failed.append(label)

    # 3a. Every element app.js reaches for must EXIST, and must exist BEFORE the
    #     <script> tags that read it. The stub's getElementById fabricates any id it is
    #     asked for, so a missing element can never throw here -- which is precisely how
    #     a compare panel appended after the scripts shipped: app.js ran first, got null
    #     from the real DOM, and the whole page died on one addEventListener.
    #
    #     Static check against index.html, because the stub cannot see this by design.
    print("\nelements app.js reads exist before the scripts run")
    try:
        html = (BASE / "index.html").read_text(encoding="utf-8")
        cut = html.index('<script src="js/')
        declared = set(re.findall(r'id="([^"]+)"', html[:cut]))
        after = set(re.findall(r'id="([^"]+)"', html[cut:]))
        app = (JS / "app.js").read_text(encoding="utf-8")
        looked = set(re.findall(r"getElementById\('([^']+)'\)", app))
        # ids app.js creates itself (pv-*, per-slot rows) are built at runtime, not markup
        looked = {i for i in looked if not i.startswith("pv-")}
        missing = sorted(looked - declared)
        late = sorted(i for i in missing if i in after)
        if missing:
            failed.append("missing elements")
            for i in missing:
                why = "declared AFTER the scripts" if i in late else "not in index.html"
                print(f"  FAIL  {i}: {why}")
        else:
            print(f"  ok    all {len(looked)} ids app.js looks up are declared above the scripts")
    except Exception as e:
        failed.append("element check")
        print(f"  FAIL  {str(e).strip().splitlines()[0]}")

    # 3b. Run selftest.html EXACTLY as the browser does: engine files only, no app.js.
    #     A check there that reaches for an app.js symbol throws at load and silently
    #     skips every later check, which has happened three times (weightsProfileText,
    #     WEAPON_KINDS, LEVELS). Executing it here catches that immediately, and makes
    #     this one command cover both layers instead of them drifting apart.
    print("\nselftest.html, engine files only (as the browser loads it)")
    try:
        st = quickjs.Context()
        st.eval(DOM_STUB)
        for name in ORDER:
            if name != "app.js":
                st.eval((JS / name).read_text(encoding="utf-8"))
        script = re.findall(r"<script>(.*?)</script>",
                            (BASE / "selftest.html").read_text(encoding="utf-8"), re.S)[0]
        st.eval(script)
        total = st.eval("results.filter(function(r){return !r.info;}).length")
        bad = st.eval("results.filter(function(r){return !r.info && !r.ok;})"
                      ".map(function(f){return f.name;}).join(', ')")
        if bad:
            failed.append("selftest checks")
            print(f"  FAIL  {total} checks, failing: {bad}")
        else:
            print(f"  ok    {total} checks, no failures, and no app.js symbol needed")
    except Exception as e:
        failed.append("selftest.html")
        print(f"  FAIL  {str(e).strip().splitlines()[0]}")

    # 3c. The single-file builds are generated, so they can go stale without any
    #     visible symptom -- they still open, still render, and quietly rank with an
    #     older engine. Rebuild in memory and compare, then actually RUN what is on
    #     disk, since "matches the generator" and "works" are different claims.
    print("\nsingle-file builds")
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import build_single

        for src_name, out_name, _ in build_single.TARGETS:
            fresh, _inlined = build_single.build(src_name)
            out = BASE / out_name
            if not out.exists():
                failed.append(out_name)
                print(f"  FAIL  {out_name} missing - run python tools/build_single.py")
                continue
            if out.read_text(encoding="utf-8") != fresh:
                failed.append(out_name)
                print(f"  FAIL  {out_name} is stale - run python tools/build_single.py")
                continue

            blocks = re.findall(r"<script>(.*?)</script>",
                                out.read_text(encoding="utf-8"), re.S)
            sc = quickjs.Context()
            sc.eval(DOM_STUB)
            for b in blocks:
                sc.eval(b)
            if src_name == "selftest.html":
                n = sc.eval("results.filter(function(r){return !r.info;}).length")
                bad2 = sc.eval("results.filter(function(r){return !r.info && !r.ok;})"
                               ".map(function(f){return f.name;}).join(', ')")
                detail = f"{n} checks, no failures" if not bad2 else f"FAILING: {bad2}"
                if bad2:
                    failed.append(out_name + " checks")
            else:
                sc.eval("cur().scouter = SCOUTER_EXAMPLE; refreshWeights(); renderAll();")
                rows = sc.eval("document.getElementById('gearBody').children.length")
                detail = f"{rows} gear rows rendered"
                if rows != 23:
                    failed.append(out_name + " render")
            print(f"  ok    {out_name}: current, {len(blocks)} inline blocks, {detail}")
    except Exception as e:
        failed.append("single-file build")
        print(f"  FAIL  {str(e).strip().splitlines()[0]}")

    # 3d. Typing in the Plan field must not re-rank on every keystroke. Eight of the
    #     nine characters in "444/11/44" leave the EFFECTIVE policy unchanged (a partial
    #     plan falls back to the global), so re-ranking on them is pure waste -- and it
    #     is what made the field feel sluggish.
    print("\nPlan field only re-ranks when the policy actually changes")
    try:
        ctx.eval("""
          cur().scouter = SCOUTER_EXAMPLE; refreshWeights();
          cur().slots.hat.sfPlan = ''; renderAll();
          var __ranks = 0, __rr = renderRank;
          renderRank = function () { __ranks++; return __rr.apply(null, arguments); };
          var __idx = SLOTS.map(function (m) { return m.key; }).indexOf('hat');
          var __inp = document.getElementById('gearBody').children[__idx].children[6].children[0];
          function __type(text) {
            __ranks = 0;
            for (var i = 1; i <= text.length; i++) {
              __inp.value = text.slice(0, i);
              __fire(__inp, 'input', {});
            }
            return __ranks;
          }
        """)
        for label, expr, want in [
            ("one re-rank for the 9 chars of 444/11/44", "__type('444/11/44')", 1),
            ("  ... and the plan took effect",
             "sfModesName(sfCfgFor(SLOTS[__idx], cur().slots.hat).modes)", "444/11/44"),
            # One, not zero: leaving a VALID plan for an invalid one really does
            # change the effective policy back to the global, so the ranking must
            # follow. The "4" does that; the second "4" changes nothing.
            ("dropping to an unparseable plan re-ranks once", "__type('44')", 1),
            ("  ... which falls back to the global",
             "sfModesName(sfCfgFor(SLOTS[__idx], cur().slots.hat).modes)",
             "111/11/11"),
            # Already on the global by now, so blanking it changes nothing.
            ("clearing an already-ineffective plan re-ranks not at all", "__type('')", 0),
        ]:
            got = ctx.eval(expr)
            ok = got == want
            print(f"  {'ok  ' if ok else 'FAIL'}  {label}: {got}")
            if not ok:
                failed.append(label)
        # restore, so later checks see an untouched renderRank
        ctx.eval("renderRank = __rr; cur().slots.hat.sfPlan = ''; renderAll();")
    except Exception as e:
        failed.append("Plan field")
        print(f"  FAIL  {str(e).strip().splitlines()[0]}")

    # 3e. Cross-character comparison. It swaps the active character to reuse the normal
    #     per-character machinery, so the thing most worth asserting is that it puts
    #     everything back -- a leak here would silently rank the wrong character's gear.
    print("\ncompare characters")
    try:
        ctx.eval("""
          // two characters that differ in weights and in gear
          state.chars.cA = newChar('A');
          state.chars.cB = newChar('B');
          // three, so unticking one still leaves a valid comparison. With two, unticking
          // drops below the minimum and the table correctly shows the "need two" notice
          // instead -- which is what an earlier version of this test tripped over.
          state.chars.cC = newChar('C');
          state.chars.cC.scouter = SCOUTER_EXAMPLE;
          state.chars.cA.scouter = SCOUTER_EXAMPLE;
          state.chars.cB.scouter = SCOUTER_EXAMPLE.replace('INT\\t\\t1', 'STR\\t\\t1')
                                                  .replace(/INT/g, 'STR');
          state.chars.cA.slots.hat.star = 15;
          state.chars.cB.slots.hat.star = 20;
          state.active = 'c1'; cur().scouter = SCOUTER_EXAMPLE;
          refreshWeights(); renderAll();
        """)
        for label, expr, want in [
            ("under two selected, nothing is computed",
             "(function(){state.compare={};renderCompare(true);"
             "return document.getElementById('cmpRankBody').children[0].children[0].textContent"
             ".indexOf('at least two') >= 0;})()", True),
            ("selecting several produces rows",
             "(function(){state.compare={cA:true,cB:true,cC:true};renderCompare(true);"
             "return document.getElementById('cmpRankBody').children.length > 0;})()", True),
            ("rows are tagged with the character",
             "(function(){var s={};compareMerged('rank').forEach(function(r){s[r.charName]=1;});"
             "return Object.keys(s).sort().join(',');})()", "A,B,C"),
            ("the active character is restored", "state.active", "c1"),
            ("  ... and so are its weights", "weights.mainStat", "INT"),
            ("the ranking is sorted by meso per stat",
             "compareMerged('rank').every(function(r,i,a){return i===0||!(a[i-1].per>r.per);})", True),
            ("flames are sorted fewest-rolls-first, i.e. easiest",
             "compareMerged('flames').every(function(r,i,a){"
             "return i===0||!(a[i-1].rollsToBeat>r.rollsToBeat);})", True),
            ("unticking filters without recomputing",
             "(function(){var n=compareMerged('rank').length;state.compare.cB=false;"
             "renderCompare(false);"
             "var rows=document.getElementById('cmpRankBody').children;"
             "return compareMerged('rank').length<n && rows.length>0 && "
             "rows.every(function(tr){return tr.children[1].textContent!=='B';}) && "
             "rows.some(function(tr){return tr.children[1].textContent==='A';});})()", True),
            ("dropping below two shows the notice rather than a partial table",
             "(function(){state.compare={cA:true};renderCompare(false);"
             "var tr=document.getElementById('cmpRankBody').children[0];"
             "return tr.children.length===1 && "
             "tr.children[0].textContent.indexOf('at least two')>=0;})()", True),
            # These three are the bugs a user hit: unticking blanked the table, and so did
            # switching tabs, because a single staleness counter was bumped by save() and
            # both of those call it. A per-character signature can tell a view change from
            # an input change.
            ("unticking does not blank the table",
             "(function(){state.compare={cA:true,cB:true,cC:true};renderCompare(true);"
             "state.compare.cC=false;save();renderCompare(false);"
             "var rows=document.getElementById('cmpRankBody').children;"
             "return rows.length>1 && compareMissing().length===0;})()", True),
            ("switching tabs does not blank it",
             "(function(){state.compare={cA:true,cB:true};renderCompare(true);"
             "showTab('main');showTab('compare');"
             "var rows=document.getElementById('cmpRankBody').children;"
             "return rows.length>1 && compareMissing().length===0;})()", True),
            ("editing one character invalidates only that one",
             "(function(){state.compare={cA:true,cB:true};renderCompare(true);"
             "state.chars.cA.slots.hat.star=19;save();"
             "return compareMissing().join(',');})()", "cA"),
            ("  ... and it says which character needs work",
             "(function(){renderCompare(false);"
             "return document.getElementById('cmpRankBody').children[0].children[0]"
             ".textContent.indexOf('A') >= 0;})()", True),
            ("recalculating clears it",
             "(function(){renderCompare(true);return compareMissing().length;})()", 0),
            # A character stays cached across tick/untick, so re-adding one costs nothing.
            # An earlier version of this check expected cC to need recomputing after being
            # re-ticked; it did not, because it was still validly cached -- which is the
            # whole point.
            ("re-ticking a character needs no recompute",
             "(function(){state.compare={cA:true,cB:true,cC:true};renderCompare(true);"
             "state.compare.cC=false;renderCompare(false);"
             "state.compare.cC=true;return compareMissing().length;})()", 0),
            ("  ... and it is back in the table",
             "(function(){renderCompare(false);"
             "var rows=document.getElementById('cmpRankBody').children;"
             "return rows.some(function(tr){return tr.children[1].textContent==='C';});})()",
             True),
            ("a character never computed does need work",
             "(function(){state.chars.cD=newChar('D');"
             "state.chars.cD.scouter=SCOUTER_EXAMPLE;state.compare.cD=true;"
             "var need=compareMissing().join(',');delete state.chars.cD;"
             "delete state.compare.cD;return need;})()", "cD"),
            ("a global setting change invalidates every character",
             "(function(){state.compare={cA:true,cB:true};renderCompare(true);"
             "state.cubeSale=!state.cubeSale;"
             "var n=compareMissing().length;state.cubeSale=!state.cubeSale;"
             "return n;})()", 2),
        ]:
            got = ctx.eval(expr)
            ok = got == want
            print(f"  {'ok  ' if ok else 'FAIL'}  {label}: {got}")
            if not ok:
                failed.append(label)
        ctx.eval("delete state.chars.cA; delete state.chars.cB; delete state.chars.cC;"
                 "state.compare={};"
                 "state.active='c1'; renderAll();")
    except Exception as e:
        failed.append("compare")
        print(f"  FAIL  {str(e).strip().splitlines()[0]}")

    # 4. the tables actually have rows in them. This is the symptom the parse error
    #    produced -- index.html rendered no gear inputs at all -- so assert it
    #    directly rather than trusting that "it loaded" means "it drew something".
    print("\nrendered tables")
    ctx.eval("""
      cur().scouter = SCOUTER_EXAMPLE;
      refreshWeights(); renderAll();
    """)
    # Column counts come from index.html's own <thead>, not from a number written here.
    # A hardcoded count goes stale the moment a column is added or dropped, and then
    # reports a failure about the wrong thing -- which is what happened when Safe was
    # removed: the body was consistent at 13 and the check was still asserting 14.
    def th_count(tbody_id):
        html = (BASE / "index.html").read_text(encoding="utf-8")
        i = html.index(f'id="{tbody_id}"')
        head = html.rindex("<thead", 0, i)
        seg = html[head:html.index("</thead>", head)]
        # <th[\s>] rather than "<th", which also matches the <thead> that opens seg
        return len(re.findall(r"<th[\s>]", seg))

    for label, expr, want in [
        ("gear rows", "document.getElementById('gearBody').children.length", 23),
        ("every gear row matches the header's column count",
         "document.getElementById('gearBody').children"
         f".every(r => r.children.length === {th_count('gearBody')})",
         True),
        ("flame rows", "document.getElementById('flameBody').children.length", 15),
        ("every flame row matches the header's column count",
         "document.getElementById('flameBody').children"
         f".every(r => r.children.length === {th_count('flameBody')})",
         True),
        ("ranking has rows",
         "document.getElementById('rankBody').children.length > 0", True),
    ]:
        got = ctx.eval(expr)
        ok = got == want
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}: {got}" + ('' if ok else f"  want {want}"))
        if not ok:
            failed.append(label)

    # 4b. The flame axis of the meso ranking, which exists because bonus stats
    #     became resettable for a flat meso price. Guards the two mistakes that
    #     were easy to make here: pricing the reset off the slot's own flame
    #     picker rather than the fixed Black Rebirth table, and losing the row
    #     to the star-force collapse in the default view.
    print("\nflame reset axis")
    flame_axis = ctx.eval("""
      (function () {
        var saveFlag = state.flameReset;
        state.flameReset = true;              // off by default; this section is about the axis
        var rows = candidates().filter(function (r) { return r.axis === 'flame'; });
        var r = rows.find(function (x) { return x.slot === 'Hat'; });

        // per must equal cost/gain on every row, as on the other axes, AND collapse
        // to price / E[gain per reset] -- the reset count scales both and cancels.
        var consistent = rows.every(function (x) {
          return Math.abs(x.per - x.cost / x.gain) < 1e-6;
        });
        var g = cur().slots.hat;
        var d = flameDistributionCached('armor', g.level, weights,
          { flameType: FLAME_RESET_TYPE, nonAdvantaged: !g.flameAdv, baseAtt: g.baseAtt });
        var rr = flameReroll(d, flameCurrentValue(g, weights));
        var identity = Math.abs(r.per - FLAME_RESET_MESO / rr.gainPerRoll) < 1e-6;

        // The meso reset always rates at the Black Rebirth (eternal) table, so
        // changing the slot's own flame picker must not move the ranking row.
        var before = r.per;
        g.flameType = 'powerful';
        flameCacheClear(); flameRowCacheClear();
        var afterPowerful = candidates().find(function (x) {
          return x.axis === 'flame' && x.slot === 'Hat'; }).per;
        g.flameType = 'eternal';
        flameCacheClear(); flameRowCacheClear();

        // Advantage, unlike the flame type, does come from the slot.
        g.flameAdv = false;
        flameCacheClear(); flameRowCacheClear();
        var nonAdv = candidates().find(function (x) {
          return x.axis === 'flame' && x.slot === 'Hat'; }).per;
        g.flameAdv = true;
        flameCacheClear(); flameRowCacheClear();

        state.flameReset = saveFlag;
        return [rows.length > 0, consistent, identity,
                Math.abs(afterPowerful - before) < 1e-6, nonAdv > before,
                isFinite(r.cost), r.gain > 0].join(',');
      })()
    """)
    (f_any, f_cons, f_ident, f_type, f_adv, f_cost, f_gain) = flame_axis.split(",")

    # The default view collapses star force to one row per slot. That filter used to
    # whitelist axis === 'cube', which silently dropped the flame row once it existed.
    flame_view = ctx.eval("""
      (function () {
        var saveBest = view.bestPerSlot, saveSteps = view.allSteps;
        var saveFlag = state.flameReset;
        state.flameReset = true;
        view.bestPerSlot = true; view.allSteps = false;
        var collapsed = candidates().filter(function (r) { return r.axis === 'flame'; }).length;
        view.bestPerSlot = false;
        var expanded = candidates().filter(function (r) { return r.axis === 'flame'; }).length;
        view.bestPerSlot = saveBest; view.allSteps = saveSteps;
        state.flameReset = saveFlag;
        return collapsed + ',' + expanded;
      })()
    """)
    v_collapsed, v_expanded = flame_view.split(",")

    # Reset count is geometric, so pXX is exact -- but it is NOT always above the
    # mean. When an improvement is near-certain the mean sits above the percentile,
    # because the mean is what the tail pulls up: at p=0.95 the mean is 1.053 resets
    # and the 85th percentile is 1. An unflamed item is exactly that case, so both
    # directions are pinned here rather than assuming the usual one.
    flame_pct = ctx.eval("""
      (function () {
        // Synthetic rerolls: p is the only thing that matters here, and this keeps
        // the assertion independent of whatever the fixture's flames happen to be.
        var unlikely = { pImprove: 0.30, gainPerRoll: 1, rollsToBeat: 1 / 0.30 };
        var certain  = { pImprove: 0.95, gainPerRoll: 1, rollsToBeat: 1 / 0.95 };
        var ua = flameResetPlan(unlikely, 0),  ub = flameResetPlan(unlikely, 85);
        var ca = flameResetPlan(certain, 0),   cb = flameResetPlan(certain, 85);

        // And one pass through the real ranking row, to prove view.pct reaches it.
        var saveFlag = state.flameReset;
        state.flameReset = true;
        var save = view.pct;
        view.pct = 0;
        var ra = candidates().find(function (r) { return r.axis === 'flame' && r.slot === 'Hat'; });
        view.pct = 85;
        var rb = candidates().find(function (r) { return r.axis === 'flame' && r.slot === 'Hat'; });
        view.pct = save;
        state.flameReset = saveFlag;

        return [
          ub.resets > ua.resets,                       // unlikely: pXX above the mean
          ub.per > ua.per,
          cb.resets < ca.resets,                       // near-certain: below it
          ub.resets === Math.round(ub.resets),         // whole resets
          Math.abs(ub.gain - ua.gain) < 1e-9,          // gain never moves with pct
          Math.abs(rb.gain - ra.gain) < 1e-9,
          rb.resets !== ra.resets,                     // ... but the row's cost does
        ].join(',');
      })()
    """)
    (p_up, p_perup, p_down, p_whole, p_gain, p_rowgain, p_rowmoves) = flame_pct.split(",")

    for label, got, want in [
        ("the ranking carries flame rows", f_any, "true"),
        ("per === cost / gain on every flame row", f_cons, "true"),
        ("  ... and === 3m / E[gain per reset]", f_ident, "true"),
        ("the slot's flame picker does not move the meso row", f_type, "true"),
        ("  ... but non-advantaged makes it worse value", f_adv, "true"),
        ("cost is finite", f_cost, "true"),
        ("gain is positive", f_gain, "true"),
        ("best-per-slot keeps the flame row", str(int(v_collapsed) > 0), "True"),
        ("  ... as many as the expanded view", v_collapsed, v_expanded),
        ("p85 needs more resets when improving is unlikely", p_up, "true"),
        ("  ... so meso/stat is higher there", p_perup, "true"),
        ("p85 needs fewer than the mean when it is near-certain", p_down, "true"),
        ("  ... resets are whole numbers", p_whole, "true"),
        ("the percentile never moves the gain", p_gain, "true"),
        ("  ... including on the real ranking row", p_rowgain, "true"),
        ("  ... though it does move that row's cost", p_rowmoves, "true"),
        ("axis labels cover all three",
         ctx.eval("[axisLabel('sf'),axisLabel('cube'),axisLabel('flame')].join('|')"),
         "star force|cubing|flame reset"),
        ("an unimprovable roll yields no plan",
         ctx.eval("String(flameResetPlan({pImprove:0,gainPerRoll:0,rollsToBeat:Infinity}).per)"),
         "Infinity"),
    ]:
        ok = got == want
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}: {got}" + ('' if ok else f"  want {want}"))
        if not ok:
            failed.append(label)

    # 4c. The axis is off by default, because the meso reset is a patch-note item
    #     rather than something confirmed live. Off must reproduce the pre-patch
    #     ranking exactly, and must not disturb the separate flames table, which
    #     ranks flames you own and never depended on a meso price.
    print("\nflame reset toggle")
    flame_toggle = ctx.eval("""
      (function () {
        var saveFlag = state.flameReset;

        state.flameReset = false;
        var offRows = candidates();
        var offFlames = offRows.filter(function (r) { return r.axis === 'flame'; }).length;
        var offSig = compareGlobalSig();
        var offPanel = flameRows().length;      // the separate flames table is unaffected

        state.flameReset = true;
        var onRows = candidates();
        var onFlames = onRows.filter(function (r) { return r.axis === 'flame'; }).length;
        var onSig = compareGlobalSig();
        var onPanel = flameRows().length;

        // With the axis off the ranking must be exactly the pre-patch one: same rows,
        // same order, same numbers. Compare a fingerprint of the non-flame rows.
        var fp = function (rows) {
          return rows.filter(function (r) { return r.axis !== 'flame'; })
            .map(function (r) { return r.slot + '|' + r.axis + '|' + r.move + '|' + r.per; })
            .join(';');
        };
        var untouched = fp(offRows) === fp(onRows);

        state.flameReset = saveFlag;
        return [offFlames, onFlames, offSig !== onSig, untouched,
                offPanel, onPanel].join(',');
      })()
    """)
    (t_off, t_on, t_sig, t_untouched, t_offpanel, t_onpanel) = flame_toggle.split(",")

    for label, got, want in [
        ("defaults off", ctx.eval("String(!!state.flameReset)"), "false"),
        ("off means no flame rows in the ranking", t_off, "0"),
        ("on adds one per flameable slot", t_on, "15"),
        ("off leaves every other row identical", t_untouched, "true"),
        ("toggling invalidates the compare cache", t_sig, "true"),
        ("the separate flames table is unaffected (off)", t_offpanel, "15"),
        ("  ... and on", t_onpanel, "15"),
        ("setFlameReset persists and syncs both buttons",
         ctx.eval("(function(){var s=state.flameReset; setFlameReset(true);"
                  "var a=[document.getElementById('tglFlame'),"
                  "document.getElementById('cmpTglFlame')]"
                  ".map(function(b){return b && b.className.indexOf('on')>=0;});"
                  "setFlameReset(false);"
                  "var b=[document.getElementById('tglFlame'),"
                  "document.getElementById('cmpTglFlame')]"
                  ".map(function(x){return x && x.className.indexOf('on')>=0;});"
                  "state.flameReset=s; syncFlameResetToggles();"
                  "return a.join(',')+' -> '+b.join(',');})()"),
         "true,true -> false,false"),
    ]:
        ok = got == want
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}: {got}" + ('' if ok else f"  want {want}"))
        if not ok:
            failed.append(label)

    # 4d. Presentation of small numbers, and the flame-score column. A Final Damage
    #     paste puts every value in %fd, where one fixed decimal turned every flame
    #     gain into "0.1" and one into "0.0"; the score column exists so that same
    #     paste still reads as a familiar "130" rather than "1.32".
    print("\nsmall-number precision and flame score")
    fs = ctx.eval("""
      (function () {
        // Unit invariance: scale every weight in the paste by 0.01 and mark it %fd.
        // The flame's Now shrinks by 0.01 too, so dividing back through the main
        // stat's weight must land on exactly the stat-mode value.
        var pct = SCOUTER_EXAMPLE.replace(/(-?[\\d.]+)$/gm, function (m) {
          return (parseFloat(m) * 0.01) + '%';
        });
        var wStat = buildWeights(parseScouter(SCOUTER_EXAMPLE));
        var wFd = buildWeights(parseScouter(pct));
        var f = { fINT: 84, fLUK: 36, fAtt: 6, fAll: 5 };
        var nowStat = flameCurrentValue(f, wStat), nowFd = flameCurrentValue(f, wFd);
        var scoreStat = flameScore(nowStat, wStat), scoreFd = flameScore(nowFd, wFd);
        // Demon Avenger: HP is the currency, so hpFlat must win the divisor.
        var da = { mainStat: 'STR', flatByStat: { STR: 0.001 }, hpFlat: 0.02 };
        return [wFd.unit, wStat.unit,
                Math.abs(scoreStat - nowStat) < 1e-9,       // stat mode: score === Now
                Math.abs(nowFd - nowStat * 0.01) < 1e-9,    // %fd Now is 100x smaller
                Math.abs(scoreFd - nowStat) < 1e-6,         // ... but the score is not
                flameScoreDivisor(da) === 0.02,
                String(flameScore(1, { mainStat: 'INT', flatByStat: {}, hpFlat: 0 }))].join(',');
      })()
    """).split(",")
    (fs_unit, fs_statunit, fs_ident, fs_shrunk, fs_invariant, fs_da, fs_none) = fs
    rf = ctx.eval("""
      (function () {
        // The score cell sits at index 15 and shifted everything after it by one;
        // refreshFlameRow writes by index, so this is the assertion that keeps them
        // aligned with the header.
        var tr = document.getElementById('flrow-hat');
        var g = cur().slots.hat, before = g.fINT;
        g.fINT = 84; flameRowCacheClear(); refreshFlameRow('hat');
        var r = flameRowData(SLOTS.find(function (m) { return m.key === 'hat'; }), g);
        var cells = tr.children;
        var ok = [
          cells.length,
          cells[14].textContent === stat(r.now),
          cells[15].textContent === stat(flameScore(r.now, weights)),
          cells[cells.length - 1].textContent === (isFinite(r.rollsToBeat) ? r.rollsToBeat.toFixed(1) : 'never'),
        ];
        g.fINT = before; flameRowCacheClear(); refreshFlameRow('hat');
        return ok.join(',');
      })()
    """).split(",")
    (rf_count, rf_now, rf_score, rf_last) = rf
    for label, got, want in [
        ("stat() keeps three figures below 1", ctx.eval("stat(0.0874)"), "0.087"),
        ("  ... two decimals from 1 to 10", ctx.eval("stat(3.3125)"), "3.31"),
        ("  ... one decimal from 10 to 100", ctx.eval("stat(87.64)"), "87.6"),
        ("  ... whole numbers from 100", ctx.eval("stat(130.4)"), "130"),
        ("  ... and a dash for infinity", ctx.eval("stat(Infinity)"), "\u2014"),
        ("the scaled paste is read as %fd", fs_unit, "%fd"),
        ("  ... and the original as stat", fs_statunit, "stat"),
        ("stat mode: flame score equals Now", fs_ident, "true"),
        ("%fd mode: Now is 100x smaller", fs_shrunk, "true"),
        ("  ... but the flame score is unchanged (unit-invariant)", fs_invariant, "true"),
        ("Demon Avenger divides by the HP weight", fs_da, "true"),
        ("no convertible weight gives no number", fs_none, "NaN"),
        ("flame row has 21 cells", rf_count, "21"),
        ("refresh writes Now at index 14", rf_now, "true"),
        ("  ... the score at index 15", rf_score, "true"),
        ("  ... and rolls-to-beat stays last", rf_last, "true"),
        ("flame-reset detail quotes the median",
         ctx.eval("(function(){var s=state.flameReset; state.flameReset=true;"
                  "var r=candidates().find(function(x){return x.axis==='flame';});"
                  "var d=describe(r); state.flameReset=s;"
                  "return String(/median \\d+/.test(d));})()"),
         "true"),
    ]:
        ok = got == want
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}: {got}" + ('' if ok else f"  want {want}"))
        if not ok:
            failed.append(label)

    # 5. Off removes a slot from the meso ranking entirely, but the flame table keeps
    #    the row and sinks it -- you still need to see and toggle it there.
    print("\nper-slot Off and flame On toggles")
    base = ctx.eval("""
      (function () {
        var rank = candidates().filter(function (r) { return r.slot === 'Ring 1'; }).length;
        var fl = flameRows().filter(function (r) { return r.meta.key === 'weapon'; });
        return rank + ',' + fl.length + ',' + (fl[0] && fl[0].off);
      })()
    """)
    off = ctx.eval("""
      (function () {
        cur().slots.ring1.on = false;
        cur().slots.weapon.on = false;
        var rank = candidates().filter(function (r) { return r.slot === 'Ring 1'; }).length;
        var rows = flameRows();
        var wi = rows.findIndex(function (r) { return r.meta.key === 'weapon'; });
        var others = candidates().length;
        cur().slots.ring1.on = true;
        cur().slots.weapon.on = true;
        return [rank, rows.length, rows[wi].off, wi === rows.length - 1,
                others > 0].join(',');
      })()
    """)
    flameoff = ctx.eval("""
      (function () {
        var saveFlag = state.flameReset;
        state.flameReset = true;   // otherwise "drops only its flame row" is vacuous
        cur().slots.hat.flameOn = false;
        var rows = flameRows();
        var hi = rows.findIndex(function (r) { return r.meta.key === 'hat'; });
        var hatRows = candidates().filter(function (r) { return r.slot === 'Hat'; });
        var inRank = hatRows.length;
        var flameRow = hatRows.filter(function (r) { return r.axis === 'flame'; }).length;
        var otherRow = hatRows.filter(function (r) { return r.axis !== 'flame'; }).length;
        cur().slots.hat.flameOn = true;
        state.flameReset = saveFlag;
        return [rows[hi].off, hi === rows.length - 1, inRank > 0,
                flameRow === 0, otherRow > 0].join(',');
      })()
    """)
    b_rank, b_fl, b_flOff = base.split(",")
    o_rank, o_rows, o_off, o_last, o_others = off.split(",")
    f_off, f_last, f_rank, f_noflame, f_others = flameoff.split(",")
    for label, got, want in [
        ("Ring 1 has rows when on", int(b_rank) > 0, True),
        ("Weapon has a flame row when on", int(b_fl) > 0, True),
        ("  ... and is not flagged off", b_flOff, "false"),
        ("Ring 1 drops out of the ranking when Off", int(o_rank), 0),
        ("Weapon keeps its flame row when Off", int(o_rows) > 0, True),
        ("  ... flagged off", o_off, "true"),
        ("  ... and sorted last", o_last, "true"),
        ("flame On off flags the row", f_off, "true"),
        ("  ... sorts it last", f_last, "true"),
        # Flame On used to be purely cosmetic for the ranking, because the ranking had
        # no flame rows. Now it owns one, so the contract is narrower than "leaves the
        # ranking alone": the flame row goes, everything else for that slot stays.
        ("  ... still leaves the slot in the meso ranking", f_rank, "true"),
        ("  ... drops only its flame row", f_noflame, "true"),
        ("  ... keeps its star force / cube rows", f_others, "true"),
        ("other slots still ranked", o_others, "true"),
    ]:
        ok = got == want
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}: {got}" + ('' if ok else f"  want {want}"))
        if not ok:
            failed.append(label)

    # 6. Enter moves down the same column, skipping rows with no control there.
    #    Column 5 is Spares; Emblem and Pocket have no star force so their cell is
    #    a dash, which the traversal must step over instead of stalling.
    print("\nEnter-to-move-down (column 5 = Spares)")
    ctx.eval("renderAll();")
    nav = ctx.eval("""
      (function () {
        var body = document.getElementById('gearBody');
        var rows = body.children;
        function inputAt(r, c) {
          var cell = rows[r].children[c];
          return cell ? cell.querySelector('input, select') : null;
        }
        function press(r, c, shift) {
          var src = inputAt(r, c);
          if (!src) return 'no source control';
          var prevented = false;
          __focused = null;
          __fire(body, 'keydown', {
            key: 'Enter', shiftKey: !!shift, target: src,
            preventDefault: function () { prevented = true; },
          });
          if (!__focused) return 'nothing focused (prevented=' + prevented + ')';
          for (var i = 0; i < rows.length; i++) {
            if (inputAt(i, c) === __focused) return String(i);
          }
          return 'focused something unexpected';
        }
        return [
          press(0, 5),       // Weapon -> Secondary
          press(1, 5),       // Secondary -> must skip Emblem (2), land on Hat (3)
          press(3, 5, true), // Hat, shift -> back up past Emblem to Secondary (1)
          press(21, 5),      // Pocket has no spares control at all
          press(0, 2),       // Lv column is a select on every row: Weapon -> Secondary
        ].join(' | ');
      })()
    """)
    got = nav.split(" | ")
    for label, actual, want in [
        ("Weapon -> Secondary", got[0], "1"),
        ("Secondary -> Hat, skipping Emblem", got[1], "3"),
        ("Shift+Enter walks back up", got[2], "1"),
        ("Pocket has no Spares control", got[3], "no source control"),
        ("works on selects too (Lv column)", got[4], "1"),
    ]:
        ok = actual == want
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}: {actual}" + ('' if ok else f"  want {want}"))
        if not ok:
            failed.append(label)

    print()
    if failed:
        print(f"{len(failed)} problem(s)")
        return 1
    print("all clear")
    return 0


if __name__ == "__main__":
    sys.exit(main())
