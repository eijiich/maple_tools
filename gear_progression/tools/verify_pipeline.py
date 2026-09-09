"""
End-to-end check of the valuation pipeline: MapleScouter weights -> star force
stat value and cube target scan -> meso per stat point.

Mirrors value.js, sf.js's sfStatValue and cubing.js's cubeTargetScan, using the
real pasted weights, so the numbers can be compared against the tool in a browser
and against the hand-computed oracles in the plan.

Run: python tools/verify_pipeline.py
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_sf_stats import SRC, parse_section, BRACKETS      # noqa: E402
from verify_sf import solve_unconstrained, expected_booms, fm  # noqa: E402
from verify_cubing import POOLS, PRIME, combos                 # noqa: E402

# cubing.js corrects this; see the comment in that file
POOLS["hat"]["unique"] = [("main_stats", 9, 5/52), ("all_stats", 6, 4/52),
                          ("HP", 9, 6/52), ("Zero", 0, 37/52)]

CUBE_COST = {"black": 22_000_000, "red": 12_000_000}

PASTE = """Boss Damage\t\t12.53
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
All Stat%\t\t13.84"""

LABELS = {
    'str': 'flat.STR', 'dex': 'flat.DEX', 'int': 'flat.INT', 'luk': 'flat.LUK',
    'str%': 'pct.STR', 'dex%': 'pct.DEX', 'int%': 'pct.INT', 'luk%': 'pct.LUK',
    'not affected by % int': 'nopct.INT', 'not affected by % luk': 'nopct.LUK',
    'all stat%': 'allStatPct',
    'attack': 'attFlat', 'm.attack': 'mattFlat',
    'attack%': 'attPctPhys', 'm.attack%': 'attPctMagic',
    'boss damage': 'boss', 'critical dmg': 'critDmg',
    'ignore dff(300)': 'ied300', 'ignore dff(380)': 'ied380',
    'hp%': 'hpPct',
}


def parse_scouter(text):
    raw = {}
    for line in text.splitlines():
        m = re.match(r'^(.*?)[\t ]+(-?[\d.,]+)\s*$', line)
        if not m:
            continue
        label = re.sub(r'\s+', ' ', m.group(1).strip()).lower()
        key = LABELS.get(label)
        if key:
            raw[key] = float(m.group(2).replace(',', ''))
    return raw


def build_weights(raw, ied_variant=300):
    g = lambda k: float(raw.get(k, 0))
    stats = ['STR', 'DEX', 'INT', 'LUK']
    main = max(stats, key=lambda s: g('flat.' + s))
    return {
        'mainStat': main,
        'statPerPoint': sum(g('flat.' + s) for s in stats),
        'mainPct': g('pct.' + main),
        'allStatPct': g('allStatPct'),
        'attPct': g('attPctPhys') + g('attPctMagic'),
        'boss': g('boss'), 'critDmg': g('critDmg'), 'hpPct': g('hpPct'),
        'ied': g('ied380') if ied_variant == 380 else g('ied300'),
        'att': g('attFlat'), 'matt': g('mattFlat'),
    }


# ---- star force stat value ---------------------------------------------------

src = SRC.read_text(encoding='utf-8')
_a = src.index('<h2 id="Weapons"')
_b = src.index('<h2 id="Armor_and_Accessories"')
_c = src.index('<h2 id="Badges"')
SF_W, CAP_W = parse_section(src[_a:_b], 5)
SF_A, CAP_A = parse_section(src[_b:_c], 6)


def bracket(level):
    for i, (_, lo, hi) in enumerate(BRACKETS):
        if lo <= level <= hi:
            return i
    return len(BRACKETS) - 1 if level > 250 else -1


def sf_stat_value(star, level, kind, w, base_att=0):
    b = bracket(level)
    table = SF_W if kind == 'weapon' else SF_A
    row = table.get(star)
    if row is None or b < 0:
        return 0

    def at(key):
        arr = row.get(key) or []
        if not arr:
            return 0
        v = arr[min(b, len(arr) - 1)]
        if isinstance(v, dict):
            return int(base_att * v['mul'] + v['add'])
        return v or 0

    total = at('stat') * w['statPerPoint']
    total += at('att') * w['att'] + at('matt') * w['matt']
    if kind == 'gloves':
        total += at('glovesAtt') * w['att'] + at('glovesMatt') * w['matt']
    return total


# ---- cube valuation ----------------------------------------------------------

def cube_value(sums, w):
    key = {'main_stats': 'mainPct', 'all_stats': 'allStatPct', 'ATT': 'attPct',
           'BOSS': 'boss', 'IED': 'ied', 'Crit DMG': 'critDmg', 'HP': 'hpPct'}
    return sum(v * w[key[n]] for n, v in sums.items() if n in key and v)


def cube_target_scan(cube_type, cat, w, current_value, limit=5):
    scored = [(p, cube_value(s, w), s) for p, s in combos(cube_type, cat)]
    scored.sort(key=lambda t: -t[1])
    cost = CUBE_COST[cube_type]
    out = []
    cum_p = cum_w = 0.0
    i = 0
    while i < len(scored):
        v = scored[i][1]
        while i < len(scored) and scored[i][1] == v:
            cum_p += scored[i][0]
            cum_w += scored[i][0] * scored[i][1]
            i += 1
        if v <= current_value or cum_p <= 0:
            continue
        exp = cum_w / cum_p
        gain = exp - current_value
        if gain <= 0:
            continue
        out.append({'threshold': v, 'prob': cum_p, 'cost': cost / cum_p,
                    'gain': gain, 'per': (cost / cum_p) / gain,
                    'example': scored[i - 1][2]})
    out.sort(key=lambda d: d['per'])
    frontier, best_gain = [], 0.0
    for c in out:
        if c['gain'] > best_gain:
            frontier.append(c)
            best_gain = c['gain']
    return frontier[:limit]


# ---- run ---------------------------------------------------------------------

w = build_weights(parse_scouter(PASTE))
print("weights parsed from the paste:")
for k, v in w.items():
    print(f"  {k:<14}{v}")

print()
print("ORACLE CHECKS from the plan")
a = 12 * w['mainPct']
print(f"  12% main stat line          {a:>10.2f}   expected 146.52   "
      f"{'ok' if abs(a-146.52) < 0.01 else 'FAIL'}")
b = sf_stat_value(16, 150, 'hat', w)
print(f"  lv150 armor 16* step        {b:>10.2f}   expected  39.01   "
      f"{'ok' if abs(b-39.01) < 0.01 else 'FAIL'}")
print(f"    breakdown: stat 11 x {w['statPerPoint']} = {11*w['statPerPoint']:.2f}"
      f"  +  matt 9 x {w['matt']} = {9*w['matt']:.2f}")

print()
print("STAR FORCE, one step, SSF, unconstrained. meso per stat point:")
print(f"{'slot':<12}{'lv':>5}{'step':>10}{'cost':>11}{'stat':>9}{'meso/stat':>12}{'booms':>8}")
print("-" * 67)
cfg_cases = [
    ('hat', 150, 15), ('hat', 150, 16), ('hat', 150, 17), ('hat', 150, 18),
    ('hat', 150, 20), ('hat', 150, 21), ('hat', 150, 22), ('hat', 150, 24),
    ('hat', 160, 17), ('hat', 200, 17), ('hat', 250, 17),
    ('hat', 160, 22), ('hat', 160, 26),
]
for kind, lv, star in cfg_cases:
    V, pol = solve_unconstrained(lv, 0, True, True, True, star + 1, 0)
    cost = V[star]
    val = sf_stat_value(star + 1, lv, kind, w)
    booms = expected_booms(lv, True, True, star, star + 1, lambda s: pol[s])
    per = cost / val if val else float('inf')
    print(f"{kind:<12}{lv:>5}{f'{star}->{star+1}':>10}{fm(cost):>11}"
          f"{val:>9.1f}{fm(per):>12}{booms:>8.2f}")

print()
print("BUNDLED CLIMBS from 17*, lv150 hat:")
for to in (18, 21, 22, 23, 25, 30):
    V, pol = solve_unconstrained(150, 0, True, True, True, to, 0)
    cost = V[17]
    val = sum(sf_stat_value(s, 150, 'hat', w) for s in range(18, to + 1))
    booms = expected_booms(150, True, True, 17, to, lambda s: pol[s])
    print(f"  17 -> {to:<3} {fm(cost):>12}  stat {val:>7.1f}  "
          f"per {fm(cost/val):>10}  booms {booms:>10.2f}")

print()
print("CUBE TARGET SCAN (black cubes)")
for cat, current in (('emblem', [('ATT', 9)]),
                     ('emblem', [('ATT', 12), ('IED', 35)]),
                     ('hat', [('main_stats', 9), ('main_stats', 9)]),
                     ('weapon', [('ATT', 12), ('BOSS', 35)])):
    cur_sums = {}
    for n, v in current:
        cur_sums[n] = cur_sums.get(n, 0) + v
    cv = cube_value(cur_sums, w)
    print(f"\n  {cat}, currently {current} = {cv:.1f} stat-equiv")
    print(f"    {'target>=':>10}{'P':>12}{'cubes':>9}{'cost':>11}"
          f"{'gain':>9}{'meso/stat':>12}  example roll")
    for t in cube_target_scan('black', cat, w, cv):
        ex = {k: v for k, v in t['example'].items() if k != 'Zero' and v}
        print(f"    {t['threshold']:>10.0f}{t['prob']:>12.6f}"
              f"{1/t['prob']:>9.0f}{fm(t['cost']):>11}{t['gain']:>9.1f}"
              f"{fm(t['per']):>12}  {ex}")
