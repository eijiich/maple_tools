from typing import List, Dict, Union, Optional
from flames import Flames, FlameWeights
from pots import Potentials, PotentialLine

class Equipment:
    def __init__(
        self,
        equip_type: str,
        equip_set: str,
        equip_name: Optional[str],
        star_force: int,
        potentials: Potentials,
        flames: Flames,
        preset_1: bool = False,
        preset_2: bool = False,
        preset_3: bool = False,
        equipped: bool = False,
    ):
        self.equip_type = equip_type
        self.equip_set = equip_set
        self.equip_name = equip_name
        self.star_force = star_force
        self.potentials = potentials
        self.flames = flames
        self.preset_1 = preset_1
        self.preset_2 = preset_2
        self.preset_3 = preset_3
        self.equipped = equipped

    def as_dict(self):
        return {
            "equip_type": self.equip_type,
            "equip_set": self.equip_set,
            "equip_name": self.equip_name,
            "star_force": self.star_force,
            "potentials": self.potentials.as_dict() if self.potentials else None,
            "flames": self.flames.as_dict() if self.flames else None,
            "preset_1": self.preset_1,
            "preset_2": self.preset_2,
            "preset_3": self.preset_3,
            "equipped": self.equipped,
        }
    
    def __str__(self):
        return (str(self.as_dict()))


a = [
    'hat',

    'overall',
    'top',
    
    'bottom',
    

    'gloves',

    'shoes',

    'cape',
    'shoulder',
    'belt',

    'face'
    'eye',
    'ring',
    'earring',
    'pendant',

    'heart'

    'weapon',

    'secondary',

    'emblem'
]


if __name__ == '__main__':
    # Assuming Potentials and Flames classes are defined properly
    pot_lines = [
        PotentialLine(1, "main_stats", 30),
        PotentialLine(2, "main_stats", 30),
        PotentialLine(3, "main_stats", 30),
    ]
    pots = Potentials(pot_lines)

    flames = Flames(flame_score = 69)

    equipment = Equipment(
        equip_type="Bottom",
        equip_set="CRA",
        equip_name=None,
        star_force=21,
        potentials=pots,
        flames=flames,
        preset_1=True,
        preset_2=False,
        preset_3=False,
        equipped=True
    )

    print(equipment)

    