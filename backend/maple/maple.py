import json, math as m

probabilities = {
    "hat_unique_prob": [
        {"name": "stats",     "value": 9, "prob":  5/52},
        {"name": "all_stats", "value": 6, "prob":  4/52},
        {"name": "HP",        "value": 9, "prob":  6/52},
        {"name": "Zero",      "value": 0, "prob": 41/52},
    ],
    "hat_leg_prob": [
        {"name": "stats",     "value": 12,"prob":  4/41},
        {"name": "all_stats", "value": 9, "prob":  3/41},
        {"name": "HP",        "value": 12,"prob":  4/41},
        {"name": "CD",        "value": -2,"prob":  2/41},
        {"name": "CD",        "value": -1,"prob":  3/41},
        {"name": "Zero",      "value": 0, "prob": 29/41},
    ],
    "top_unique_prob": [
        {"name": "stats",     "value": 9, "prob":  5/62},
        {"name": "all_stats", "value": 6, "prob":  4/62},
        {"name": "HP",        "value": 9, "prob":  6/62},
        {"name": "Zero",      "value": 0, "prob": 51/62},
    ],
    "top_leg_prob": [
        {"name": "stats",     "value": 12,"prob":  4/39},
        {"name": "all_stats", "value": 9, "prob":  3/39},
        {"name": "HP",        "value": 12,"prob":  4/39},
        {"name": "Zero",      "value": 0, "prob": 32/39},
    ],
    "bot_unique_prob": [
        {"name": "stats",     "value": 9, "prob":  5/52},
        {"name": "all_stats", "value": 6, "prob":  4/52},
        {"name": "HP",        "value": 9, "prob":  6/52},
        {"name": "Zero",      "value": 0, "prob": 41/52},
    ],
    "bot_leg_prob": [
        {"name": "stats",     "value": 12,"prob":  4/33},
        {"name": "all_stats", "value": 9, "prob":  3/33},
        {"name": "HP",        "value": 12,"prob":  4/33},
        {"name": "Zero",      "value": 0, "prob": 26/33},
    ],
    "gloves_unique_prob": [
        {"name": "stats",     "value": 9, "prob":  5/56},
        {"name": "all_stats", "value": 6, "prob":  4/56},
        {"name": "HP",        "value": 9, "prob":  6/56},
        {"name": "Zero",      "value": 0, "prob": 45/56},
    ],
    "gloves_leg_prob": [
        {"name": "stats",     "value": 12,"prob":  4/40},
        {"name": "all_stats", "value": 9, "prob":  3/40},
        {"name": "HP",        "value": 12,"prob":  4/40},
        {"name": "Crit DMG",  "value": 8, "prob":  4/40},
        {"name": "Zero",      "value": 0, "prob": 29/40},
    ],
    "shoes_unique_prob": [
        {"name": "stats",     "value": 9, "prob":  5/52},
        {"name": "all_stats", "value": 6, "prob":  4/52},
        {"name": "HP",        "value": 9, "prob":  6/52},
        {"name": "Zero",      "value": 0, "prob": 41/52},
    ],
    "shoes_leg_prob": [
        {"name": "stats",     "value": 12,"prob":  4/36},
        {"name": "all_stats", "value": 9, "prob":  3/36},
        {"name": "HP",        "value": 12,"prob":  4/36},
        {"name": "Zero",      "value": 0, "prob": 29/36},
    ],
    "cape_belt_shoulder_unique_prob": [
        {"name": "stats",     "value": 9, "prob":  5/48},
        {"name": "all_stats", "value": 6, "prob":  4/48},
        {"name": "HP",        "value": 9, "prob":  6/48},
        {"name": "Zero",      "value": 0, "prob": 37/48},
    ],
    "cape_belt_shoulder_leg_prob": [
        {"name": "stats",     "value": 12,"prob":  4/33},
        {"name": "all_stats", "value": 9, "prob":  3/33},
        {"name": "HP",        "value": 12,"prob":  4/33},
        {"name": "Zero",      "value": 0, "prob": 26/33},
    ],
    "acc_unique_prob": [
        {"name": "stats",     "value": 9, "prob":  5/40},
        {"name": "all_stats", "value": 6, "prob":  4/40},
        {"name": "HP",        "value": 9, "prob":  6/40},
        {"name": "Zero",      "value": 0, "prob": 29/40},
    ],
    "acc_leg_prob": [
        {"name": "stats",     "value": 12,"prob":  4/39},
        {"name": "all_stats", "value": 9, "prob":  3/39},
        {"name": "HP",        "value": 12,"prob":  4/39},
        {"name": "Drop",      "value": 20,"prob":  3/39},
        {"name": "Meso",      "value": 20,"prob":  3/39},
        {"name": "Zero",      "value": 0, "prob": 26/39},
    ],
    "heart_unique_prob": [
        {"name": "stats",     "value": 9, "prob":  5/40},
        {"name": "all_stats", "value": 6, "prob":  4/40},
        {"name": "HP",        "value": 9, "prob":  6/40},
        {"name": "Zero",      "value": 0, "prob": 29/40},
    ],
    "heart_leg_prob": [
        {"name": "stats",     "value": 12,"prob":  4/27},
        {"name": "all_stats", "value": 9, "prob":  3/27},
        {"name": "HP",        "value": 12,"prob":  4/27},
        {"name": "Zero",      "value": 0, "prob": 20/27},
    ],
    "weapon_unique_prob": [
        {"name": "ATT",       "value": 9, "prob":  3/43},
        {"name": "BOSS",      "value": 30,"prob":  3/43},
        {"name": "IED",       "value": 30,"prob":  3/43},
        {"name": "Zero",      "value": 0, "prob": 34/43},
    ],
    "weapon_leg_prob": [
        {"name": "ATT",       "value": 12,"prob":  2/41},
        {"name": "BOSS",      "value": 40,"prob":  2/41},
        {"name": "BOSS",      "value": 35,"prob":  4/41},
        {"name": "IED",       "value": 40,"prob":  2/41},
        {"name": "IED",       "value": 35,"prob":  2/41},
        {"name": "Zero",      "value": 0, "prob": 29/41},
    ],
    "secondary_unique_prob": [
        {"name": "ATT",       "value": 9, "prob":  3/51},
        {"name": "BOSS",      "value": 30,"prob":  3/51},
        {"name": "IED",       "value": 30,"prob":  3/51},
        {"name": "Zero",      "value": 0, "prob": 42/51},
    ],
    "secondary_leg_prob": [
        {"name": "ATT",       "value": 12,"prob":  2/47},
        {"name": "BOSS",      "value": 40,"prob":  2/47},
        {"name": "BOSS",      "value": 35,"prob":  4/47},
        {"name": "IED",       "value": 40,"prob":  2/47},
        {"name": "IED",       "value": 35,"prob":  2/47},
        {"name": "Zero",      "value": 0, "prob": 35/47},
    ],
    "emblem_unique_prob": [
        {"name": "ATT",       "value": 9, "prob":  3/40},
        {"name": "IED",       "value": 30,"prob":  3/40},
        {"name": "Zero",      "value": 0, "prob": 34/40},
    ],
    "emblem_leg_prob": [
        {"name": "ATT",       "value": 12,"prob":  2/35},
        {"name": "IED",       "value": 40,"prob":  2/35},
        {"name": "IED",       "value": 35,"prob":  2/35},
        {"name": "Zero",      "value": 0, "prob": 29/35},
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

def create_desired_values(list_of_stats:list, list_of_desired_value:list):
    ls = list_of_stats
    ld = list_of_desired_value

    desired_values = {
        "stats": 0,
        "all_stats": 0,
        "HP": 0,

        "Crit DMG": 0,
        "CD": 0,
        
        "Drop": 0,
        "Meso": 0,
        
        "ATT": 0,
        "BOSS": 0,
        "IED": 0,
    }

    for key in ls:
        if key in desired_values:
            desired_values[key] = ld[ls.index(key)]
    
    return desired_values

def get_var_name(var:str):
    for name, value in globals().items():
        if value is var:
            return name

def calc_prob(cube_type:str, desired_item:str, desired_values:dict):
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
                        if key in item["name"]:
                            value_sums[key] += item_value
                            
                if all(
                    (
                        value_sums.get(key, 0) >= desired_values[key] if desired_values[key] >= 0 
                    else
                        value_sums.get(key, 0) <= desired_values[key]) 
                    for key in desired_values
                ):
                    # print(f"{list_prob_slot_1[i]['value']} {i},{list_prob_slot_2[i]['value']} {j},{list_prob_slot_3[i]['value']} {k}")
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

with open(r'maple.json', 'r') as file:
    list_of_all_desired_values = json.load(file)['desired_values']

for dic in list_of_all_desired_values:
    print(f"{dic['item'].replace('_',' ').title().replace(' ','/')}:")
    for desired_values in dic['list_of_desired_values']:
        prob = calc_prob('black', dic['item'], desired_values)
        a:dict = {"a":"a"}
        
    #percentiles
        if prob != 0:
            avg_cubes       = round(1/prob)
            percentile_50_0 = round((-0.6931471805599453)/m.log(1-prob)) #50.0%
            percentile_75_0 = round((-1.3862943611198906)/m.log(1-prob)) #75.0%
            percentile_80_0 = round((-1.6094379124341003)/m.log(1-prob)) #80.0%
            percentile_85_0 = round((-1.8971199848858813)/m.log(1-prob)) #85.0%
            percentile_90_0 = round((-2.3025850929940455)/m.log(1-prob)) #90.0%
            percentile_95_0 = round((-2.9957322735539910)/m.log(1-prob)) #95.0%
            percentile_97_5 = round((-3.6888794541139363)/m.log(1-prob)) #97.5%

            # if (dic['item'] in ['emblem', 'secondary']):
                # print(f"{desired_values}:, prob: {round(prob,10)}, avg_cubes: {avg_cubes}, p_50_0: {percentile_50_0}, p_75_0: {percentile_75_0}, p_80_0: {percentile_80_0}, p_85_0: {percentile_85_0}, p_90_0: {percentile_90_0}, p_95_0: {percentile_95_0}, p_97_5: {percentile_97_5}")
            print(f"{desired_values}:, cost: {220000000*avg_cubes}, prob: {round(prob,10)}, avg_cubes: {avg_cubes}, ")

    print('')

list_of_stats:list = ['stats']
list_of_desired_value:list = [18]

desired_values = create_desired_values(list_of_stats, list_of_desired_value)

a = calc_prob('black', 'hat', desired_values)
print(round(a,10))
if a != 0:
    print(round(1/a))
    percentile_50_0 = round((-0.6931471805599453)/m.log(1-prob)) #log(50.0%)
    percentile_75_0 = round((-1.3862943611198906)/m.log(1-prob)) #log(25.0%)
    percentile_80_0 = round((-1.6094379124341003)/m.log(1-prob)) #log(20.0%)
    percentile_85_0 = round((-1.8971199848858813)/m.log(1-prob)) #log(15.0%)
    percentile_90_0 = round((-2.3025850929940455)/m.log(1-prob)) #log(10.0%)
    percentile_95_0 = round((-2.9957322735539910)/m.log(1-prob)) #log(5.00%)
    percentile_97_5 = round((-3.6888794541139363)/m.log(1-prob)) #log(2.50%)
    print(f"percentile_50_0: {percentile_50_0}")
    print(f"percentile_75_0: {percentile_75_0}")
    print(f"percentile_80_0: {percentile_80_0}")
    print(f"percentile_85_0: {percentile_85_0}")
    print(f"percentile_90_0: {percentile_90_0}")
    print(f"percentile_95_0: {percentile_95_0}")
    print(f"percentile_97_5: {percentile_97_5}")
    print(round(1/(0.000402235+2.52693e-05))*220000000)
