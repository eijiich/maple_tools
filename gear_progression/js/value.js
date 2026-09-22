/* ===========================================================================
 * Turning MapleScouter output into weights the two engines can use.
 *
 * MapleScouter's table is three columns wide: a row label, an editable AMOUNT, and
 * the value of that amount. The value column is a dropdown -- "Main Stat" gives it
 * in main-stat-equivalent, "Final Damage" gives it as a % of final damage with a %
 * suffix on every row. Both are the same weight set in different units, so either
 * ranks identically; only the printed scale differs, since everything downstream is
 * a ratio of cost to value. `unit` records which arrived so columns can be labelled
 * honestly. It has nothing to do with class.
 *
 * The amount is the catch. Both value columns are per-LINE totals -- one point's
 * worth times the amount -- and this file has to hand back PER-POINT weights,
 * because the engines apply their own amounts (a 12% potential line, a tier-7 flame).
 * Feed totals straight in and every row is counted twice over, by a different factor
 * each (12x for a 12% line, 9x for a 9% one), which reorders the ranking rather than
 * just inflating it.
 *
 * So amounts are divided back out here, from `opts.amounts`. The amount column does
 * not survive select-and-copy from the site, hence the UI inputs; a paste that DOES
 * carry three columns is parsed directly and wins over the UI. With every amount at
 * 1 -- the default -- this is a no-op and a per-point paste works unchanged.
 *
 * Dividing MapleScouter's own defaults out of the Main Stat column reproduces the
 * per-point figures exactly, including HP 30/30 = 1.
 *
 * No threshold anywhere in this tool may compare these weights to an absolute
 * constant -- only to each other. The scale is set by whichever row MapleScouter
 * normalised, which differs by class.
 *
 * A stat-equivalent paste looks like:
 *
 *     Boss Damage         12.53
 *     M.Attack             2.99
 *     M.Attack%           53.59
 *     Critical Dmg        41.26
 *     Ignore Dff(300)      3.8
 *     Ignore Dff(380)      4.86
 *     INT                  1
 *     INT%                12.21
 *     Not Affected by % INT 0.14
 *     LUK                  0.1
 *     LUK%                 1.64
 *     All Stat%           13.84
 *
 * These are local derivatives at the character's current gear, which is exactly
 * the right thing for pricing one marginal upgrade -- and a reason to re-paste
 * after any big change.
 * ======================================================================== */

const STAT_NAMES = ['STR', 'DEX', 'INT', 'LUK'];

// normalised label -> weight key. Exact matches only, so "Not Affected by % INT"
// can't be mistaken for "INT".
const SCOUTER_LABELS = {
  'str': 'stat.STR', 'dex': 'stat.DEX', 'int': 'stat.INT', 'luk': 'stat.LUK',
  'str%': 'pct.STR', 'dex%': 'pct.DEX', 'int%': 'pct.INT', 'luk%': 'pct.LUK',

  'not affected by % str': 'flat.STR',
  'not affected by % dex': 'flat.DEX',
  'not affected by % int': 'flat.INT',
  'not affected by % luk': 'flat.LUK',

  'all stat%': 'allStatPct',
  'all stats%': 'allStatPct',

  'attack': 'attFlat',
  'att': 'attFlat',
  'm.attack': 'mattFlat',
  'magic attack': 'mattFlat',
  'matt': 'mattFlat',

  'attack%': 'attPctPhys',
  'att%': 'attPctPhys',
  'm.attack%': 'attPctMagic',
  'magic attack%': 'attPctMagic',
  'matt%': 'attPctMagic',

  'boss damage': 'boss',
  'boss dmg': 'boss',
  'boss': 'boss',

  'critical dmg': 'critDmg',
  'critical damage': 'critDmg',
  'crit dmg': 'critDmg',

  'ignore dff(300)': 'ied300',
  'ignore dff(380)': 'ied380',
  'ignore def(300)': 'ied300',
  'ignore def(380)': 'ied380',
  'ied(300)': 'ied300',
  'ied(380)': 'ied380',

  'hp%': 'hpPct',
  'max hp%': 'hpPct',
  'hp': 'hpStat',
  'max hp': 'hpStat',
  'not affected by % hp': 'flat.HP',
};

// MapleScouter's own default amounts, so "fill defaults" matches an untouched page.
// One realistic line of each kind: a 12% stat line, a 9% all-stat line, 40% boss.
const SCOUTER_DEFAULT_AMOUNTS = {
  boss: 40, critDmg: 8, ied300: 40, ied380: 40,
  attFlat: 30, mattFlat: 30, attPctPhys: 12, attPctMagic: 12,
  hpStat: 30, hpPct: 12, 'flat.HP': 200,
  allStatPct: 9,
  'stat.STR': 30, 'stat.DEX': 30, 'stat.INT': 30, 'stat.LUK': 30,
  'pct.STR': 12, 'pct.DEX': 12, 'pct.INT': 12, 'pct.LUK': 12,
  'flat.STR': 200, 'flat.DEX': 200, 'flat.INT': 200, 'flat.LUK': 200,
};

function normLabel(s) {
  return s.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*%\s*$/, '%')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .trim();
}

/**
 * Parse a pasted table. Each line is a label then a number, separated by tabs or
 * runs of spaces. Returns the raw key/value map plus which rows were used, so the
 * UI can show anything it didn't recognise instead of silently dropping it.
 */
function parseScouter(text) {
  const raw = {};
  const rows = [];
  const amounts = {};   // only populated when the paste carried three columns
  let percent = false;

  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Last numeric token is the value, everything before it the label. The
    // trailing %? is needed for the Final Damage column, where every row ends in
    // "%"; without it those rows matched nothing and the tool rendered blank.
    //
    // Two numbers means the amount column came along, so the first is the amount.
    // Tried first, but only kept when it yields a label we recognise -- otherwise a
    // label ending in a bare number would eat its own last word as an amount.
    let label = null, amount = null, value = null, pct = '';
    const three = line.match(/^(.*?)[\t ]+(-?[\d.,]+)[\t ]+(-?[\d.,]+)\s*(%?)\s*$/);
    if (three && SCOUTER_LABELS[normLabel(three[1].trim())]) {
      label = three[1].trim();
      amount = parseFloat(three[2].replace(/,/g, ''));
      value = parseFloat(three[3].replace(/,/g, ''));
      pct = three[4];
    } else {
      const m = line.match(/^(.*?)[\t ]+(-?[\d.,]+)\s*(%?)\s*$/);
      if (!m) { rows.push({ label: line.trim(), value: null, key: null }); continue; }
      label = m[1].trim();
      value = parseFloat(m[2].replace(/,/g, ''));
      pct = m[3];
    }
    if (!isFinite(value)) { rows.push({ label, value: null, key: null }); continue; }
    if (pct) percent = true;

    const key = SCOUTER_LABELS[normLabel(label)] || null;
    if (key) {
      raw[key] = value;
      if (isFinite(amount) && amount > 0) amounts[key] = amount;
    }
    rows.push({ label, value, key, amount: isFinite(amount) ? amount : null });
  }
  return { raw, rows, percent, amounts };
}

/**
 * Which row sits at exactly 1 once amounts are divided out, or null if none does.
 *
 * The Main Stat column always has one -- it is what sets the scale, "INT" for a mage
 * and "HP" for a Demon Avenger, which has no natural stat to normalise against. It is
 * also the only thing separating per-point weights from per-line totals, since both
 * use identical row labels. Searched across every parsed row rather than just the
 * stats, because the normaliser is not always a stat.
 *
 * The Final Damage column normalises nothing, so this legitimately returns null for
 * it -- absence alone is not evidence of a mistake, which is why `suspectTotals`
 * needs a second signal.
 *
 * `weightOf` is buildWeights' amount-aware getter, so this asks about the effective
 * weight rather than the pasted number.
 */
function normaliserOf(parsed, weightOf) {
  for (const r of parsed.rows || []) {
    if (r.key && Math.abs(weightOf(r.key) - 1) <= 1e-6) return r.label;
  }
  return null;
}

/**
 * Build the weight set the engines consume.
 *
 * mainStat is normally detected as the largest stat weight -- MapleScouter
 * normalises the main stat to 1, and secondaries come out well below it. Pass an
 * override when a build makes that ambiguous.
 *
 * ied picks between the 300 and 380 def columns; which one is right depends on
 * the boss you are gearing for.
 */
function buildWeights(parsed, opts = {}) {
  const raw = parsed.raw || {};
  // Amounts divide the pasted per-line totals back down to per-point. A three-column
  // paste beats the UI inputs, since it came from the page itself. Everything at the
  // default 1 makes this the identity, so a per-point paste is untouched.
  const amountOf = (k) => {
    const fromPaste = Number((parsed.amounts || {})[k]);
    if (isFinite(fromPaste) && fromPaste > 0) return fromPaste;
    const fromUi = Number((opts.amounts || {})[k]);
    return isFinite(fromUi) && fromUi > 0 ? fromUi : 1;
  };
  const g = (k) => (k in raw ? Number(raw[k] || 0) / amountOf(k) : 0);

  let mainStat = opts.mainStat;
  if (!mainStat || !STAT_NAMES.includes(mainStat)) {
    mainStat = STAT_NAMES.reduce(
      (best, s) => (g('stat.' + s) > g('stat.' + best) ? s : best), 'STR');
  }

  // Star force raises every class-relevant stat by the same amount, so one point
  // of "Class Stat" is worth the sum of the stat weights -- 1 + 0.1 = 1.1 for a
  // mage, and correctly larger for a build like Xenon that uses three stats.
  const statPerPoint = STAT_NAMES.reduce((a, s) => a + g('stat.' + s), 0);

  const iedVariant = opts.iedVariant === 380 ? 380 : 300;

  // Both of these read the weights AFTER dividing, not the pasted numbers -- the
  // question is whether what the engines will consume is per-point, and that is only
  // true once the amounts are right. Dividing MapleScouter's defaults out of the Main
  // Stat column lands HP back on exactly 1, so the normaliser reappears and the
  // warning goes quiet by itself once the amounts are entered.
  const normaliser = normaliserOf(parsed, g);
  const values = (parsed.rows || [])
    .filter(r => r.key && isFinite(r.value)).map(r => Math.abs(g(r.key)));

  // Star force adds the same amount to every class-relevant stat, so it only ever
  // needs the sum. Flames don't: a single-stat line hits one stat while a combo
  // line hits two, so the per-stat split has to survive.
  const statByStat = {};
  for (const s of STAT_NAMES) statByStat[s] = g('stat.' + s);

  // % weight per individual stat, for classes where more than one stat's % lines
  // carry real value (Xenon runs on three). Single-stat classes only ever read
  // the main stat's entry.
  const pctByStat = {};
  for (const s of STAT_NAMES) pctByStat[s] = g('pct.' + s);

  return {
    mainStat,
    statPerPoint,
    statByStat,
    pctByStat,
    // Attack, whichever of the two the class actually uses -- a flame line
    // reads "Attack Power +N" or "Magic ATT +N" depending on the weapon, and only
    // one of the two weights is ever non-zero.
    attFlat: g('attFlat') || g('mattFlat'),

    // potential lines
    mainPct:    g('pct.' + mainStat),
    allStatPct: g('allStatPct'),
    attPct:     g('attPctPhys') + g('attPctMagic'),  // only one is ever non-zero
    boss:       g('boss'),
    ied:        iedVariant === 380 ? g('ied380') : g('ied300'),
    critDmg:    g('critDmg'),
    hpPct:      g('hpPct'),
    // max HP -- worthless to most classes, but it is Demon Avenger's whole
    // game: MathBro's DA flame branch scores hp_tier * hp_per_tier with no
    // equivalence multiplier at all, because HP IS the currency there.
    hpStat:     g('hpStat'),
    // Damage% IS boss damage%. Same weight, the only difference being that boss%
    // applies to bosses only -- which is all this tool is optimising for. MathBro
    // does the same: worker.js:755 multiplies both by one shared
    // `stat_equivalences.dmg`, differing only by boss counting 2 per flame tier to
    // damage's 1. MapleScouter never emits a separate damage row, so there is
    // nothing to parse and no fallback to arrange.
    dmgPct:     g('boss'),

    // attack from star force
    att:  g('attFlat'),
    matt: g('mattFlat'),

    iedVariant,
    // which value column arrived; only affects how columns are labelled
    unit: parsed.percent ? '%fd' : 'stat',
    // the row that set the scale -- "INT" for a mage, "HP" for a Demon Avenger.
    // null for the Final Damage column, which normalises nothing.
    normalizedTo: normaliser,
    // What each row was divided by, so the UI can show what is actually in force
    // rather than only what was typed. Keyed the same as the weights.
    amounts: Object.keys(raw).reduce((a, k) => (a[k] = amountOf(k), a), {}),
    amountsFromPaste: Object.keys(parsed.amounts || {}).length > 0,
    // Two independent signals that per-line totals were pasted with the amounts
    // still at 1: nothing sits at 1, and nothing is below 1 either (a real per-point
    // paste always carries small rows -- "Not Affected by %" lands near 0.1, and
    // secondary stats lower still). Requiring both keeps a legitimate paste from
    // being scolded on one coincidence. Only meaningful for the Main Stat column;
    // Final Damage normalises nothing and its rows are all sub-1 anyway, so it is
    // excluded rather than false-flagged -- a real gap, noted in the README.
    suspectTotals: !parsed.percent && !normaliser && values.length > 0
                   && Math.min.apply(null, values) > 1,
    // a pure-HP Demon Avenger paste has near-zero stat weights but is not empty
    empty: statPerPoint === 0 && !g('hpStat'),
  };
}

/**
 * Human-readable readout of what the weight set implies about the class. This is
 * the answer to "where is the class selector": the paste already encodes the
 * class, and this line makes the inference visible instead of magic.
 */
function weightsProfileText(w) {
  const flats = w.statByStat || {};
  // Thresholds are RELATIVE to the biggest weight, never absolute. The percent
  // format normalises nothing, so a Xenon's flats there are ~0.12 rather than ~1
  // and any fixed cutoff would misread every class.
  const top = Math.max(...STAT_NAMES.map(s => flats[s] || 0), 0);
  const primaries = STAT_NAMES.filter(s => top > 0 && (flats[s] || 0) >= 0.5 * top);
  const secondaries = STAT_NAMES.filter(s =>
    (flats[s] || 0) > 0 && !primaries.includes(s));
  const bits = [];
  // Demon Avenger scales off HP%, so HP% outweighing the stat's own % is the
  // scale-free signature -- true in both formats.
  if ((w.hpStat || 0) > 0 && (w.hpPct || 0) >= (w.mainPct || 0)) {
    bits.push('HP-based build (Demon Avenger)');
  } else if (primaries.length > 1) {
    bits.push(primaries.join('/') + ' all primary (Xenon-style)');
  } else {
    bits.push(`${w.mainStat} main` + (secondaries.length ? `, ${secondaries.join('/')} secondary` : ''));
  }
  bits.push(cubeStatCollapsed(w)
    ? 'main% and all-stat% priced as one currency'
    : 'all-stat% kept at its own, higher weight');
  const subs = cubeSubStats(w);
  if (subs.length) bits.push('counting ' + subs.map(s => s + '%').join(' and ') + ' potential lines');
  if ((w.hpStat || 0) > 0) bits.push('flat-HP flame lines valued');
  const divided = Object.keys(w.amounts || {}).filter(k => w.amounts[k] !== 1);
  if (divided.length) {
    bits.push(`${divided.length} row${divided.length > 1 ? 's' : ''} divided by `
      + `${w.amountsFromPaste ? 'amounts in the paste' : 'the amounts you set'}`);
  }
  if (w.suspectTotals) {
    bits.push('SCALE UNVERIFIED - no row lands on 1, so amounts are probably needed');
  } else {
    bits.push(w.unit === '%fd'
      ? 'the Final Damage column, so costs read as meso per 1% final damage'
      : `the Main Stat column, per point, scaled against ${w.normalizedTo || 'the main stat'} = 1`);
  }
  return bits.join(' · ');
}

/** Rows it did not recognise -- shown so a mapping gap is visible, not silent. */
function scouterUnknownRows(parsed) {
  return (parsed.rows || []).filter(r => !r.key);
}

const SCOUTER_EXAMPLE = `Boss Damage\t\t12.53
M.Attack\t\t2.99
M.Attack%\t\t53.59
Critical Dmg\t\t41.26
Ignore Dff(300)\t\t3.8
Ignore Dff(380)\t\t4.86
INT\t\t1
INT%\t\t12.21
Not Affected by % INT\t\t0.14
LUK\t\t0.1
LUK%\t\t1.64
Not Affected by % LUK\t\t0.04
All Stat%\t\t13.84`;
