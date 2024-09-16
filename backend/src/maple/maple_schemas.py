from typing import List, Dict, Union, Optional
from flames import Flames, FlameValues, FlameWeights
from pots import Potentials, PotentialLines
from equipment import Equipment
from marshmallow import Schema, fields, post_load, post_dump, pre_dump

#Marshmallow schemas
class FlameValuesSchema(Schema):
    main_stats = fields.Int(allow_none=True, load_default=None)
    secondary_stats = fields.Int(allow_none=True, load_default=None)
    att = fields.Int(allow_none=True, load_default=None)
    all_stats = fields.Int(allow_none=True, load_default=None)

class FlamesSchema(Schema):
    values = fields.Nested(FlameValuesSchema, allow_none=True, load_default=FlameValuesSchema().dump(FlameValues()))
    flame_score = fields.Float(allow_none=True, load_default=None)

    @post_dump
    def ensure_values_key(self, data, **kwargs):
        # Ensure that 'values' is always a dictionary, not None
        if data.get('values') is None:
            data['values'] = {
                "main_stats": None,
                "secondary_stats": None,
                "att": None,
                "all_stats": None
            }
        return data

    @post_load
    def make_flames(self, data, **kwargs):
        return Flames(**data)

class PotentialLinesSchema(Schema):
    position = fields.Float(allow_none=True, load_default=None)
    stat = fields.Str(allow_none=True, load_default=None)
    value = fields.Int(allow_none=True, load_default=None)

    @post_load
    def make_potential_line(self, data, **kwargs):
        return PotentialLines(**data)

class PotentialsSchema(Schema):
    lines = fields.List(fields.Nested(PotentialLinesSchema), allow_none=True, load_default=[])
    total_stats = fields.Int(allow_none=True, load_default=0)
    
    @pre_dump
    def handle_lines(self, data, **kwargs):
        #Ensure lines is never None and default to an empty list if None.
        if data.lines is None:
            data.lines = []
        return data

    @post_dump
    def fill_default_lines(self, data, **kwargs):
        #Ensure lines contains default entries if it's empty.
        if not data.get('lines'):
            num_defaults = 3  # Number of default entries you want
            data['lines'] = [
                {'position': None, 'stat': None, 'value': None}
                for _ in range(num_defaults)
            ]
        return data

    @post_load
    def make_potentials(self, data, **kwargs):
        return Potentials(**data)

class EquipmentSchema(Schema):
    equip_type = fields.Str(allow_none=True, load_default=None)
    equip_set = fields.Str(allow_none=True, load_default=None)
    equip_name = fields.Str(allow_none=True, load_default=None)
    star_force = fields.Int(allow_none=True, load_default=None)
    potentials = fields.Nested(PotentialsSchema, allow_none=True, load_default=PotentialsSchema().dump(Potentials()))
    flames = fields.Nested(FlamesSchema, allow_none=True, load_default=FlamesSchema().dump(Flames()))
    preset_1 = fields.Bool(allow_none=True, load_default=None)
    preset_2 = fields.Bool(allow_none=True, load_default=None)
    preset_3 = fields.Bool(allow_none=True, load_default=None)
    equipped = fields.Bool(allow_none=True, load_default=None)

    @post_load
    def make_equipment(self, data, **kwargs):
        return Equipment(**data)

equipments1 = [
    {
        "equip_type": None,
        "equip_set": None,
        "equip_name": None,
        "star_force": None,
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
            "flame_score": None,
        },
        "preset_1": True,
        "preset_2": True,
        "preset_3": True,
        "equipped": True,
    }
]

equipments2 = [
    {
        "equip_type": "Hat",
        "equip_set": "Eternal",
        "equip_name": None,
        "star_force": 18,
        "potentials": {
            "lines": None,
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

if __name__ == '__main__':# Example input data
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
    print(equipment_data)

    # Serialize
    serialized_data = equipment_schema.dump(equipment_data)
    print(serialized_data)

    # equipment_data = equipments2[0]
    # flames = Flames(**equipment_data['flames'])
    # potentials_lines = [PotentialLines(**line) for line in equipment_data['potentials']['lines']]
    # potentials = Potentials(lines=potentials_lines)

    # equipment_object = Equipment(
    #     equip_type=equipment_data['type'],
    #     equip_set=equipment_data['set'],
    #     equip_name=equipment_data['name'],
    #     star_force=equipment_data['star_force'],
    #     potentials=potentials,
    #     flames=flames,
    #     preset_1=equipment_data['preset_1'],
    #     preset_2=equipment_data['preset_2'],
    #     preset_3=equipment_data['preset_3'],
    #     equipped=equipment_data['equipped']
    # )

    # # Serialize to JSON
    # equipment_schema = EquipmentSchema()
    # json_data = equipment_schema.dump(equipment_object)
    # print(json_data)

    # # Deserialize from JSON back to an object
    # loaded_equipment = equipment_schema.load(json_data)
    # print(loaded_equipment)
