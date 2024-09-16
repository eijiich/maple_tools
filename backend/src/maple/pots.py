from typing import List, Dict, Union, Optional

list_of_possible_stats = [
    "stats",
    "all_stats",
    "HP",

    "Crit DMG",
    "CD",
    
    "Drop",
    "Meso",
    
    "ATT",
    "BOSS",
    "IED",
]

class PotentialLines:
    def __init__(
        self,
        position: float = None,
        stat: str = None,
        value: int = None
    ):
        self.position = position
        self.stat = stat
        self.value = value

    def as_list(self):
        return [self.position, self.stat, self.att, self.value]

    def as_dict(self):
        return {
            "position": self.position,
            "stat": self.stat,
            "value": self.value,
        }

    def __str__(self):
        return f"{str(self.as_dict())})"

class Potentials:
    def __init__(
        self,
        lines: Optional[List[PotentialLines]] = None,
        total_stats: Optional[int] = None,
    ):
        # Initialize weights with default values if not provided
        self.lines = lines if lines is not None else []
        self.total_stats = total_stats if total_stats is not None else self.calculate_total_stats()
   
    def calculate_total_stats(self):
        # Sum values where 'stats' is in the stat name
        return sum(line.value for line in self.lines if 'stats' in line.stat)

    def as_dict(self):
        # Generate a default list if lines is empty
        if not self.lines:
            # Define how many default entries you want
            num_defaults = 3
            self.lines = [PotentialLines() for _ in range(num_defaults)]
            
        return {
            "lines": [line.as_dict() for line in self.lines],
            "total_stats": self.total_stats,
        }

    def __str__(self):
        return f"{str(self.as_dict())}"

if __name__ == '__main__':
    teste = [
        PotentialLines(position=1, stat="main_stats", value=13),
        PotentialLines(position=1, stat="main_stats", value=7),
        PotentialLines(position=1, stat="all_stats", value=7),
    ]
    
    potentials = Potentials(lines=teste)
    print(potentials)
    print("Total stats sum:", potentials.total_stats)