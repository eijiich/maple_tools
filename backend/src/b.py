import csv

# The input data (list of characters)
data = [
    {
    "class": "Bishop",
    "name": "Ayamushy",
    "equipments": [
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
              "position": 2,
              "stat": "all_stats",
              "value": 7
            },
            {
              "position": 3,
              "stat": "all_stats",
              "value": 7
            }
          ],
          "total_stats": 30
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
        "equipped": True
      }
    ]
    },
    {
        "class": "Lynn",
        "name": "KawaiiBotan",
        "equipments": [
            {
                "type": "Top",
                "set": "CRA",
                "star_force": 21,
                "potentials": {
                    "total_stats": 30
                },
                "flames": {
                    "flame_score": 90
                },
                "equipped": True
            }
        ]
    }
]

# Initialize data storage for each CSV
equipped_items = []
star_force = []
potentials = []
flames = []

# Set to keep track of all equipment types
equipment_types = set()

# Process each character and their equipments
for character in data:
    if character["equipments"] is not None:
        character_class = character["class"]
        character_name = character["name"]
        
        # Base row for each CSV (class and name)
        equipped_row = {"class": character_class, "name": character_name}
        star_force_row = {"class": character_class, "name": character_name}
        potentials_row = {"class": character_class, "name": character_name}
        flames_row = {"class": character_class, "name": character_name}
        
        # Loop through each equipment
        for equip in character["equipments"]:
            if equip["equipped"]:
                equip_type = equip["type"].lower()  # e.g., 'hat', 'top'
                equipment_types.add(equip_type)  # Add to the set of equipment types
                equipped_row[equip_type] = equip["set"]
                star_force_row[equip_type] = equip["star_force"]
                potentials_row[equip_type] = equip["potentials"]["total_stats"]
                flames_row[equip_type] = equip["flames"]["flame_score"]

        # Add rows to the corresponding lists
        equipped_items.append(equipped_row)
        star_force.append(star_force_row)
        potentials.append(potentials_row)
        flames.append(flames_row)

# Convert the set of equipment types to a sorted list
equipment_types = sorted(equipment_types)

# Define fieldnames for each CSV
equipped_fieldnames = ['class', 'name'] + equipment_types
star_force_fieldnames = ['class', 'name'] + equipment_types
potentials_fieldnames = ['class', 'name'] + equipment_types
flames_fieldnames = ['class', 'name'] + equipment_types

# Helper function to write data to CSV
def write_csv(filename, data, fieldnames):
    with open(filename, mode='w', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)

# Write each CSV file with the appropriate fieldnames
write_csv('equipped_items.csv', equipped_items, equipped_fieldnames)
write_csv('star_force.csv', star_force, star_force_fieldnames)
write_csv('potentials.csv', potentials, potentials_fieldnames)
write_csv('flames.csv', flames, flames_fieldnames)