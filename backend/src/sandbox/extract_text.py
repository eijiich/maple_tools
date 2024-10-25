from math import floor
from pathlib import Path

import cv2
import numpy as np
import pytesseract

base_dir = Path(__file__).resolve().parent.parent.parent.parent  # Adjust according to the file's structure

# Define paths relative to the base directory
data_path = base_dir/'data'/'img'/'dataset'
output_path = base_dir/'data'/'img'/'output'

# Converting Path objects to strings for compatibility with OpenCV
data_path = str(data_path)
output_path = str(output_path)

image = cv2.imread(data_path+'\\'+r'Ring2.png')
dot_image = cv2.imread(data_path+'\\'+r'BlueDotOriginal.png')

# Calculate the new dimensions
original_height, original_width = image.shape[:2]
new_width = original_width * 4
new_height = original_height * 4

image2 = cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_LINEAR)
cv2.imwrite(output_path+'\\'+"target2.png", image2)



# Convert both images to HSV color space
hsv_dot = cv2.cvtColor(dot_image, cv2.COLOR_BGR2HSV)
hsv_image = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

# Define the blue color range (these values might need adjustment)
# These values should match the hue, saturation, and value of your blue dot

#light blue mask
lower_blue = np.array([(80), (80), (80)])
upper_blue = np.array([(110), (255), (255)])
# Create a mask that captures areas within the blue range
mask_blue = cv2.inRange(hsv_image, lower_blue, upper_blue)
target = cv2.bitwise_and(image,image, mask=mask_blue)
cv2.imwrite(output_path+'\\'+"target_blue.png", target)

#green mask
lower_green = np.array([(32), (80), (80)])
upper_green = np.array([(80), (255), (255)])
# Create a mask that captures areas within the blue range
mask_green = cv2.inRange(hsv_image, lower_green, upper_green)
target = cv2.bitwise_and(image,image, mask=mask_green)
cv2.imwrite(output_path+'\\'+"target_green.png", target)

#yellow mask
lower_yellow = np.array([(15), (80), (80)])
upper_yellow = np.array([(32), (255), (255)])
# Create a mask that captures areas within the blue range
mask_yellow = cv2.inRange(hsv_image, lower_yellow, upper_yellow)
target = cv2.bitwise_and(image,image, mask=mask_yellow)
cv2.imwrite(output_path+'\\'+"target_yellow.png", target)

#lower red mask
lower_red = np.array([(0), (80), (80)])
upper_red = np.array([(10), (255), (255)])
# Create a mask that captures areas within the blue range
lower_mask = cv2.inRange(hsv_image, lower_red, upper_red)
#upper red mask
lower_red = np.array([(170), (80), (80)])
upper_red = np.array([(180), (255), (255)])
# Create a mask that captures areas within the blue range
upper_mask = cv2.inRange(hsv_image, lower_red, upper_red)
mask_red = lower_mask+upper_mask
target = cv2.bitwise_and(image,image, mask=mask_red)
cv2.imwrite(output_path+'\\'+"target_red.png", target)

#pink_red mask
lower_pink = np.array([(155), (80), (80)])
upper_pink = np.array([(170), (255), (255)])
# Create a mask that captures areas within the blue range
mask_pink = cv2.inRange(hsv_image, lower_pink, upper_pink)
target = cv2.bitwise_and(image,image, mask=mask_pink)
cv2.imwrite(output_path+'\\'+"target_red.png", target)

#purple mask
lower_purple = np.array([(125), (80), (80)])
upper_purple = np.array([(145), (255), (255)])
# Create a mask that captures areas within the blue range
mask_purple = cv2.inRange(hsv_image, lower_purple, upper_purple)
target = cv2.bitwise_and(image,image, mask=mask_purple)
cv2.imwrite(output_path+'\\'+"target_purple.png", target)

#mono mask
lower = np.array([(0), (0), (80)])
upper = np.array([(180), (50), (255)])
# Create a mask that captures areas within the blue range
mask_mono = cv2.inRange(hsv_image, lower, upper)
target = cv2.bitwise_and(image,image, mask=mask_mono)
cv2.imwrite(output_path+'\\'+"target_white.png", target)

mask = (
    mask_red
    +mask_green
    +mask_blue
    +mask_yellow
    +mask_purple
    +mask_pink
)

# Use the mask to find contours (potential blue dots)
contours, _ = cv2.findContours(mask_blue, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

padding=3
# Iterate through contours and match against the blue dot reference
for contour in reversed(contours):
    x, y, w, h = cv2.boundingRect(contour)
    detected_dot = hsv_image[y:y+h, x:x+w]
    
    x, y, w, h = (x-padding, y-padding, w+padding, h+padding) 
    cv2.rectangle(image, (x, y), (x + w, y + h), (0, 255, 0), 2)
    cv2.imshow('blue_dot', image)
    cv2.waitKey(0)
    # Resize the detected dot to match the reference dot size
    detected_dot_resized = cv2.resize(detected_dot, (hsv_dot.shape[1], hsv_dot.shape[0]))
    
    # Compare the detected dot with the reference dot
    if np.allclose(detected_dot_resized, hsv_dot, atol=30):  # Adjust tolerance as needed
        print(f"Blue dot found at position: x={x}, y={y}")

        # Draw a rectangle around the detected dot
        cv2.rectangle(image, (x, y), (x+w, y+h), (0, 255, 0), 2)

        # Assuming the text is to the right of the blue dot
        text_region = image[y-5:y+h+6, x+w+2:x+w+200]  # Adjust width for your needs
        
        # Optional: Save or display the extracted region
        # cv2.imshow('Text Region', text_region)
        # cv2.waitKey(0)
        cv2.imwrite(output_path+'\\'+'extracted_text_region.png', text_region)
        
        break

height, width = image.shape[:2]
roi_start_y = y + 210
roi_end_y = height-5
roi_start_x = x - 5  # Define width of ROI (e.g., 100 pixels wide)
roi_end_x = width-5

# Create a mask of the same size as the image, initially all zeros (black)
mask_stats = np.zeros((height, width), dtype=np.uint8)
mask_stats[roi_start_y:roi_end_y, roi_start_x:roi_end_x] = 255  # Set the left half to white (255)

target = cv2.bitwise_and(image,image, mask=mask_stats)
cv2.imwrite(output_path+'\\'+'\\'+"target.png", target)
mask_pink[0:50,0:width] = 0
mask_pink[y+10:height,0:width] = 0
mask = (
    mask_red
    +mask_green
    +mask_blue
    +mask_yellow
    +mask_purple
    +mask_pink
    +mask_mono
) * mask_stats + mask_pink
target = cv2.bitwise_and(image,image, mask=mask)
gray_image = cv2.cvtColor(target, cv2.COLOR_BGR2GRAY)
_, binary_image = cv2.threshold(gray_image, 50, 255, cv2.THRESH_BINARY_INV)
cv2.imwrite(output_path+'\\'+'\\'+"target.png", target)
cv2.imwrite(output_path+'\\'+'\\'+"target_gray.png", gray_image)
cv2.imwrite(output_path+'\\'+'\\'+"target_binary.png", binary_image)
 
extracted_text_gray_image = pytesseract.image_to_string(gray_image)
extracted_text_binary_image = pytesseract.image_to_string(binary_image)

original_height, original_width = image.shape[:2]

# Calculate the new dimensions
new_width = original_width * 10
new_height = original_height * 10

# Resize the image
resized_image = cv2.resize(binary_image, (new_width, new_height), interpolation=cv2.INTER_LINEAR)
cv2.imwrite(output_path+'\\'+"target_binary2.png", resized_image)

 
# Optional: Display the results
extracted_text_binary_image = pytesseract.image_to_string(resized_image)

print(extracted_text_binary_image)

#https://stackoverflow.com/questions/43352918/how-do-i-train-tesseract-4-with-image-data-instead-of-a-font-file