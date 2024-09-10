import cv2
import numpy as np
from math import floor
import pytesseract

# Load the main image and the reference image with the blue dot
pytesseract.pytesseract.tesseract_cmd = r'C:\Users\GuilhermeIchibara\AppData\Local\Programs\Tesseract-OCR\tesseract.exe'  # Windows example
data_path = r'C:\Users\GuilhermeIchibara\OneDrive - StepWise\Guilherme Ichibara\Projects\maple_tools\data\img\dataset\\'
output_path = r'C:\Users\GuilhermeIchibara\OneDrive - StepWise\Guilherme Ichibara\Projects\maple_tools\data\img\output\\'


# Load the main image in color
image = cv2.imread(data_path+r'TrixterPants.png')
# Load the star template with transparency (RGBA)
template = cv2.imread(data_path+r'BlueDotTransparent.png', cv2.IMREAD_UNCHANGED)

# Split the template into color channels and alpha channel (to use as a mask)
template_rgb = template[:, :, :3]  # Extract RGB channels
template_alpha = template[:, :, 3]  # Extract alpha channel for masking

# Create a mask where the alpha is greater than 0 (to ignore the background)
_, mask = cv2.threshold(template_alpha, 0, 255, cv2.THRESH_BINARY)

# Get the dimensions of the template
w, h = template_rgb.shape[1], template_rgb.shape[0]

# Perform template matching using the mask to ignore background
res = cv2.matchTemplate(image, template_rgb, cv2.TM_CCOEFF_NORMED, mask=mask)

# Set a threshold to find the match
threshold = 0.9
locations = np.where(res >= threshold)

# Draw rectangles around the matched areas
x = 0
y = 0

for loc in zip(*locations[::-1]):
    x,y = loc
    # cv2.rectangle(main_image, loc, (loc[0] + reference_square.shape[1], loc[1] + reference_square.shape[0]), (0, 0, 255), 2)

if (x != 0 or y != 0):
    print(x)
    print(y)

for pt in zip(*locations[::-1]):
    cv2.rectangle(image, pt, (pt[0] + w, pt[1] + h), (0, 255, 0), 2)

# Count the number of matches
count = len(list(zip(*locations[::-1])))

print(f"Number of Dots found: {count}")

# Show the result
cv2.imshow('Detected Dots', image)
cv2.waitKey(0)
cv2.destroyAllWindows()
