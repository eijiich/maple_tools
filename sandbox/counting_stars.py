from pathlib import Path
import cv2
import numpy as np

base_dir = Path(__file__).resolve().parent.parent.parent.parent  # Adjust according to the file's structure

# Define paths relative to the base directory
data_path = base_dir/'data'/'img'/'dataset'
output_path = base_dir/'data'/'img'/'output'

# Converting Path objects to strings for compatibility with OpenCV
data_path = str(data_path)
output_path = str(output_path)

# Load the main image in color
image = cv2.imread(data_path+'\\'+r'Weapon2.png')
print(image)
# Load the star template with transparency (RGBA)
template = cv2.imread(data_path+'\\'+r'star.png', cv2.IMREAD_UNCHANGED)

# Split the template into color channels and alpha channel (to use as a mask)
template_rgb = template[:, :, :3]  # Extract RGB channels
template_alpha = template[:, :, 3]  # Extract alpha channel for masking

# Create a mask where the alpha is greater than 0 (to ignore the background)
_, mask = cv2.threshold(template_alpha, 0, 255, cv2.THRESH_BINARY)

# Get the dimensions of the template
w, h = template_rgb.shape[1], template_rgb.shape[0]

# Perform template matching using the mask to ignore background
res = cv2.matchTemplate(image, template_rgb, cv2.TM_CCOEFF_NORMED, mask=mask)

# Set a threshold to detect only good matches
threshold = 0.8
loc = np.where(res >= threshold)
# Draw rectangles around the detected stars
for pt in zip(*loc[::-1]):
    cv2.rectangle(image, pt, (pt[0] + w, pt[1] + h), (0, 255, 0), 2)

# Count the number of matches
count = len(list(zip(*loc[::-1])))

print(f"Number of stars found: {count}")

# Show the result
cv2.imshow('Detected Stars', image)
cv2.waitKey(0)
cv2.destroyAllWindows()
