/* ===========================================================================
 * Cubing: probability of rolling a target line combo on a legendary item.
 *
 * The line pools, prime probabilities and cube costs below are a direct port of
 * ../backend/maple_cubing/cubing.py, which is the source of truth. cubeProb()
 * reproduces its calc_prob() exactly and is checked against it by
 * tools/verify_cubing.py.
 *
 * What the model is: an already-legendary 3-line item being rerolled. Line 1 is
 * always a prime (legendary-tier) roll; lines 2 and 3 are prime with probability
 * prime_prob[1] / prime_prob[2] and otherwise roll from the unique pool. Every
 * line that isn't one of the listed desirable outcomes collapses into "Zero".
 *
 * Tier-ups are deliberately not modelled -- at the point you need this tool,
 * getting an item to legendary is not the expensive part.
 * ======================================================================== */

// [nameOfLine, valuePercent, probability] per tier pool.
// Fractions kept as division so they stay checkable against cubing.py.
//
// ONE DELIBERATE DIVERGENCE FROM cubing.py -- see hat.unique below.
const CUBE_POOLS = {
  hat: {
    // cubing.py has Zero at 41/52 here, which makes this pool sum to 56/52 =
    // 1.0769 instead of 1. It is the only one of the 22 pools that doesn't sum
    // to exactly 1, and the inflated mass made every hat target read ~13%
    // cheaper than it is. The desirable lines are 5+4+6 = 15, so Zero must be
    // 52-15 = 37; bottom.unique and shoes.unique have this identical 5/4/6
    // shape with 37/52. The stray 41 matches gloves.unique's 41/56, so it looks
    // like a copy-paste slip in cubing.py rather than real data.
    // Corrected here. tools/verify_cubing.py checks parity against the raw
    // value and asserts every pool sums to 1 after the fix.
    unique: [['main_stats',9,5/52],['all_stats',6,4/52],['HP',9,6/52],['Zero',0,37/52]],
    leg:    [['main_stats',12,4/41],['all_stats',9,3/41],['HP',12,4/41],['CD',-2,2/41],['CD',-1,3/41],['Zero',0,25/41]],
  },
  top: {
    unique: [['main_stats',9,5/62],['all_stats',6,4/62],['HP',9,6/62],['Zero',0,47/62]],
    leg:    [['main_stats',12,4/39],['all_stats',9,3/39],['HP',12,4/39],['Zero',0,28/39]],
  },
  bottom: {
    unique: [['main_stats',9,5/52],['all_stats',6,4/52],['HP',9,6/52],['Zero',0,37/52]],
    leg:    [['main_stats',12,4/33],['all_stats',9,3/33],['HP',12,4/33],['Zero',0,22/33]],
  },
  gloves: {
    unique: [['main_stats',9,5/56],['all_stats',6,4/56],['HP',9,6/56],['Zero',0,41/56]],
    leg:    [['main_stats',12,4/40],['all_stats',9,3/40],['HP',12,4/40],['Crit DMG',8,4/40],['Zero',0,25/40]],
  },
  shoes: {
    unique: [['main_stats',9,5/52],['all_stats',6,4/52],['HP',9,6/52],['Zero',0,37/52]],
    leg:    [['main_stats',12,4/36],['all_stats',9,3/36],['HP',12,4/36],['Zero',0,25/36]],
  },
  cape_belt_shoulder: {
    unique: [['main_stats',9,5/48],['all_stats',6,4/48],['HP',9,6/48],['Zero',0,33/48]],
    leg:    [['main_stats',12,4/33],['all_stats',9,3/33],['HP',12,4/33],['Zero',0,22/33]],
  },
  acc: {
    unique: [['main_stats',9,5/40],['all_stats',6,4/40],['HP',9,6/40],['Zero',0,25/40]],
    leg:    [['main_stats',12,4/39],['all_stats',9,3/39],['HP',12,4/39],['Drop',20,3/39],['Meso',20,3/39],['Zero',0,22/39]],
  },
  heart: {
    unique: [['main_stats',9,5/40],['all_stats',6,4/40],['HP',9,6/40],['Zero',0,25/40]],
    leg:    [['main_stats',12,4/27],['all_stats',9,3/27],['HP',12,4/27],['Zero',0,16/27]],
  },
  weapon: {
    unique: [['ATT',9,3/43],['BOSS',30,3/43],['IED',30,3/43],['Zero',0,34/43]],
    leg:    [['ATT',12,2/41],['BOSS',40,2/41],['BOSS',35,4/41],['IED',40,2/41],['IED',35,2/41],['Zero',0,29/41]],
  },
  secondary: {
    unique: [['ATT',9,3/51],['BOSS',30,3/51],['IED',30,3/51],['Zero',0,42/51]],
    leg:    [['ATT',12,2/47],['BOSS',40,2/47],['BOSS',35,4/47],['IED',40,2/47],['IED',35,2/47],['Zero',0,35/47]],
  },
  emblem: {
    unique: [['ATT',9,3/40],['IED',30,3/40],['Zero',0,34/40]],
    leg:    [['ATT',12,2/35],['IED',40,2/35],['IED',35,2/35],['Zero',0,29/35]],
  },
};

const CUBE_PRIME_PROB = { black: [1.0, 0.2, 0.05], red: [1.0, 0.1, 0.01] };
const CUBE_COST       = { black: 22000000, red: 12000000 };

/*
 * Revealing the potential is charged on top of the cube, once per use.
 *
 * Source: MathBro's cubing calculator, cubes_CDdL.js -- getRevealCostConstant()
 * and cubingCost(). The fee is `constant * itemLevel^2`, with the constant
 * stepping 0 / 0.5 / 2.5 / 20 at levels 30 / 70 / 120. Every level this tool
 * handles is past 120, so the constant is always 20:
 *
 *   lv140  392k     lv200    800k
 *   lv150  450k     lv250  1,250k
 *
 * Small beside a 22m black cube, but 2-6% on top of it and proportionally twice
 * that on a 12m red -- so it slightly narrows red's advantage without reversing
 * it. cubing.py omits this entirely, which is why our cube costs were low.
 */
function cubeRevealCost(itemLevel) {
  if (!itemLevel || itemLevel < 30) return 0;
  const k = itemLevel <= 70 ? 0.5 : itemLevel <= 120 ? 2.5 : 20;
  return k * itemLevel ** 2;
}

/*
 * Cube sales knock a fixed percentage off the cube itself.
 *
 * Applied to the cube price only, NOT to the reveal fee -- they are two separate
 * charges and the sale is on the cube. If a sale ever discounts the reveal too, this
 * is the one line to change.
 */
const CUBE_SALE_OFF = 0.25;

/** What one cube actually costs to use on an item of this level. */
function cubeCostPerUse(cubeType, itemLevel, sale = false) {
  const cube = CUBE_COST[cubeType] * (sale ? 1 - CUBE_SALE_OFF : 1);
  return cube + cubeRevealCost(itemLevel);
}

/*
 * Item level 151+ line values (GMS only).
 *
 * Source: StrategyWiki's Potential System page, saved under reference/. Every
 * numeric percentage line gains exactly +1 point at "(GMS) 151+" -- so a
 * legendary main-stat line is 12% below the threshold and 13% at or above it,
 * and a unique one goes 9% -> 10%. The same holds for ATT% and All Stat%.
 *
 * Lines that do NOT move are the ones whose value is baked into the line name
 * rather than being a scaling number: "Ignore 30/35/40% of Monster's DEF",
 * "Damage to Boss Monsters +30/35/40%", the cooldown lines, and MaxHP% at the
 * unique and legendary tiers. Verified line by line against the wiki, not
 * assumed from the pattern.
 *
 * In practice this is the 160+ rule: no equipment exists between 151 and 159, so
 * of the real item levels (140, 150, 160, 200, 250) the bump applies to 160 and
 * up. The constant is written as 151 only because that is how the wiki words it.
 *
 * cubing.py has no notion of item level, so it always uses the lower values.
 * Passing level 0 reproduces it exactly, which is how parity is kept.
 */
const CUBE_LEVEL_BUMP_AT = 151;
const CUBE_LEVEL_BUMP = { main_stats: 1, all_stats: 1, ATT: 1,
  'STR%': 1, 'DEX%': 1, 'INT%': 1, 'LUK%': 1 };

/** A line's value at a given item level. */
function cubeLineValue(name, value, itemLevel) {
  if (!itemLevel || itemLevel < CUBE_LEVEL_BUMP_AT) return value;
  return value + (CUBE_LEVEL_BUMP[name] || 0);
}

const CUBE_CATEGORIES = Object.keys(CUBE_POOLS);

/*
 * Sub-stat % lines for multi-stat classes.
 *
 * The pools track one 'main_stats' line; the other three single-stat % lines sit
 * inside Zero. All four have the SAME probability within a tier (MathBro's rate
 * tables: 5/52 each at unique, 4/41 each at legendary on a hat), so a class that
 * actually values them can lift them out of Zero without touching anything else.
 *
 * Which stats qualify comes from the weights: pct weight >= 25% of the main
 * stat's. That keeps a mage's LUK% folded away (1.64 vs 12.21 = 13%, explicitly
 * called insignificant) and a Shadower's DEX%/STR% too -- their BASES are small,
 * so the % lines are near-worthless for potentials even though the flat stats
 * matter for flames. Xenon's three near-equal stats all qualify.
 */
const CUBE_SUB_MIN_RATIO = 0.25;

function cubeSubStats(w) {
  if (!w || !w.pctByStat) return [];
  return STAT_NAMES.filter(s =>
    s !== w.mainStat && (w.pctByStat[s] || 0) > 0
    && (w.pctByStat[s] || 0) >= CUBE_SUB_MIN_RATIO * (w.mainPct || 0));
}

/** Lift qualifying sub-stat lines out of a pool's Zero mass. */
function cubeExpandPool(entries, subs) {
  if (!subs.length) return entries;
  const main = entries.find(e => e[0] === 'main_stats');
  if (!main) return entries;   // WSE pools have no stat lines at all
  const [, value, prob] = main;
  const out = entries.map(([n, v, pr]) =>
    n === 'Zero' ? [n, v, pr - prob * subs.length] : [n, v, pr]);
  for (const s of subs) out.push([s + '%', value, prob]);
  return out;
}

/*
 * The main/all-stat one-currency collapse exists for one reason: when all-stat is
 * worth MORE per point than main%, scoring the gap lets a roll with fewer total
 * percent outscore one with more (27% all-stat beating 30% main), and fills the
 * ladder with lateral 30%->30% rerolls. Collapsing both to the main% weight kills
 * that inversion.
 *
 * So it applies exactly where the inversion is possible, and is bounded on both
 * sides:
 *   all-stat BELOW main%  -- no inversion possible, the natural ordering is
 *                            already right. Keep the true, lower weight; a Demon
 *                            Avenger sits here (0.561 vs 0.748) and collapsing
 *                            would overvalue its all-stat lines by a third.
 *   within 1.6x above     -- collapse. Every single-stat class (mage 13.84 vs
 *                            12.21, Shadower 13.5 vs 11.9).
 *   beyond 1.6x above     -- do not collapse. Xenon runs on three stats so values
 *                            All Stat% at roughly triple a single stat%, and
 *                            collapsing would price its best line at a third.
 *
 * Every comparison here is a ratio, so this holds for either MapleScouter format.
 */
const CUBE_ALLSTAT_COLLAPSE_MAX = 1.6;

function cubeAllStatWeight(w) {
  const main = w.mainPct || 0, all = w.allStatPct || 0;
  if (!main) return all;
  const collapse = all >= main && all <= CUBE_ALLSTAT_COLLAPSE_MAX * main;
  return collapse ? main : all;
}

/** True when main% and all-stat% are being treated as one currency. */
function cubeStatCollapsed(w) {
  return !w || cubeAllStatWeight(w) === (w.mainPct || 0);
}

/**
 * Every pool is a probability distribution and must sum to 1. A pool that
 * doesn't makes P(target) silently wrong in a direction that is very hard to
 * notice by eye, which is exactly how cubing.py's hat typo survived. Checked at
 * load so an edit to the tables above can't reintroduce it quietly.
 */
const CUBE_POOL_ERRORS = (() => {
  const errs = [];
  for (const cat of CUBE_CATEGORIES) {
    for (const tier of ['unique', 'leg']) {
      const sum = CUBE_POOLS[cat][tier].reduce((a, [, , p]) => a + p, 0);
      if (Math.abs(sum - 1) > 1e-9) {
        errs.push(`${cat}.${tier} sums to ${sum.toFixed(6)}, not 1`);
      }
    }
  }
  if (errs.length) console.error('cubing.js pool tables are broken:\n  ' + errs.join('\n  '));
  return errs;
})();

/** Slot-name -> pool category, matching cubing.py's `equip` argument. */
const SLOT_TO_CUBE_CATEGORY = {
  hat: 'hat', top: 'top', bottom: 'bottom', gloves: 'gloves', shoes: 'shoes',
  cape: 'cape_belt_shoulder', belt: 'cape_belt_shoulder', shoulder: 'cape_belt_shoulder',
  face: 'acc', eye: 'acc', ear: 'acc',
  pend1: 'acc', pend2: 'acc',
  ring1: 'acc', ring2: 'acc', ring3: 'acc', ring4: 'acc',
  heart: 'heart', weapon: 'weapon', secondary: 'secondary',
  emblem: 'emblem', pocket: 'acc',
};

/**
 * The three per-line distributions for a legendary item.
 * Line 1 is always prime; lines 2/3 mix prime and unique by prime_prob.
 */
function cubeLineDists(cubeType, category, itemLevel = 0, subs = []) {
  const pool = CUBE_POOLS[category];
  const leg = cubeExpandPool(pool.leg, subs);
  const unique = cubeExpandPool(pool.unique, subs);
  const p = CUBE_PRIME_PROB[cubeType];
  const lv = (n, v) => cubeLineValue(n, v, itemLevel);
  const mix = (primeP) => [
    ...leg.map(([n, v, pr]) => [n, lv(n, v), pr * primeP]),
    ...unique.map(([n, v, pr]) => [n, lv(n, v), pr * (1 - primeP)]),
  ];
  return [leg.map(([n, v, pr]) => [n, lv(n, v), pr]), mix(p[1]), mix(p[2])];
}

/**
 * Every reachable 3-line outcome, as { prob, sums } where sums maps a line name
 * to its summed value across the three lines.
 *
 * Note IED and BOSS are summed arithmetically here, matching cubing.py. In game
 * IED stacks multiplicatively, so a double-IED roll is slightly overvalued; see
 * the note in cubeValue().
 */
const _comboCache = new Map();

function cubeCombos(cubeType, category, itemLevel = 0, subs = []) {
  // 3876-ish combos per call and the scan asks for them repeatedly; the set only
  // depends on these three inputs, so memoise it.
  const key = `${cubeType}|${category}|${itemLevel >= CUBE_LEVEL_BUMP_AT ? 'hi' : 'lo'}|${subs.join('.')}`;
  const hit = _comboCache.get(key);
  if (hit) return hit;

  const [d1, d2, d3] = cubeLineDists(cubeType, category, itemLevel, subs);
  const out = [];
  for (const [n1, v1, p1] of d1) {
    for (const [n2, v2, p2] of d2) {
      for (const [n3, v3, p3] of d3) {
        const sums = {};
        sums[n1] = (sums[n1] || 0) + v1;
        sums[n2] = (sums[n2] || 0) + v2;
        sums[n3] = (sums[n3] || 0) + v3;
        out.push({ prob: p1 * p2 * p3, sums });
      }
    }
  }
  _comboCache.set(key, out);
  return out;
}

function cubeCacheClear() { _comboCache.clear(); }

/**
 * cubing.py's check_sums: a desired key matches every line name containing it as
 * a substring, and their values are summed. So desiring "stats" requires
 * main_stats + all_stats together, which is the intended behaviour.
 * Positive targets are minimums; negative ones (cooldown) are maximums.
 */
function cubeCheckSums(sums, desired) {
  for (const key in desired) {
    const want = desired[key];
    let got = 0;
    for (const name in sums) {
      if (name.toLowerCase().includes(key.toLowerCase())) got += sums[name];
    }
    if (want >= 0 ? got < want : got > want) return false;
  }
  return true;
}

/** Port of cubing.py calc_prob(). Probability one cube satisfies `desired`. */
function cubeProb(cubeType, category, desired, itemLevel = 0) {
  if (!desired || !Object.keys(desired).length) return 0;
  let total = 0;
  for (const c of cubeCombos(cubeType, category, itemLevel)) {
    if (cubeCheckSums(c.sums, desired)) total += c.prob;
  }
  return total;
}

/* ===========================================================================
 * Valuation and target scanning -- this tool's own additions.
 * ======================================================================== */

/**
 * Main-stat-equivalent value of a rolled line set.
 *
 * `w` comes from value.js. Line values are percentages, so each is multiplied by
 * the matching per-1% weight.
 *
 * Caveat kept deliberately simple: IED is treated as linear in the line's stated
 * percentage. Real IED stacks as 1-(1-a)(1-b), so an item carrying two IED lines
 * is somewhat overvalued. MapleScouter's weight is a derivative at your current
 * IED, which is exactly right for one added line and optimistic for two.
 */
/*
 * Main-stat% and all-stat% are scored as the same currency.
 *
 * All-stat also lifts the secondary stat, so strictly it is worth a bit more per
 * point -- 13.84 against 12.21 on the sample weights. But scoring that gap makes
 * the target scan treat 13+10+7 and 10+10+10 as *different* goals even though both
 * are plainly "30% stat", so the ladder fills with lateral rerolls: three separate
 * rows at 383, 394 and 399 all captioned "stat 30", offering to spend 8-12b
 * turning 30% into a differently-composed 30%.
 *
 * Per the user the secondary-stat contribution is not significant enough to be
 * worth that noise, so any composition summing to the same percentage now scores
 * identically. The practical effect is that the value lattice becomes multiples of
 * the main-stat weight, "30% is 30%", and an item already at 30% correctly sees no
 * 30% target offered.
 *
 * Flames are untouched and keep the distinct all-stat weight -- there is no
 * main-stat% flame line, so nothing is being conflated there.
 */
function cubeValue(sums, w) {
  let total = 0;
  for (const name in sums) {
    const v = sums[name];
    if (!v) continue;
    switch (name) {
      case 'main_stats': total += v * w.mainPct;   break;
      case 'all_stats':  total += v * cubeAllStatWeight(w); break;
      case 'ATT':        total += v * w.attPct;    break;
      case 'BOSS':       total += v * w.boss;      break;
      case 'IED':        total += v * w.ied;       break;
      case 'Crit DMG':   total += v * w.critDmg;   break;
      case 'HP':         total += v * w.hpPct;     break;
      // CD, Drop, Meso and Zero carry no combat value here
      default:
        // injected sub-stat % lines ('DEX%' and friends) for multi-stat classes
        if (name.endsWith('%') && w.pctByStat) {
          total += v * (w.pctByStat[name.slice(0, -1)] || 0);
        }
    }
  }
  return total;
}

/**
 * Rank the worthwhile cube targets for one slot.
 *
 * Rather than asking for thresholds, this scans the achievable value
 * distribution: for every distinct reachable total value V, "reroll until the
 * item is worth at least V" is a candidate target, priced at cubeCost / P(>= V)
 * with the gain being E[value | >= V] minus what the item is worth now.
 *
 * Returns the best `limit` candidates by meso-per-stat. Absolute gain is
 * returned alongside because the cheapest-per-point target is often a trivially
 * small improvement.
 */
function cubeTargetScan(cubeType, category, w, currentValue, limit = 5,
                        constraints = null, itemLevel = 0, sale = false) {
  let combos = cubeCombos(cubeType, category, itemLevel, cubeSubStats(w));

  // A constraint is a line you insist on, not a line you value. Cooldown is the
  // motivating case: there is no seconds-to-main-stat exchange rate, so it cannot
  // be scored -- but demanding -2s pins one of the three lines and removes the
  // chance of rolling three stat lines. Filtering here makes every probability
  // below a joint one, so the price of "-2s AND this much stat" comes out right
  // and can be compared against the unconstrained rows by eye.
  // Uses cubing.py's own semantics: a negative target is a maximum, so cd:-2
  // means the summed cooldown must be at most -2.
  if (constraints && Object.keys(constraints).length) {
    combos = combos.filter(c => cubeCheckSums(c.sums, constraints));
    if (!combos.length) return [];
  }
  // Round when grouping: two different line sets can land on the same value but
  // differ in the 13th decimal, which would otherwise split one threshold into
  // several near-duplicate rows.
  const scored = combos.map(c => ({
    prob: c.prob,
    value: Math.round(cubeValue(c.sums, w) * 1e4) / 1e4,
    sums: c.sums,
  }));
  scored.sort((a, b) => b.value - a.value);

  const cost = cubeCostPerUse(cubeType, itemLevel, sale);
  const out = [];
  let cumProb = 0, cumWeighted = 0, i = 0;

  while (i < scored.length) {
    const v = scored[i].value;
    // absorb every combo with this exact value so thresholds are distinct
    while (i < scored.length && scored[i].value === v) {
      cumProb += scored[i].prob;
      cumWeighted += scored[i].prob * scored[i].value;
      i++;
    }
    if (v <= currentValue || cumProb <= 0) continue;

    const expected = cumWeighted / cumProb;
    const gain = expected - currentValue;
    if (gain <= 0) continue;

    out.push({
      threshold: v,
      prob: cumProb,
      cubes: 1 / cumProb,
      cost: cost / cumProb,
      costPerCube: cost,
      expectedValue: expected,
      gain,
      per: (cost / cumProb) / gain,
      example: scored[i - 1].sums,
    });
  }

  return cubeParetoLadder(out, limit);
}

/**
 * Reduce candidates to the Pareto frontier of (cheap per point, large absolute
 * gain), then take the best `limit`.
 *
 * Sorting by per and requiring each survivor to beat the best gain so far drops
 * anything that is both pricier per point AND smaller, which is never the right
 * call. What's left reads as a ladder: the first entry is the cheapest per point,
 * each next one buys strictly more stat at a worse rate.
 */
function cubeParetoLadder(rows, limit = 5) {
  const sorted = rows.slice().sort((a, b) => a.per - b.per);
  const frontier = [];
  let bestGain = 0;
  for (const c of sorted) {
    if (c.gain > bestGain) { frontier.push(c); bestGain = c.gain; }
  }
  return frontier.slice(0, limit);
}

/** The cube types cubing.py prices. Adding one needs its prime odds and cost. */
const CUBE_TYPES = Object.keys(CUBE_COST);

/**
 * Scan every cube type and return one merged ladder, each rung tagged with the
 * cube that achieves it.
 *
 * Which cube wins is not a fixed property of the slot: red costs 12m against
 * black's 22m but has far worse prime odds (0.1/0.01 versus 0.2/0.05), so red
 * tends to win for easy targets and black for hard ones. Presenting both and
 * letting the frontier decide is strictly more useful than making it a setting.
 *
 * Re-filtering after the merge matters -- two individually-Pareto ladders will
 * contain entries that dominate each other once combined.
 */
/*
 * Memo for the whole scan, not just the combo enumeration.
 *
 * The combo cache below made enumeration free, but the SCAN on top of it -- valuing
 * every combo, grouping by threshold, running Pareto -- was re-run for all 21 cubeable
 * slots on every render. One keystroke in a star field therefore paid for rescanning
 * every other slot's cubing, which is where the sluggishness came from.
 *
 * Keyed on everything the result depends on except the weights, which change far less
 * often and are handled by clearing the whole cache (cubeScanCacheClear).
 */
const _scanCache = new Map();

function cubeScanCacheClear() { _scanCache.clear(); }

function cubeTargetScanAll(category, w, currentValue, limit = 5,
                           constraints = null, itemLevel = 0, sale = false) {
  const key = `${category}|${currentValue}|${limit}|${itemLevel}|${sale ? 1 : 0}`
            + `|${constraints ? JSON.stringify(constraints) : ''}`;
  const memo = _scanCache.get(key);
  if (memo) return memo;

  let all = [];
  for (const ct of CUBE_TYPES) {
    for (const row of cubeTargetScan(ct, category, w, currentValue,
                                     Infinity, constraints, itemLevel, sale)) {
      all.push(Object.assign({ cubeType: ct }, row));
    }
  }
  const out = cubeParetoLadder(all, limit);
  _scanCache.set(key, out);
  return out;
}

/**
 * Readable summary of a rolled line set: "stat 30, IED 30" rather than
 * "all_stats 10, main_stats 20, IED 30".
 *
 * main_stats and all_stats both raise main stat, so their percentages are added --
 * consistent with cubeValue(), which scores them at the same weight. Non-stat lines
 * keep the dropdown's grouping order.
 */
function cubeExampleText(sums, w = null) {
  if (!sums) return '';
  // merge main+all into one 'stat' figure only while they are one currency;
  // for a Xenon they are not, and folding them would hide the distinction
  const collapsed = cubeStatCollapsed(w);
  let statTotal = 0;
  const rest = [];
  for (const name in sums) {
    const v = sums[name];
    if (!v || name === 'Zero') continue;
    if (name === 'main_stats' || (name === 'all_stats' && collapsed)) statTotal += v;
    else rest.push([name, v]);
  }
  const rank = (n) => {
    const i = CUBE_LINE_ORDER.indexOf(n);
    return i === -1 ? CUBE_LINE_ORDER.length : i;
  };
  rest.sort((a, b) => rank(a[0]) - rank(b[0]));

  const parts = rest.map(([n, v]) => `${n === 'all_stats' ? 'all' : n} ${v}`);
  if (statTotal) parts.unshift(`stat ${statTotal}`);
  return parts.join(', ');
}

/**
 * Cubes needed at a given percentile, and what they cost.
 *
 * Exact, unlike the star force equivalent: cube count is geometric, so this is
 * `ceil(log(1-pct) / log(1-p))` -- the same formula cubing.py uses for its own
 * percentile table. A falsy pct gives the mean instead.
 */
function cubeAtPct(t, pct) {
  if (!pct) return { cubes: t.cubes, cost: t.cost };
  const cubes = geometricPct(t.prob, pct);
  return { cubes, cost: cubes * t.costPerCube };
}

/** Value of the lines an item currently has. `lines` is [[name, value], ...]. */
function cubeCurrentValue(lines, w, itemLevel = 0) {
  const sums = {};
  for (const [name, value] of lines) {
    if (!name || name === 'Zero') continue;
    // Stored lines already hold the level-adjusted value the dropdown offered, so
    // itemLevel is only used to re-clamp a value saved before the level changed.
    sums[name] = (sums[name] || 0) + Number(value || 0);
  }
  return cubeValue(sums, w);
}

// Display order for the line dropdowns: offensive lines first, then the
// situational ones. Anything unlisted sorts last.
// Per-category overrides for the order lines are OFFERED in. Only gloves need one: they
// are the only slot rolling Crit DMG, and it beats the stat lines there.
const CUBE_LINE_ORDER_BY_CATEGORY = {
  gloves: ['Crit DMG', 'main_stats', 'all_stats', 'STR%', 'DEX%', 'INT%', 'LUK%',
           'ATT', 'BOSS', 'IED', 'CD', 'HP', 'Drop', 'Meso'],
};

const CUBE_LINE_ORDER = [
  'main_stats', 'all_stats', 'STR%', 'DEX%', 'INT%', 'LUK%', 'ATT', 'BOSS', 'IED',
  'Crit DMG', 'CD', 'HP', 'Drop', 'Meso',
];

/**
 * Distinct [name, value] line options for a slot, grouped by line type and
 * ordered strongest-first inside each group. Values are level-adjusted, so a
 * 160+ item offers 13% where a 150 item offers 12%.
 */
function cubeLineOptions(category, itemLevel = 0, subs = [], legendaryOnly = false) {
  const pool = CUBE_POOLS[category];
  const seen = new Set();
  const out = [];
  // Line 1 is prime for both cube types -- CUBE_PRIME_PROB[*][0] is 1.0, and
  // cubeLineDists builds slot 1 from `leg` alone with no unique mixed in. So offering
  // unique-tier values there lets you describe an item the engine treats as
  // impossible: a 9% main stat cannot be line 1, only 12% can.
  const pools = legendaryOnly ? [cubeExpandPool(pool.leg, subs)]
                              : [cubeExpandPool(pool.leg, subs),
                                 cubeExpandPool(pool.unique, subs)];
  for (const [name, rawValue] of pools.flat()) {
    const value = cubeLineValue(name, rawValue, itemLevel);
    const key = name + '|' + value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([name, value]);
  }
  // Gloves are the one category where Crit DMG is the line you actually want, so it
  // leads the list there rather than sitting under the stat lines. Ordering only -- the
  // pool, the odds and the scoring are untouched; this is about which option your eye
  // lands on first when filling the row in.
  const order = CUBE_LINE_ORDER_BY_CATEGORY[category] || CUBE_LINE_ORDER;
  const rank = (n) => {
    const i = order.indexOf(n);
    return i === -1 ? order.length : i;
  };
  out.sort((a, b) => {
    if (rank(a[0]) !== rank(b[0])) return rank(a[0]) - rank(b[0]);
    // CD is stored negative, so "bigger reduction" means more negative
    return a[0] === 'CD' ? a[1] - b[1] : b[1] - a[1];
  });
  return out;
}
