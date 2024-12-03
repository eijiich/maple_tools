from pathlib import Path
import json, math as m
from math import ceil

probabilities = {
    "hat_unique_prob": [
        {"name": "main_stats", "value": 9, "prob":  5/52},
        {"name": "all_stats",  "value": 6, "prob":  4/52},
        {"name": "HP",         "value": 9, "prob":  6/52},
        {"name": "Zero",       "value": 0, "prob": 41/52},
    ],
    "hat_leg_prob": [
        {"name": "main_stats", "value": 12,"prob":  4/41},
        {"name": "all_stats",  "value":  9,"prob":  3/41},
        {"name": "HP",         "value": 12,"prob":  4/41},
        {"name": "CD",         "value": -2,"prob":  2/41},
        {"name": "CD",         "value": -1,"prob":  3/41},
        {"name": "Zero",       "value":  0,"prob": 25/41},
    ],
    "top_unique_prob": [
        {"name": "main_stats", "value": 9, "prob":  5/62},
        {"name": "all_stats",  "value": 6, "prob":  4/62},
        {"name": "HP",         "value": 9, "prob":  6/62},
        {"name": "Zero",       "value": 0, "prob": 47/62},
    ],
    "top_leg_prob": [
        {"name": "main_stats", "value": 12,"prob":  4/39},
        {"name": "all_stats",  "value":  9,"prob":  3/39},
        {"name": "HP",         "value": 12,"prob":  4/39},
        {"name": "Zero",       "value":  0,"prob": 28/39},
    ],
    "bottom_unique_prob": [
        {"name": "main_stats", "value": 9, "prob":  5/52},
        {"name": "all_stats",  "value": 6, "prob":  4/52},
        {"name": "HP",         "value": 9, "prob":  6/52},
        {"name": "Zero",       "value": 0, "prob": 37/52},
    ],
    "bottom_leg_prob": [
        {"name": "main_stats", "value": 12,"prob":  4/33},
        {"name": "all_stats",  "value":  9,"prob":  3/33},
        {"name": "HP",         "value": 12,"prob":  4/33},
        {"name": "Zero",       "value":  0,"prob": 22/33},
    ],
    "gloves_unique_prob": [
        {"name": "main_stats", "value": 9, "prob":  5/56},
        {"name": "all_stats",  "value": 6, "prob":  4/56},
        {"name": "HP",         "value": 9, "prob":  6/56},
        {"name": "Zero",       "value": 0, "prob": 41/56},
    ],
    "gloves_leg_prob": [
        {"name": "main_stats", "value": 12,"prob":  4/40},
        {"name": "all_stats",  "value":  9,"prob":  3/40},
        {"name": "HP",         "value": 12,"prob":  4/40},
        {"name": "Crit DMG",   "value":  8,"prob":  4/40},
        {"name": "Zero",       "value":  0,"prob": 25/40},
    ],
    "shoes_unique_prob": [
        {"name": "main_stats", "value": 9, "prob":  5/52},
        {"name": "all_stats",  "value": 6, "prob":  4/52},
        {"name": "HP",         "value": 9, "prob":  6/52},
        {"name": "Zero",       "value": 0, "prob": 37/52},
    ],
    "shoes_leg_prob": [
        {"name": "main_stats", "value": 12,"prob":  4/36},
        {"name": "all_stats",  "value":  9,"prob":  3/36},
        {"name": "HP",         "value": 12,"prob":  4/36},
        {"name": "Zero",       "value":  0,"prob": 25/36},
    ],
    "cape_belt_shoulder_unique_prob": [
        {"name": "main_stats", "value": 9, "prob":  5/48},
        {"name": "all_stats",  "value": 6, "prob":  4/48},
        {"name": "HP",         "value": 9, "prob":  6/48},
        {"name": "Zero",       "value": 0, "prob": 33/48},
    ],
    "cape_belt_shoulder_leg_prob": [
        {"name": "main_stats", "value": 12,"prob":  4/33},
        {"name": "all_stats",  "value":  9,"prob":  3/33},
        {"name": "HP",         "value": 12,"prob":  4/33},
        {"name": "Zero",       "value":  0,"prob": 22/33},
    ],
    "acc_unique_prob": [
        {"name": "main_stats", "value": 9, "prob":  5/40},
        {"name": "all_stats",  "value": 6, "prob":  4/40},
        {"name": "HP",         "value": 9, "prob":  6/40},
        {"name": "Zero",       "value": 0, "prob": 25/40},
    ],
    "acc_leg_prob": [
        {"name": "main_stats", "value": 12,"prob":  4/39},
        {"name": "all_stats",  "value":  9,"prob":  3/39},
        {"name": "HP",         "value": 12,"prob":  4/39},
        {"name": "Drop",       "value": 20,"prob":  3/39},
        {"name": "Meso",       "value": 20,"prob":  3/39},
        {"name": "Zero",       "value":  0,"prob": 22/39},
    ],
    "heart_unique_prob": [
        {"name": "main_stats", "value": 9, "prob":  5/40},
        {"name": "all_stats",  "value": 6, "prob":  4/40},
        {"name": "HP",         "value": 9, "prob":  6/40},
        {"name": "Zero",       "value": 0, "prob": 25/40},
    ],
    "heart_leg_prob": [
        {"name": "main_stats", "value": 12,"prob":  4/27},
        {"name": "all_stats",  "value":  9,"prob":  3/27},
        {"name": "HP",         "value": 12,"prob":  4/27},
        {"name": "Zero",       "value":  0,"prob": 16/27},
    ],
    "weapon_unique_prob": [
        {"name": "ATT",        "value":  9,"prob":  3/43},
        {"name": "BOSS",       "value": 30,"prob":  3/43},
        {"name": "IED",        "value": 30,"prob":  3/43},
        {"name": "Zero",       "value":  0,"prob": 34/43},
    ],
    "weapon_leg_prob": [
        {"name": "ATT",        "value": 12,"prob":  2/41},
        {"name": "BOSS",       "value": 40,"prob":  2/41},
        {"name": "BOSS",       "value": 35,"prob":  4/41},
        {"name": "IED",        "value": 40,"prob":  2/41},
        {"name": "IED",        "value": 35,"prob":  2/41},
        {"name": "Zero",       "value": 0, "prob": 29/41},
    ],
    "secondary_unique_prob": [
        {"name": "ATT",        "value":  9,"prob":  3/51},
        {"name": "BOSS",       "value": 30,"prob":  3/51},
        {"name": "IED",        "value": 30,"prob":  3/51},
        {"name": "Zero",       "value":  0,"prob": 42/51},
    ],
    "secondary_leg_prob": [
        {"name": "ATT",        "value": 12,"prob":  2/47},
        {"name": "BOSS",       "value": 40,"prob":  2/47},
        {"name": "BOSS",       "value": 35,"prob":  4/47},
        {"name": "IED",        "value": 40,"prob":  2/47},
        {"name": "IED",        "value": 35,"prob":  2/47},
        {"name": "Zero",       "value":  0,"prob": 35/47},
    ],
    "emblem_unique_prob": [
        {"name": "ATT",        "value":  9,"prob":  3/40},
        {"name": "IED",        "value": 30,"prob":  3/40},
        {"name": "Zero",       "value":  0,"prob": 34/40},
    ],
    "emblem_leg_prob": [
        {"name": "ATT",        "value": 12,"prob":  2/35},
        {"name": "IED",        "value": 40,"prob":  2/35},
        {"name": "IED",        "value": 35,"prob":  2/35},
        {"name": "Zero",       "value":  0,"prob": 29/35},
    ],
}

prime_prob = {
    "black": [1.0, 0.2, 0.05],
    "red":   [1.0, 0.1, 0.01],
}

cube_cost = {
    "black": 22000000,
    "red":   12000000,
}

def check_sums(value_sums, desired_values):
    for desired_key, desired_value in desired_values.items():
        matching_keys = [key for key in value_sums if desired_key.lower() in key.lower()]
        matching_sum = sum(value_sums[key] for key in matching_keys)
        
        if desired_value >= 0:
            if matching_sum < desired_value:
                return False
        else:
            if matching_sum > desired_value:
                return False
    
    return True

def create_desired_values(list_of_stats:list, list_of_desired_value:list):
    if ((not list_of_stats) or (not list_of_desired_value)):
         return {}

    ls = list_of_stats
    ld = list_of_desired_value

    desired_values = {
        "stats": 0,
        "all_stats": 0,
        "hp": 0,
        "crit DMG": 0,
        "cd": 0,
        "drop": 0,
        "meso": 0,
        "att": 0,
        "boss": 0,
        "ied": 0,
    }

    for key in ls:
        lowercase_key = key.lower()
        if lowercase_key in desired_values:
            desired_values[lowercase_key] = ld[ls.index(key)]
        else:
            return {}
    
    return desired_values

def get_var_name(var:str):
    for name, value in globals().items():
        if value is var:
            return name

def calc_prob(cube_type:str, desired_item:str, desired_values:dict):
    if not desired_values:
        return 0

    total_prob = 0
    keys_list = []

    filtered_probs = [value for key,value in probabilities.items() if desired_item in key]
    list_prob_slot_1 = filtered_probs[1]
    list_prob_slot_2 = (
        [{**item, "prob": item["prob"] * (    prime_prob[cube_type][1])} for item in filtered_probs[1]] +
        [{**item, "prob": item["prob"] * (1 - prime_prob[cube_type][1])} for item in filtered_probs[0]]
    )
    list_prob_slot_3 = (
        [{**item, "prob": item["prob"] * (    prime_prob[cube_type][2])} for item in filtered_probs[1]] +
        [{**item, "prob": item["prob"] * (1 - prime_prob[cube_type][2])} for item in filtered_probs[0]]
    )

    [keys_list.append(item["name"]) for item in list_prob_slot_1 if item["name"] not in keys_list]
    for i in range(len(list_prob_slot_1)):
        for j in range(len(list_prob_slot_2)):
            for k in range(len(list_prob_slot_3)):
                combined_list = []
                combined_list.append(list_prob_slot_1[i])
                combined_list.append(list_prob_slot_2[j])
                combined_list.append(list_prob_slot_3[k])

                value_sums = {key: 0 for key in keys_list}
                for item in combined_list:
                    item_value = item["value"]
                    for key,value in value_sums.items():
                        if key == item["name"]:
                            value_sums[key] += item_value
                            
                if(check_sums(value_sums, desired_values)):
                    prob = list_prob_slot_1[i]['prob'] * list_prob_slot_2[j]['prob'] * list_prob_slot_3[k]['prob']
                    total_prob += prob

    return total_prob
##########################################################################################################################################
# lists_probs = [value for key,value in probabilities.items()]
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

##############################################################################################################################################################
list_of_stats:list = ['stats']
list_of_desired_value:list = [30]
cube_type = 'red'
equip = 'acc'
tries = 2861

desired_values = create_desired_values(list_of_stats, list_of_desired_value)
probability = calc_prob(cube_type, equip, desired_values)

# print(round(a,10))
if probability != 0:
    avg_cubes = ceil(1/probability)
    avg_cost = avg_cubes*cube_cost[cube_type]

    print(f"percentile_XX_0: {round((1-(1-probability)**tries)*100,2)}")

    percentile_list = [0.50,5.00,10.0,15.0,20.0,25.0,50.0,75.0,80.0,85.0,90.0,95.0,97.5]
    for percentile in percentile_list:
        percentile_str = f'{percentile:04.1f}'.replace('.','_')
        cube_percentile = round((m.log(1-(percentile/100)))/m.log(1-probability))
        print(f"percentile_{percentile_str}: {cube_percentile:,}")
    print("")
    print(f"avg_cubes: {avg_cubes:,}")
    print(f"avg_cost:  {avg_cost:,}")

print(f"probability: {round(probability,10)}")
##############################################################################################################################################################
# base_dir = Path(__file__).resolve().parent

# # Define paths relative to the base directory
# data_path = base_dir
# data_path = str(data_path)

# print(data_path+'\\'+r'maple.json')
# with open(data_path+'\\'+r'maple.json', 'r') as file:
#     list_of_all_desired_values = json.load(file)['desired_values']
# cube_type = 'black'
# for dic in list_of_all_desired_values:
#     print(f"{dic['item'].replace('_',' ').title().replace(' ','/')}:")
#     for desired_values in dic['list_of_desired_values']:
#         prob = calc_prob(cube_type, dic['item'], desired_values)
#         a:dict = {"a":"a"}
        
#     #percentiles
#         if prob != 0:
#             avg_cubes = round(1/prob)
#             avg_cost = avg_cubes*cube_cost[cube_type]
#             percentile_list = [50.0,75.0,80.0,85.0,90.0,95.0,97.5]
#             for percentile in percentile_list:
#                 percentile_str = f'{percentile:04.1f}'.replace('.','_')
#                 cube_percentile = round((m.log(1-(percentile/100)))/m.log(1-prob))
#                 #print(f"percentile_{percentile_str}: {cube_percentile:,}")

#             # if (dic['item'] in ['emblem', 'secondary']):
#                 # print(f"{desired_values}:, prob: {round(prob,10)}, avg_cubes: {avg_cubes}, p_50_0: {percentile_50_0}, p_75_0: {percentile_75_0}, p_80_0: {percentile_80_0}, p_85_0: {percentile_85_0}, p_90_0: {percentile_90_0}, p_95_0: {percentile_95_0}, p_97_5: {percentile_97_5}")
#             print(f"{desired_values}:, avg_cost: {avg_cost:,}, prob: {round(prob,10)}, avg_cubes: {avg_cubes:,}, ")


