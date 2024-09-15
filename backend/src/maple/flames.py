from typing import List, Dict, Union, Optional

class FlameWeights:
    def __init__(
        self,
        main_stats: float = 1.0,
        secondary_stats: float = 0.1,
        att: float = 3.0,
        all_stats: float = 9.0,
    ):
        self.main_stats = main_stats
        self.secondary_stats = secondary_stats
        self.att = att
        self.all_stats = all_stats

    def asList(self):
        return [self.main_stats, self.secondary_stats, self.att, self.all_stats]

    def asDict(self):
        return {
            "main_stats": self.main_stats,
            "secondary_stats": self.secondary_stats,
            "att": self.att,
            "all_stats": self.all_stats,
        }

    def __str__(self):
        return f"{str(self.asDict())})"

class Flames:
    values: Optional[dict] = {'main_stats': None, 'secondary_stats': None, 'att': None, 'all_stats': None}
    weights: Optional[FlameWeights] = None
    flame_score: Optional[int] = None
    
    def __init__(
        self,
        main_stats: int = None,
        secondary_stats: int = None,
        att: int = None,
        all_stats: int = None,
        weights: Optional[FlameWeights] = None,
        flame_score: int = None
    ):
        if flame_score is not None:
            self.flame_score = flame_score
        else:
            try:
                # Initialize values, default to 0 if None is passed
                self.values = {
                    "main_stats": main_stats if main_stats is not None else 0,
                    "secondary_stats": secondary_stats if secondary_stats is not None else 0,
                    "att": att if att is not None else 0,
                    "all_stats": all_stats if all_stats is not None else 0,
                }
                # Initialize weights with default values if not provided
                if weights is None:
                    self.weights = FlameWeights()
                else:
                    self.weights = weights
                    
                # Calculate flame_score using attributes of the FlameWeights object
                self.flame_score = (
                    self.values["main_stats"] * self.weights.main_stats +
                    self.values["secondary_stats"] * self.weights.secondary_stats +
                    self.values["att"] * self.weights.att +
                    self.values["all_stats"] * self.weights.all_stats
                )
                
            except Exception as e:
                raise ValueError(f"Missing values to calculate the flames: {e}")
        
        
    
    def asDict(self):
        return {
            "values": self.values,
            # "weights": (self.weights.asDict() if self.weights is not None else None), 
            "flame_score": self.flame_score,
        }
    
    def __str__(self):
        return f"{str(self.asDict())}"
    
if __name__ == '__main__':
    teste = [
        {
            "type": "Hat",
            "set": "Eternal",
            "name": None,
            "star_force": 18,
            "potentials": {
            "lines": [
                {
                "position": 1,
                "stat": "int",
                "value": 13
                },
                {
                "position": 1,
                "stat": "all_stats",
                "value": 7
                },
                {
                "position": 1,
                "stat": "all_stats",
                "value": 7
                },
            ],
            "total_stats": 30,
            },
            "flames": {
                "values": {
                    "main_stats": None,
                    "secondary_stats": None,
                    "att": None,
                    "all_stats": None
                },
                "flame_score": 164
            },
            "preset_1": True,
            "preset_2": True,
            "preset_3": True,
            "equipped": True,
        }
    ]
    
    flames = teste[0]["flames"]
    print(flames)
    
    flames_object = Flames(flame_score = flames["flame_score"])
    print(flames_object)
    print(flames_object.flame_score)
    print(flames_object.weights)