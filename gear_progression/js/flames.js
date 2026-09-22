/* ===========================================================================
 * Flames (bonus stats).
 *
 * Every constant here is taken from MathBro's flame calculator, specifically
 * reference/MathBro's Flaming Calculator_files/worker.js -- NOT from the copy of
 * the same tables in main_IRbm.js, which disagrees on `reincarnation`
 * (main has 4:0/7:0.03, worker has 4:0.01/7:0.02). worker.js is the file that
 * actually computes, so it wins. worker.js in turn cites
 * strategywiki.org/wiki/MapleStory/Bonus_Stats#Flame_Advantage.
 *
 * The mechanics, from getLineProbability() and worker.js:755:
 *
 *   - A flame-advantaged item rolls exactly 4 lines, drawn as a uniform 4-subset
 *     of 19 possible bonus-stat slots (21 on a weapon, which adds boss% and
 *     damage%).
 *   - A non-advantaged item rolls 1/2/3/4 lines at 40/40/15/5%, and every tier
 *     shifts DOWN by two, so the range becomes 1-5 instead of 3-7. Both effects
 *     together make advantage worth a great deal.
 *   - Each line's tier is drawn independently from the flame type's distribution.
 *
 * Bonus stats can now be reset for a flat meso price as well as by burning a
 * flame item, so flames DO have a meso denominator and can be ranked next to
 * star force and cubing. See FLAME_RESET_MESO below. The separate flames panel
 * still ranks by stat gained per reroll, which is the right question when you
 * are spending flames you already own rather than mesos.
 *
 * Classes fall out of the weights rather than a dropdown. MathBro needs per-class
 * branches (choose_from = 10 / 8 / 8 junk slots for a standard class / Xenon /
 * DB-Shadower-Cadena) because he asks for hand-typed equivalences; here every
 * single-stat slot is valued at stat[s] and every combo pair at stat[a]+stat[b],
 * so Xenon's double-counted pairs and a Shadower's DEX/STR secondaries emerge on
 * their own, and the tracked/junk splits land on his constants by construction.
 * Kanna was reworked into a standard mage and needs nothing special.
 * ======================================================================== */

// tier -> probability, per flame type. Advantaged range is 3-7.
const FLAME_TIER_PROBS = {
  drop:          { 3: 0.25, 4: 0.3,  5: 0.3,  6: 0.14, 7: 0.01 },
  powerful:      { 3: 0.2,  4: 0.3,  5: 0.36, 6: 0.14, 7: 0    },
  eternal:       { 3: 0,    4: 0.29, 5: 0.45, 6: 0.25, 7: 0.01 },
  reincarnation: { 3: 0,    4: 0.01, 5: 0.63, 6: 0.34, 7: 0.02 },
  fusion:        { 3: 0.5,  4: 0.4,  5: 0.1,  6: 0,    7: 0    },
  masterFusion:  { 3: 0.25, 4: 0.35, 5: 0.3,  6: 0.1,  7: 0    },
  meisterFusion: { 3: 0,    4: 0.4,  5: 0.45, 6: 0.14, 7: 0.01 },
};

/*
 * The flame types actually offered, in dropdown order.
 *
 * Keys stay as worker.js names them so the tables above remain traceable to their
 * source and saved state keeps working -- `reincarnation` is the in-game Abyssal
 * flame, which is what it is labelled here.
 *
 * The other four types worker.js carries (dropped, fusion, master fusion, meister
 * fusion) keep their data in FLAME_TIER_PROBS but are not offered: not worth
 * cluttering the picker with flames that aren't used. Add a line here to surface
 * one again.
 */
const FLAME_TYPES = [
  ['eternal', 'eternal (rainbow/black)'],
  ['powerful', 'powerful (red)'],
  ['reincarnation', 'abyssal'],
];

const FLAME_TYPE_LABELS = Object.fromEntries(FLAME_TYPES);

/** Fall back to eternal for a type that is no longer offered. */
function flameTypeOrDefault(t) {
  return FLAME_TYPE_LABELS[t] ? t : 'eternal';
}

// line count on a non-advantaged item
const FLAME_LINES_NON_ADV = { 1: 0.40, 2: 0.40, 3: 0.15, 4: 0.05 };

// [minLevel, maxLevel, valuePerTier]
const FLAME_STAT_PER_TIER = [
  [120, 139, 7], [140, 159, 8], [160, 179, 9], [180, 199, 10],
  [200, 229, 11], [230, 249, 12], [250, Infinity, 12],
];
const FLAME_COMBO_PER_TIER = [
  [120, 139, 4], [140, 159, 4], [160, 179, 5], [180, 199, 5],
  [200, 229, 6], [230, 249, 6], [250, Infinity, 7],
];

// Flat max-HP flame line, per tier. Ten-level brackets, unlike the stat tables.
// This is Demon Avenger's score: worker.js's da branch (line 871) is
// attack_gain + hp_tier * hp_stat_per_tier, no equivalence multiplier.
const FLAME_HP_PER_TIER = [
  [120, 129, 360], [130, 139, 390], [140, 149, 420], [150, 159, 450],
  [160, 169, 480], [170, 179, 510], [180, 189, 540], [190, 199, 570],
  [200, 209, 600], [210, 219, 620], [220, 229, 640], [230, 239, 660],
  [240, 249, 680], [250, Infinity, 700],
];

// weapon attack flame, as a fraction of the weapon's base attack
const FLAME_WATT_ADV = {
  '160-199': { 3: 0.15, 4: 0.22,  5: 0.3025, 6: 0.3993,  7: 0.512435 },
  '200+':    { 3: 0.18, 4: 0.264, 5: 0.363,  6: 0.47916, 7: 0.614922 },
};
const FLAME_WATT_NON_ADV = {
  '160-199': { 1: 0.05, 2: 0.11,  3: 0.185,  4: 0.2662,  5: 0.366025, 6: 0.43923,  7: 0.512435 },
  '200+':    { 1: 0.06, 2: 0.132, 3: 0.2178, 4: 0.31944, 5: 0.43923,  6: 0.527076, 7: 0.614922 },
};

// boss damage is 2 points per tier, plain damage 1 (worker.js:755)
const FLAME_BOSS_PER_TIER = 2;
const FLAME_DMG_PER_TIER = 1;

// Total bonus-stat slots a roll draws from. Exactly two pools exist: a weapon rolls
// from 21 (the 19 plus boss% and damage%), everything else from 19. Level changes
// the per-tier values, never the pool.
const FLAME_SLOTS_ARMOR = 19;
const FLAME_SLOTS_WEAPON = 21;

const FLAME_STATS = ['STR', 'DEX', 'INT', 'LUK'];

function flameBracket(table, level) {
  for (const [lo, hi, v] of table) if (level >= lo && level <= hi) return v;
  return level > 250 ? table[table.length - 1][2] : 0;
}

/** Tier -> probability, shifted down by 2 for a non-advantaged item. */
function flameTierProbs(flameType, nonAdvantaged) {
  const base = FLAME_TIER_PROBS[flameType] || FLAME_TIER_PROBS.eternal;
  if (!nonAdvantaged) return base;
  const out = {};
  for (const t in base) out[Number(t) - 2] = base[t];
  return out;
}

function _comb(n, r) {
  if (r < 0 || r > n) return 0;
  let v = 1;
  for (let i = 0; i < r; i++) v = v * (n - i) / (i + 1);
  return v;
}

/**
 * The bonus-stat slots worth anything to this character, each with the value it
 * contributes at a given tier.
 *
 * Only nonzero slots are enumerated; everything else is left in the junk pool.
 * That is self-consistent for any weight set -- P(a specific k-subset of the
 * tracked slots is present) = C(junk, lines-k)/C(total, lines), and Vandermonde's
 * identity makes those sum to 1 regardless of how many slots are tracked.
 *
 * Sanity check on the inventory: for a mage the tracked slots come to exactly 9
 * (main, secondary, the 5 pairs containing one of them, all-stat, MATT), leaving
 * 10 junk out of 19 -- which is precisely the `choose_from = 10` constant in
 * MathBro's own code.
 */
function flameTrackedSlots(kind, level, w, opts = {}) {
  const { baseAtt = 0, nonAdvantaged = false } = opts;
  const isWeapon = kind === 'weapon' || kind === 'secondary';
  const stat = w.statByStat || {};
  const statPer = flameBracket(FLAME_STAT_PER_TIER, level);
  const comboPer = flameBracket(FLAME_COMBO_PER_TIER, level);
  const slots = [];
  const lin = (label, coeff) => {
    if (coeff) slots.push({ label, at: (t) => coeff * t });
  };

  for (const s of FLAME_STATS) lin(s, statPer * (stat[s] || 0));

  // combo lines grant the combo amount to BOTH stats in the pair
  for (let i = 0; i < FLAME_STATS.length; i++) {
    for (let j = i + 1; j < FLAME_STATS.length; j++) {
      const a = FLAME_STATS[i], b = FLAME_STATS[j];
      lin(`${a}+${b}`, comboPer * ((stat[a] || 0) + (stat[b] || 0)));
    }
  }

  lin('all stat', w.allStatPct);

  // flat max HP -- Demon Avenger's whole game, zero weight for everyone else,
  // in which case it stays untracked and the junk count is unaffected
  lin('HP', flameBracket(FLAME_HP_PER_TIER, level) * (w.hpStat || 0));

  if (isWeapon) {
    // weapon attack is a fraction of base attack and the fractions are not
    // linear in tier, so this slot needs the table rather than a coefficient
    const tbl = (nonAdvantaged ? FLAME_WATT_NON_ADV : FLAME_WATT_ADV)[
      level >= 200 ? '200+' : '160-199'];
    for (const [label, weight] of [['ATT', w.att], ['MATT', w.matt]]) {
      if (weight) {
        slots.push({ label, at: (t) => baseAtt * (tbl[t] || 0) * weight });
      }
    }
    lin('boss', FLAME_BOSS_PER_TIER * w.boss);
    lin('damage', FLAME_DMG_PER_TIER * (w.dmgPct || 0));
  } else {
    lin('ATT', w.att);
    lin('MATT', w.matt);
  }

  return slots;
}

/**
 * Full distribution of the flame score a reroll produces, as a sorted array of
 * { score, prob }. Exact, not sampled: at most sum over k of C(|tracked|,k)*5^k
 * outcomes, which is about 90k for armour and 150k for a weapon.
 */
// ~38k leaves per slot, and the distribution is independent of what the item
// already has, so cache it and let only flameReroll() re-run while typing.
const _flameCache = new Map();

function flameCacheClear() { _flameCache.clear(); }

function flameDistributionCached(kind, level, w, opts = {}) {
  // Every weight field flameTrackedSlots reads must be in here, or two characters that
  // differ only in an omitted one share a wrong distribution. hpStat was missing, which
  // meant a Demon Avenger and a mage with otherwise identical listed weights collided --
  // latent while only one character was ever computed per session, and reachable the
  // moment the compare panel started switching between them.
  const key = [kind, level, opts.flameType, !!opts.nonAdvantaged, opts.baseAtt || 0,
               w.mainStat, w.allStatPct, w.att, w.matt, w.boss, w.dmgPct || 0,
               w.hpStat || 0,
               JSON.stringify(w.statByStat || {})].join('|');
  let hit = _flameCache.get(key);
  if (!hit) {
    hit = flameDistribution(kind, level, w, opts);
    _flameCache.set(key, hit);
  }
  return hit;
}

function flameDistribution(kind, level, w, opts = {}) {
  const { flameType = 'eternal', nonAdvantaged = false } = opts;
  const isWeapon = kind === 'weapon' || kind === 'secondary';
  const total = isWeapon ? FLAME_SLOTS_WEAPON : FLAME_SLOTS_ARMOR;

  const tracked = flameTrackedSlots(kind, level, w, opts);
  const junk = total - tracked.length;
  if (junk < 0) return [];

  const tp = flameTierProbs(flameType, nonAdvantaged);
  const tiers = Object.keys(tp).map(Number).filter(t => tp[t] > 0);

  const lineCounts = nonAdvantaged ? FLAME_LINES_NON_ADV : { 4: 1 };

  // P(exactly k of the tracked slots appear), summed over how many lines rolled
  const subsetProb = [];
  for (let k = 0; k <= 4; k++) {
    let p = 0;
    for (const L in lineCounts) {
      const n = Number(L);
      if (k > n) continue;
      p += lineCounts[L] * _comb(junk, n - k) / _comb(total, n);
    }
    subsetProb[k] = p;
  }

  const acc = new Map();
  const add = (score, prob) => {
    if (prob <= 0) return;
    const key = Math.round(score * 100) / 100;
    acc.set(key, (acc.get(key) || 0) + prob);
  };

  // Walk every subset of the tracked slots up to size 4, with every tier
  // assignment. Emit ONLY at a leaf -- once every tracked slot has been decided
  // present or absent. Emitting at interior nodes as well would count a partial
  // subset and then count its own extensions again, which inflates the total mass
  // (it read 3.90 instead of 1 before this was fixed).
  const walk = (idx, chosen, score, prob) => {
    if (idx >= tracked.length || chosen === 4) {
      // any remaining slots are implicitly absent, so this is one complete outcome
      add(score, prob * subsetProb[chosen]);
      return;
    }
    walk(idx + 1, chosen, score, prob);                 // slot absent
    for (const t of tiers) {                            // slot present at tier t
      walk(idx + 1, chosen + 1, score + tracked[idx].at(t), prob * tp[t]);
    }
  };
  walk(0, 0, 0, 1);

  return [...acc.entries()]
    .map(([score, prob]) => ({ score, prob }))
    .sort((a, b) => a.score - b.score);
}

/**
 * What one reroll is worth against what the item already has.
 *
 * gainPerRoll is E[max(0, new - current)] -- you keep the better outcome, so a
 * worse roll costs nothing but the flame. That is the figure the flame table
 * ranks on. rollsToBeat is the mean of the geometric distribution, i.e. how many
 * flames it takes to see any improvement at all.
 */
function flameReroll(dist, currentValue = 0) {
  let mass = 0, eScore = 0, pImprove = 0, gain = 0, best = 0;
  for (const { score, prob } of dist) {
    mass += prob;
    eScore += prob * score;
    best = Math.max(best, score);
    if (score > currentValue) {
      pImprove += prob;
      gain += prob * (score - currentValue);
    }
  }
  return {
    mass,                     // must be 1; exposed so the self test can assert it
    expected: eScore,
    max: best,
    pImprove,
    gainPerRoll: gain,
    rollsToBeat: pImprove > 0 ? 1 / pImprove : Infinity,
    expectedIfBetter: pImprove > 0 ? gain / pImprove + currentValue : 0,
  };
}

/* ------------------------------------------------------------- meso reset ---
 *
 * Bonus stats can be reset for a flat meso price instead of consuming a flame
 * item. That is what lets flames into the main ranking at all: its denominator
 * is meso per point of main stat, and until this existed a flame had no meso
 * price to divide by.
 *
 * Two things from the patch note drive everything here.
 *
 *   - It costs FLAME_RESET_MESO per reset.
 *   - "The reset rates are identical to Black Rebirth Flames", i.e. the
 *     `eternal` distribution above -- NOT whichever flame the slot is set to in
 *     the flames panel. That panel is about flames you own; this is about
 *     mesos, so it always prices the eternal rates.
 *
 * Flame advantage is still taken from the slot: it is a property of the item and
 * class pairing, not of the flame item being consumed, so the meso reset does
 * not change it.
 */
const FLAME_RESET_MESO = 3000000;
const FLAME_RESET_TYPE = 'eternal';

/**
 * Cost and gain of "reset until it beats what is there, then keep it".
 *
 * The patch lets you choose whether to apply the new bonus stats, so a bad reset
 * costs only the mesos -- exactly the E[max(0, new - now)] that flameReroll
 * already models, which is why no new probability work is needed here.
 *
 * Both the cost and the gain scale with how many resets it takes, and the
 * scaling cancels:
 *
 *   E[resets] = 1 / p
 *   E[cost]   = price / p
 *   E[gain]   = gainPerRoll / p     (the gain given that you stopped on an improvement)
 *   per       = cost / gain         = price / gainPerRoll
 *
 * So the headline meso-per-point does not depend on how many resets it takes --
 * only on how much one reset adds on average. rollsToBeat still sets the cost
 * column, because that is the meso the plan actually consumes.
 *
 * `pct` follows the ranking's percentile box: blank is the mean number of
 * resets, 85 is enough resets to be 85% sure of seeing an improvement. Exact
 * rather than fitted, because reset count is geometric -- the same footing as
 * the cube percentile, not the lognormal star force one.
 */
function flameResetPlan(reroll, pct = 0, price = FLAME_RESET_MESO) {
  // pImprove 0 means the item already holds the best roll the pool can produce,
  // so there is nothing to buy at any price.
  if (!(reroll.pImprove > 0) || !(reroll.gainPerRoll > 0)) {
    return { resets: Infinity, cost: Infinity, gain: 0, per: Infinity };
  }
  const resets = pct ? geometricPct(reroll.pImprove, pct) : reroll.rollsToBeat;
  const gain = reroll.gainPerRoll / reroll.pImprove;
  const cost = resets * price;
  return { resets, cost, gain, per: cost / gain };
}

/*
 * The six numbers a flame can contribute, as read straight off the item.
 * Keys are the per-slot state fields; the label is the column heading.
 */
/*
 * One column per stat, not Main/Sec. Main/Sec was a two-stat worldview: the Sec
 * column multiplied a single typed number by the SUM of every non-main weight,
 * which is only correct when exactly one secondary exists (a mage's LUK). A
 * Xenon has three primaries and a Shadower two secondaries with different
 * weights -- their flames were impossible to enter correctly. Per-stat columns
 * are exact for every class, and the ones the paste gives no weight to are
 * hidden, so each class only ever sees its own stats.
 */
const FLAME_INPUTS = [
  ['fSTR',  'STR',   'flat STR from the flame'],
  ['fDEX',  'DEX',   'flat DEX from the flame'],
  ['fINT',  'INT',   'flat INT from the flame'],
  ['fLUK',  'LUK',   'flat LUK from the flame'],
  ['fAtt',  'Atk',   'flat attack or magic attack'],
  ['fHp',   'HP',    'flat max HP (Demon Avenger)'],
  ['fAll',  'All%',  'all stat %'],
  ['fDmg',  'Dmg%',  'damage %'],
  ['fBoss', 'Boss%', 'boss damage %'],
];

// stat and HP columns disappear entirely when the paste gives them no weight;
// the rest stay visible and merely warn if filled against a zero weight
const FLAME_INPUTS_HIDEABLE = new Set(['fSTR', 'fDEX', 'fINT', 'fLUK', 'fHp']);

/**
 * What an item's existing flame is worth, from the amounts shown on the item.
 *
 * Replaces asking for one pre-computed score: these are numbers readable straight
 * off the equip window, converted with the same weights the reroll distribution
 * uses, so "now" and "after" sit on one scale by construction.
 */
function flameCurrentValue(f, w) {
  if (!f) return 0;
  let total = 0;
  for (const [key] of FLAME_INPUTS) {
    total += Number(f[key] || 0) * flameInputWeight(key, w);
  }
  return total;
}

/**
 * The flame in main-stat points -- the figure people quote as a "flame score".
 *
 * Every other column follows the paste's unit, which for a Final Damage paste is
 * %fd: a strong flame reads "1.32", which means nothing to anyone used to hearing
 * "130 flame score". Dividing by the main stat's own weight -- %fd per point in
 * that mode, exactly 1 in stat mode -- recovers the familiar number. So in stat
 * mode this equals Now, and in %fd mode it is Now translated. Either way it is
 * invariant to how the paste was scaled, which is the property that makes it
 * comparable across characters and between pastes.
 *
 * Demon Avenger's currency is HP, and hpStat is the one stat weight that
 * dominates only for that class, so the larger of the two decides. Zero means the
 * paste carries no row to convert with, and there is no honest number to show.
 */
function flameScoreDivisor(w) {
  if (!w) return 0;
  const main = (w.statByStat && w.statByStat[w.mainStat]) || 0;
  return Math.max(main, w.hpStat || 0);
}

function flameScore(value, w) {
  const d = flameScoreDivisor(w);
  return d > 0 ? value / d : NaN;
}

/**
 * The weight one point of a given flame input converts at.
 *
 * Single source of truth so the UI can warn about a weight of zero using exactly
 * the number the valuation uses. A zero here means the amount typed in that column
 * contributes nothing -- which is the case for Dmg% unless the MapleScouter paste
 * actually carries a damage weight, since most of them don't.
 */
function flameInputWeight(key, w) {
  switch (key) {
    case 'fSTR': case 'fDEX': case 'fINT': case 'fLUK':
      return (w.statByStat && w.statByStat[key.slice(1)]) || 0;
    case 'fAtt':  return w.attFlat || 0;
    case 'fHp':   return w.hpStat || 0;
    case 'fAll':  return w.allStatPct || 0;
    case 'fDmg':  return w.dmgPct || 0;
    case 'fBoss': return w.boss || 0;
    default:      return 0;
  }
}

/**
 * Slots that can carry flames.
 *
 * Armour, the weapon, the accessories, the pocket item and the medal. Note what is
 * NOT here, all three confirmed rather than assumed:
 *
 *   secondary -- takes potential but no flames, despite sitting beside the weapon
 *                everywhere else in this tool
 *   shoulder  -- no flames, even though it is part of the armour set and every
 *                other piece of that set does take them
 *   emblem    -- no flames
 *   rings     -- no flames, even though pendants and earrings do take them
 *
 * The pocket item is flame-only: it takes no potential (see SLOTS in app.js) but
 * does take bonus stats.
 *
 * There are only two bonus-stat pools: weapons and everything else. Which one
 * applies depends on the equip being a weapon, and the *values* then scale with
 * item level -- there is no per-slot pool. So accessories, the pocket item and the
 * medal all correctly share the 19-slot non-weapon pool with armour; that is the
 * rule, not an approximation standing in for missing data.
 */
const FLAMEABLE = new Set([
  'hat', 'top', 'bottom', 'shoes', 'gloves', 'cape', 'belt',
  'weapon',
  'face', 'eye', 'ear', 'pend1', 'pend2',
  'pocket', 'medal',
]);

/* ------------------------------------------------------------------ sampling
 *
 * flameDistribution enumerates only the slots worth something to this
 * character and lumps everything else together as "junk", which is all the
 * ranking needs. A simulator has to show a roll the way the game does --
 * "Jump +6", "Max MP +2880", "Reduced level requirement -25" -- so it needs the
 * whole named pool, junk included.
 *
 * The valued lines use the same per-tier amounts as flameTrackedSlots, so a
 * sample's worth (flameSampleValue) is drawn from exactly the distribution the
 * ranking integrates over; check_js.py asserts the two agree to within sampling
 * error. The junk lines carry weight 0 everywhere, so their amounts are
 * display-only. They come from StrategyWiki's Bonus Stats page and were
 * cross-checked against a recording of the reset dialog on a lv160 item:
 * DEF +54 is 6 x 9, Speed +5 is tier 5, level requirement -25 is 5 x 5,
 * Max MP +2880 is 6 x 480.
 *
 * The game shows a fifth number beside the flame icon -- 23, 20, 22 in that
 * recording -- and it is simply the sum of the four line tiers (max 28). It is
 * exposed as tierTotal because it is what people compare in-game, and because
 * the recording caught it going DOWN (23 -> 22) on a roll that was better: the
 * tier total ignores which stats the character actually uses.
 */

/** Weapon attack per tier is a fraction of base attack and not linear in tier. */
function flameWeaponAttFrac(level, tier, nonAdvantaged) {
  const tbl = (nonAdvantaged ? FLAME_WATT_NON_ADV : FLAME_WATT_ADV)[
    level >= 200 ? '200+' : '160-199'];
  return tbl[tier] || 0;
}

const _statAmt  = (lv, t) => flameBracket(FLAME_STAT_PER_TIER, lv) * t;
const _comboAmt = (lv, t) => flameBracket(FLAME_COMBO_PER_TIER, lv) * t;
const _hpAmt    = (lv, t) => flameBracket(FLAME_HP_PER_TIER, lv) * t;
const _attAmt   = (lv, t, c) => c.isWeapon ? c.baseAtt * flameWeaponAttFrac(lv, t, c.nonAdvantaged) : t;

// Every line a bonus-stat roll can produce. `stats` is the stat(s) a line credits
// in the Total Value box -- a combo credits both. Pool order here is only an
// inventory; the game lists a roll's lines in the order they came out.
const FLAME_LINES = [
  { key: 'STR', label: 'STR', stats: ['STR'], amount: _statAmt },
  { key: 'DEX', label: 'DEX', stats: ['DEX'], amount: _statAmt },
  { key: 'INT', label: 'INT', stats: ['INT'], amount: _statAmt },
  { key: 'LUK', label: 'LUK', stats: ['LUK'], amount: _statAmt },
  { key: 'STR+DEX', label: 'STR, DEX', stats: ['STR', 'DEX'], amount: _comboAmt },
  { key: 'STR+INT', label: 'STR, INT', stats: ['STR', 'INT'], amount: _comboAmt },
  { key: 'STR+LUK', label: 'STR, LUK', stats: ['STR', 'LUK'], amount: _comboAmt },
  { key: 'DEX+INT', label: 'DEX, INT', stats: ['DEX', 'INT'], amount: _comboAmt },
  { key: 'DEX+LUK', label: 'DEX, LUK', stats: ['DEX', 'LUK'], amount: _comboAmt },
  { key: 'INT+LUK', label: 'INT, LUK', stats: ['INT', 'LUK'], amount: _comboAmt },
  { key: 'HP',    label: 'Max HP',       amount: _hpAmt },
  { key: 'MP',    label: 'Max MP',       amount: _hpAmt },
  { key: 'DEF',   label: 'Defense',      amount: _statAmt },
  { key: 'ATT',   label: 'Attack Power', amount: _attAmt },
  { key: 'MATT',  label: 'Magic ATT',    amount: _attAmt },
  { key: 'SPEED', label: 'Speed',        amount: (lv, t) => t },
  { key: 'JUMP',  label: 'Jump',         amount: (lv, t) => t },
  { key: 'ALL',   label: 'All Stats',    amount: (lv, t) => t, suffix: '%' },
  { key: 'LEVEL', label: 'Reduced level requirement', amount: (lv, t) => -5 * t },
  { key: 'BOSS',  label: 'Boss Damage',  amount: (lv, t) => FLAME_BOSS_PER_TIER * t, suffix: '%', weaponOnly: true },
  { key: 'DMG',   label: 'Damage',       amount: (lv, t) => FLAME_DMG_PER_TIER * t, suffix: '%', weaponOnly: true },
];

const FLAME_LINE_BY_KEY = Object.fromEntries(FLAME_LINES.map(l => [l.key, l]));

/** The lines an item of this kind can roll: 19 for armour, 21 for a weapon. */
function flamePool(kind) {
  const isWeapon = kind === 'weapon' || kind === 'secondary';
  return FLAME_LINES.filter(l => isWeapon || !l.weaponOnly);
}

/**
 * Deterministic RNG (mulberry32) for reproducible runs and testable sampling.
 * Returns a function like Math.random.
 */
function flameRng(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw a key from a {key: probability} table. */
function _flamePick(probs, rng) {
  const r = rng();
  let acc = 0, last = null;
  for (const k of Object.keys(probs)) {
    const p = probs[k];
    if (p <= 0) continue;
    acc += p;
    last = Number(k);
    if (r < acc) return last;
  }
  return last;   // rounding left r a hair above the total
}

function _flameLine(def, level, tier, ctx) {
  return {
    key: def.key, label: def.label, tier,
    amount: def.amount(level, tier, ctx),
    suffix: def.suffix || '',
    stats: def.stats || null,
  };
}

function _flameCtx(kind, opts) {
  return {
    isWeapon: kind === 'weapon' || kind === 'secondary',
    nonAdvantaged: !!opts.nonAdvantaged,
    baseAtt: Number(opts.baseAtt) || 0,
  };
}

/**
 * One bonus-stat roll, as the game would show it.
 *
 * Mechanics as documented at the top of this file: an advantaged item rolls
 * exactly 4 lines, a non-advantaged one 1-4 at 40/40/15/5%; lines are a uniform
 * subset of the pool (no line twice); each line's tier is independent, drawn
 * from the flame type's table, shifted down two when non-advantaged.
 */
function flameSample(kind, level, opts = {}, rng = Math.random) {
  const { flameType = 'eternal', nonAdvantaged = false } = opts;
  const pool = flamePool(kind);
  const ctx = _flameCtx(kind, opts);
  const count = nonAdvantaged ? _flamePick(FLAME_LINES_NON_ADV, rng) : 4;

  // uniform subset without replacement: a partial Fisher-Yates over the indices
  const idx = pool.map((_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }

  const tp = flameTierProbs(flameType, nonAdvantaged);
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(_flameLine(pool[idx[i]], level, _flamePick(tp, rng), ctx));
  }
  return {
    lines,
    count,
    tierTotal: lines.reduce((a, l) => a + l.tier, 0),
  };
}

/**
 * A flame from explicit [{key, tier}] picks -- how the BEFORE side is entered,
 * and what "use the AFTER" turns a sample back into. Unknown keys and keys the
 * item kind can't roll are dropped, so a weapon-only line disappears when the
 * kind is switched to armour rather than lingering as a phantom.
 */
function flameCompose(kind, level, opts = {}, picks = []) {
  const pool = flamePool(kind);
  const allowed = new Set(pool.map(l => l.key));
  const ctx = _flameCtx(kind, opts);
  const lines = [];
  for (const p of picks) {
    const def = FLAME_LINE_BY_KEY[p && p.key];
    const tier = Number(p && p.tier);
    if (!def || !allowed.has(def.key) || !(tier >= 1 && tier <= 7)) continue;
    lines.push(_flameLine(def, level, tier, ctx));
  }
  return { lines, count: lines.length, tierTotal: lines.reduce((a, l) => a + l.tier, 0) };
}

// Order the game's Total Value box uses, as far as the recording shows it.
const FLAME_TOTAL_ORDER = ['STR', 'DEX', 'INT', 'LUK', 'HP', 'MP', 'ATT', 'MATT',
                           'DEF', 'SPEED', 'JUMP', 'ALL', 'BOSS', 'DMG', 'LEVEL'];

/** Per-stat totals of a sample, combos credited to both of their stats. */
function flameSampleTotals(sample) {
  const t = {};
  for (const l of (sample && sample.lines) || []) {
    for (const k of l.stats || [l.key]) t[k] = (t[k] || 0) + l.amount;
  }
  return t;
}

/**
 * The flame-table inputs a sample corresponds to, so it can be valued with the
 * same flameCurrentValue the ranking uses -- one scale by construction.
 *
 * The table has a single attack column, weighted by whichever of the two the
 * class uses. Only the matching line counts; the other is junk here, exactly as
 * flameTrackedSlots treats it (a mage rolling "Attack Power +6" gains nothing).
 */
function flameSampleToInputs(sample, w) {
  const t = flameSampleTotals(sample);
  return {
    fSTR: t.STR || 0, fDEX: t.DEX || 0, fINT: t.INT || 0, fLUK: t.LUK || 0,
    fAtt: ((w && w.att) ? (t.ATT || 0) : 0) + ((w && w.matt) ? (t.MATT || 0) : 0),
    fHp: t.HP || 0, fAll: t.ALL || 0, fDmg: t.DMG || 0, fBoss: t.BOSS || 0,
  };
}

function flameSampleValue(sample, w) {
  return sample ? flameCurrentValue(flameSampleToInputs(sample, w), w) : 0;
}
