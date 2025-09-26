import warnings
warnings.filterwarnings("ignore", category=FutureWarning, message="Series.__getitem__ treating keys as positions is deprecated")

import pandas as pd
from pandasgui import show
from pathlib import Path

base_folder = Path(__file__).resolve().parent.parent / 'data/database'
characters_file = base_folder / 'Characters.csv'

df = pd.read_csv(characters_file)

# Open GUI (name it 'df' inside the GUI)
gui = show(df, settings={"block": True})  # Waits until GUI is closed

# After GUI is closed, fetch the edited version
df = gui["df"]

# Save the edited DataFrame
df.to_csv(characters_file, index=False)
print('saved successfully')