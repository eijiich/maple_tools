"""
Cross-check of the star force engine vendored into sf.js.

This mirrors sf.js line for line in Python so the numbers can be compared
against lostara's own UI by hand: open lostara_sf_caculator.html, enter the same
item level / star range / event / spares, and the expected cost must match.

Run: python tools/verify_sf.py
"""

import math

STAR_ENHANCE_MIN = 15
STAR_ENHANCE_MAX = 21
STAR_ENHANCE_MODES = 4
STAR_MAX = 30

RATES = [
    (0.95, 0.05, 0), (0.90, 0.10, 0), (0.85, 0.15, 0), (0.85, 0.15, 0),
    (0.80, 0.20, 0), (0.75, 0.25, 0), (0.70, 0.30, 0), (0.65, 0.35, 0),
    (0.60, 0.40, 0), (0.55, 0.45, 0), (0.50, 0.50, 0), (0.45, 0.55, 0),
    (0.40, 0.60, 0), (0.35, 0.65, 0), (0.30, 0.70, 0),
    (0.30, 0.679, 0.021), (0.30, 0.679, 0.021),
    (0.15, 0.782, 0.068), (0.15, 0.782, 0.068), (0.15, 0.765, 0.085),
    (0.30, 0.595, 0.105), (0.15, 0.7225, 0.1275), (0.15, 0.68, 0.17),
    (0.10, 0.72, 0.18), (0.10, 0.72, 0.18), (0.10, 0.72, 0.18),
    (0.07, 0.744, 0.186), (0.05, 0.76, 0.19), (0.03, 0.776, 0.194),
    (0.01, 0.792, 0.198),
]

ENHANCE_MODES = [
    [(0.30,0.679,0.021,1.0),(0.30,0.68688,0.01313,1.5),(0.30,0.69475,0.00525,2.5),(0.30,0.70,0.0,3.0)],
    [(0.30,0.679,0.021,1.0),(0.30,0.68688,0.01313,1.5),(0.30,0.69475,0.00525,2.5),(0.30,0.70,0.0,3.0)],
    [(0.15,0.782,0.068,1.0),(0.15,0.8075,0.0425,1.5),(0.15,0.833,0.017,2.5),(0.15,0.85,0.0,3.0)],
    [(0.15,0.782,0.068,1.0),(0.12,0.836,0.044,2.0),(0.10,0.882,0.018,3.5),(0.08,0.92,0.0,6.5)],
    [(0.15,0.765,0.085,1.0),(0.12,0.8184,0.0616,2.0),(0.10,0.864,0.036,3.5),(0.08,0.92,0.0,6.5)],
    [(0.30,0.595,0.105,1.0),(0.25,0.675,0.075,2.0),(0.20,0.76,0.04,3.5),(0.15,0.85,0.0,6.5)],
    [(0.15,0.7225,0.1275,1.0),(0.12,0.792,0.088,2.0),(0.10,0.855,0.045,3.5),(0.08,0.92,0.0,6.5)],
]


def get_rates(s, mode_idx, boom_off, catching):
    if STAR_ENHANCE_MIN <= s <= STAR_ENHANCE_MAX:
        ps, pf, pd, _ = ENHANCE_MODES[s - STAR_ENHANCE_MIN][mode_idx]
    else:
        ps, pf, pd = RATES[s]
    if boom_off and s <= STAR_ENHANCE_MAX and pd > 0:
        red = pd * 0.30
        pd -= red
        pf += red
    if catching and ps < 1:
        ps_new = ps * 1.05
        scale = (1 - ps_new) / (1 - ps)
        pf *= scale
        pd *= scale
        ps = ps_new
    return ps, pf, pd


def recovery_star(s):
    if s <= 19: return 12
    if s == 20: return 15
    if s <= 22: return 17
    if s <= 25: return 19
    return 20


def raw_cost(S, L):
    if S <= 9:   return 1000 + math.floor(L**3 * (S+1) / 25)
    if S == 10:  return 1000 + math.floor(L**3 * 11**2.7 / 400)
    if S == 11:  return 1000 + math.floor(L**3 * 12**2.7 / 220)
    if S == 12:  return 1000 + math.floor(L**3 * 13**2.7 / 150)
    if S == 13:  return 1000 + math.floor(L**3 * 14**2.7 / 110)
    if S == 14:  return 1000 + math.floor(L**3 * 15**2.7 / 75)
    if S == 15:  return 1000 + math.floor(L**3 * 16**2.7 / 200)
    if S == 16:  return 1000 + math.floor(L**3 * 17**2.7 / 200)
    if S == 17:  return 1000 + math.floor(L**3 * 18**2.7 / 150)
    if S == 18:  return 1000 + math.floor(L**3 * 19**2.7 / 70)
    if S == 19:  return 1000 + math.floor(L**3 * 20**2.7 / 45)
    if S == 20:  return 1000 + math.floor(L**3 * 21**2.7 / 200)
    if S == 21:  return 1000 + math.floor(L**3 * 22**2.7 / 125)
    return 1000 + math.floor(L**3 * (S+1)**2.7 / 200)


def js_round(x):
    """JS Math.round: halves go up, not to even like Python's round()."""
    return math.floor(x + 0.5)


def attempt_cost(s, L, mvp, cost_off, mode_idx):
    raw = raw_cost(s, L)
    mult = ENHANCE_MODES[s - STAR_ENHANCE_MIN][mode_idx][3] \
        if STAR_ENHANCE_MIN <= s <= STAR_ENHANCE_MAX else 1.0
    mvp_factor = (1 - mvp) if s <= 16 else 1
    total = mult * (0.70 if cost_off else 1) * mvp_factor
    return js_round(raw * total / 100) * 100


def solve_spares(L, mvp, cost_off, boom_off, catching, to, max_y, item_cost=0):
    INF = float('inf')
    V = [[INF] * (max_y + 1) for _ in range(STAR_MAX + 1)]
    pol = [[0] * (max_y + 1) for _ in range(STAR_MAX + 1)]
    for y in range(max_y + 1):
        V[to][y] = 0.0
    for y in range(1, max_y + 1):
        for s in range(to - 1, -1, -1):
            r = recovery_star(s)
            n_modes = STAR_ENHANCE_MODES if STAR_ENHANCE_MIN <= s <= STAR_ENHANCE_MAX else 1
            best, best_m = INF, 0
            for m in range(n_modes):
                ps, _, pd = get_rates(s, m, boom_off, catching)
                cost = attempt_cost(s, L, mvp, cost_off, m)
                if pd == 0:
                    rec = 0.0
                else:
                    rec = pd * ((item_cost + V[r][y-1]) if y >= 2 else INF)
                num = cost + ps * V[s+1][y] + rec
                val = num / (ps + pd) if num != INF else INF
                if val < best:
                    best, best_m = val, m
            V[s][y] = best
            pol[s][y] = best_m
    return V, pol


def solve_unconstrained(L, mvp, cost_off, boom_off, catching, to, item_cost=0):
    X = [0.0] * (STAR_MAX + 1)
    pol = [0] * (STAR_MAX + 1)
    for s in range(to):
        r = recovery_star(s)
        cum_x = sum(X[min(r, s):s])
        n_modes = STAR_ENHANCE_MODES if STAR_ENHANCE_MIN <= s <= STAR_ENHANCE_MAX else 1
        best, best_m = float('inf'), 0
        for m in range(n_modes):
            ps, _, pd = get_rates(s, m, boom_off, catching)
            cost = attempt_cost(s, L, mvp, cost_off, m)
            val = cost / ps if pd == 0 else (cost + pd * (item_cost + cum_x)) / ps
            if val < best:
                best, best_m = val, m
        X[s], pol[s] = best, best_m
    V = [0.0] * (STAR_MAX + 2)
    for s in range(to - 1, -1, -1):
        V[s] = V[s + 1] + X[s]
    return V, pol


def expected_booms(L, boom_off, catching, frm, to, mode_at):
    D = [0.0] * (STAR_MAX + 1)
    for s in range(to):
        ps, _, pd = get_rates(s, mode_at(s), boom_off, catching)
        if pd == 0:
            continue
        r = recovery_star(s)
        rec = sum(D[min(r, s):s])
        D[s] = pd * (1 + rec) / ps
    return sum(D[frm:to])


def fm(x):
    if x == float('inf'): return 'unreachable'
    if x >= 1e12: return f'{x/1e12:.2f}t'
    if x >= 1e9:  return f'{x/1e9:.2f}b'
    if x >= 1e6:  return f'{x/1e6:.1f}m'
    return f'{x:,.0f}'


CASES = [
    ("lv150  0->15", 150, 0, 15),
    ("lv150 15->16", 150, 15, 16),
    ("lv150 17->18", 150, 17, 18),
    ("lv150 21->22", 150, 21, 22),
    ("lv150 22->23", 150, 22, 23),
    ("lv150 17->22", 150, 17, 22),
    ("lv160 17->22", 160, 17, 22),
    ("lv200 21->22", 200, 21, 22),
    ("lv160 22->30", 160, 22, 30),
    ("lv250 22->30", 250, 22, 30),
]

def main():
    print("SSF (30% off + 30% boom reduction), star catch on, mvp 0, itemCost 0")
    print()
    print("UNCONSTRAINED -- expected meso, booming as often as needed.")
    print("This is what the ranking uses. Compare against lostara's expected cost.")
    print(f"{'case':<14}{'exp. cost':>12}{'booms':>8}   mode policy (stars 15-21)")
    print("-" * 74)
    for label, L, frm, to in CASES:
        V, pol = solve_unconstrained(L, 0, True, True, True, to, 0)
        booms = expected_booms(L, True, True, frm, to, lambda s: pol[s])
        modes = " ".join(f"{s}*:m{pol[s]+1}"
                         for s in range(max(frm, 15), min(to, 22)))
        print(f"{label:<14}{fm(V[frm]):>12}{booms:>8.2f}   {modes}")

    print()
    print("SAFE (one item, no backups -- only zero-destroy modes allowed).")
    print("Infinity above 21* is correct: no such mode exists there.")
    print(f"{'case':<14}{'exp. cost':>12}   mode policy")
    print("-" * 60)
    for label, L, frm, to in CASES:
        V, pol = solve_spares(L, 0, True, True, True, to, 1, 0)
        c = V[frm][1]
        modes = "" if c == float('inf') else " ".join(
            f"{s}*:m{pol[s][1]+1}" for s in range(max(frm, 15), min(to, 22)))
        print(f"{label:<14}{fm(c):>12}   {modes}")

    print()
    print("per-attempt cost, mode 1 vs mode 4 (SSF), for eyeballing rawCost:")
    for L in (150, 200):
        print(f"  lv{L}")
        for s in (0, 14, 15, 17, 18, 19, 21, 22, 25, 29):
            m1 = attempt_cost(s, L, 0, True, 0)
            m4 = attempt_cost(s, L, 0, True, 3) if 15 <= s <= 21 else None
            extra = f"   mode4 {fm(m4):>9}" if m4 else ""
            print(f"    {s:>2}* -> {s+1:<3} mode1 {fm(m1):>9}{extra}")


if __name__ == "__main__":
    main()
