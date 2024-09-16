from typing import List, Dict, Union, Optional
from flames import Flames, FlameWeights
from pots import Potentials, PotentialLines

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
    # Example usage
if __name__ == '__main__':
    # Assuming Potentials and Flames classes are defined properly
    potentials = Potentials(lines=None, total_stats=None)
    flames = Flames(values=None, flame_score=None)
    
    equipment = Equipment(
        equip_type=None,
        equip_set=None,
        equip_name=None,
        star_force=None,
        potentials=potentials,
        flames=flames,
        preset_1=True,
        preset_2=True,
        preset_3=True,
        equipped=True
    )
    
    print(equipment)