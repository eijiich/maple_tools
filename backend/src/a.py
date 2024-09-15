import duckdb
import polars as pl
import json
from pathlib import Path
import csv

def check_file_existance(file_path: Path):
    if file_path.exists():
        print("File exists")

# Helper function to write data to CSV
def write_csv(filename, data, fieldnames):
    with open(filename, mode='w', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)

# Helper function to create a Polars DataFrame
def create_dataframe(data, extra_columns):
    if not data:
        return pl.DataFrame()  # No data to create
    # Ensure all columns are present, even if some are missing
    for row in data:
        for equip_type in extra_columns:
            if equip_type not in row:
                row[equip_type] = None
    return pl.DataFrame(data)

base_folder = Path(__file__).resolve().parent.parent / 'data/database'
characters_file = base_folder / 'Characters.json'
equipments_file = base_folder / 'Equipments.json'

# check_file_existance(characters_file)
# check_file_existance(equipments_file)

# Load the two JSON files
with open(characters_file, 'r') as f:
    characters_data = json.load(f)

with open(equipments_file, 'r') as f:
    equipments_data = json.load(f)

data = equipments_data

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

equipped_items_df = create_dataframe(equipped_items, equipment_types)
star_force_df = create_dataframe(star_force, equipment_types)
potentials_df = create_dataframe(potentials, equipment_types)
flames_df = create_dataframe(flames, equipment_types)
characters_df = pl.DataFrame(characters_data)

# Optionally, display the DataFrames
print("Equipped Items DataFrame:")
print(equipped_items_df)

print("\nStar Force DataFrame:")
print(star_force_df)

print("\nPotentials DataFrame:")
print(potentials_df)

print("\nFlames DataFrame:")
print(flames_df)

# Convert JSON data to Polars DataFrames
print("\nCharacterrs DataFrame:")

# Create DuckDB connection
con = duckdb.connect()

# Register the Polars DataFrames as DuckDB tables
con.register("characters", characters_df.to_pandas())  # DuckDB requires Pandas input
con.register("star_force", star_force_df.to_pandas())
con.register("potentials", potentials_df.to_pandas())
con.register("flames", flames_df.to_pandas())

# Perform SQL query to join both DataFrames on 'Class' and 'Name'
query = """
SELECT 
    characters.Class AS class,
    characters.Name AS name,
    characters.Level AS level,
    star_force.hat AS star_force,
    potentials.hat AS total_stats,
    flames.hat AS flame_score,
FROM 
    characters
LEFT JOIN 
    star_force 
ON 
    characters.Class = star_force.class AND characters.Name = star_force.name
LEFT JOIN 
    potentials
ON 
    characters.Class = potentials.class AND characters.Name = potentials.name
LEFT JOIN 
    flames 
ON 
    characters.Class = flames.class AND characters.Name = flames.name
"""

# Execute the query
result_df = con.execute(query).df()

# Convert the result back to Polars DataFrame if needed
result_pl = pl.from_pandas(result_df)

# Display the resulting DataFrame
print(result_pl)