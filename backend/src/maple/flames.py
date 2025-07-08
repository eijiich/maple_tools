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

    def as_list(self):
        return [self.main_stats, self.secondary_stats, self.att, self.all_stats]

    def as_dict(self):
        return {
            "main_stats": self.main_stats,
            "secondary_stats": self.secondary_stats,
            "att": self.att,
            "all_stats": self.all_stats,
        }

    def __str__(self):
        return f"{str(self.as_dict())})"

class FlameValues:
    def __init__(
        self,
        main_stats: int = None,
        secondary_stats: int = None,
        att: int = None,
        all_stats: int = None
    ):
        self.main_stats = main_stats
        self.secondary_stats = secondary_stats
        self.att = att
        self.all_stats = all_stats

    def as_dict(self):
        return {
            "main_stats": self.main_stats,
            "secondary_stats": self.secondary_stats,
            "att": self.att,
            "all_stats": self.all_stats,
        }

    def __str__(self):
        return f"{str(self.as_dict())}"
    
class Flames:
    values:  Optional[FlameValues] = None
    weights: Optional[FlameWeights] = None
    flame_score: Optional[int] = None
    
    def __init__(
        self,
        main_stats: int = None,
        secondary_stats: int = None,
        att: int = None,
        all_stats: int = None,
        weights: Optional[FlameWeights] = None,
        values: Optional[Dict[str,int]] = None,
        flame_score: int = None
    ):
        if flame_score is not None:
            self.flame_score = flame_score
        elif values is not None:
            try:
                # Initialize values, default to 0 if None is passed
                self.values = FlameValues(**values)
                # Initialize weights with default values if not provided
                self.weights = weights if weights else FlameWeights()
                    
                # Calculate flame_score using attributes of the FlameWeights object
                self.flame_score = (
                    self.values.main_stats * self.weights.main_stats +
                    self.values.secondary_stats * self.weights.secondary_stats +
                    self.values.att * self.weights.att +
                    self.values.all_stats * self.weights.all_stats
                )
                
            except Exception as e:
                raise ValueError(f"Missing values to calculate the flames: {e}")
        else:
            try:
                # Initialize values, default to 0 if None is passed
                self.values = FlameValues(
                    main_stats=main_stats if main_stats is not None else 0,
                    secondary_stats=secondary_stats if secondary_stats is not None else 0,
                    att=att if att is not None else 0,
                    all_stats=all_stats if all_stats is not None else 0
                )
                # Initialize weights with default values if not provided
                self.weights = weights if weights else FlameWeights()
                    
                # Calculate flame_score using attributes of the FlameWeights object
                self.flame_score = (
                    self.values.main_stats * self.weights.main_stats +
                    self.values.secondary_stats * self.weights.secondary_stats +
                    self.values.att * self.weights.att +
                    self.values.all_stats * self.weights.all_stats
                )
                
            except Exception as e:
                raise ValueError(f"Missing values to calculate the flames: {e}")
    
    def as_dict(self):
        return {
            "values": self.values.as_dict() if self.values else FlameValues().as_dict(),
            # "weights": (self.weights.as_dict() if self.weights is not None else None), 
            "flame_score": self.flame_score,
        }
    
    def __str__(self):
        return f"{str(self.as_dict())}"