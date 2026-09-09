/* ===========================================================================
 * Star force cost engine.
 *
 * The constants and the four solver functions below are VENDORED VERBATIM from
 * lostara's star force calculator (lostara_sf_caculator.html, lines 545-1035 of
 * the copy saved in this folder). They are not reimplemented and should not be
 * "improved" -- lostara is the reference this tool is checked against, so any
 * edit here silently breaks parity.
 *
 * Only two adaptations were made:
 *   - getModeIndex() read a <select> from lostara's DOM. Mode choice here comes
 *     from solveSpares' policy instead, so that function is dropped.
 *   - a memo cache and the stat-gain valuation (which lostara has no need for,
 *     being cost-only) are added at the bottom, clearly separated.
 *
 * Facts about the current system that the code encodes, worth knowing when
 * reading it:
 *   - Failure MAINTAINS the star. Only a boom regresses you, to recoveryStar(s),
 *     which is not always 12. That is why V solves in one backward pass.
 *   - Stars 15-21 have four "enhancement modes" trading cost against boom
 *     chance; mode 4 cannot boom at all. Outside 15-21 there is no choice.
 *   - rawCost uses per-star divisors, not one formula.
 * ======================================================================== */

const STAR_ENHANCE_MIN   = 15;
const STAR_ENHANCE_MAX   = 21;
const STAR_ENHANCE_COUNT = STAR_ENHANCE_MAX - STAR_ENHANCE_MIN + 1; // 7
const STAR_ENHANCE_MODES = 4;
const STAR_MAX           = 30;

// ─── standard rates (mode 1) ──────────────────────────────────────────────────
const RATES = [
  [0.95, 0.05, 0],       // 0
  [0.90, 0.10, 0],       // 1
  [0.85, 0.15, 0],       // 2
  [0.85, 0.15, 0],       // 3
  [0.80, 0.20, 0],       // 4
  [0.75, 0.25, 0],       // 5
  [0.70, 0.30, 0],       // 6
  [0.65, 0.35, 0],       // 7
  [0.60, 0.40, 0],       // 8
  [0.55, 0.45, 0],       // 9
  [0.50, 0.50, 0],       // 10
  [0.45, 0.55, 0],       // 11
  [0.40, 0.60, 0],       // 12
  [0.35, 0.65, 0],       // 13
  [0.30, 0.70, 0],       // 14
  [0.30, 0.679, 0.021],  // 15
  [0.30, 0.679, 0.021],  // 16
  [0.15, 0.782, 0.068],  // 17
  [0.15, 0.782, 0.068],  // 18
  [0.15, 0.765, 0.085],  // 19
  [0.30, 0.595, 0.105],  // 20
  [0.15, 0.7225, 0.1275],// 21
  [0.15, 0.68, 0.17],    // 22
  [0.10, 0.72, 0.18],    // 23
  [0.10, 0.72, 0.18],    // 24
  [0.10, 0.72, 0.18],    // 25
  [0.07, 0.744, 0.186],  // 26
  [0.05, 0.76, 0.19],    // 27
  [0.03, 0.776, 0.194],  // 28
  [0.01, 0.792, 0.198],  // 29
];

// ─── enhancement mode rates ───────────────────────────────────────────────────
// ENHANCE_MODES[star - STAR_ENHANCE_MIN][modeIndex 0-3] = [success, fail, destroy, costMultiplier]
// stars 15-17: success unchanged, destroy reduces. cost ×1/1.5/2.5/3.
// stars 15-16: destroy reduction fractions extrapolated from measured 17→18 data.
// stars 18-21: success also decreases. cost ×1/2/3.5/6.5. (measured)
const ENHANCE_MODES = [
  // star 15
  [[0.30,0.679,0.021,1.0],[0.30,0.68688,0.01313,1.5],[0.30,0.69475,0.00525,2.5],[0.30,0.70,0.0,3.0]],
  // star 16
  [[0.30,0.679,0.021,1.0],[0.30,0.68688,0.01313,1.5],[0.30,0.69475,0.00525,2.5],[0.30,0.70,0.0,3.0]],
  // star 17 (measured)
  [[0.15,0.782,0.068,1.0],[0.15,0.8075,0.0425,1.5],[0.15,0.833,0.017,2.5],[0.15,0.85,0.0,3.0]],
  // star 18 (measured)
  [[0.15,0.782,0.068,1.0],[0.12,0.836,0.044,2.0],[0.10,0.882,0.018,3.5],[0.08,0.92,0.0,6.5]],
  // star 19 (measured)
  [[0.15,0.765,0.085,1.0],[0.12,0.8184,0.0616,2.0],[0.10,0.864,0.036,3.5],[0.08,0.92,0.0,6.5]],
  // star 20 (measured)
  [[0.30,0.595,0.105,1.0],[0.25,0.675,0.075,2.0],[0.20,0.76,0.04,3.5],[0.15,0.85,0.0,6.5]],
  // star 21 (measured)
  [[0.15,0.7225,0.1275,1.0],[0.12,0.792,0.088,2.0],[0.10,0.855,0.045,3.5],[0.08,0.92,0.0,6.5]],
];

// mode cost multiplier labels, by [old-tier 15-17, new-tier 18-21]
const MODE_COST_LABEL = [['×1','×1'], ['×1.5','×2'], ['×2.5','×3.5'], ['×3','×6.5']];

function getRates(s, modeIdx, boomOff, catching = false) {
  let [ps, pf, pd] = (s >= STAR_ENHANCE_MIN && s <= STAR_ENHANCE_MAX)
    ? ENHANCE_MODES[s - STAR_ENHANCE_MIN][modeIdx]
    : RATES[s];
  // 30% boom reduction: remainder goes to fail
  if (boomOff && s <= STAR_ENHANCE_MAX && pd > 0) {
    const reduction = pd * 0.30;
    pd -= reduction;
    pf += reduction;
  }
  if (catching && ps < 1) {
    const psNew = ps * 1.05;
    const scale  = (1 - psNew) / (1 - ps);
    pf = pf * scale;
    pd = pd * scale;
    ps = psNew;
  }
  return [ps, pf, pd];
}

// ─── recovery star (gms) ──────────────────────────────────────────────────────
function recoveryStar(s) {
  if (s <= 19) return 12;
  if (s === 20) return 15;
  if (s <= 22) return 17;
  if (s <= 25) return 19;
  return 20;
}

// ─── cost formula ─────────────────────────────────────────────────────────────
// Returns raw (pre-rounding) base cost
function rawCost(S, L) {
  if (S <= 9)  return 1000 + Math.floor(L**3 * (S+1) / 25);
  if (S === 10) return 1000 + Math.floor(L**3 * 11**2.7 / 400);
  if (S === 11) return 1000 + Math.floor(L**3 * 12**2.7 / 220);
  if (S === 12) return 1000 + Math.floor(L**3 * 13**2.7 / 150);
  if (S === 13) return 1000 + Math.floor(L**3 * 14**2.7 / 110);
  if (S === 14) return 1000 + Math.floor(L**3 * 15**2.7 / 75);
  if (S === 15) return 1000 + Math.floor(L**3 * 16**2.7 / 200);
  if (S === 16) return 1000 + Math.floor(L**3 * 17**2.7 / 200);
  if (S === 17) return 1000 + Math.floor(L**3 * 18**2.7 / 150);
  if (S === 18) return 1000 + Math.floor(L**3 * 19**2.7 / 70);
  if (S === 19) return 1000 + Math.floor(L**3 * 20**2.7 / 45);
  if (S === 20) return 1000 + Math.floor(L**3 * 21**2.7 / 200);
  if (S === 21) return 1000 + Math.floor(L**3 * 22**2.7 / 125);
  return 1000 + Math.floor(L**3 * (S+1)**2.7 / 200);
}

function attemptCost(s, L, mvp, costOff, modeIdx) {
  const raw = rawCost(s, L);
  const mult = (s >= STAR_ENHANCE_MIN && s <= STAR_ENHANCE_MAX) ? ENHANCE_MODES[s - STAR_ENHANCE_MIN][modeIdx][3] : 1.0;
  const mvpFactor = s <= 16 ? (1 - mvp) : 1;
  const totalMult = mult * (costOff ? 0.70 : 1) * mvpFactor;
  return Math.round(raw * totalMult / 100) * 100;
}

// ─── spares optimizer ────────────────────────────────────────────────────────
// V[s][y] = min expected cost to reach `to` from s with y items remaining
function solveSpares(L, mvp, costOff, boomOff, catching, to, maxY, itemCost = 0,
                     recFn = recoveryStar) {
  const V   = Array.from({length: STAR_MAX + 1}, () => new Array(maxY + 1).fill(Infinity));
  const pol = Array.from({length: STAR_MAX + 1}, () => new Uint8Array(maxY + 1));
  for (let y = 0; y <= maxY; y++) V[to][y] = 0;
  for (let y = 1; y <= maxY; y++) {
    for (let s = to - 1; s >= 0; s--) {
      const r = recFn(s);
      const nM = (s >= STAR_ENHANCE_MIN && s <= STAR_ENHANCE_MAX) ? STAR_ENHANCE_MODES : 1;
      let best = Infinity, bestM = 0;
      for (let m = 0; m < nM; m++) {
        const [ps, , pd] = getRates(s, m, boomOff, catching);
        const cost = attemptCost(s, L, mvp, costOff, m);
        const recTerm = pd === 0 ? 0 : pd * (y >= 2 ? (itemCost + V[r][y - 1]) : Infinity);
        const num = cost + ps * V[s + 1][y] + recTerm;
        const val = isFinite(num) ? num / (ps + pd) : Infinity;
        if (val < best) { best = val; bestM = m; }
      }
      V[s][y] = best; pol[s][y] = bestM;
    }
  }
  return { V, pol };
}

// Unconstrained optimal (infinite booms allowed) — process increasing like solve(),
// using cumulative recovery cost already computed for earlier stars.
function solveUnconstrained(L, mvp, costOff, boomOff, catching, to, itemCost = 0,
                            recFn = recoveryStar) {
  const X   = new Array(STAR_MAX + 1).fill(0); // X[s] = optimal expected cost to advance s★→(s+1)★
  const pol = new Array(STAR_MAX + 1).fill(0);
  for (let s = 0; s < to; s++) {
    const r    = recFn(s);
    const cumX = X.slice(Math.min(r, s), s).reduce((a, v) => a + v, 0);
    const nM   = (s >= STAR_ENHANCE_MIN && s <= STAR_ENHANCE_MAX) ? STAR_ENHANCE_MODES : 1;
    let best = Infinity, bestM = 0;
    for (let m = 0; m < nM; m++) {
      const [ps, , pd] = getRates(s, m, boomOff, catching);
      const cost = attemptCost(s, L, mvp, costOff, m);
      const val = pd === 0 ? cost / ps : (cost + pd * (itemCost + cumX)) / ps;
      if (val < best) { best = val; bestM = m; }
    }
    X[s] = best; pol[s] = bestM;
  }
  // V[s] = total expected cost from s★ to to★
  const V = new Array(STAR_MAX + 1).fill(0);
  for (let s = to - 1; s >= 0; s--) V[s] = V[s + 1] + X[s];
  return { V, pol };
}

// ─── variance of the cost, for percentiles ───────────────────────────────────
// Same recursion as solveUnconstrained but also carrying the second moment, so a
// pXX cost can be quoted rather than just the mean. Variance derivation: law of
// total variance on the one-step decomposition. No-boom is geometric,
// Var = c²(1−p)/p²; the boom case adds the variance of re-climbing from recovery.
function solve(L, mvp, costOff, boomOff, catching, modesByStarFn, itemCost = 0,
               recFn = recoveryStar, recoveryFn = null) {
  const X = new Array(STAR_MAX).fill(0);
  const D = new Array(STAR_MAX).fill(0);
  const V = new Array(STAR_MAX).fill(0);
  const DVar = new Array(STAR_MAX).fill(0);
  for (let s = 0; s < STAR_MAX; s++) {
    const m = modesByStarFn(s);
    const [ps, , pd] = getRates(s, m, boomOff, catching);
    const cost = attemptCost(s, L, mvp, costOff, m);
    // What a boom at s costs, in mean / variance / booms / boom-variance. The
    // default is "fall to recFn(s), pay itemCost, climb back", which is every
    // ordinary item. recoveryFn exists because a Destiny is not ordinary: it comes
    // back at 12★ and you may instead BUY your way to 22★, so recovery is a choice
    // between two routes rather than one forced climb. itemCost is deterministic, so
    // it moves the mean and leaves the variance alone.
    const climb = (from) => ({
      x: X.slice(Math.min(from, s), s).reduce((a, v) => a + v, 0),
      v: V.slice(Math.min(from, s), s).reduce((a, v) => a + v, 0),
      d: D.slice(Math.min(from, s), s).reduce((a, v) => a + v, 0),
      dvar: DVar.slice(Math.min(from, s), s).reduce((a, v) => a + v, 0),
    });
    const rec = recoveryFn ? recoveryFn(s, climb) : climb(recFn(s));
    const recV = rec.v, recD = rec.d, recDVar = rec.dvar;
    const recXi = rec.x + (recoveryFn ? 0 : itemCost);
    if (pd === 0) {
      X[s] = cost / ps;
      D[s] = 0;
      V[s] = cost * cost * (1 - ps) / (ps * ps);
      DVar[s] = 0;
    } else {
      X[s] = (cost + pd * recXi) / ps;
      D[s] = pd * (1 + recD) / ps;
      V[s] = (cost*cost + 2*cost*X[s]*(1-ps) - ps*X[s]*X[s]
              + pd*(recXi*recXi + 2*recXi*(cost+X[s]) + recV)) / ps;
      const pf = 1 - ps - pd;
      const K = 1 + recD + D[s];
      const pfMuPdK = pf*D[s] + pd*K;
      DVar[s] = (pf*D[s]*D[s] + pd*recDVar + pd*K*K - pfMuPdK*pfMuPdK) / ps;
    }
  }
  return { X, D, V, DVar };
}

// Rational approximation (Abramowitz & Stegun 26.2.17), max error ~4.5e-4
function normalQuantile(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [2.515517, 0.802853, 0.010328];
  const b = [1.432788, 0.189269, 0.001308];
  const t = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p));
  const z = t - (a[0] + t*(a[1] + t*a[2])) / (1 + t*(b[0] + t*(b[1] + t*b[2])));
  return p < 0.5 ? -z : z;
}

/**
 * Cost at a given percentile, fitting a lognormal to the mean and variance.
 *
 * Star force cost has no closed-form distribution once booms are in play, so this
 * is an approximation -- the same one lostara quotes its p85 from. Cubing does not
 * need it: cube count is exactly geometric, so its percentile is exact.
 */
function lognormalPct(mu, variance, pct) {
  if (variance <= 0 || mu <= 0) return mu;
  const cv2 = variance / (mu * mu);
  const sig2 = Math.log(1 + cv2);
  const muLn = Math.log(mu) - sig2 / 2;
  return Math.exp(muLn + normalQuantile(pct / 100) * Math.sqrt(sig2));
}

/**
 * Number of independent attempts needed to succeed at least once with probability
 * `pct`, when each attempt succeeds with probability p. Exact, unlike the star
 * force case: ceil(log(1-pct) / log(1-p)). This is cubing.py's own percentile
 * formula, and it also covers flame rerolls.
 */
function geometricPct(p, pct) {
  if (p <= 0) return Infinity;
  if (p >= 1) return 1;
  const q = Math.min(Math.max(pct / 100, 0), 0.999999);
  return Math.ceil(Math.log(1 - q) / Math.log(1 - p));
}

// ─── expected booms under a fixed mode policy ────────────────────────────────
// Same one-step decomposition as the cost recursion, counting destructions
// instead of meso. Used only to explain a row, never to rank it.
function expectedBooms(L, boomOff, catching, from, to, modeAt,
                       recFn = recoveryStar) {
  const D = new Array(STAR_MAX + 1).fill(0);
  for (let s = 0; s < to; s++) {
    const [ps, , pd] = getRates(s, modeAt(s), boomOff, catching);
    if (pd === 0) { D[s] = 0; continue; }
    const r = recFn(s);
    let recD = 0;
    for (let k = Math.min(r, s); k < s; k++) recD += D[k];
    D[s] = pd * (1 + recD) / ps;
  }
  let total = 0;
  for (let s = from; s < to; s++) total += D[s];
  return total;
}

/* ===========================================================================
 * Everything below is this tool's own code, not vendored.
 * ======================================================================== */

/*
 * Genesis and Destiny are handed over at a fixed 22*, their stars coming from
 * liberation quests rather than from star forcing, so there is nothing to buy.
 * Second-stage Destiny liberation unlocks 22*->25*.
 *
 * A boom up there does NOT just cost a fee. Per the user (namu.wiki's Destiny weapon
 * page; the site 403s to automated fetches, so these are their figures):
 *
 *   - 10b recovers the weapon, but it comes back at 12*, not at 22*.
 *   - From there, 54.2b more buys a guaranteed 22*.
 *   - Or you re-star-force 12*->22* yourself, which is usually worse.
 *
 * So recovery is a CHOICE, and the cheaper of the two routes is what a boom really
 * costs. An earlier version of this assumed the weapon returned at 22* for the 10b
 * alone, which understated a boom by tens of billions.
 */
const WEAPON_KINDS = {
  none:     { label: 'ordinary weapon' },
  fixed22:  { label: 'Genesis / Destiny (fixed 22★)', minStar: 22, noSf: true },
  destiny2: {
    label: 'Destiny, 2nd stage liberation',
    minStar: 22, maxStar: 25,
    reviveCost: 10e9,      // recovers the weapon...
    reviveStar: 12,        // ...but only to 12*
    guaranteeCost: 54.2e9, // 12* -> a guaranteed 22*
    guaranteeStar: 22,
  },
};

/**
 * Cost of recovering from a boom at star `s`, for a weapon with a revive/guarantee
 * rule. `climb(from)` gives the mean/variance/booms of star forcing from `from` up to
 * `s` under the policy already solved for the stars below.
 *
 * Two routes, and the cheaper one in expectation is taken:
 *   climb    revive, then star force all the way back from reviveStar
 *   buy      revive, pay the guarantee to reach guaranteeStar, climb the rest
 *
 * The guarantee is deterministic, so that route contributes no extra booms and no
 * extra variance beyond whatever is left above guaranteeStar.
 */
function weaponRecovery(rule, s, climb) {
  const viaClimb = climb(rule.reviveStar);
  const routes = [{
    ...viaClimb,
    x: rule.reviveCost + viaClimb.x,
    route: 'climb',
  }];
  if (rule.guaranteeCost != null) {
    const rest = climb(rule.guaranteeStar);
    routes.push({
      ...rest,
      x: rule.reviveCost + rule.guaranteeCost + rest.x,
      route: 'buy',
    });
  }
  return routes.reduce((best, r) => (r.x < best.x ? r : best));
}

/*
 * Secondaries are mostly not star forceable at all. The ones that are -- lv130 shields
 * for explorer mages, thieves and warriors -- cap at 20*, which already falls out of
 * the 128-137 bracket. Kanna and Dual Blade are exceptions, deliberately out of scope.
 *
 * An Astra secondary is the case worth modelling: spares are not farmed, they cost 1b
 * each. That is exactly what itemCost means, so a boom here is priced rather than free.
 */
const SECONDARY_KINDS = {
  none:  { label: 'ordinary secondary' },
  astra: { label: 'Astra secondary (spares cost 1b)', itemCost: 1e9 },
};

// Reboot: no MVP discount exists. SSF is assumed always on -- per the user,
// starforcing outside the event is never the right move. Editable in settings.
const SF_DEFAULTS = {
  mvp: 0,
  event: 'ssf',   // 'none' | '30off' | '30boom' | 'ssf'
  catching: true,
  itemCost: 0,    // spares are farmed, so a boom costs only the lost stars
  // Mode per star for 15->16 .. 21->22, as indices 0-3 for modes 1-4. Outside that
  // range there is no choice. This is a POLICY, not a hint: the ranking prices the
  // strategy you picked rather than searching for the cheapest one, which is what
  // lostara does and the only way a "safeguard 15-18" plan can be costed at all.
  modes: [0, 0, 0, 0, 0, 0, 0],
};

// The three strategies people actually run, named the way they are talked about: one
// digit per star from 15->16 to 21->22, grouped 15-18 / 18-20 / 20-22.
const SF_MODE_PRESETS = {
  '111/11/11': [0, 0, 0, 0, 0, 0, 0],
  '444/11/44': [3, 3, 3, 0, 0, 3, 3],
  '444/44/44': [3, 3, 3, 3, 3, 3, 3],
};

/** Mode index in force at star `s`; 0 outside the 15-21 band, where none exists. */
function sfModeIndex(cfg, s) {
  if (s < STAR_ENHANCE_MIN || s > STAR_ENHANCE_MAX) return 0;
  const m = (cfg.modes || [])[s - STAR_ENHANCE_MIN];
  return (m >= 0 && m < STAR_ENHANCE_MODES) ? m : 0;
}

/**
 * Parse a strategy written the way players say it: "444/11/44", or "4441144", or
 * "4-4-4-1-1-4-4". Returns 7 mode indices, or null if it isn't 7 digits of 1-4.
 *
 * A text field rather than seven dropdowns per row, because per-slot strategies are
 * the point and 23 slots x 7 stars of dropdowns is not a table anyone can read.
 */
function sfModesFromText(text) {
  const digits = String(text || '').replace(/[^1-4]/g, '');
  if (digits.length !== STAR_ENHANCE_COUNT) return null;
  if (String(text || '').replace(/[^0-9]/g, '').length !== STAR_ENHANCE_COUNT) return null;
  return digits.split('').map(d => Number(d) - 1);
}

/** How the preset name is spelled out, for display: "444/11/44". */
function sfModesName(modes) {
  const d = (modes || []).map(m => (m || 0) + 1).join('');
  return `${d.slice(0, 3)}/${d.slice(3, 5)}/${d.slice(5, 7)}`;
}

/**
 * Label for one mode at one star: the boom chance you actually face and what the
 * attempt costs. Effective, not raw -- SSF's 30% boom reduction is already in it,
 * so the labels move when the event changes.
 */
function sfModeLabel(s, m, cfg) {
  const { boomOff } = sfEventFlags(cfg.event);
  const [, , pd] = getRates(s, m, boomOff, cfg.catching);
  const mult = ENHANCE_MODES[s - STAR_ENHANCE_MIN][m][3];
  const risk = pd === 0 ? 'no boom' : `${(pd * 100).toFixed(2)}% boom`;
  return `mode ${m + 1} — ${risk} (×${mult})`;
}

function sfEventFlags(event) {
  return {
    costOff: event === '30off' || event === 'ssf',
    boomOff: event === '30boom' || event === 'ssf',
  };
}

/*
 * Three solvers. The ranking uses only the third; the first two are kept as vendored
 * reference and as oracles the self-tests check the policy numbers against.
 *
 *   solveUnconstrained  "cheapest expected meso, booming as often as it takes",
 *                       choosing modes for you. Always finite. No longer the ranking
 *                       path -- once you name a strategy, cost is not a search.
 *
 *   solveSpares         "cheapest policy that GUARANTEES arrival with only y items".
 *                       Above 21★ no zero-destroy mode exists, so a boom is always
 *                       possible and no finite y guarantees anything -- Infinity is
 *                       the correct answer, not a bug. Replaced in the UI by picking
 *                       mode 4 per star, which says the same thing without a column
 *                       that reads "impossible" for every endgame row.
 *
 *   sfPolicy/solve      cost, booms and variance under the modes you chose. This is
 *                       what the ranking prices.
 */
const _sfCache = new Map();

function _cfgKey(cfg) {
  const w = cfg.weaponRule || {};
  return `${cfg.mvp}|${cfg.event}|${cfg.catching}|${cfg.itemCost}|${cfg.recoverTo ?? ''}`
       + `|${(cfg.modes || []).join('')}`
       + `|${w.reviveCost ?? ''}:${w.reviveStar ?? ''}:${w.guaranteeCost ?? ''}:${w.guaranteeStar ?? ''}`;
}

// A liberated Destiny weapon arrives at 22* from quests, not from star forcing, so a
// recovered one comes back at 22 rather than at the generic recovery star. cfg.recoverTo
// carries that; absent, the vendored gms table applies unchanged.
function _recFn(cfg) {
  const r = cfg.recoverTo;
  return (r == null) ? recoveryStar : (() => r);
}

function sfUnconstrained(level, to, cfg) {
  const key = `U|${level}|${to}|${_cfgKey(cfg)}`;
  let hit = _sfCache.get(key);
  if (!hit) {
    const { costOff, boomOff } = sfEventFlags(cfg.event);
    hit = solveUnconstrained(level, cfg.mvp, costOff, boomOff, cfg.catching, to,
                             cfg.itemCost, _recFn(cfg));
    _sfCache.set(key, hit);
  }
  return hit;
}

function sfSafe(level, to, cfg) {
  const key = `S|${level}|${to}|${_cfgKey(cfg)}`;
  let hit = _sfCache.get(key);
  if (!hit) {
    const { costOff, boomOff } = sfEventFlags(cfg.event);
    // maxY = 1: one item, no backups, so any mode that can boom is rejected
    hit = solveSpares(level, cfg.mvp, costOff, boomOff, cfg.catching, to, 1,
                      cfg.itemCost, _recFn(cfg));
    _sfCache.set(key, hit);
  }
  return hit;
}

/**
 * Cost, expected booms and variance for every star under the chosen mode policy.
 *
 * One recursion supplies all three, so the mean and the percentile can never be
 * computed under different assumptions -- which is exactly how the fee went missing
 * from the percentile column before.
 */
function sfPolicy(level, cfg) {
  const key = `P|${level}|${_cfgKey(cfg)}`;
  let hit = _sfCache.get(key);
  if (!hit) {
    const { costOff, boomOff } = sfEventFlags(cfg.event);
    const rule = cfg.weaponRule;
    hit = solve(level, cfg.mvp, costOff, boomOff, cfg.catching,
                (s) => sfModeIndex(cfg, s), cfg.itemCost, _recFn(cfg),
                rule && rule.reviveCost != null
                  ? (s, climb) => weaponRecovery(rule, s, climb)
                  : null);
    _sfCache.set(key, hit);
  }
  return hit;
}

function sfCacheClear() { _sfCache.clear(); }

/**
 * Expected meso to climb `from` -> `to` under the configured mode policy, plus the
 * modes used and the expected booms.
 *
 * Prices the strategy you chose rather than searching for the cheapest -- picking the
 * modes is the whole point of the panel. Always finite: mode 4 cannot boom below 22*,
 * and above 21* there is no mode choice to make.
 *
 * `solveUnconstrained` and `solveSpares` are no longer on this path. They stay because
 * they are vendored reference and the self-tests check the policy numbers against
 * them, but a chosen policy is not an optimisation problem.
 */
function sfClimb(level, from, to, cfg) {
  if (to <= from) return { cost: 0, modes: [], booms: 0, variance: 0 };

  const { X, D, V, DVar } = sfPolicy(level, cfg);
  let cost = 0, booms = 0, variance = 0, boomVariance = 0;
  for (let s = from; s < to; s++) {
    cost += X[s]; booms += D[s]; variance += V[s]; boomVariance += DVar[s];
  }

  const modes = [];
  for (let s = from; s < to; s++) {
    if (s >= STAR_ENHANCE_MIN && s <= STAR_ENHANCE_MAX) {
      modes.push({ star: s, mode: sfModeIndex(cfg, s) + 1 });
    }
  }

  // Which recovery route a boom at the starting star takes, and what it costs. For a
  // Destiny this is most of the bill, so it belongs on the row rather than buried.
  let recovery = null;
  const rule = cfg.weaponRule;
  if (rule && rule.reviveCost != null) {
    const { X } = sfPolicy(level, cfg);
    const sum = (a, b) => X.slice(a, b).reduce((acc, v) => acc + v, 0);
    const climb = rule.reviveCost + sum(rule.reviveStar, from);
    const buy = rule.reviveCost + rule.guaranteeCost + sum(rule.guaranteeStar, from);
    // `per` is the full cost of one recovery, which is what decides the route. `fee`
    // is only the meso handed over -- the revive, plus the guarantee if bought. The
    // re-climb part of `per` is star force spend that the totals already contain, so
    // attributing it again would report a component larger than the whole.
    recovery = buy < climb
      ? { route: 'buy', per: buy, fee: rule.reviveCost + rule.guaranteeCost }
      : { route: 'climb', per: climb, fee: rule.reviveCost };
  }
  return { cost, modes, booms, variance, boomVariance, recovery };
}

/** Cost to reach `to` at the given percentile; falsy pct gives the mean. */
function sfClimbAtPct(r, pct) {
  if (!pct || !isFinite(r.cost)) return r.cost;
  return lognormalPct(r.cost, r.variance, pct);
}

/**
 * Booms at a given percentile. The mean is what you expect over many climbs; this is
 * what a bad one looks like, and it is the figure that belongs beside a pXX cost.
 *
 * Exactly lostara's line 1312: a lognormal fitted to the mean and variance, the same
 * family it uses for cost, reported CONTINUOUSLY. An earlier version fitted a negative
 * binomial and returned an integer instead, which is a discrete quantile -- i.e. the
 * ceiling of this -- so 22★→23★ read 4 where lostara says 3.26. The discrete figure was
 * arguably the better statistic (booms are counts, and it can return the honest 0 for a
 * short climb) but this file exists to agree with lostara, and "3.26" also carries
 * "about three, maybe four" in a way a hard 4 does not.
 */
function sfBoomsAtPct(r, pct) {
  if (!pct || !isFinite(r.booms)) return r.booms;
  return lognormalPct(r.booms, r.boomVariance || 0, pct);
}

/**
 * Which stat table a slot reads. 'gloves' uses the armor table but also picks up
 * the gloves-only attack lines. Secondaries use the ARMOR table: a lv200 secondary at
 * 20* has cumulative +115 stat and +70 attack, which is the armor table exactly. The
 * weapon table happens to give the same 115 stat, so it is the flat 70 attack that
 * settles it -- weapons compute attack as a formula over their own base instead.
 */
function sfTableFor(kind) {
  if (kind === 'weapon')    return SF_STATS_WEAPON;
  return SF_STATS_ARMOR;
}

/** True when the slot's stat table has no numbers in it yet. */
/**
 * No stat table for this kind. Nothing hits this now that secondaries are known to use
 * the armor table, but it stays as the honest answer for any kind added without data --
 * better a row saying "no table" than one silently valuing stars at zero.
 */
function sfTableEmpty(kind) {
  return !sfTableFor(kind);
}

/** Star cap for a slot, from the wiki-derived tables in sf-stats.js. */
function sfCap(level, kind) {
  const b = sfBracket(level);
  if (b < 0) return 0;
  const caps = kind === 'weapon' ? SF_CAP_WEAPON : SF_CAP_ARMOR;
  return caps[b];
}

/**
 * Main-stat-equivalent value of the stat granted by reaching `star`.
 *
 * The wiki's Delta row for star N is what landing N adds, so a step s -> s+1
 * grants row s+1.
 *
 * `w` is the weight set from value.js. Note stat applies to EACH class-relevant
 * stat, hence w.statPerPoint (= w_main + w_sub) rather than w_main alone.
 * Weapon attack below 16★ is floor(base * mul + add) over the weapon's own base
 * attack, so `baseAtt` is required to value those steps.
 */
function sfStatValue(star, level, kind, w, baseAtt = 0) {
  const b = sfBracket(level);
  if (b < 0) return 0;
  const row = sfTableFor(kind)[star];
  if (!row) return 0;

  const at = (arr) => {
    if (!arr) return 0;
    const v = arr[Math.min(b, arr.length - 1)];
    if (typeof v === 'object' && v) return Math.floor(baseAtt * v.mul + v.add);
    return v || 0;
  };

  let total = at(row.stat) * w.statPerPoint;
  total += at(row.att) * w.att + at(row.matt) * w.matt;
  if (kind === 'gloves') {
    total += at(row.glovesAtt) * w.att + at(row.glovesMatt) * w.matt;
  }
  return total;
}

/** Cumulative stat value of a whole climb from -> to. */
function sfClimbStatValue(from, to, level, kind, w, baseAtt = 0) {
  let total = 0;
  for (let s = from + 1; s <= to; s++) total += sfStatValue(s, level, kind, w, baseAtt);
  return total;
}
