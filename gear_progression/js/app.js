/* ===========================================================================
 * State, candidate generation and rendering.
 *
 * Depends on (loaded before this, as plain scripts so file:// works):
 *   sf-stats.js  generated per-star stat gain tables
 *   sf.js        vendored lostara cost engine + valuation
 *   cubing.js    port of cubing.py + target scanner
 *   value.js     MapleScouter paste parser
 * ======================================================================== */

const LS_KEY = 'maple_gear_progression';

// key, label, star-forceable, cube pool category, stat-table kind
const SLOTS = [
  // WSE first -- weapon, secondary, emblem. They are handled as a group in game and
  // are the slots most worth looking at, so they head every table.
  ['weapon',    'Weapon',    true,  'weapon',             'weapon'],
  ['secondary', 'Secondary', true,  'secondary',          'secondary'],
  ['emblem',    'Emblem',    false, 'emblem',             null],
  ['hat',       'Hat',       true,  'hat',                'armor'],
  ['top',       'Top',       true,  'top',                'armor'],
  ['bottom',    'Bottom',    true,  'bottom',             'armor'],
  ['shoes',     'Shoes',     true,  'shoes',              'armor'],
  ['gloves',    'Gloves',    true,  'gloves',             'gloves'],
  ['cape',      'Cape',      true,  'cape_belt_shoulder', 'armor'],
  ['shoulder',  'Shoulder',  true,  'cape_belt_shoulder', 'armor'],
  ['belt',      'Belt',      true,  'cape_belt_shoulder', 'armor'],
  ['face',      'Face Acc',  true,  'acc',                'armor'],
  ['eye',       'Eye Acc',   true,  'acc',                'armor'],
  ['ear',       'Earrings',  true,  'acc',                'armor'],
  ['pend1',     'Pendant 1', true,  'acc',                'armor'],
  ['pend2',     'Pendant 2', true,  'acc',                'armor'],
  ['ring1',     'Ring 1',    true,  'acc',                'armor'],
  ['ring2',     'Ring 2',    true,  'acc',                'armor'],
  ['ring3',     'Ring 3',    true,  'acc',                'armor'],
  ['ring4',     'Ring 4',    true,  'acc',                'armor'],
  ['heart',     'Heart',     true,  'heart',              'armor'],
  // Pocket items take no potential at all, so they have no cube pool either.
  ['pocket',    'Pocket',    false, null,                 null],
  // Medals take neither star force nor potential -- flames only.
  ['medal',     'Medal',     false, null,                 null],
].map(([key, label, sf, cube, kind]) => ({ key, label, sf, cube, kind }));

// Slots that offer a swap, and what they swap with. Only the pendants: they are the one
// pair that is genuinely interchangeable, so a swap is meaningful rather than destructive.
const PENDANT_SWAP = { pend1: 'pend2' };

// Only hats roll cooldown lines, so only hats get the constraint control.
const CD_CHOICES = [[0, '—'], [-1, '-1s'], [-2, '-2s'], [-3, '-3s'], [-4, '-4s']];

// Why each strategy exists, in the terms players use for them.
const SF_PRESET_NOTES = {
  '111/11/11': 'Cheapest expected meso, most booms. Right when spares are free, since '
    + 'nothing is lost but the stars.',
  '444/11/44': 'What most people run: safeguard 15★→18★ and 20★→22★, ride the middle. '
    + 'Those are the steps where a boom costs the most to climb back.',
  '444/44/44': 'Cannot boom below 22★ at all, and priced accordingly — up to ×6.5 an '
    + 'attempt on the upper stars.',
};

// lv130 is rare but real -- some accessories and secondaries sit there. It lands in
// the wiki's 128-137 bracket, whose tables stop at 20★, so sfCap already returns 20
// for it and the milestones above that filter themselves out. Nothing else needed.
const LEVELS = [130, 140, 150, 160, 200, 250];
const DEFAULT_MILESTONES = [15, 17, 18, 21, 22, 30];

function newSlot(meta) {
  return {
    // Slot active at all. Untick for gear that simply has none of these systems --
    // an Oz ring takes no potential, so scoring one is meaningless. Ticked = active,
    // matching the flame table's On, rather than the inverted Off it replaced.
    on: true,
    level: 150,
    star: 17,
    // Secondaries still default to SF off -- most cannot be star forced at all, and
    // the ones that can are the lv130 shields. The table is known now (armor), so this
    // is a sensible default rather than a missing-data guard: tick it when it applies.
    sfOn: meta.sf && meta.key !== 'secondary',
    spares: 5,
    baseAtt: 0,
    cdWanted: 0,   // hats only: seconds of cooldown reduction to insist on
    // Per-slot star force strategy as "444/11/44". Blank means "use the global one",
    // which is the common case; nobody safeguards a ring the way they safeguard a hat.
    sfPlan: '',
    lines: [['Zero', 0], ['Zero', 0], ['Zero', 0]],
    flameType: 'eternal',
    // flames for this slot specifically, separate from the global Off. Lets a slot
    // stay in the meso ranking while dropping out of the flame ranking.
    flameOn: true,
    flameAdv: true,
    // the flame the item already has, as shown in the equip window
    fSTR: 0, fDEX: 0, fINT: 0, fLUK: 0, fAtt: 0, fHp: 0,
    fAll: 0, fDmg: 0, fBoss: 0,
  };
}

function newChar(name) {
  const slots = {};
  for (const m of SLOTS) slots[m.key] = newSlot(m);
  // amounts: MapleScouter's editable middle column, per weight key. 1 means "the
  // paste is already per-point", which is the safe default -- it makes the division
  // in buildWeights a no-op, so an older save keeps ranking exactly as it did.
  // weaponKind: which endgame weapon, per WEAPON_KINDS in sf.js. Per character rather
  // than global, since the weapon belongs to the character.
  return { name, scouter: '', iedVariant: 300, mainStat: '', amounts: {},
           weaponKind: 'none', secondaryKind: 'none', slots };
}

let state = load();
let view = { bestPerSlot: true, allSteps: false, sort: 'per',
             pct: 0, page: 0,
             // flameSort is what is shown now; flameRankSort remembers the last
             // ranking column so `recalculate` can return to it from slot order.
             // load in slot order -- it matches the gear table and is what you read first;
             // `recalculate` moves to flameRankSort when you want them ranked.
             // Flames are a separate decision on a separate denominator, so they get
             // their own percentile rather than borrowing the ranking's.
             flamePct: 0,
             flameSort: 'slot', flameRankSort: 'pImprove' };

function load() {
  let raw = null;
  try { raw = localStorage.getItem(LS_KEY); } catch (_) { /* private mode */ }
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (s && s.chars) return migrate(s);
    } catch (_) { /* corrupt; fall through to a fresh state */ }
  }
  return migrate({ chars: { c1: newChar('Character 1') }, active: 'c1' });
}

// fill in whatever a partial or older save is missing, so nothing reads undefined
function migrate(s) {
  s.sf = Object.assign({}, SF_DEFAULTS, s.sf || {});
  s.milestones = Array.isArray(s.milestones) && s.milestones.length
    ? s.milestones : DEFAULT_MILESTONES.slice();
  // Persisted so the choice survives a refresh. It has to be state rather than a
  // module default: browsers restore <select> values across a reload, so a default
  // held only in JS drifts from the control the moment you change it and come back.
  if (![0, 10, 20, 50].includes(s.pageSize)) s.pageSize = 10;
  s.cubeSale = !!s.cubeSale;   // 25% off the cube itself, when a sale is running
  // Whether bonus stats can be reset for mesos on your server. Announced in a patch
  // note but not necessarily live, so it defaults OFF: with it off the tool ranks
  // exactly what it ranked before flames had a price, and no flame row can mislead
  // a plan. One flag for both tables -- the ranking and the compare tab each expose
  // a button for it, but it is the same switch.
  s.flameReset = !!s.flameReset;
  // Which characters the compare panel is showing. Persisted, since it is a deliberate
  // selection rather than a transient view -- "ignore this mule for now" should stick.
  if (!s.compare || typeof s.compare !== 'object') s.compare = {};
  if (![0, 25, 50].includes(s.comparePageSize)) s.comparePageSize = 25;
  // Which tab is showing. Persisted so a reload puts you back where you were.
  if (!['main', 'compare'].includes(s.tab)) s.tab = 'main';
  // Mode policy for 15->16 .. 21->22. Repaired rather than replaced, so a save from
  // before the panel existed lands on all-mode-1 instead of undefined.
  s.sf.modes = Array.from({ length: STAR_ENHANCE_COUNT }, (_, i) => {
    const m = (s.sf.modes || [])[i];
    return (Number.isInteger(m) && m >= 0 && m < STAR_ENHANCE_MODES) ? m : 0;
  });

  for (const id of Object.keys(s.chars)) {
    const c = s.chars[id] = Object.assign(newChar('?'), s.chars[id]);
    if (!c.amounts || typeof c.amounts !== 'object') c.amounts = {};
    if (!WEAPON_KINDS[c.weaponKind]) c.weaponKind = 'none';
    if (!SECONDARY_KINDS[c.secondaryKind]) c.secondaryKind = 'none';
    // fMain/fSub predate the per-stat flame columns. Fold them into the stats the
    // character's own paste points at (a mage: fMain -> fINT, fSub -> fLUK).
    const legacyFlame = Object.values(c.slots || {})
      .some(g => g && ('fMain' in g || 'fSub' in g));
    const mw = legacyFlame ? buildWeights(parseScouter(c.scouter || '')) : null;
    for (const m of SLOTS) {
      const g = c.slots[m.key] = Object.assign(newSlot(m), c.slots[m.key] || {});
      if (!Array.isArray(g.lines) || g.lines.length !== 3) {
        g.lines = [['Zero', 0], ['Zero', 0], ['Zero', 0]];
      }
      g.flameType = flameTypeOrDefault(g.flameType);
      // `ignore` was the inverted form of `on`; carry old saves across
      if (Object.prototype.hasOwnProperty.call(g, 'ignore')) {
        g.on = !g.ignore;
        delete g.ignore;
      }
      if (mw && ('fMain' in g || 'fSub' in g)) {
        const main = mw.mainStat || 'STR';
        let sub = null, best = -1;
        for (const s2 of STAT_NAMES) {
          if (s2 === main) continue;
          const f2 = (mw.statByStat && mw.statByStat[s2]) || 0;
          if (f2 > best) { best = f2; sub = s2; }
        }
        g['f' + main] = (g['f' + main] || 0) + Number(g.fMain || 0);
        g['f' + sub] = (g['f' + sub] || 0) + Number(g.fSub || 0);
        delete g.fMain; delete g.fSub;
      }
    }
  }
  if (!s.chars[s.active]) s.active = Object.keys(s.chars)[0];
  return s;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch (e) { console.warn('could not save', e); }   // quota / private browsing
  }, 250);
}

const cur = () => state.chars[state.active];

let weights = null;
function refreshWeights() {
  const c = cur();
  const parsed = parseScouter(c.scouter);
  weights = buildWeights(parsed, {
    iedVariant: c.iedVariant, mainStat: c.mainStat, amounts: c.amounts });
  weights._parsed = parsed;
  // Every cached scan and flame row was valued against the OLD weights, so they are
  // all stale now. Weights are the one input those keys do not cover: they change
  // rarely and invalidate everything, so a version stamp would be machinery for no gain.
  cubeScanCacheClear();
  flameRowCacheClear();
  flameCacheClear();
}

/* ============================================================ candidates */

function slotMeta(key) { return SLOTS.find(m => m.key === key); }

/**
 * Which stat table a slot reads. Now a pure function of the slot.
 *
 * There used to be a per-row override, because nothing said whether a secondary used
 * the weapon or the armor table. Measurement settled it -- secondaries are armor -- so
 * the column went: a control whose only correct setting is the default is just a way to
 * get the wrong answer.
 */
/**
 * The per-slot Plan field.
 *
 * Not bound() because bound() re-ranks on every keystroke, and typing "444/11/44"
 * produces eight intermediate values -- "4", "44", "444", "444/" ... -- none of which
 * parse. An unparseable plan falls back to the global, so those keystrokes leave the
 * EFFECTIVE policy exactly as it was and re-ranking is pure waste. Only a real change
 * triggers work, which turns nine full re-ranks into one.
 *
 * A non-empty value that does not parse is dimmed, since it is silently doing nothing
 * otherwise.
 */
function planInput(g) {
  const effective = () => (sfModesFromText(g.sfPlan) || []).join('');
  let last = effective();

  const i = el('input', {
    type: 'text', style: 'width:96px',
    placeholder: sfModesName(state.sf.modes),
    title: 'this slot\u2019s enhancement modes, e.g. 444/11/44. '
         + 'Blank uses the global strategy shown as the placeholder.',
  });
  i.value = g.sfPlan || '';

  const paint = () => {
    const bad = !!g.sfPlan && !sfModesFromText(g.sfPlan);
    i.style.color = bad ? 'var(--dimmer)' : '';
    i.title = bad
      ? `"${g.sfPlan}" is not 7 modes, so this slot is using the global `
        + `${sfModesName(state.sf.modes)}`
      : 'this slot\u2019s enhancement modes, e.g. 444/11/44. '
        + 'Blank uses the global strategy shown as the placeholder.';
  };
  paint();

  i.addEventListener('input', () => {
    g.sfPlan = i.value;
    save();
    paint();
    const now = effective();
    if (now === last) return;   // same policy in force; nothing to recompute
    last = now;
    sfCacheClear();
    renderRank();
  });
  return i;
}

/*
 * Swap two slots outright.
 *
 * Written for the pendants, which take the same lines and the same flames, so moving one
 * to the other's row means moving the whole item: level, stars, potential, flames, the
 * lot. Swapping only some fields would leave a row describing an item that does not
 * exist, so every own property goes.
 */
function swapSlots(keyA, keyB) {
  const c = cur();
  const a2 = c.slots[keyA];
  const b2 = c.slots[keyB];
  if (!a2 || !b2) return;
  c.slots[keyA] = b2;
  c.slots[keyB] = a2;
  save();
  // Both tables read the same slot objects, so one swap moves the flame rows too.
  renderGear(); renderRank();
}

function statTableKind(g, meta) {
  // 'gloves' shares the armor table but picks up the gloves-only attack lines
  if (meta.kind === 'gloves') return 'gloves';
  return meta.kind === 'secondary' ? 'armor' : (meta.kind || 'armor');
}

/** The weapon rule in force for a slot -- only ever the weapon itself. */
function weaponRule(meta) {
  return meta.key === 'weapon' ? WEAPON_KINDS[cur().weaponKind] || WEAPON_KINDS.none
                               : WEAPON_KINDS.none;
}

/** The secondary rule in force for a slot -- only ever the secondary. */
function secondaryRule(meta) {
  return meta.key === 'secondary'
    ? SECONDARY_KINDS[cur().secondaryKind] || SECONDARY_KINDS.none
    : SECONDARY_KINDS.none;
}

/**
 * Star force config for a slot: the global settings, plus this slot's own strategy if
 * it has one, plus any weapon recovery rule.
 *
 * An unparseable sfPlan falls back to the global rather than to some default, so a
 * half-typed "44" prices as whatever the panel says instead of silently becoming
 * all-mode-1 mid-keystroke.
 */
function sfCfgFor(meta, g) {
  const rule = weaponRule(meta);
  const sec = secondaryRule(meta);
  const own = g ? sfModesFromText(g.sfPlan) : null;
  if (rule.reviveCost == null && sec.itemCost == null && !own) return state.sf;
  const cfg = Object.assign({}, state.sf);
  if (own) cfg.modes = own;
  if (rule.reviveCost != null) cfg.weaponRule = rule;
  // An Astra spare is bought, not farmed, so a boom costs the replacement.
  if (sec.itemCost != null) cfg.itemCost = sec.itemCost;
  return cfg;
}

function sfCandidates(meta, g) {
  if (!g.on || !meta.sf || !g.sfOn || weights.empty) return [];
  const kind = statTableKind(g, meta);

  // Star force switched on against a table with no numbers in it. Say so instead
  // of returning nothing, which would read as "this slot is already maxed".
  if (sfTableEmpty(kind)) {
    return [{
      slot: meta.label, axis: 'sf', move: '—',
      cost: Infinity, gain: 0, per: Infinity, booms: 0, modes: null,
      spares: g.spares, unreachable: true, noTable: true,
    }];
  }

  const rule = weaponRule(meta);
  // Nothing to rank: the stars are quest-granted, so no amount of meso buys one.
  if (rule.noSf) {
    return [{
      slot: meta.label, axis: 'sf', move: '—',
      cost: Infinity, gain: 0, per: Infinity, booms: 0, modes: null,
      spares: g.spares, unreachable: true, fixedStars: true,
    }];
  }

  const cap = Math.min(sfCap(g.level, kind), rule.maxStar ?? Infinity);
  // A liberated Destiny cannot be forced below 22 either -- it is never in that
  // state, so a step from lower down is not a purchase that exists.
  const floor = rule.minStar ?? 0;
  const star = Math.max(floor, Math.min(g.star, cap));
  if (star >= cap) return [];

  const cfg = sfCfgFor(meta, g);
  const out = [];
  const add = (to, label) => {
    const r = sfClimb(g.level, star, to, cfg);
    const gain = sfClimbStatValue(star, to, g.level, kind, weights, g.baseAtt);
    if (gain <= 0) return;
    const cost = sfClimbAtPct(r, view.pct);
    out.push({
      slot: meta.label, axis: 'sf', move: label,
      cost, gain, per: isFinite(cost) ? cost / gain : Infinity,
      booms: r.booms, boomVariance: r.boomVariance, modes: r.modes, spares: g.spares,
      unreachable: !isFinite(cost), itemCost: cfg.itemCost || 0,
      recovery: r.recovery,
    });
  };

  add(star + 1, `★${star} → ${star + 1}`);

  if (view.allSteps) {
    for (let s = star + 1; s < cap; s++) {
      const r = sfClimb(g.level, s, s + 1, cfg);
      const gain = sfClimbStatValue(s, s + 1, g.level, kind, weights, g.baseAtt);
      if (gain <= 0) continue;
      const cost = sfClimbAtPct(r, view.pct);
      out.push({
        slot: meta.label, axis: 'sf', move: `★${s} → ${s + 1}`, later: true,
        cost, gain, per: isFinite(cost) ? cost / gain : Infinity,
        booms: r.booms, boomVariance: r.boomVariance, modes: r.modes, spares: g.spares,
        unreachable: !isFinite(cost), itemCost: cfg.itemCost || 0,
      recovery: r.recovery,
      });
    }
  }

  for (const ms of state.milestones) {
    if (ms > star + 1 && ms <= cap) add(ms, `★${star} ⇒ ${ms}`);
  }
  return out;
}

function cubeCandidates(meta, g) {
  if (!g.on || weights.empty || !meta.cube) return [];
  const currentValue = cubeCurrentValue(g.lines, weights, g.level);
  const cd = Number(g.cdWanted || 0);
  const constraints = cd < 0 ? { cd } : null;
  // both cube types compete; the frontier picks whichever wins at each rung
  const targets = cubeTargetScanAll(meta.cube, weights, currentValue,
                                    view.bestPerSlot ? 3 : 6, constraints, g.level,
                                    !!state.cubeSale);
  return targets.map(t => {
    const at = cubeAtPct(t, view.pct);
    return {
      slot: meta.label, axis: 'cube',
      move: `${t.cubeType} → ≥ ${t.threshold.toFixed(0)}${cd < 0 ? ` +${cd}s cd` : ''}`,
      cost: at.cost, gain: t.gain, per: at.cost / t.gain,
      prob: t.prob, cubes: at.cubes, example: t.example, cubeType: t.cubeType,
      cd: cd < 0 ? cd : 0,
    };
  });
}

/*
 * The flame axis of the main ranking.
 *
 * Priced off the meso reset, which is what lets it share the ranking's
 * denominator with star force and cubing. The flames panel stays separate and
 * unpriced: it answers "which slot is a flame I already own least likely to be
 * wasted on", which is a different question from what a point of main stat costs
 * in mesos.
 *
 * Always rates the reset at FLAME_RESET_TYPE, not the slot's own flame picker --
 * the meso reset's rates are fixed by the game. Advantage does come from the
 * slot, since that is a property of the item and class.
 */
function flameCandidates(meta, g) {
  if (!state.flameReset) return [];
  if (!g.on || !g.flameOn || weights.empty || !FLAMEABLE.has(meta.key)) return [];
  const dist = flameDistributionCached(
    meta.key === 'weapon' ? 'weapon' : 'armor', g.level, weights,
    { flameType: FLAME_RESET_TYPE, nonAdvantaged: !g.flameAdv, baseAtt: g.baseAtt });
  const now = flameCurrentValue(g, weights);
  const rr = flameReroll(dist, now);
  const plan = flameResetPlan(rr, view.pct);
  // Already holding the best roll the pool can produce: no row rather than an
  // "unreachable" one, since unlike a star cap this is a win, not a blocker.
  if (!isFinite(plan.cost)) return [];
  return [{
    slot: meta.label, axis: 'flame',
    // "> 0.0" reads like a typo on an item that has no flame yet, and that is the
    // most common case by far, so say so plainly instead.
    move: now > 0 ? `reset → > ${stat(now)}` : 'reset (no flame yet)',
    cost: plan.cost, gain: plan.gain, per: plan.per,
    resets: plan.resets, pImprove: rr.pImprove, now, adv: !!g.flameAdv,
  }];
}

function candidates() {
  const c = cur();
  let out = [];
  for (const meta of SLOTS) {
    const g = c.slots[meta.key];
    let rows = [...sfCandidates(meta, g), ...cubeCandidates(meta, g),
                ...flameCandidates(meta, g)];
    // Collapsing star force to one row would hide the per-step curve, so don't do
    // it while that curve is what's being asked for.
    if (view.bestPerSlot && !view.allSteps) {
      // one star force move per slot: the cheapest per point across the next step
      // and the bundled milestones. Keep the whole cube ladder though -- its rungs
      // are the point, since the top rung is usually a trivially small win.
      const sf = rows.filter(r => r.axis === 'sf');
      const finite = sf.filter(r => isFinite(r.per)).sort((a, b) => a.per - b.per);
      // if nothing is reachable (safe mode above 21★), still show one row so the
      // impossibility is visible rather than the slot just vanishing
      const bestSf = finite[0] || sf[0];
      // Anything that is not star force keeps its own rows: the cube ladder's rungs
      // are the point, and there is only ever one flame row per slot anyway.
      rows = [bestSf, ...rows.filter(r => r.axis !== 'sf')].filter(Boolean);
    }
    out = out.concat(rows);
  }
  const dir = view.sort === 'gain' ? -1 : 1;
  out.sort((a, b) => {
    const av = a[view.sort], bv = b[view.sort];
    if (!isFinite(av) && !isFinite(bv)) return 0;
    if (!isFinite(av)) return 1;
    if (!isFinite(bv)) return -1;
    return (av - bv) * dir;
  });
  return out;
}

/* ============================================================ formatting */

function meso(n) {
  if (!isFinite(n)) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 't';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'b';
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + 'm';
  if (n >= 1e3)  return Math.round(n / 1e3) + 'k';
  return Math.round(n).toLocaleString();
}
// Roughly three significant figures. One fixed decimal was fine for a stat paste,
// whose values run 10-500, and useless for a %fd paste, whose values run 0.05-2:
// every flame gain in the ranking read "0.1" and one read "0.0", while the meso /
// %fd column next to them differed by 20%. The digits were always there; they were
// being thrown away at the last step.
const stat = n => {
  if (!isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 100) return Math.round(n).toLocaleString();
  if (a >= 10) return n.toFixed(1);
  if (a >= 1) return n.toFixed(2);
  return n.toFixed(3);
};

// Two tables render this tag, so the mapping lives in one place -- a third axis
// was previously a silent fallthrough to "cubing" in both.
const AXIS_LABEL = { sf: 'star force', cube: 'cubing', flame: 'flame reset' };
const axisLabel = a => AXIS_LABEL[a] || a;

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

/** input bound to obj[key]; re-renders the ranking only, so focus survives typing */
function bound(obj, key, opts = {}) {
  const type = opts.type || 'number';
  const i = el('input', {
    type, step: opts.step, min: opts.min, max: opts.max,
    title: opts.title, style: opts.width ? `width:${opts.width}` : null,
  });
  if (type === 'checkbox') i.checked = !!obj[key];
  else i.value = obj[key] ?? '';
  i.addEventListener('input', () => {
    if (type === 'checkbox') obj[key] = i.checked;
    else if (type === 'text') obj[key] = i.value;
    else obj[key] = i.value === '' ? 0 : +i.value;
    save();
    if (opts.onChange) opts.onChange();
    // `local` means the caller refreshes whatever it needs itself. Without it a
    // flame keystroke reaches renderFlames() via renderRank() and rebuilds the very
    // input being typed into, so the second digit lands nowhere.
    if (!opts.local) renderRank();
  });
  return i;
}

function picker(obj, key, options, opts = {}) {
  const s = el('select', { style: opts.width ? `width:${opts.width}` : null, title: opts.title },
    options.map(([v, label]) =>
      el('option', { value: v, text: label, selected: String(obj[key]) === String(v) })));
  s.addEventListener('change', () => {
    obj[key] = opts.number ? +s.value : s.value;
    save();
    if (opts.onChange) opts.onChange();
    if (!opts.local) renderRank();
  });
  return s;
}

/* ============================================================ render */

function renderChars() {
  document.getElementById('charSel').replaceChildren(
    ...Object.keys(state.chars).map(id =>
      el('option', { value: id, text: state.chars[id].name, selected: id === state.active })));
}

/**
 * The amount column, as inputs -- one per recognised row, in paste order.
 *
 * It exists because MapleScouter's middle column does not survive select-and-copy,
 * so the value column arrives as per-line totals with no way to divide them back
 * down. Blank means 1, i.e. "already per point", which is why an untouched save
 * keeps ranking exactly as before.
 *
 * A three-column paste fills these in from the page itself, and they go read-only:
 * editing them could only disagree with what was pasted.
 */
function renderAmounts() {
  const box = document.getElementById('amountBox');
  const c = cur();
  const seen = new Set();
  const rows = ((weights._parsed || {}).rows || [])
    .filter(r => r.key && !seen.has(r.key) && (seen.add(r.key), true));
  if (!rows.length) { box.replaceChildren(); return; }

  const fromPaste = weights.amountsFromPaste;
  const kids = [el('p', { class: 'note', style: 'margin:0 0 6px' }, fromPaste
    ? 'Amounts came with the paste, so they are read-only here.'
    : 'Amount each value is for, matching the middle column on your MapleScouter '
      + 'page. Blank or 1 means the values are already per point.')];

  const grid = el('div', { class: 'amts' });
  for (const r of rows) {
    const inp = el('input', {
      type: 'number', step: 'any', min: '0', placeholder: '1',
      disabled: fromPaste || false,
      title: `divides the ${r.label} row`,
    });
    inp.value = fromPaste ? String(weights.amounts[r.key])
                          : (c.amounts[r.key] != null ? String(c.amounts[r.key]) : '');
    inp.addEventListener('input', () => {
      const v = inp.value === '' ? null : +inp.value;
      if (v == null || !isFinite(v) || v <= 0) delete c.amounts[r.key];
      else c.amounts[r.key] = v;
      save();
      // Deliberately does NOT re-render this grid: rebuilding the inputs mid-keystroke
      // is what once made the second digit of a flame entry vanish.
      refreshWeights(); renderWeights(); renderRank();
      for (const m of SLOTS) renderPotValue(m.key);
    });
    grid.append(el('label', {}, [el('span', { text: r.label }), inp]));
  }
  kids.push(grid);

  if (!fromPaste) {
    kids.push(el('div', { class: 'row', style: 'margin-top:8px' }, [
      el('button', { onclick: () => {
        for (const r of rows) {
          const d = SCOUTER_DEFAULT_AMOUNTS[r.key];
          if (d != null) c.amounts[r.key] = d;
        }
        save(); reweigh(); renderAmounts();
      } }, 'MapleScouter defaults'),
      el('button', { onclick: () => {
        c.amounts = {};
        save(); reweigh(); renderAmounts();
      } }, 'all 1 (already per point)'),
    ]));
  }
  box.replaceChildren(...kids);
}

function renderWeights() {
  const box = document.getElementById('weightOut');
  const p = weights._parsed;

  if (weights.empty) {
    box.replaceChildren(el('p', { class: 'note',
      text: 'No stat weights yet. Paste the MapleScouter table above — nothing can be ranked without it.' }));
    return;
  }

  const shown = [
    ['main stat', weights.mainStat],
    ['1 pt class stat', weights.statPerPoint.toFixed(2)],
    [`1% ${weights.mainStat}`, weights.mainPct],
    ['1% all stat', weights.allStatPct],
    ['1% att', weights.attPct],
    ['1% boss', weights.boss],
    [`1% ied @${weights.iedVariant}`, weights.ied],
    ['1% crit dmg', weights.critDmg],
    ['1% dmg', weights.dmgPct],
    ['1 att', weights.attFlat],
    ...STAT_NAMES.filter(s => s !== weights.mainStat && (weights.statByStat[s] || 0) > 0)
      .map(s => [`1 ${s}`, weights.statByStat[s]]),
    ...(weights.hpStat > 0 ? [['1 HP', weights.hpStat]] : []),
  ];

  const kids = [
    el('div', { class: 'wt' }, shown.map(([k, v]) =>
      el('div', {}, [el('span', { text: k + ' ' }), el('b', { text: String(v) })]))),
  ];
  kids.push(el('p', { class: 'note', style: 'margin-top:10px' },
    'Read from the paste: ' + weightsProfileText(weights) + '.'));

  // Unmissable, because this input is wrong in a way that produces a plausible
  // ranking rather than a visible failure.
  if (weights.suspectTotals) {
    kids.push(el('p', { class: 'err', style: 'margin-top:10px' },
      'No row lands on 1, so these look like per-line values — each one point’s '
      + 'worth times the amount beside it. This tool applies amounts itself, so it '
      + 'would count them twice over, by a different factor per row (12× for a 12% '
      + 'line, 9× for a 9% one), changing the order and not just the scale. Set '
      + 'the amounts below to match your MapleScouter page — '
      + '“MapleScouter defaults” if you have not edited them — and this '
      + 'warning clears itself once a row divides back down to 1.'));
  }

  const unknown = scouterUnknownRows(p);
  if (unknown.length) {
    kids.push(el('p', { class: 'note', style: 'margin-top:10px' },
      `Not recognised, so contributing nothing: ${unknown.map(r => r.label).join(', ')}`));
  }
  // A weight that is absent from the paste is not "unrecognised" -- there is no row
  // to flag -- so anything landing on zero is called out separately.
  const zero = shown.filter(([, v]) => v === 0).map(([k]) => k);
  if (zero.length) {
    kids.push(el('p', { class: 'note warn', style: 'margin-top:6px' },
      `Absent from the paste, so anything you enter against them scores 0: `
      + `${zero.join(', ')}.`));
  }
  box.replaceChildren(...kids);
}

function renderGear() {
  const c = cur();
  const dash = () => el('td', { class: 'num', text: '—', style: 'color:var(--dimmer)' });

  document.getElementById('gearBody').replaceChildren(...SLOTS.map(meta => {
    const g = c.slots[meta.key];
    const tds = [
      el('td', {}, bound(g, 'on', { type: 'checkbox', onChange: renderGear,
        title: 'slot active. Untick to skip it on every axis' })),
      el('td', { class: 'slot-name' }, PENDANT_SWAP[meta.key]
        ? [document.createTextNode(meta.label + ' '),
           el('button', {
             class: 'swap',
             title: `swap everything with ${SLOTS.find(m => m.key === PENDANT_SWAP[meta.key]).label}`
                  + ' \u2014 level, stars, potential and flames',
             onclick: () => swapSlots(meta.key, PENDANT_SWAP[meta.key]),
           }, '\u21c5')]
        : [document.createTextNode(meta.label)]),
      el('td', { class: 'num' }, picker(g, 'level', LEVELS.map(l => [l, l]),
          { number: true, width: '72px', onChange: renderGear,
            title: 'potential line values step up at item level 151+' })),
    ];

    if (meta.sf) {
      const kind = statTableKind(g, meta);
      const cap = sfCap(g.level, kind);
      tds.push(
        el('td', { class: 'num' }, bound(g, 'star', { width: '52px', min: 0, max: 30, title: `cap ${cap}` })),
        el('td', {}, bound(g, 'sfOn', { type: 'checkbox', title: 'stars bought with meso' })),
        el('td', { class: 'num' }, bound(g, 'spares', { width: '52px', min: 1, title: 'spares you can lose' })),
        el('td', {}, planInput(g)),
      );
    } else {
      tds.push(dash(), dash(), dash(), dash());   // star, SF, spares, plan
    }

    tds.push(
      // only the weapon has a base attack; a secondary has none
      meta.key === 'weapon'
        ? el('td', { class: 'num' }, bound(g, 'baseAtt',
            { width: '64px', min: 0, title: 'base ATT/MATT, used below 16★' }))
        : dash(),
      // cooldown is a constraint rather than a scored stat, and only hats roll it
      meta.key === 'hat'
        ? el('td', {}, picker(g, 'cdWanted', CD_CHOICES,
            { number: true, width: '60px',
              title: 'insist on this much cooldown reduction. Pins a line, so it '
                   + 'removes the chance of three stat lines' }))
        : dash(),
    );

    if (!meta.cube) {
      tds.push(dash(), dash(), dash(), dash());   // 3 line pickers + the value cell
      return el('tr', { class: g.on ? null : 'off' }, tds);
    }

    const optsFor = (legendaryOnly) => [['Zero|0', '—'],
      ...cubeLineOptions(meta.cube, g.level, cubeSubStats(weights), legendaryOnly)
        .filter(([n]) => n !== 'Zero')
        .map(([n, v]) => [`${n}|${v}`, `${n} ${v}`])];
    const allOpts = optsFor(false);
    const primeOpts = optsFor(true);

    for (let i = 0; i < 3; i++) {
      // Line 1 is always prime, so only legendary-tier values belong in it.
      let opts = i === 0 ? primeOpts : allOpts;
      // A value already saved that the filtered list would drop is still shown, so an
      // older save reads back as what it actually holds instead of silently appearing
      // to be something else while the state says otherwise.
      const held = `${g.lines[i][0]}|${g.lines[i][1]}`;
      if (!opts.some(([v]) => v === held)) {
        const label = allOpts.find(([v]) => v === held);
        opts = opts.concat([[held, (label ? label[1] : held) + ' (not prime)']]);
      }
      const sel = el('select', { style: 'width:132px' }, opts.map(([v, label]) =>
        el('option', { value: v, text: label,
                       selected: `${g.lines[i][0]}|${g.lines[i][1]}` === v })));
      sel.addEventListener('change', () => {
        const [n, v] = sel.value.split('|');
        g.lines[i] = [n, +v];
        save(); renderRank(); renderPotValue(meta.key);
      });
      tds.push(el('td', {}, sel));
    }

    tds.push(el('td', { class: 'num', id: 'pv-' + meta.key,
                        text: stat(cubeCurrentValue(g.lines, weights, g.level)) }));
    return el('tr', { class: g.on ? null : 'off' }, tds);
  }));
}

function renderPotValue(key) {
  // Slots with no cube pool (pocket) render no value cell at all, so bail early.
  const cell = document.getElementById('pv-' + key);
  if (!cell) return;
  const g = cur().slots[key];
  cell.textContent = stat(cubeCurrentValue(g.lines, weights, g.level));
}

function describe(r) {
  if (r.axis === 'sf') {
    if (r.noTable) {
      return 'no stat table yet — fill in sf-stats-secondary.js, or leave SF off';
    }
    if (r.fixedStars) {
      return 'fixed 22★ from liberation — no stars to buy. Tick the 2nd-stage box '
           + 'once liberated to unlock 22★→25★';
    }
    if (r.unreachable) {
      return 'unreachable';
    }
    // Booms followed the mean even at p85, which read as though a percentile only
    // moved the cost. It moves both -- an expensive climb is expensive BECAUSE it boomed
    // more -- so quote the pXX count when a percentile is set, and say which it is.
    const bits = [view.pct
      ? `p${view.pct}: ${sfBoomsAtPct(r, view.pct).toFixed(2)} booms `
        + `(${r.booms.toFixed(2)} expected)`
      : `${r.booms.toFixed(2)} booms`];
    if (r.recovery) {
      bits.push(`${meso(r.booms * r.recovery.fee)} of that in fees`
        + ` (${r.recovery.route === 'buy' ? 'revive 10b + buy back to 22★' : 'revive 10b, re-climb'})`);
    } else if (r.itemCost > 0) {
      bits.push(`${meso(r.booms * r.itemCost)} of that in weapon recovery`);
    }
    if (r.modes && r.modes.length) {
      const uniq = [...new Set(r.modes.map(m => m.mode))];
      bits.push(uniq.length === 1
        ? `mode ${uniq[0]}`
        : r.modes.map(m => `${m.star}★:m${m.mode}`).join(' '));
    }
    // Only meaningful when a boom is absorbed by a spare. A Destiny weapon is
    // recovered by paying, not replaced, so a spares count says nothing about it and
    // the warning would be pure noise.
    if (!r.itemCost && !r.recovery) {
      const shown = view.pct ? sfBoomsAtPct(r, view.pct) : r.booms;
      if (shown > r.spares) bits.push(`⚠ over ${r.spares} spares`);
    }
    return bits.join(' · ');
  }
  if (r.axis === 'flame') {
    const bits = [`${(r.pImprove * 100).toFixed(1)}% per reset`];
    // The mean of a geometric count sits well above its median once p is small --
    // at p=0.4% the mean is 270 resets and the median 187 -- so a reader who takes
    // "270 expected" as "about 270" is misled in the direction of optimism. Quote both.
    const median = geometricPct(r.pImprove, 50);
    bits.push(view.pct
      ? `p${view.pct}: ${r.resets.toFixed(0)} resets `
        + `(${(1 / r.pImprove).toFixed(1)} expected, median ${median})`
      : `${r.resets.toFixed(1)} resets expected, median ${median}`);
    bits.push(`${meso(FLAME_RESET_MESO)} each`);
    // Worth flagging: non-advantaged drops you to 1-4 lines AND shifts every tier
    // down two, which is usually the reason a slot looks terrible here.
    if (!r.adv) bits.push('⚠ non-advantaged');
    return bits.join(' · ');
  }
  const ex = cubeExampleText(r.example, weights);
  return `${r.cubes.toFixed(0)} cubes · p=${(r.prob * 100).toFixed(2)}%${ex ? ' · e.g. ' + ex : ''}`;
}

function renderRank() {
  const list = candidates();
  const body = document.getElementById('rankBody');
  const meta = document.getElementById('rankMeta');

  if (weights.empty) {
    body.replaceChildren(el('tr', {}, el('td', { colspan: 8, class: 'empty',
      text: 'Paste your MapleScouter weights to rank anything.' })));
    meta.textContent = '';
    renderPager(1);
    return;
  }
  if (!list.length) {
    body.replaceChildren(el('tr', {}, el('td', { colspan: 8, class: 'empty',
      text: 'Nothing to improve — every slot is at its cap with no worthwhile cube target.' })));
    meta.textContent = '';
    renderPager(1);
    return;
  }

  const size = state.pageSize || list.length;
  const pages = Math.max(1, Math.ceil(list.length / size));
  view.page = Math.min(Math.max(0, view.page), pages - 1);
  const from = view.page * size;
  const shown = list.slice(from, from + size);

  // the paste decides the unit, so the headings must follow it rather than always
  // claiming "stat"
  const unit = weights.unit === '%fd' ? '% fd' : 'stat';
  const thGain = document.getElementById('th-gain');
  const thPer = document.getElementById('th-per');
  if (thGain) thGain.textContent = 'Δ ' + unit;
  if (thPer) thPer.textContent = 'Meso / ' + unit;

  meta.textContent = `${list.length} moves · sorted by ${view.sort === 'per' ? 'meso per ' + unit
    : view.sort === 'gain' ? unit + ' gained' : 'cost'}`
    + (view.pct ? ` · p${view.pct} cost` : '')
    + (pages > 1 ? ` · showing ${from + 1}-${Math.min(from + size, list.length)}` : '');
  renderPager(pages);

  // cheapest per point regardless of which column is sorted on
  const best = list.reduce((b, r) =>
    isFinite(r.per) && (!b || r.per < b.per) ? r : b, null);
  body.replaceChildren(...shown.map((r, i) => el('tr', {}, [
    el('td', { class: 'idx', text: from + i + 1 }),
    el('td', { class: 'slot-name', text: r.slot }),
    el('td', {}, el('span', { class: 'tag ' + r.axis, text: axisLabel(r.axis) })),
    el('td', { text: r.move, style: r.later ? 'color:var(--dimmer)' : null }),
    el('td', { class: 'num' + (r.unreachable ? ' bad' : ''), text: meso(r.cost) }),
    el('td', { class: 'num', text: stat(r.gain) }),
    el('td', { class: 'num' + (r === best ? ' best' : ''), text: meso(r.per) }),
    el('td', { class: 'detail' + (r.booms > r.spares ? ' warn' : ''), text: describe(r) }),
  ])));

  // Flame rows depend on the same inputs (level, base attack, weights) and every
  // one of those already calls renderRank, so refresh both together.
  renderFlames();
}

/**
 * Paging controls, in the bar ABOVE the table.
 *
 * Below the table they moved every time a short last page changed its height, so the
 * button you were aiming at slid out from under the cursor. Up here their position
 * does not depend on how many rows rendered.
 *
 * The rows select is written from state on every render, never left to the browser.
 * Browsers restore form values across a reload, so a default held only in JS drifts
 * from what the control shows -- which is exactly how it came back reading 10 while
 * still paging by 50.
 */
function renderPager(pages) {
  const sel = document.getElementById('pageSize');
  if (sel) sel.value = String(state.pageSize);

  const box = document.getElementById('rankPager');
  if (pages <= 1) { box.replaceChildren(); return; }
  const jump = (d) => { view.page += d; renderRank(); };
  box.replaceChildren(
    el('button', { text: '‹', title: 'previous page',
                   disabled: view.page === 0, onclick: () => jump(-1) }),
    el('span', { class: 'note', text: `${view.page + 1}/${pages}` }),
    el('button', { text: '›', title: 'next page',
                   disabled: view.page >= pages - 1, onclick: () => jump(1) }),
  );
}

/* ============================================================ flames */

/*
 * Memoised, because renderRank() calls renderFlames() and therefore rebuilds all 15
 * rows on every keystroke anywhere in the tool -- including star fields, which cannot
 * affect a flame. flameDistributionCached already stops the 6.6k-entry distribution
 * being rebuilt, but flameReroll still walked it per row.
 *
 * The key covers every input, so this cannot go stale. Refreshing flames from
 * renderRank stays: it is the safe direction, and now it is cheap.
 */
const _flameRowCache = new Map();

function flameRowCacheClear() { _flameRowCache.clear(); }

function flameRowData(meta, g) {
  const key = [meta.key, g.level, g.flameType, !!g.flameAdv, g.baseAtt,
               !!g.on, !!g.flameOn,
               ...FLAME_INPUTS.map(([k]) => g[k] || 0)].join('|');
  const memo = _flameRowCache.get(key);
  if (memo) return memo;

  const opts = {
    flameType: g.flameType, nonAdvantaged: !g.flameAdv, baseAtt: g.baseAtt,
  };
  const kind = meta.key === 'weapon' ? 'weapon' : 'armor';
  const dist = flameDistributionCached(kind, g.level, weights, opts);
  const now = flameCurrentValue(g, weights);
  const row = {
    meta, g, now, slotOrder: SLOTS.indexOf(meta),
    off: !g.on || !g.flameOn,
    ...flameReroll(dist, now),
  };
  _flameRowCache.set(key, row);
  return row;
}

function flameRows() {
  const c = cur();
  if (weights.empty) return [];
  const out = [];
  for (const meta of SLOTS) {
    const g = c.slots[meta.key];
    if (!FLAMEABLE.has(meta.key)) continue;
    out.push(flameRowData(meta, g));
  }
  // Default P(better): the chance a reroll beats what's there, so the top row is
  // where a flame is least likely to be wasted. E[gain] weighs how much better
  // instead of how often, which is a different question -- hence both are offered.
  const key = view.flameSort;
  const asc = key === 'rollsToBeat';   // fewer rolls is better
  out.sort((a, b) => {
    // switched-off slots always sink, whichever column is sorted on
    if (a.off !== b.off) return a.off ? 1 : -1;
    if (key === 'slot') return a.slotOrder - b.slotOrder;
    const av = a[key], bv = b[key];
    if (!isFinite(av) && !isFinite(bv)) return a.slotOrder - b.slotOrder;
    if (!isFinite(av)) return 1;
    if (!isFinite(bv)) return -1;
    // equal values keep slot order rather than shuffling arbitrarily
    return (asc ? av - bv : bv - av) || (a.slotOrder - b.slotOrder);
  });
  return out;
}

function renderFlames() {
  const body = document.getElementById('flameBody');
  if (weights.empty) {
    body.replaceChildren(el('tr', {}, el('td', { colspan: 20, class: 'empty',
      text: 'Paste your MapleScouter weights to price flames.' })));
    return;
  }

  // per-stat and HP headers follow the paste: only weighted columns show
  for (const [key] of FLAME_INPUTS) {
    if (!FLAME_INPUTS_HIDEABLE.has(key)) continue;
    const th = document.getElementById('th-' + key);
    if (th) th.style.display = flameInputWeight(key, weights) ? '' : 'none';
  }

  const rows = flameRows();
  const best = rows.reduce((b, r) =>
    (!b || r.gainPerRoll > b.gainPerRoll) ? r : b, null);

  body.replaceChildren(...rows.map((r) => {
    const g = r.g;
    // Editing an input must NOT rebuild the table: doing so destroys the element
    // being typed into, so the second keystroke lands nowhere and the row jumps to
    // a new sorted position mid-edit. Refresh just this row's computed cells and
    // leave the ordering until an explicit recalculate or a header click.
    const live = () => refreshFlameRow(r.meta.key);
    // Same leading On | Slot | Lv as the gear table. The rank index is gone: order
    // already conveys rank, and dropping it makes the two tables line up.
    return el('tr', { id: 'flrow-' + r.meta.key, class: r.off ? 'off' : null }, [
      el('td', {}, bound(g, 'flameOn', { type: 'checkbox', local: true,
        title: 'flame this slot; untick to sink it to the bottom on the next reorder',
        onChange: live })),
      el('td', { class: 'slot-name', text: r.meta.label }),
      el('td', { class: 'num', text: g.level }),
      el('td', {}, picker(g, 'flameType', FLAME_TYPES,
        { width: '170px', onChange: live, local: true })),
      el('td', {}, bound(g, 'flameAdv', { type: 'checkbox', onChange: live, local: true,
        title: 'flame advantaged. Off shifts every tier down 2 and drops to 1-4 lines' })),
      ...FLAME_INPUTS.map(([key, , title]) => {
        const wt = flameInputWeight(key, weights);
        const dead = wt === 0 && Number(g[key] || 0) > 0;
        const attrs = { class: 'num' + (dead ? ' warn' : '') };
        // stat and HP columns exist only for classes whose paste weights them --
        // a mage sees INT/LUK, a Xenon STR/DEX/LUK, a Demon Avenger HP
        if (FLAME_INPUTS_HIDEABLE.has(key) && wt === 0) attrs.style = 'display:none';
        return el('td', attrs, bound(g, key,
          { width: '56px', min: 0, step: '1', onChange: live, local: true,
            title: dead
              ? `${title} — but your MapleScouter paste has no weight for this, so it `
                + `scores 0. Add the row and re-paste.`
              : `${title} (1 point = ${wt} main stat)` }));
      }),
      ...flameCells(r, r === best),
    ]);
  }));
}

/** The six computed cells at the end of a flame row. */
function flameCells(r, isBest) {
  return [
    el('td', { class: 'num detail', text: stat(r.now) }),
    // Now again, in main-stat points -- see flameScore. Not sortable: it orders
    // identically to Now, and Now is not sortable either.
    el('td', { class: 'num', text: stat(flameScore(r.now, weights)) }),
    el('td', { class: 'num', text: stat(r.expected) }),
    el('td', { class: 'num', text: stat(r.max) }),
    el('td', { class: 'num', text: (r.pImprove * 100).toFixed(2) + '%' }),
    el('td', { class: 'num' + (isBest && r.gainPerRoll > 0 ? ' best' : ''),
               text: stat(r.gainPerRoll) }),
    el('td', { class: 'num detail', text: !isFinite(r.rollsToBeat) ? 'never'
      : view.flamePct ? String(geometricPct(r.pImprove, view.flamePct))
      : r.rollsToBeat.toFixed(1) }),
  ];
}

/**
 * Recompute one row's derived cells without touching row order or the DOM nodes
 * holding focus. Called on every keystroke; the full re-sort waits for the
 * recalculate button or a header click.
 */
function refreshFlameRow(key) {
  const tr = document.getElementById('flrow-' + key);
  if (!tr) return;
  const meta = SLOTS.find(m => m.key === key);
  const r = flameRowData(meta, cur().slots[key]);
  // dim immediately so the toggle reads as taking effect; the row only changes
  // position on the next reorder, keeping with "nothing moves while you type"
  tr.className = r.off ? 'off' : '';
  const cells = flameCells(r, false);
  // computed cells are the last seven of the twenty-one (per-stat columns first)
  for (let i = 0; i < cells.length; i++) {
    const target = tr.children[14 + i];
    if (target) target.textContent = cells[i].textContent;
  }
}

/**
 * Mode per star for 15★→22★, with the three strategies people name as one-click
 * presets. This replaced a per-row "Safe" checkbox, which could only say all-or-
 * nothing and read "impossible" for every row above 21★ -- where the honest answer is
 * that no zero-destroy mode exists, not that the climb cannot be done.
 *
 * The ranking prices the policy set here. It is not a hint the solver may overrule:
 * a "safeguard 15-18, ride 18-20" plan has a cost, and that cost is what you want.
 */
function renderSfModes() {
  const box = document.getElementById('sfModes');
  const cfg = state.sf;
  const apply = () => {
    save(); sfCacheClear(); renderSfModes(); renderRank();
  };

  const current = sfModesName(cfg.modes);
  const chips = Object.keys(SF_MODE_PRESETS).map(name => {
    const on = name === current;
    return el('button', {
      class: on ? 'on' : null,
      title: SF_PRESET_NOTES[name],
      onclick: () => { cfg.modes = SF_MODE_PRESETS[name].slice(); apply(); },
    }, name);
  });

  const grid = el('div', { class: 'modes' });
  for (let i = 0; i < STAR_ENHANCE_COUNT; i++) {
    const s = STAR_ENHANCE_MIN + i;
    const opts = [];
    for (let m = 0; m < STAR_ENHANCE_MODES; m++) opts.push([m, sfModeLabel(s, m, cfg)]);
    grid.append(el('label', {}, [
      el('span', { text: `${s}★ → ${s + 1}★` }),
      picker(cfg.modes, String(i), opts, { number: true, onChange: apply }),
    ]));
  }

  box.replaceChildren(
    el('div', { class: 'row', style: 'gap:6px; flex-wrap:wrap' }, chips),
    grid,
    el('p', { class: 'note', style: 'margin:8px 0 0' },
      current in SF_PRESET_NOTES ? SF_PRESET_NOTES[current]
        : `Custom ${current}. Boom chances shown are what you actually face, with the `
          + `event's reduction already applied.`),
  );
}

function renderSfSettings() {
  const box = document.getElementById('sfSettings');
  const f = (label, node, title) =>
    el('div', { class: 'fld', title }, [el('label', { text: label }), node]);

  // Boom chances in the mode labels move with the event, so the panel is rebuilt too.
  const onChange = () => { sfCacheClear(); renderSfModes(); renderRank(); };

  box.replaceChildren(
    f('Event', picker(state.sf, 'event', [
      ['ssf', 'ssf — 30% off + 30% boom red.'],
      ['30off', '30% off'],
      ['30boom', '30% boom reduction'],
      ['none', 'none'],
    ], { onChange }), 'lostara\'s event options; ssf is both discounts together'),
    f('Star catch', el('label', { class: 'row', style: 'color:var(--fg)' },
      [bound(state.sf, 'catching', { type: 'checkbox', onChange }),
       document.createTextNode('+5% relative')]), 'multiplicative, not additive'),
    f('MVP discount', picker(state.sf, 'mvp', [
      ['0', 'none (Reboot)'], ['0.03', 'silver 3%'],
      ['0.05', 'gold 5%'], ['0.1', 'diamond+ 10%'],
    ], { number: true, onChange }), 'Reboot has no MVP; only applies at or below 16★'),
    f('Boom item cost', bound(state.sf, 'itemCost', { step: '1000000', min: 0, onChange }),
      'what replacing a destroyed item costs you. 0 = spares are free, which makes ' +
      'the riskiest mode expected-optimal nearly everywhere'),
    f('Cube sale', el('label', { class: 'row', style: 'color:var(--fg)' }, [
      (() => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!state.cubeSale;
        cb.addEventListener('change', () => {
          state.cubeSale = cb.checked; save(); cubeScanCacheClear(); renderRank();
        });
        return cb;
      })(),
      document.createTextNode('25% off cubes'),
    ]), 'discounts the cube itself, not the reveal fee -- they are separate charges'),
  );

  renderSfModes();

  // Two checkboxes, but one underlying field, so they cannot both be on -- ticking
  // either clears the other rather than needing the two kept in sync. Per character,
  // hence the label: this panel is otherwise global.
  const kindBox = (kind, text, title) => {
    const cb = el('input', { type: 'checkbox', title });
    cb.checked = cur().weaponKind === kind;
    cb.addEventListener('change', () => {
      cur().weaponKind = cb.checked ? kind : 'none';
      save(); sfCacheClear(); renderSfSettings(); renderGear(); renderRank();
    });
    return el('label', { class: 'row', style: 'color:var(--fg)', title },
      [cb, document.createTextNode(text)]);
  };
  // Astra sits with the weapon toggles but drives a SEPARATE field, because a secondary
  // rule is not exclusive with a weapon rule -- you can hold a Destiny and an Astra at
  // once. Only the two weapon boxes exclude each other.
  const secBox = (kind, text, title) => {
    const cb = el('input', { type: 'checkbox', title });
    cb.checked = cur().secondaryKind === kind;
    cb.addEventListener('change', () => {
      cur().secondaryKind = cb.checked ? kind : 'none';
      save(); sfCacheClear(); renderSfSettings(); renderGear(); renderRank();
    });
    return el('label', { class: 'row', style: 'color:var(--fg)', title },
      [cb, document.createTextNode(text)]);
  };

  box.append(
    el('div', { class: 'fld', style: 'grid-column:1/-1' }, [
      el('label', { text: 'This character’s gear' }),
      el('div', { class: 'row', style: 'flex-wrap:wrap; gap:4px 14px' }, [
        kindBox('fixed22', 'Genesis / Destiny — fixed 22★',
          'stars come from liberation quests, so none can be bought; '
          + 'weapon star force is dropped from the ranking'),
        kindBox('destiny2', 'Destiny, 2nd stage liberation',
          'unlocks 22★→25★. A boom revives it at 12★ for 10b; from there '
          + '54.2b buys a guaranteed 22★, or you re-climb'),
        secBox('astra', 'Astra secondary — spares cost 1b',
          'spares are bought rather than farmed, so every boom costs 1b'),
      ]),
    ]));

  const ms = document.getElementById('milestones');
  ms.value = state.milestones.join(', ');
  ms.oninput = () => {
    const vals = ms.value.split(/[,\s]+/).map(Number)
      .filter(n => Number.isFinite(n) && n > 0 && n <= 30);
    state.milestones = [...new Set(vals)].sort((a, b) => a - b);
    save(); renderRank();
  };
}

function renderScouter() {
  const c = cur();
  const ta = document.getElementById('scouter');
  ta.value = c.scouter || '';
  document.getElementById('iedSel').value = String(c.iedVariant);
  document.getElementById('mainSel').value = c.mainStat || '';
}

/*
 * Both toggle buttons show one flag, so they are written from state rather than
 * toggled in place -- a button whose look is flipped locally drifts from the other
 * one the moment either is used, and from localStorage on reload.
 */
function syncFlameResetToggles() {
  for (const id of ['tglFlame', 'cmpTglFlame']) {
    const b = document.getElementById(id);
    if (b) b.classList.toggle('on', !!state.flameReset);
  }
}

function setFlameReset(on) {
  state.flameReset = !!on;
  save();
  syncFlameResetToggles();
  view.page = 0;
  renderRank();
  // Not recomputed: compareGlobalSig now differs, so the compare table reports
  // itself stale and waits to be asked, like every other policy change.
  renderCompare(false);
}

function renderAll() {
  refreshWeights();
  syncFlameResetToggles();
  renderChars(); renderScouter(); renderWeights(); renderAmounts();
  renderTabs();
  renderSfSettings(); renderGear(); renderFlameControls(); renderRank();
  // Deliberately last, and never with recompute: it runs every selected character from
  // cold, so page load and character switches must not pay for it uninvited.
  renderCompare(false);
}


/* ============================================================ grid navigation */

/**
 * Enter moves to the same column one row down, Shift+Enter one row up, the way a
 * spreadsheet behaves. Rows whose cell in that column holds no control (a dash,
 * or a slot that doesn't support the mechanic) are skipped rather than trapping
 * focus, so pressing Enter down the Spares column jumps over Emblem and Pocket.
 *
 * Only Enter is bound. Arrow keys are deliberately left alone: up/down already
 * step a number input's value and change a select's option, so taking them over
 * would break editing to add navigation.
 *
 * Attached to the tbody, which survives replaceChildren, so this is wired once
 * rather than per row.
 */
function gridNav(e) {
  if (e.key !== 'Enter') return;
  const el = e.target;
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'SELECT')) return;

  const td = el.closest('td');
  const tr = el.closest('tr');
  if (!td || !tr) return;
  const col = Array.prototype.indexOf.call(tr.children, td);

  const step = e.shiftKey ? 'previousElementSibling' : 'nextElementSibling';
  for (let row = tr[step]; row; row = row[step]) {
    const cell = row.children[col];
    const next = cell && cell.querySelector('input, select');
    if (!next || next.disabled) continue;
    e.preventDefault();
    next.focus();
    if (typeof next.select === 'function' && next.type !== 'checkbox') next.select();
    return;
  }
  // nothing below: swallow the keypress so the browser doesn't try to submit
  e.preventDefault();
}

for (const id of ['gearBody', 'flameBody']) {
  document.getElementById(id).addEventListener('keydown', gridNav);
}

/* ============================================================ compare characters */

/*
 * Cross-character comparison.
 *
 * Everything here has to run the normal per-character machinery against a character
 * that is NOT the active one. Rather than thread a character through sfCandidates,
 * cubeCandidates and flameRowData -- all of which read `cur()` and the module-level
 * `weights` -- the active character is swapped for the duration and put back after.
 * Less surface area to get wrong than a parameter on ten functions.
 *
 * The memos are keyed on slot inputs, not on which character owns them, so they are
 * cleared on the way in and out. That makes this expensive, which is why nothing in
 * the normal typing path calls it: only the compare panel's own controls do.
 */
function withCharacter(id, fn) {
  const prevActive = state.active;
  const prevWeights = weights;
  state.active = id;
  // refreshWeights clears the memos itself, which is exactly what is needed: they were
  // valued against the previous character. Note sfCache is NOT cleared -- it keys on the
  // full config including modes and weapon rule, so it is already character-safe and
  // clearing it would throw away work every switch.
  refreshWeights();
  try {
    return fn();
  } finally {
    state.active = prevActive;
    weights = prevWeights;
    // The next thing to run is the active character again, and these two memos key on
    // slot inputs alone, so they now hold the other character's values and must go.
    //
    // flameCacheClear() is deliberately NOT called: that cache keys on the weights
    // themselves, so it is already character-safe, and rebuilding a 6.6k-entry
    // distribution per character was most of what made comparing slow.
    cubeScanCacheClear(); flameRowCacheClear();
  }
}

/** Characters ticked for comparison, in save order. */
function compareIds() {
  return Object.keys(state.chars).filter(id => state.compare[id]);
}

/*
 * Comparing is EXPENSIVE: a character not already cached is computed from cold, because
 * the memos key on slot inputs and know nothing about who owns them.
 *
 * So it is cached PER CHARACTER, against a signature of everything that changes the
 * answer. That makes the cheap things cheap:
 *
 *   unticking a character   free -- filters the cache, computes nothing
 *   switching tabs          free -- same
 *   ticking a new one       computes that character alone
 *   editing one character   invalidates that character alone
 *
 * The first version used a single counter bumped by save(), which meant unticking and
 * even switching tabs blanked the whole table: both call save(), and the counter could
 * not tell a view change from an input change. A signature can.
 */
const _cmpCache = new Map();   // charId -> { sig, rank, flames }

/** Settings shared by every character, so a change here invalidates all of them. */
function compareGlobalSig() {
  return JSON.stringify([state.sf, state.cubeSale, state.flameReset, state.milestones,
                         view.pct, view.bestPerSlot, view.allSteps]);
}

/** Everything about one character that can move its numbers. */
function compareCharSig(id) {
  const c = state.chars[id];
  if (!c) return '';
  return JSON.stringify([
    compareGlobalSig(), c.scouter, c.amounts, c.iedVariant, c.mainStat,
    c.weaponKind, c.secondaryKind,
    SLOTS.map(m => {
      const g = c.slots[m.key] || {};
      return [g.on, g.level, g.star, g.sfOn, g.spares, g.baseAtt, g.cdWanted, g.sfPlan,
              g.lines, g.flameType, g.flameOn, g.flameAdv,
              ...FLAME_INPUTS.map(([k]) => g[k] || 0)];
    }),
  ]);
}

/** Selected characters whose cached rows are missing or out of date. */
function compareMissing() {
  return compareIds().filter(id => {
    const hit = _cmpCache.get(id);
    return !hit || hit.sig !== compareCharSig(id);
  });
}

/** Compute and cache one character. */
function compareComputeOne(id) {
  const c = state.chars[id];
  const rank = [];
  const flames = [];
  withCharacter(id, () => {
    if (weights.empty) return;
    for (const r of candidates()) {
      rank.push(Object.assign({}, r, { charId: id, charName: c.name, unit: weights.unit }));
    }
    for (const meta of SLOTS) {
      if (!FLAMEABLE.has(meta.key)) continue;
      const row = flameRowData(meta, cur().slots[meta.key]);
      if (row.off) continue;
      flames.push(Object.assign({}, row, { charId: id, charName: c.name }));
    }
  });
  _cmpCache.set(id, { sig: compareCharSig(id), rank, flames });
}

/*
 * ON THE UNIT, because it is the one thing a reader should be suspicious of:
 *
 * Meso per stat is each character's own main stat point, since MapleScouter normalises
 * every paste to 1. That makes this "who buys a stat point cheapest", which is exactly
 * the question when a stat point is worth about the same everywhere -- true for
 * characters at similar progression. It drifts only when totals differ a lot, because
 * then one point is a different share of each character's damage.
 *
 * Flames carry no such caveat. Rolls to beat comes from a PROBABILITY, and probability is
 * scale-invariant -- scaling a character's weights scales the current flame and every
 * rolled outcome together, so "will a reroll beat this" is unchanged. Comparable as-is.
 */
function compareMerged(which) {
  const rows = [];
  for (const id of compareIds()) {
    const hit = _cmpCache.get(id);
    if (hit) rows.push(...hit[which]);
  }
  if (which === 'rank') rows.sort((a, b) => (a.per - b.per) || (b.gain - a.gain));
  // fewest rolls first, i.e. easiest to improve, which is where flames should go
  else rows.sort((a, b) => (a.rollsToBeat - b.rollsToBeat) || (b.pImprove - a.pImprove));
  return rows;
}

/*
 * Two tabs in ONE document, rather than a second page at /compare/.
 *
 * A separate page would need the engines loaded twice, would break the single-file build
 * (which is one HTML file by definition), and would depend on the two paths sharing
 * localStorage -- true on an http origin, browser-dependent from file://. Same document
 * means the same state object, so there is nothing to sync.
 *
 * The compare tab is still not computed on open: switching to it is cheap, and the table
 * asks for recalculate. Opening a tab should not freeze the page for seconds.
 */
const TABS = ['main', 'compare'];

function renderTabs() {
  const active = TABS.includes(state.tab) ? state.tab : 'main';
  for (const name of TABS) {
    const pane = document.getElementById('tab-' + name);
    if (pane) pane.hidden = name !== active;
    const btn = document.getElementById('tab' + name[0].toUpperCase() + name.slice(1));
    if (btn) btn.classList.toggle('on', name === active);
  }
}

function showTab(name) {
  state.tab = TABS.includes(name) ? name : 'main';
  save();
  renderTabs();
  // Rows are only drawn for the visible pane, so the compare tables have to be built when
  // the tab is first shown -- from cache, never recomputing.
  if (state.tab === 'compare') renderCompare(false);
}

function renderCompare(recompute = false) {
  const rows = document.getElementById('cmpRows');
  if (rows) rows.value = String(state.comparePageSize);

  const pick = document.getElementById('comparePick');
  const ids = Object.keys(state.chars);

  pick.replaceChildren(...ids.map(id => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!state.compare[id];
    cb.addEventListener('change', () => {
      state.compare[id] = cb.checked;
      save();
      // Ticking is an explicit ask, so compute it; unticking only filters.
      renderCompare(cb.checked);
    });
    return el('label', { class: 'row', style: 'color:var(--fg)' },
      [cb, document.createTextNode(state.chars[id].name || id)]);
  }));

  const chosen = compareIds();
  const rankBody = document.getElementById('cmpRankBody');
  const flameBody = document.getElementById('cmpFlameBody');
  const meta = document.getElementById('cmpMeta');
  const say = (msg, cls) => {
    rankBody.replaceChildren(el('tr', {}, el('td', { colspan: 9, class: cls, text: msg })));
    flameBody.replaceChildren(el('tr', {}, el('td', { colspan: 7, class: cls, text: msg })));
  };

  if (chosen.length < 2) {
    say('Tick at least two characters to compare.', 'empty');
    meta.textContent = ''; meta.className = 'note';
    return;
  }

  let missing = compareMissing();
  if (recompute) {
    for (const id of missing) compareComputeOne(id);
    missing = compareMissing();
  }
  if (missing.length) {
    const names = missing.map(id => state.chars[id].name || id).join(', ');
    say(`Press recalculate to work out ${names}. Each character not already calculated `
      + 'is computed from scratch, so it is not done automatically.', 'empty');
    meta.textContent = `${chosen.length} selected · ${missing.length} still to calculate`;
    meta.className = 'note warn';
    return;
  }

  const rank = compareMerged('rank');
  const flames = compareMerged('flames');
  const size = state.comparePageSize || 0;
  const rankShown = size ? rank.slice(0, size) : rank;
  const flameShown = size ? flames.slice(0, size) : flames;

  // Different normalisers mean the stat columns are not the same unit at all, which is
  // a much stronger objection than the scale caveat above. Say so rather than rank them.
  const units = new Set(rank.map(r => r.unit));
  meta.textContent = `${chosen.length} characters · ${rank.length} moves · `
    + `${flames.length} flame slots`
    + (units.size > 1
      ? ' · MIXED UNITS: one of these pastes is the Final Damage column and the rest are '
        + 'Main Stat, so the stat columns are not the same thing. Use one column for all.'
      : '');
  meta.className = units.size > 1 ? 'note err' : 'note';

  const best = rank.reduce((b, r) => isFinite(r.per) && (!b || r.per < b.per) ? r : b, null);
  rankBody.replaceChildren(...rankShown.map((r, i) => el('tr', {}, [
    el('td', { class: 'idx', text: i + 1 }),
    el('td', { class: 'slot-name', text: r.charName }),
    el('td', { text: r.slot }),
    el('td', {}, el('span', { class: 'tag ' + r.axis, text: axisLabel(r.axis) })),
    el('td', { text: r.move, style: r.later ? 'color:var(--dimmer)' : null }),
    el('td', { class: 'num' + (r.unreachable ? ' bad' : ''), text: meso(r.cost) }),
    el('td', { class: 'num', text: stat(r.gain) }),
    el('td', { class: 'num' + (r === best ? ' best' : ''), text: meso(r.per) }),
    el('td', { class: 'detail', text: describe(r) }),
  ])));

  const bestFlame = flameShown.find(r => isFinite(r.rollsToBeat)) || null;
  flameBody.replaceChildren(...flameShown.map((r, i) => el('tr', {}, [
    el('td', { class: 'idx', text: i + 1 }),
    el('td', { class: 'slot-name', text: r.charName }),
    el('td', { text: r.meta.label }),
    el('td', { class: 'num', text: r.g.level }),
    el('td', { class: 'num', text: (r.pImprove * 100).toFixed(2) + '%' }),
    el('td', { class: 'num' + (r === bestFlame ? ' best' : ''),
      text: !isFinite(r.rollsToBeat) ? 'never'
        : view.flamePct ? String(geometricPct(r.pImprove, view.flamePct))
        : r.rollsToBeat.toFixed(1) }),
    el('td', { class: 'num', text: stat(r.gainPerRoll) }),
  ])));
}

/* ============================================================ events */

function reweigh() {
  refreshWeights(); renderWeights(); renderAmounts(); renderGear(); renderRank();
}

document.getElementById('scouter').addEventListener('input', (e) => {
  cur().scouter = e.target.value;
  save();
  // renderAmounts here is safe -- the typing is in the textarea, not the grid, and a
  // new paste changes which rows exist, so the grid has to follow.
  refreshWeights(); renderWeights(); renderAmounts(); renderRank();
  for (const m of SLOTS) renderPotValue(m.key);
});

document.getElementById('iedSel').addEventListener('change', (e) => {
  cur().iedVariant = +e.target.value; save(); reweigh();
});
document.getElementById('mainSel').addEventListener('change', (e) => {
  cur().mainStat = e.target.value; save(); reweigh();
});
document.getElementById('loadExample').addEventListener('click', () => {
  cur().scouter = SCOUTER_EXAMPLE; save(); renderScouter(); reweigh();
});

document.getElementById('tglBest').addEventListener('click', (e) => {
  view.bestPerSlot = !view.bestPerSlot;
  e.target.classList.toggle('on', view.bestPerSlot);
  view.page = 0;
  renderRank();
});
document.getElementById('tglSteps').addEventListener('click', (e) => {
  view.allSteps = !view.allSteps;
  e.target.classList.toggle('on', view.allSteps);
  view.page = 0;
  renderRank();
});
for (const id of ['tglFlame', 'cmpTglFlame']) {
  const b = document.getElementById(id);
  if (b) b.addEventListener('click', () => setFlameReset(!state.flameReset));
}
for (const th of document.querySelectorAll('th.sortable')) {
  if (th.dataset.sort) {
    th.addEventListener('click', () => {
      view.sort = th.dataset.sort; view.page = 0; renderRank();
    });
  } else if (th.dataset.fsort) {
    th.addEventListener('click', () => {
      view.flameSort = th.dataset.fsort;
      // slot order is a filling-in convenience, not a ranking, so don't remember it
      if (view.flameSort !== 'slot') view.flameRankSort = view.flameSort;
      renderFlames();
    });
  }
}

// blank, 0 or out of range means "show the mean"
const readPct = (el2) => {
  const v = Number(el2.value);
  return el2.value === '' || !isFinite(v) || v <= 0 || v >= 100 ? 0 : v;
};

document.getElementById('pctIn').addEventListener('input', (e) => {
  view.pct = readPct(e.target);
  view.page = 0;
  renderRank();
});

// Its own control rather than the ranking's: flames are a separate decision, and the
// confidence you want for "will a reroll beat this" is not the confidence you want for
// "how much meso should I set aside". renderFlames only, so the ranking is untouched.
document.getElementById('flamePctIn').addEventListener('input', (e) => {
  view.flamePct = readPct(e.target);
  renderFlames();
  if (compareIds().length >= 2) renderCompare();
});

for (const name of TABS) {
  const btn = document.getElementById('tab' + name[0].toUpperCase() + name.slice(1));
  if (btn) btn.addEventListener('click', () => showTab(name));
}

document.getElementById('cmpRecalc').addEventListener('click', () => renderCompare(true));

document.getElementById('cmpRows').addEventListener('change', (e) => {
  state.comparePageSize = Number(e.target.value) || 0;   // 0 = all
  save(); renderCompare();
});

document.getElementById('pageSize').addEventListener('change', (e) => {
  state.pageSize = Number(e.target.value) || 0;   // 0 = all
  save();
  view.page = 0;
  renderRank();
});

function renderFlameControls() {
  const sel = document.getElementById('flameAllType');
  sel.replaceChildren(...FLAME_TYPES.map(([k, label]) =>
    el('option', { value: k, text: label })));
  sel.value = cur().slots.hat.flameType;
}

function setAllFlames(patch) {
  const c = cur();
  for (const meta of SLOTS) {
    if (FLAMEABLE.has(meta.key)) Object.assign(c.slots[meta.key], patch);
  }
  save(); renderFlames();
}

document.getElementById('flameAllType').addEventListener('change', (e) =>
  setAllFlames({ flameType: e.target.value }));
document.getElementById('flameAllAdv').addEventListener('click', () =>
  setAllFlames({ flameAdv: true }));
document.getElementById('flameAllNon').addEventListener('click', () =>
  setAllFlames({ flameAdv: false }));
document.getElementById('flameRecalc').addEventListener('click', () => {
  // Recalculate means "rank them", so it leaves slot order and returns to whichever
  // ranking column was last chosen -- otherwise you would have to press this and
  // then click a header every time.
  view.flameSort = view.flameRankSort;
  renderFlames();
});

document.getElementById('charSel').addEventListener('change', (e) => {
  state.active = e.target.value; save(); renderAll();
});
function moveChar(dir) {                       // reorder the active char in the list
  const ids = Object.keys(state.chars);
  const i = ids.indexOf(state.active), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  ids.splice(j, 0, ids.splice(i, 1)[0]);       // pull out and reinsert at the new spot
  const next = {};
  for (const id of ids) next[id] = state.chars[id];
  state.chars = next; save(); renderChars();
  if (state.tab === 'compare') renderCompare(false);
}
document.getElementById('charUp').addEventListener('click', () => moveChar(-1));
document.getElementById('charDown').addEventListener('click', () => moveChar(1));
document.getElementById('charAdd').addEventListener('click', () => {
  const name = prompt('Character name?');
  if (!name) return;
  const id = 'c' + Date.now().toString(36);
  state.chars[id] = newChar(name.trim());
  state.active = id; save(); renderAll();
});
document.getElementById('charRename').addEventListener('click', () => {
  const name = prompt('New name?', cur().name);
  if (!name) return;
  cur().name = name.trim(); save(); renderChars();
});
document.getElementById('charDel').addEventListener('click', () => {
  if (Object.keys(state.chars).length === 1) {
    alert("That's the only character — nothing left to switch to.");
    return;
  }
  if (!confirm(`Delete "${cur().name}" and all of its gear? This can't be undone.`)) return;
  delete state.chars[state.active];
  state.active = Object.keys(state.chars)[0];
  save(); renderAll();
});

// One data file / device transfer for every tool (shared/transfer.js). Live hooks: export reads
// the in-memory state (the save is debounced), import goes through migrate + re-render.
if (window.AyaTransfer) {
  AyaTransfer.register(LS_KEY, {
    get: () => state,
    set: (s) => {
      state = migrate(s && s.chars ? s : { chars: { c1: newChar('Character 1') }, active: 'c1' });
      sfCacheClear(); save(); renderAll();
    },
  });
  document.getElementById('doExport').addEventListener('click', AyaTransfer.exportFile);
  document.getElementById('doImport').addEventListener('click', AyaTransfer.importFile);
  document.getElementById('doDevices').addEventListener('click', AyaTransfer.openDevices);
}

// surface a broken data table rather than silently ranking on bad numbers
if (typeof CUBE_POOL_ERRORS !== 'undefined' && CUBE_POOL_ERRORS.length) {
  document.getElementById('bootErr').replaceChildren(el('div', { class: 'err',
    text: 'Cube pool tables are broken: ' + CUBE_POOL_ERRORS.join('; ') }));
}

renderAll();
