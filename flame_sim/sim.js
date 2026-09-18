/* ===========================================================================
 * Flame reset simulator -- the game's "Select which Bonus stats to use" dialog,
 * driven by the same tables the gear-progression ranking uses.
 *
 * Built from a recording of the real thing (data/video/2026-09-10 10-28-21.mkv):
 *   - BEFORE and AFTER columns, each with its lines, the tier total beside the
 *     flame icon, a Total Value box, and a change figure that is green with an
 *     up-arrow when AFTER is better and plain grey when it is not.
 *   - Reset x1 -> a confirm popup -> the AFTER column refreshes and 3m leaves.
 *   - "Pressing Reset will automatically use the BEFORE stats" -- every reset
 *     discards the AFTER; you choose the AFTER column to keep it.
 *   - The player drives it from the keyboard: Space presses Reset, and holding
 *     Enter confirms the popup and presses Reset again, so the two alternate.
 *
 * What replaces Combat Power Change: the flame score in main-stat points, from
 * the MapleScouter weights, because Combat Power needs the game's formula and
 * the whole character. The tier total is still shown, because it is the number
 * people compare in-game -- and the recording caught it dropping 23 -> 22 on a
 * roll that was +60,107 combat power better, which is exactly the lesson.
 *
 * Everything this file computes with comes from ../gear_progression/js:
 * flameSample and friends for rolling, flameCurrentValue / flameScore for
 * worth, flameDistributionCached + flameReroll for the odds shown under BEFORE.
 * It is wrapped so its helpers can't collide with app.js when both are loaded
 * into one test context, and exposes SIM for that test.
 * ======================================================================== */
(function () {
  'use strict';

  const LS_KEY = 'maple_flame_sim';
  const PRICE = FLAME_RESET_MESO;
  const LEVELS = [120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250];
  const HISTORY = 40;

  // Persisted: how the item and weights are set up, and the BEFORE flame. Not
  // persisted: the run counters, which describe a session rather than an item.
  const S = {
    kind: 'armor', level: 160, adv: true, flameType: FLAME_RESET_TYPE, baseAtt: 150,
    scouter: SCOUTER_EXAMPLE, seed: '', skipConfirm: false, stopOnBetter: true,
    beforePicks: [],
    // runtime
    before: null, after: null,
    resets: 0, spent: 0, best: null, history: [], run: '',
    confirmOpen: false,
    decideOpen: false,   // the end-of-auto-run "use this?" dialog
  };
  const PERSIST = ['kind', 'level', 'adv', 'flameType', 'baseAtt', 'scouter', 'seed',
                   'skipConfirm', 'stopOnBetter', 'beforePicks'];

  let weights = null;
  let rng = Math.random;

  /* ------------------------------------------------------------ helpers */

  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) n.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    for (const kid of [].concat(kids || [])) if (kid != null) n.append(kid);
    return n;
  }

  // ~3 significant figures, same rule as the gear tool
  function fmt(n) {
    if (!isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 100) return Math.round(n).toLocaleString();
    if (a >= 10) return n.toFixed(1);
    if (a >= 1) return n.toFixed(2);
    return n.toFixed(3);
  }
  const signed = (n) => (n > 0 ? '+' : '') + fmt(n);
  function meso(n) {
    if (!isFinite(n)) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'b';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'm';
    if (n >= 1e3) return Math.round(n / 1e3) + 'k';
    return Math.round(n).toLocaleString();
  }
  /** pXX of a geometric count. p >= 1 means the first reset always does it. */
  function geoPct(p, pct) {
    if (!(p > 0)) return Infinity;
    if (p >= 1) return 1;
    return Math.ceil(Math.log(1 - pct / 100) / Math.log(1 - p));
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (raw && typeof raw === 'object') for (const k of PERSIST) if (k in raw) S[k] = raw[k];
    } catch (_) { /* private mode, or no storage in a test */ }
    S.flameType = flameTypeOrDefault(S.flameType);
    if (!LEVELS.includes(Number(S.level))) S.level = 160;
    S.level = Number(S.level);
    if (!Array.isArray(S.beforePicks)) S.beforePicks = [];
  }
  function save() {
    try {
      const out = {};
      for (const k of PERSIST) out[k] = S[k];
      localStorage.setItem(LS_KEY, JSON.stringify(out));
    } catch (_) { /* ignore */ }
  }

  /* -------------------------------------------------------------- model */

  function opts() {
    return {
      flameType: S.flameType,
      nonAdvantaged: !S.adv,
      baseAtt: S.kind === 'weapon' ? Number(S.baseAtt) || 0 : 0,
    };
  }
  function refreshWeights() {
    weights = buildWeights(parseScouter(S.scouter));
    // The seed is re-applied whenever settings change so a run is reproducible
    // from the moment you set it; blank means the browser's own randomness.
    rng = String(S.seed).trim() === '' ? Math.random : flameRng(S.seed);
  }
  const valueOf = (sample) => flameSampleValue(sample, weights);
  const scoreOf = (sample) => flameScore(valueOf(sample), weights);
  function odds() {
    if (!weights || weights.empty) return null;
    return flameReroll(flameDistributionCached(S.kind, S.level, weights, opts()), valueOf(S.before));
  }
  function composeBefore() {
    S.before = S.beforePicks.length ? flameCompose(S.kind, S.level, opts(), S.beforePicks) : null;
    // A pick the new kind can't roll is dropped by flameCompose; mirror that in
    // the stored picks so the editor shows what is actually in force.
    if (S.before) S.beforePicks = S.before.lines.map(l => ({ key: l.key, tier: l.tier }));
  }

  function roll() {
    S.after = flameSample(S.kind, S.level, opts(), rng);
    S.resets += 1;
    S.spent += PRICE;
    if (!S.best || valueOf(S.after) > valueOf(S.best)) S.best = S.after;
    S.history.push(valueOf(S.after));
    if (S.history.length > HISTORY) S.history.shift();
  }

  function reset() {
    if (!weights || weights.empty) return;
    if (S.skipConfirm) { roll(); render(true); return; }
    S.confirmOpen = true;
    renderConfirm();
  }
  function confirm() {
    if (!S.confirmOpen) return;
    S.confirmOpen = false;
    renderConfirm();
    roll();
    render(true);
  }
  function cancel() {
    if (!S.confirmOpen) return;
    S.confirmOpen = false;
    renderConfirm();
  }
  // The decision an auto run ends on. Keeping BEFORE leaves the roll up as AFTER,
  // so the Use AFTER button still works afterwards -- nothing is thrown away.
  function decideUse() {
    if (!S.decideOpen) return;
    S.decideOpen = false;
    useAfter();
  }
  function decideKeep() {
    if (!S.decideOpen) return;
    S.decideOpen = false;
    renderDecide();
  }
  function useAfter() {
    if (!S.after) return;
    S.beforePicks = S.after.lines.map(l => ({ key: l.key, tier: l.tier }));
    composeBefore();
    S.after = null;
    S.run = '';
    save();
    render();
  }

  /**
   * Auto-roll. Every policy is one a player can actually follow in-game, where
   * you only ever see the latest AFTER and can only keep that one:
   *   first-better  reset until a roll beats BEFORE, leave it up as AFTER
   *   greedy        whenever AFTER beats BEFORE, use it, keep going
   *   watch         reset n times without keeping anything
   */
  function auto(n, policy) {
    if (!weights || weights.empty) return;
    S.decideOpen = false;   // a new run supersedes an unanswered dialog; the AFTER it asked about is replaced
    const o = odds();
    const startBefore = valueOf(S.before);
    let taken = 0, found = 0;
    for (let i = 0; i < n; i++) {
      roll();
      const v = valueOf(S.after);
      if (policy === 'first-better' && v > startBefore) { found = i + 1; break; }
      if (policy === 'greedy' && v > valueOf(S.before)) {
        S.beforePicks = S.after.lines.map(l => ({ key: l.key, tier: l.tier }));
        composeBefore();
        taken += 1;
      }
    }
    const exp = o && o.pImprove > 0
      ? ` · expected ${(1 / o.pImprove).toFixed(1)}, median ${geoPct(o.pImprove, 50)}`
      : '';
    if (policy === 'first-better') {
      S.run = found
        ? `beat it after ${found} reset${found === 1 ? '' : 's'} (${meso(found * PRICE)})${exp}`
        : `${n} resets (${meso(n * PRICE)}) and nothing better${exp}`;
    } else if (policy === 'greedy') {
      S.run = `${n} resets (${meso(n * PRICE)}), took ${taken} improvement${taken === 1 ? '' : 's'}: `
        + `flame score ${fmt(flameScore(startBefore, weights))} → ${fmt(scoreOf(S.before))}`;
    } else {
      const better = S.history.slice(-Math.min(n, HISTORY)).filter(v => v > startBefore).length;
      S.run = `${n} resets (${meso(n * PRICE)}) watched` +
        (n <= HISTORY ? `, ${better} would have beaten BEFORE` : '') + exp;
    }
    save();
    render(true);
    // The run is over. If what it left up beats BEFORE, ask now -- this is the
    // moment the game itself puts in front of you -- rather than leave the roll
    // to be noticed among the counters.
    if (afterIsBetter()) { S.decideOpen = true; renderDecide(); }
  }

  function clearCounters() {
    S.resets = 0; S.spent = 0; S.best = null; S.history = []; S.run = '';
    render();
  }

  /* ------------------------------------------------------------ keyboard */

  const afterIsBetter = () => !!S.after && valueOf(S.after) > valueOf(S.before);

  // Keys currently held, so a hold is recognised even where the browser does not
  // set e.repeat (some Android keyboards). keyup clears; a keydown for a key that
  // is already down is a hold.
  const down = new Set();

  // Space presses Reset; Enter confirms the popup, and with no popup open it is
  // the dialog's default button, i.e. Reset again -- so a held Enter alternates
  // the two exactly as it does in the game. Ignored while typing in a field.
  //
  // One deliberate departure from the game: in-game, the Reset that follows a
  // good roll under a held Enter throws that roll away. Here a HELD key stops the
  // moment AFTER beats BEFORE, leaving the roll up for a decision. A fresh press
  // still resets (and discards), and U keeps the roll. stopOnBetter turns the
  // guard off for anyone who wants the raw game behaviour.
  function onKey(e) {
    const tag = ((e.target && e.target.tagName) || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = e.key === ' ' || e.code === 'Space' ? ' ' : e.key;
    const held = !!e.repeat || down.has(key);
    down.add(key);
    const guarded = held && S.stopOnBetter && afterIsBetter();

    // The end-of-run dialog owns the keyboard while it is up. Only a FRESH Enter
    // accepts: the hand that was holding Enter to roll must not accept by inertia.
    if (S.decideOpen) {
      if ((key === ' ' || key === 'Enter') && e.preventDefault) e.preventDefault();
      if ((key === 'Enter' && !held) || key === 'u' || key === 'U') decideUse();
      else if (key === 'Escape') decideKeep();
      return;
    }

    if (key === ' ') {
      if (e.preventDefault) e.preventDefault();
      if (S.confirmOpen || guarded) return;
      reset();
    } else if (key === 'Enter') {
      if (e.preventDefault) e.preventDefault();
      if (S.confirmOpen) { confirm(); return; }
      if (guarded) return;
      reset();
    } else if (key === 'Escape') {
      cancel();
    } else if (key === 'u' || key === 'U') {
      if (!S.confirmOpen) useAfter();
    }
  }
  function onKeyUp(e) {
    down.delete(e.key === ' ' || e.code === 'Space' ? ' ' : e.key);
  }

  /* ------------------------------------------------------------- render */

  function amountText(line) {
    // weapon attack is a fraction of base attack; the game shows it whole
    const a = line.key === 'ATT' || line.key === 'MATT' ? Math.round(line.amount) : line.amount;
    return (a > 0 ? '+' : '') + a + line.suffix;
  }

  function renderLines(target, sample, emptyText) {
    if (!sample || !sample.lines.length) {
      target.replaceChildren(el('div', { class: 'line dim', text: emptyText }));
      return;
    }
    target.replaceChildren(...sample.lines.map(l => el('div', { class: 'line' }, [
      el('span', { class: 'dot', title: `tier ${l.tier}` }),
      el('span', { text: l.label }),
      el('span', { class: 'amt', text: amountText(l) }),
    ])));
  }

  function renderTotals(target, sample) {
    const t = flameSampleTotals(sample);
    const kids = [];
    for (const k of FLAME_TOTAL_ORDER) {
      if (!t[k]) continue;
      const def = FLAME_LINE_BY_KEY[k];
      const label = def ? def.label : k;
      const a = (k === 'ATT' || k === 'MATT') ? Math.round(t[k]) : t[k];
      kids.push(el('span', { text: label }),
                el('span', { text: (a > 0 ? '+' : '') + a + ((def && def.suffix) || '') }));
    }
    if (!kids.length) kids.push(el('span', { class: 'line dim', text: '—' }), el('span'));
    target.replaceChildren(...kids);
  }

  function unitSub(value) {
    if (!weights || weights.unit !== '%fd') return '';
    return `= ${fmt(value)} %fd`;
  }

  function renderDialog(flash) {
    $('itemLabel').replaceChildren(
      el('b', { text: `Lv.${S.level} ${S.kind === 'weapon' ? 'weapon' : 'armour / accessory'}` }),
      document.createTextNode(` · ${S.adv ? 'advantaged' : 'non-advantaged'} · ` +
        `${FLAME_TYPE_LABELS[S.flameType] || S.flameType} rates` +
        (S.kind === 'weapon' ? ` · base attack ${Number(S.baseAtt) || 0}` : '')),
    );

    // BEFORE
    $('beforeBadge').textContent = S.before ? String(S.before.tierTotal) : '—';
    renderLines($('beforeLines'), S.before, 'no flame');
    renderTotals($('beforeTotals'), S.before);
    const bv = valueOf(S.before);
    $('beforeScoreVal').textContent = S.before ? fmt(flameScore(bv, weights)) : '0';
    const o = odds();
    $('beforeSub').textContent = o
      ? `${unitSub(bv)}${unitSub(bv) ? ' · ' : ''}a reset beats this ${(o.pImprove * 100).toFixed(2)}% of the time`
      : (weights && weights.empty ? 'paste MapleScouter weights first' : '');

    // AFTER
    const col = $('afterCol');
    $('afterBadge').textContent = S.after ? String(S.after.tierTotal) : '—';
    renderLines($('afterLines'), S.after, 'press Reset');
    renderTotals($('afterTotals'), S.after);
    const score = $('afterScore');
    score.classList.remove('up', 'down');
    if (S.after) {
      const av = valueOf(S.after);
      const d = flameScore(av, weights) - flameScore(bv, weights);
      const better = av > bv, same = Math.abs(av - bv) < 1e-9;
      score.classList.toggle('up', better);
      score.classList.toggle('down', !better && !same);
      $('afterLbl').replaceChildren(
        better ? el('span', { class: 'arrow' }) : null,
        document.createTextNode('Flame score change'));
      $('afterScoreVal').textContent = same ? '0' : signed(d);
      $('afterSub').textContent =
        `flame score ${fmt(flameScore(av, weights))}` + (unitSub(av) ? ` ${unitSub(av)}` : '');
    } else {
      $('afterLbl').textContent = 'Flame score change';
      $('afterScoreVal').textContent = '—';
      $('afterSub').textContent = '';
    }
    if (flash && col && col.classList) {
      col.classList.remove('flash');
      // restart the CSS animation; offsetWidth is undefined outside a browser
      void col.offsetWidth;
      col.classList.add('flash');
    }

    $('btnUse').disabled = !S.after;
    // The stopped-on-a-better-roll moment needs saying, or a held key that
    // suddenly does nothing reads as a bug.
    $('holdHint').textContent = afterIsBetter()
      ? (S.stopOnBetter
          ? 'better roll — a held key stops here. U keeps it · Enter / Space resets again and discards it'
          : 'better roll — U keeps it')
      : '';
    const ready = !!(weights && !weights.empty);
    $('btnReset').disabled = !ready;
    for (const id of ['btnAuto10', 'btnAuto100', 'btnAuto1000']) $(id).disabled = !ready;
  }

  function renderStats() {
    $('statResets').textContent = S.resets.toLocaleString();
    $('statSpent').textContent = meso(S.spent);
    const o = odds();
    if (o && o.pImprove > 0 && isFinite(o.rollsToBeat)) {
      $('statP').textContent = `${(o.pImprove * 100).toFixed(2)}%`;
      $('statExpected').textContent =
        `${o.rollsToBeat.toFixed(1)} / ${geoPct(o.pImprove, 50)} / ${geoPct(o.pImprove, 85)}`;
    } else if (o) {
      $('statP').textContent = '0%';
      $('statExpected').textContent = 'already the best roll possible';
    } else {
      $('statP').textContent = '—';
      $('statExpected').textContent = '—';
    }
    $('statBest').textContent = S.best ? `${fmt(scoreOf(S.best))} (\u{1F525} ${S.best.tierTotal})` : '—';
    $('statRun').textContent = S.run;

    const bv = valueOf(S.before);
    $('history').replaceChildren(...S.history.map(v => el('span', {
      class: v > bv ? 'up' : (Math.abs(v - bv) < 1e-9 ? 'eq' : ''),
      text: fmt(flameScore(v, weights)),
      title: v > bv ? 'would beat BEFORE' : 'not better than BEFORE',
    })));
  }

  function renderDecide() {
    const m = $('decide');
    m.hidden = !S.decideOpen;
    if (!S.decideOpen || !S.after) return;
    const bs = flameScore(valueOf(S.before), weights);
    const as = flameScore(valueOf(S.after), weights);
    const how = S.run ? S.run.split(' \u00b7 ')[0] : 'this roll';
    $('decideText').textContent =
      `${how} \u2014 flame score ${fmt(bs)} \u2192 ${fmt(as)} (${signed(as - bs)}), ` +
      `\u{1F525} ${S.before ? S.before.tierTotal : '\u2014'} \u2192 \u{1F525} ${S.after.tierTotal}`;
    $('decideLines').replaceChildren(...S.after.lines.map(l => el('div', { class: 'line' }, [
      el('span', { class: 'dot', title: `tier ${l.tier}` }),
      el('span', { text: l.label }),
      el('span', { class: 'amt', text: amountText(l) }),
    ])));
  }

  function renderConfirm() {
    const m = $('confirm');
    m.hidden = !S.confirmOpen;
    $('confirmItem').textContent =
      `Relevant Item: Lv.${S.level} ${S.kind === 'weapon' ? 'weapon' : 'armour / accessory'}`;
    $('confirmSkip').checked = !!S.skipConfirm;
  }

  /** The BEFORE editor: up to four (line, tier) rows, written from state. */
  function renderEditor() {
    const box = $('beforeEditor');
    const pool = flamePool(S.kind);
    const rows = [];
    const slots = S.adv ? 4 : 4;   // the editor always offers four; blanks are simply absent
    for (let i = 0; i < slots; i++) {
      const pick = S.beforePicks[i] || { key: '', tier: 5 };
      const lineSel = el('select', { onchange: () => {
        setPick(i, { key: lineSel.value, tier: Number(tierSel.value) });
      } });
      lineSel.append(el('option', { value: '', text: '— none —' }));
      for (const def of pool) {
        const o = el('option', { value: def.key, text: def.label });
        if (def.key === pick.key) o.selected = true;
        lineSel.append(o);
      }
      lineSel.value = pick.key;
      const tierSel = el('select', { onchange: () => {
        setPick(i, { key: lineSel.value, tier: Number(tierSel.value) });
      } });
      for (let t = 1; t <= 7; t++) {
        const o = el('option', { value: String(t), text: `tier ${t}` });
        if (t === Number(pick.tier)) o.selected = true;
        tierSel.append(o);
      }
      tierSel.value = String(pick.tier || 5);
      rows.push(el('span', { class: 'n', text: `line ${i + 1}` }), lineSel, tierSel);
    }
    box.replaceChildren(...rows);
  }

  function setPick(i, pick) {
    const picks = [];
    for (let k = 0; k < 4; k++) picks[k] = k === i ? pick : (S.beforePicks[k] || { key: '', tier: 5 });
    // keep positions so the editor rows don't shuffle under the cursor, but drop
    // blanks from what is actually in force
    S.beforePicks = picks.filter(p => p && p.key);
    // re-pad by position for the editor's benefit
    S._editorPicks = picks;
    composeBefore();
    S.after = null;
    S.run = '';
    save();
    render();
  }

  function renderSetup() {
    $('simKind').value = S.kind;
    const lv = $('simLevel');
    if (!lv.children.length) {
      for (const L of LEVELS) lv.append(el('option', { value: String(L), text: `Lv.${L}` }));
    }
    lv.value = String(S.level);
    const ty = $('simType');
    if (!ty.children.length) {
      for (const [k, label] of FLAME_TYPES) ty.append(el('option', { value: k, text: label }));
    }
    ty.value = S.flameType;
    $('simAdv').checked = !!S.adv;
    $('simBaseAtt').value = S.baseAtt;
    $('simBaseAttRow').hidden = S.kind !== 'weapon';
    $('simSeed').value = S.seed;
    $('simSkipConfirm').checked = !!S.skipConfirm;
    $('simStopBetter').checked = !!S.stopOnBetter;
    if ($('simScouter').value !== S.scouter) $('simScouter').value = S.scouter;
    $('simProfile').textContent = weights && !weights.empty
      ? `— read as ${weights.mainStat} main, ${weights.unit === '%fd' ? '% final damage' : 'main-stat points'}`
      : '— nothing usable in the paste';
  }

  function render(flash) {
    renderSetup();
    renderEditor();
    renderDialog(flash);
    renderStats();
    renderConfirm();
    renderDecide();
  }

  /* -------------------------------------------------------------- wiring */

  function settingsChanged() {
    refreshWeights();
    composeBefore();
    S.after = null;
    S.run = '';
    save();
    render();
  }

  function wire() {
    $('simKind').addEventListener('change', (e) => {
      S.kind = e.target.value === 'weapon' ? 'weapon' : 'armor';
      if (S.kind === 'weapon' && !(Number(S.baseAtt) > 0)) S.baseAtt = 150;
      settingsChanged();
    });
    $('simLevel').addEventListener('change', (e) => { S.level = Number(e.target.value); settingsChanged(); });
    $('simType').addEventListener('change', (e) => { S.flameType = flameTypeOrDefault(e.target.value); settingsChanged(); });
    $('simAdv').addEventListener('change', (e) => { S.adv = !!e.target.checked; settingsChanged(); });
    $('simBaseAtt').addEventListener('input', (e) => { S.baseAtt = Number(e.target.value) || 0; settingsChanged(); });
    $('simSeed').addEventListener('input', (e) => { S.seed = e.target.value; settingsChanged(); });
    $('simScouter').addEventListener('input', (e) => { S.scouter = e.target.value; settingsChanged(); });
    $('simSkipConfirm').addEventListener('change', (e) => { S.skipConfirm = !!e.target.checked; save(); renderConfirm(); });
    $('simStopBetter').addEventListener('change', (e) => { S.stopOnBetter = !!e.target.checked; save(); render(); });
    $('confirmSkip').addEventListener('change', (e) => { S.skipConfirm = !!e.target.checked; save(); renderSetup(); });

    $('beforeRandom').addEventListener('click', () => {
      const s = flameSample(S.kind, S.level, opts(), rng);
      S.beforePicks = s.lines.map(l => ({ key: l.key, tier: l.tier }));
      S._editorPicks = null;
      composeBefore(); S.after = null; S.run = ''; save(); render();
    });
    $('beforeNone').addEventListener('click', () => {
      S.beforePicks = []; S._editorPicks = null;
      composeBefore(); S.after = null; S.run = ''; save(); render();
    });

    $('btnReset').addEventListener('click', reset);
    $('btnConfirm').addEventListener('click', confirm);
    $('btnCancel').addEventListener('click', cancel);
    $('btnUse').addEventListener('click', useAfter);
    $('btnClear').addEventListener('click', clearCounters);
    $('btnAuto10').addEventListener('click', () => auto(10, $('autoPolicy').value));
    $('btnAuto100').addEventListener('click', () => auto(100, $('autoPolicy').value));
    $('btnAuto1000').addEventListener('click', () => auto(1000, $('autoPolicy').value));
    $('btnDecideUse').addEventListener('click', decideUse);
    $('btnDecideKeep').addEventListener('click', decideKeep);
    // Deliberately NO backdrop-click handler on either popup. A click that lands
    // outside the box is almost always the mouse still spamming the button that
    // opened it -- Reset, or x1000 -- and closing on it meant Reset never rolled
    // and the end-of-run decision vanished under the hand that asked for it. Only
    // the buttons and the keys act, as with the game's own modals.

    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);
  }

  function init() {
    load();
    refreshWeights();
    composeBefore();
    wire();
    render();
  }

  init();

  // For the test harness, which drives the page without a browser.
  globalThis.SIM = {
    state: S, reset, confirm, cancel, useAfter, auto, onKey, onKeyUp, clearCounters, render,
    afterIsBetter, decideUse, decideKeep,
    valueOf, scoreOf, odds, get weights() { return weights; },
    setBeforePicks(picks) { S.beforePicks = picks.slice(); composeBefore(); S.after = null; render(); },
    setSeed(seed) { S.seed = seed; refreshWeights(); },
    setScouter(text) { S.scouter = text; settingsChanged(); },
  };
})();
