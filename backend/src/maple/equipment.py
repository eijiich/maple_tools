from typing import List, Dict, Union, Optional
from flames import Flames, FlameWeights


class Equipment:
    def __init__(
        self,
        equip_type: str,
        equip_set: str,
        equip_name: str,
        equip_star_force: int,
        equip_potentials,
        flames: Flames,
    ):
        self.equip_type = equip_type
        self.equip_set = equip_set
        self.equip_name = equip_name
        self.equip_star_force = equip_star_force
        self.equip_potentials = equip_potentials
        self.equip_flames = flames


equipments = [
    {
        "type": "Hat",
        "set": "Eternal",
        "name": None,
        "star_force": 18,
        "potentials": {
            "lines": [
                {"position": 1, "stat": "int", "value": 13},
                {"position": 1, "stat": "all_stats", "value": 7},
                {"position": 1, "stat": "all_stats", "value": 7},
            ],
            "total_stats": 30,
        },
        "flames": {
            "values": {
                "main_stats": None,
                "secondary_stats": None,
                "att": None,
                "all_stats": None,
            },
            "flame_score": 164,
        },
        "preset_1": True,
        "preset_2": True,
        "preset_3": True,
        "equipped": True,
    }
]
