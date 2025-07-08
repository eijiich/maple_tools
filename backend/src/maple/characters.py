from typing import List, Dict, Union, Optional
from .equipment import Equipment
from .flames import Flames, FlameWeights
from .pots import Potentials, PotentialLine

class Character:
    def __init__(
        self,
        character_class: str,
        character_name: str,
        equipments: List[Equipment],
    ):
        self.character_class = character_class
        self.character_name = character_name
        self.equipments = equipments

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