"""
Parity check: cubing.js against ../backend/maple_cubing/cubing.py.

cubing.py is the source of truth. This mirrors the JS port in Python and compares
probabilities across every pool, both cube types, and a spread of targets. Any
disagreement above 1e-12 is a port bug.

History: cubing.py's hat_unique_prob had Zero at 41/52, making that pool sum to
1.077. cubing.js corrected it to 37/52 and this script reported the divergence.
The fix has since been applied upstream in cubing.py, so all three now agree and
the integrity section below should report all 22 pools summing to 1.

Run: python tools/verify_cubing.py
"""

import importlib.util
import io
import sys
from contextlib import redirect_stdout
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
CUBING_PY = BASE.parent / "backend" / "maple_cubing" / "cubing.py"


def load_reference():
    """Import cubing.py, muting the demo it prints at module scope."""
    spec = importlib.util.spec_from_file_location("cubing_ref", CUBING_PY)
    mod = importlib.util.module_from_spec(spec)
    with redirect_stdout(io.StringIO()):
        spec.loader.exec_module(mod)
    return mod


# ---- mirror of cubing.js -----------------------------------------------------

POOLS = {
    "hat": {
        "unique": [("main_stats",9,5/52),("all_stats",6,4/52),("HP",9,6/52),("Zero",0,37/52)],
        "leg":    [("main_stats",12,4/41),("all_stats",9,3/41),("HP",12,4/41),("CD",-2,2/41),("CD",-1,3/41),("Zero",0,25/41)],
    },
    "top": {
        "unique": [("main_stats",9,5/62),("all_stats",6,4/62),("HP",9,6/62),("Zero",0,47/62)],
        "leg":    [("main_stats",12,4/39),("all_stats",9,3/39),("HP",12,4/39),("Zero",0,28/39)],
    },
    "bottom": {
        "unique": [("main_stats",9,5/52),("all_stats",6,4/52),("HP",9,6/52),("Zero",0,37/52)],
        "leg":    [("main_stats",12,4/33),("all_stats",9,3/33),("HP",12,4/33),("Zero",0,22/33)],
    },
    "gloves": {
        "unique": [("main_stats",9,5/56),("all_stats",6,4/56),("HP",9,6/56),("Zero",0,41/56)],
        "leg":    [("main_stats",12,4/40),("all_stats",9,3/40),("HP",12,4/40),("Crit DMG",8,4/40),("Zero",0,25/40)],
    },
    "shoes": {
        "unique": [("main_stats",9,5/52),("all_stats",6,4/52),("HP",9,6/52),("Zero",0,37/52)],
        "leg":    [("main_stats",12,4/36),("all_stats",9,3/36),("HP",12,4/36),("Zero",0,25/36)],
    },
    "cape_belt_shoulder": {
        "unique": [("main_stats",9,5/48),("all_stats",6,4/48),("HP",9,6/48),("Zero",0,33/48)],
        "leg":    [("main_stats",12,4/33),("all_stats",9,3/33),("HP",12,4/33),("Zero",0,22/33)],
    },
    "acc": {
        "unique": [("main_stats",9,5/40),("all_stats",6,4/40),("HP",9,6/40),("Zero",0,25/40)],
        "leg":    [("main_stats",12,4/39),("all_stats",9,3/39),("HP",12,4/39),("Drop",20,3/39),("Meso",20,3/39),("Zero",0,22/39)],
    },
    "heart": {
        "unique": [("main_stats",9,5/40),("all_stats",6,4/40),("HP",9,6/40),("Zero",0,25/40)],
        "leg":    [("main_stats",12,4/27),("all_stats",9,3/27),("HP",12,4/27),("Zero",0,16/27)],
    },
    "weapon": {
        "unique": [("ATT",9,3/43),("BOSS",30,3/43),("IED",30,3/43),("Zero",0,34/43)],
        "leg":    [("ATT",12,2/41),("BOSS",40,2/41),("BOSS",35,4/41),("IED",40,2/41),("IED",35,2/41),("Zero",0,29/41)],
    },
    "secondary": {
        "unique": [("ATT",9,3/51),("BOSS",30,3/51),("IED",30,3/51),("Zero",0,42/51)],
        "leg":    [("ATT",12,2/47),("BOSS",40,2/47),("BOSS",35,4/47),("IED",40,2/47),("IED",35,2/47),("Zero",0,35/47)],
    },
    "emblem": {
        "unique": [("ATT",9,3/40),("IED",30,3/40),("Zero",0,34/40)],
        "leg":    [("ATT",12,2/35),("IED",40,2/35),("IED",35,2/35),("Zero",0,29/35)],
    },
}

PRIME = {"black": [1.0, 0.2, 0.05], "red": [1.0, 0.1, 0.01]}


def line_dists(cube_type, cat):
    pool = POOLS[cat]
    p = PRIME[cube_type]

    def mix(prime_p):
        return ([(n, v, pr * prime_p) for n, v, pr in pool["leg"]]
                + [(n, v, pr * (1 - prime_p)) for n, v, pr in pool["unique"]])

    return [list(pool["leg"]), mix(p[1]), mix(p[2])]


def combos(cube_type, cat):
    d1, d2, d3 = line_dists(cube_type, cat)
    out = []
    for n1, v1, p1 in d1:
        for n2, v2, p2 in d2:
            for n3, v3, p3 in d3:
                sums = {}
                for n, v in ((n1, v1), (n2, v2), (n3, v3)):
                    sums[n] = sums.get(n, 0) + v
                out.append((p1 * p2 * p3, sums))
    return out


def check_sums(sums, desired):
    for key, want in desired.items():
        got = sum(v for n, v in sums.items() if key.lower() in n.lower())
        if (got < want) if want >= 0 else (got > want):
            return False
    return True


def cube_prob(cube_type, cat, desired):
    if not desired:
        return 0
    return sum(p for p, sums in combos(cube_type, cat) if check_sums(sums, desired))


# ---- the comparison ----------------------------------------------------------

TARGETS = [
    (["stats"], [18]),
    (["stats"], [21]),
    (["stats"], [30]),
    (["stats"], [33]),
    (["all_stats"], [9]),
    (["HP"], [24]),
    (["ATT"], [12]),
    (["ATT"], [21]),
    (["ATT"], [24]),
    (["ATT", "BOSS"], [21, 30]),
    (["ATT", "IED"], [12, 30]),
    (["BOSS"], [70]),
    (["IED"], [70]),
    (["IED"], [75]),
    (["Crit DMG"], [8]),
    (["Drop"], [20]),
]

def main():
    ref = load_reference()

    fails = 0
    checked = 0
    print(f"reference: {CUBING_PY}")
    print()
    print(f"{'pool':<20}{'cube':<7}{'target':<28}{'cubing.py':>14}{'cubing.js':>14}  ok")
    print("-" * 90)

    for cat in POOLS:
        for cube_type in ("black", "red"):
            for stats, vals in TARGETS:
                desired = ref.create_desired_values(stats, vals)
                if not desired:
                    continue
                a = ref.calc_prob(cube_type, cat, desired)
                b = cube_prob(cube_type, cat, desired)
                ok = abs(a - b) < 1e-12
                checked += 1
                if not ok:
                    fails += 1
                if not ok or (cat in ("emblem", "hat") and cube_type == "black"):
                    label = ",".join(f"{s}>={v}" for s, v in zip(stats, vals))
                    mark = "ok" if ok else "MISMATCH"
                    print(f"{cat:<20}{cube_type:<7}{label:<28}{a:>14.10f}{b:>14.10f}  {mark}")

    print()
    print(f"compared {checked} (pool, cube, target) combinations -- {fails} mismatches")

    print()
    print("=" * 90)
    print("POOL INTEGRITY -- every pool is a distribution and must sum to exactly 1.")
    print("All three -- cubing.py, cubing.js and this mirror -- now use 37/52.")
    print()
    broken = []
    for cat in POOLS:
        for tier in ("unique", "leg"):
            s = sum(pr for _, _, pr in POOLS[cat][tier])
            if abs(s - 1) > 1e-12:
                broken.append((cat, tier, s))
                print(f"  {cat}.{tier:<8} sums to {s:.6f}  <-- BROKEN")
    if not broken:
        print("  all 22 pools sum to 1")
    else:
        for cat, tier, _ in broken:
            entries = POOLS[cat][tier]
            den = round(1 / min(pr for _, _, pr in entries if pr > 0) * min(pr for _, _, pr in entries if pr > 0))
            print()
            print(f"  {cat}.{tier} numerators (denominator 52):")
            for n, v, pr in entries:
                print(f"      {n:<12} {v:>4}   {round(pr*52):>3}/52")
            good = sum(round(pr*52) for n, _, pr in entries if n != "Zero")
            print(f"    desirable lines total {good}, so Zero must be {52-good}, not "
                  f"{[round(pr*52) for n,_,pr in entries if n=='Zero'][0]}")

        print()
    print("cubing.py's own committed example (secondary, red, ATT>=21 & BOSS>=30):")
    d = ref.create_desired_values(["ATT", "BOSS"], [21, 30])
    p = ref.calc_prob("red", "secondary", d)
    print(f"  probability {p:.10f}   avg cubes {1/p:,.0f}   "
          f"avg cost {ref.cube_cost['red']/p:,.0f}")

    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
