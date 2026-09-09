"""
Generate sf-stats.js from the saved MapleStory Wiki page.

Source: "Star Force Enhancement_Stat Tables - MapleStory Wiki.htm" (saved locally).
Only the *Delta Values* tables (per-star gain) are used, for Weapons and for
Armor & Accessories. Badges and the Cumulative tables are not used.

Things the page does that this parser has to respect:

  * Weapon attack gains below 16* are MathML formulas over the weapon's own base
    attack -- floor(att_base * mul + add) -- so they are emitted as {mul, add}
    rather than a constant.
  * Armor rows carry slot-conditional lines ("Gloves' Attack Power +1",
    "Shoes' Speed +1", "Overalls' DEF +5%"). A possessive-qualified line applies
    only to that slot and must NOT be read as a general gain. Gloves' attack is
    kept separately; speed/jump/DEF are dropped as combat-irrelevant.
  * From 23* up, neither weapons nor armor grant class stat at all -- the gain is
    pure attack. That is real, not a parse failure.
  * A blank cell means that level bracket cannot reach that star, which is how we
    derive the star cap per bracket instead of hardcoding it.
  * The weapon table has no level-250 column; the armor table does.

Run:  python tools/extract_sf_stats.py           # writes ../sf-stats.js
      python tools/extract_sf_stats.py --dump    # print parsed cells, write nothing
"""

import html
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
SRC = BASE / "reference" / "Star Force Enhancement_Stat Tables - MapleStory Wiki.htm"
OUT = BASE / "js" / "sf-stats.js"

# <td> column order. The weapon table stops at the 200-249 column.
BRACKETS = [
    ("128-137", 128, 137),
    ("138-149", 138, 149),
    ("150-159", 150, 159),
    ("160-199", 160, 199),
    ("200-249", 200, 249),
    ("250",     250, 250),
]


def math_to_text(m):
    """Collapse a MathML element to its concatenated token text."""
    inner = re.sub(r"<[^>]+>", "", m)
    return re.sub(r"\s+", "", html.unescape(inner))


def cell_segments(td_html):
    """One <td> of HTML -> list of 'Label +N' strings (split on <br>)."""
    s = re.sub(r"<math.*?</math>", lambda mo: math_to_text(mo.group(0)), td_html, flags=re.S)
    s = re.sub(r"<sup.*?</sup>", "", s, flags=re.S)
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return [seg.strip() for seg in s.split("\n") if seg.strip()]


def split_cells(row_html, ncols):
    """(star, [segments-per-column]) with colspan expanded, or None."""
    star_m = re.search(r"<th[^>]*>\s*(\d+)★", row_html)
    if not star_m:
        return None
    star = int(star_m.group(1))

    cols = []
    for cm in re.finditer(r"<td([^>]*)>(.*?)</td>", row_html, re.S):
        attrs, body = cm.group(1), cm.group(2)
        span_m = re.search(r'colspan="(\d+)"', attrs)
        span = int(span_m.group(1)) if span_m else 1
        segs = cell_segments(body)
        cols.extend([segs] * span)

    if not cols:
        return None
    # a colspan row spans however many columns the table actually has
    cols = cols[:ncols]
    return star, cols


# A leading "Word' " marks the line as applying only to that slot.
POSSESSIVE = re.compile(r"^\w+'\s")

FORMULA = re.compile(r"\+⌊(?:m?att)base×([0-9.]+)(?:\+([0-9]+))?⌋")
FLAT = re.compile(r"\+(\d+)")


def read_value(segs, label, possessive=None):
    """
    Find `label` among the segments and return its gain.

    possessive=None  -> only unqualified lines ("Attack Power +7")
    possessive="Gloves" -> only that slot's lines ("Gloves' Attack Power +1")

    Returns int, or {'mul','add'} for the base-attack formula, or 0 if absent.
    """
    for seg in segs:
        qualified = POSSESSIVE.match(seg)
        if possessive is None:
            if qualified:
                continue
            if not seg.startswith(label):
                continue
        else:
            if not seg.startswith(possessive + "' " + label):
                continue

        fm = FORMULA.search(seg)
        if fm:
            return {"mul": float(fm.group(1)), "add": int(fm.group(2) or 0)}
        im = FLAT.search(seg)
        if im:
            return int(im.group(1))
    return 0


def parse_section(sec_html, ncols):
    """Delta table -> ({star: entry}, {bracket_index: max_star})."""
    start = sec_html.index("Delta Values")
    end = sec_html.find("Cumulative Values")
    body = sec_html[start : end if end != -1 else len(sec_html)]

    table = {}
    caps = {i: 0 for i in range(ncols)}

    for rm in re.finditer(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        parsed = split_cells(rm.group(1), ncols)
        if not parsed:
            continue
        star, cols = parsed
        entry = {"stat": [], "att": [], "matt": [], "glovesAtt": [], "glovesMatt": []}
        for i, segs in enumerate(cols):
            if segs:
                caps[i] = max(caps[i], star)
            entry["stat"].append(read_value(segs, "Class Stat"))
            entry["att"].append(read_value(segs, "Attack Power"))
            entry["matt"].append(read_value(segs, "Magic Attack"))
            entry["glovesAtt"].append(read_value(segs, "Attack Power", "Gloves"))
            entry["glovesMatt"].append(read_value(segs, "Magic Attack", "Gloves"))
        table[star] = entry
    return table, caps


def js_val(v):
    if isinstance(v, dict):
        return "{mul:%g,add:%d}" % (v["mul"], v["add"])
    return str(v)


def js_table(name, table, ncols, comment):
    lines = [f"// {comment}", f"const {name} = {{"]
    for star in sorted(table):
        e = table[star]
        parts = []
        for key in ("stat", "att", "matt", "glovesAtt", "glovesMatt"):
            vals = e[key][:ncols]
            if not any(v != 0 for v in vals):
                continue
            parts.append(f"{key}:[" + ",".join(js_val(x) for x in vals) + "]")
        lines.append(f"  {star}: {{ " + ", ".join(parts) + " },")
    lines.append("};")
    return "\n".join(lines)


def main():
    src = SRC.read_text(encoding="utf-8")

    def section(h2_id, next_id):
        a = src.index(f'<h2 id="{h2_id}"')
        b = src.index(f'<h2 id="{next_id}"') if next_id else len(src)
        return src[a:b]

    # weapons: 5 columns (no lv250); armor: 6
    wt, wcaps = parse_section(section("Weapons", "Armor_and_Accessories"), 5)
    at, acaps = parse_section(section("Armor_and_Accessories", "Badges"), 6)

    if "--dump" in sys.argv:
        for label, tbl, caps, n in (("WEAPONS", wt, wcaps, 5), ("ARMOR", at, acaps, 6)):
            print(f"===== {label}   caps by bracket: "
                  + ", ".join(f"{BRACKETS[i][0]}={caps[i]}" for i in range(n)))
            for star in sorted(tbl):
                e = tbl[star]
                bits = []
                for k in ("stat", "att", "glovesAtt"):
                    vals = e[k][:n]
                    if any(v != 0 for v in vals):
                        bits.append(f"{k}={[js_val(x) for x in vals]}")
                print(f"  {star:>2}*  " + "  ".join(bits))
        return

    brackets_js = "\n".join(
        '  { label:"%s", min:%d, max:%d },' % b for b in BRACKETS
    )
    caps_w = ",".join(str(wcaps[i]) for i in range(5)) + ",%d" % wcaps[4]
    caps_a = ",".join(str(acaps[i]) for i in range(6))

    header = f'''// GENERATED by tools/extract_sf_stats.py -- do not edit by hand.
// Source: "{SRC.name}" (MapleStory Wiki, Delta Values tables).
//
// Per-star stat gain, indexed [star][bracketIndex]. Use sfBracket(level) for the
// index. Keys absent from a star's entry are zero for every bracket.
//
//   stat        gain applied to EACH class-relevant stat. A mage gets this on
//               both INT and LUK, so its value is stat * (w_main + w_sub) --
//               it is NOT a single total.
//   att/matt    flat attack gain. Below 16* on weapons this is a {{mul, add}}
//               formula over the weapon's own base attack:
//               gain = floor(base * mul + add).
//   glovesAtt   slot-conditional: applies only to gloves.
//
// From 23* up there is no class stat at all -- the gain is pure attack.
// DEF, Max HP, Speed and Jump are dropped as combat-irrelevant here.
//
// The weapon table has no level-250 column, so SF_CAP_WEAPON's last entry
// repeats the 200-249 column. Moot in practice: the endgame weapon arrives at
// 22* with its remaining stars granted by quests, not bought with meso.

const SF_BRACKETS = [
{brackets_js}
];

// bracket index for an item level, or -1 if below the table
function sfBracket(level) {{
  for (let i = 0; i < SF_BRACKETS.length; i++) {{
    if (level >= SF_BRACKETS[i].min && level <= SF_BRACKETS[i].max) return i;
  }}
  return level > 250 ? SF_BRACKETS.length - 1 : -1;
}}

// max reachable star per bracket, derived from where the wiki cells go blank
const SF_CAP_WEAPON = [{caps_w}];
const SF_CAP_ARMOR  = [{caps_a}];
'''

    body = "\n\n".join([
        header,
        js_table("SF_STATS_WEAPON", wt, 5, "Weapons."),
        js_table("SF_STATS_ARMOR", at, 6, "Armor & accessories."),
        "",
    ])
    OUT.write_text(body, encoding="utf-8")
    print(f"wrote {OUT}")
    print(f"  weapon caps {[wcaps[i] for i in range(5)]}")
    print(f"  armor  caps {[acaps[i] for i in range(6)]}")


if __name__ == "__main__":
    main()
