import json
from maple.characters import Character
from maple.equipment import Equipment
from maple.flames import Flames
from maple.pots import Potentials, PotentialLine
from maple.maple_schemas import FlameValuesSchema, FlamesSchema, PotentialLineSchema, PotentialsSchema, EquipmentSchema

def test_equipment():
    pot_lines = [
        PotentialLine(1, "main_stats", 30),
        PotentialLine(2, "main_stats", 30),
        PotentialLine(3, "main_stats", 30),
    ]
    pots = Potentials(pot_lines)
    flames = Flames(flame_score=69)

    equipment = Equipment(
        equip_type="Bottom",
        equip_set="CRA",
        equip_name=None,
        star_force=21,
        potentials=pots,
        flames=flames,
        preset_1=True,
        equipped=True
    )
    return(equipment)

def test_flames():
    data = [
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
    
    flames = data[0]["flames"]
    # print(flames)
    
    flames_object = Flames(flame_score = flames["flame_score"])
    # print(flames_object)
    # print(flames_object.flame_score)
    # print(flames_object.weights)
    return flames_object

def test_pots():
    data = [
        PotentialLine(position=1, stat="main_stats", value=13),
        PotentialLine(position=1, stat="main_stats", value=7),
        PotentialLine(position=1, stat="all_stats", value=7),
    ]
    
    potentials = Potentials(lines=data)
    # print(potentials)
    # print("Total stats sum:", potentials.total_stats)
    return potentials

def test_schemas():
    
    equipments = [
        {
            "equip_type": "Hat",
            "equip_set": "Eternal",
            "equip_name": None,
            "star_force": 18,
            "potentials": {
                "lines": [
                    {
                    "position":None,
                    "stat":None,
                    "value":None,
                    },
                    {
                    "position":None,
                    "stat":None,
                    "value":None,
                    },
                    {
                    "position":None,
                    "stat":None,
                    "value":None,
                    },
                ],
            "total_stats": None,
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

    # Deserialize
    equipment_schema = EquipmentSchema()
    equipment_data = equipment_schema.load(equipments[0])
    #print(equipment_data)

    # Serialize
    serialized_data = equipment_schema.dump(equipment_data)
    pretty_json = json.dumps(serialized_data, indent=4)
    print('\nEquipment:')
    print(pretty_json)

    pot_lines = [
        PotentialLine(1, "main_stats", 30),
        PotentialLine(2, "main_stats", 30),
        PotentialLine(3, "main_stats", 30),
    ]
    pots = Potentials(pot_lines)

    flames = Flames(flame_score = 69)
    flames_schema = FlamesSchema()
    serialized_data = flames_schema.dump(flames)
    pretty_json = json.dumps(serialized_data, indent=4)
    print('\nFlames:')
    print(pretty_json)

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

    equipment_schema = EquipmentSchema()
    serialized_data = equipment_schema.dump(equipment)
    pretty_json = json.dumps(serialized_data, indent=4)
    print('\nEquipment:')
    print(pretty_json)

if __name__ == '__main__':
    data = test_equipment()
    data = test_flames()
    data = test_pots()
    pretty_json = json.dumps(data.as_dict(), indent=4)
    # print(pretty_json)

    test_schemas()