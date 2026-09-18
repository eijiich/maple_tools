"""Maps in-game STAT window labels to maplescouter.com/en/input fields.

Three categories:

1. SINGLE_VALUE_FIELDS — directly writable single-number inputs on the site.
2. TABLE_STATS         — stats with a 3-column breakdown (Base / % / % Not Applied)
                         that live in a table at the top of the form. Values come
                         from the Stat Info side panel in-game, which displays
                         these three numbers when the user clicks the stat row.
3. CALCULATED          — appear in the game STAT window but the site computes them
                         from other inputs, so we ignore them on extract.
4. IGNORED             — stats in the STAT window that are unrelated to damage calc.
"""

SINGLE_VALUE_FIELDS = {
    "damage": "Damage",
    "boss damage": "Boss Damage",
    "ignore defense": "Ignore Enemy Defense",
    "critical rate": "Critical Rate",
    "critical damage": "Critical Damage",
    "cooldown reduction": "Cooldown Reduction",
    "cooldown not applied": "Cooldown Skip",
    "buff duration": "Buff Duration",
    "ignore elemental resistance": "Ignore Elemental Resistance",
    "additional status damage": "Additional Status Damage",
    "summons duration increase": "Summon Duration",
    "arcane power": "Arcane Force",
    "sacred power": "Sacred Force",
}

# Stats that appear as rows in the site's "Base Value / % Value / % Value Not Applied" table.
# Row count and identity vary by class — INT/LUK/M.Attack for mages, STR/DEX/Attack for
# warriors, HP for Demon Avenger, etc. The OCR reads whichever stat name appears in the
# Stat Info panel title and matches against this set.
TABLE_STATS = {
    "STR", "DEX", "INT", "LUK",
    "Attack", "M.Attack",
    "HP",
}

# Game labels -> table-stat keys (normalized).
TABLE_STAT_ALIASES = {
    "str": "STR",
    "dex": "DEX",
    "int": "INT",
    "luk": "LUK",
    "attack power": "Attack",
    "magic att": "M.Attack",
    "magic attack": "M.Attack",
    "hp": "HP",
}

CALCULATED = {
    "damage range",
    "final damage",
    "normal enemy damage",
}

IGNORED = {
    "mp",
    "combat power",
    "mesos obtained",
    "star force",
    "item drop rate",
    "additional exp obtained",
}


def normalize(label: str) -> str:
    return " ".join(label.lower().split())


def lookup_single(label: str) -> str | None:
    """Return the site label for a directly-writable single-value field, or None."""
    return SINGLE_VALUE_FIELDS.get(normalize(label))


def lookup_table_stat(label: str) -> str | None:
    """Return the table-row key (e.g. 'M.Attack') for a Stat Info panel title, or None."""
    return TABLE_STAT_ALIASES.get(normalize(label))
