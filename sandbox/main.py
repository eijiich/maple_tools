from math import floor
from pathlib import Path
import cv2
import pytesseract

base_dir = Path(__file__).resolve().parent.parent  # Adjust according to the file's structure

# Define paths relative to the base directory
data_path = base_dir/'data'/'img'/'dataset'
output_path = base_dir/'data'/'img'/'output'

# Converting Path objects to strings for compatibility with OpenCV
data_path = str(data_path)
output_path = str(output_path)

image_path = data_path+'\\'+r'\Top.png'
image = cv2.imread(image_path)
gray_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
# Upscale (2x)
scale = 2
gray_image = cv2.resize(gray_image, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)

_, binary_image = cv2.threshold(gray_image, 80, 255, cv2.THRESH_BINARY_INV)
# Slight blur helps smooth edges
gray_image = cv2.medianBlur(gray_image, 3)
binary_image = cv2.medianBlur(binary_image, 3)

# Use Tesseract to extract text
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 1))
processed = cv2.morphologyEx(binary_image, cv2.MORPH_CLOSE, kernel)

extracted_text = pytesseract.image_to_string(image)
extracted_text_gray_image = pytesseract.image_to_string(gray_image)
extracted_text_gray_image_binary = pytesseract.image_to_string(binary_image)

# # print(extracted_text_gray_image_binary)
# name_path = data_path+r'\Name.png'
# image = cv2.imread(name_path)
# gray_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
# extracted_text = pytesseract.image_to_string(image)
# extracted_text_gray_image = pytesseract.image_to_string(gray_image)
# print(extracted_text_gray_image)

# just_stats = data_path+r'\JustStats.png'
# image = cv2.imread(just_stats)
# extracted_text = pytesseract.image_to_string(image)
# gray_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
# _, binary_image = cv2.threshold(gray_image, 75, 255, cv2.THRESH_BINARY_INV)
extracted_text_gray_image = pytesseract.image_to_string(gray_image)
extracted_text_gray_image_binary = pytesseract.image_to_string(binary_image)
cv2.imwrite(data_path+'\\'+r'extracted_text_gray_image.png', gray_image)
cv2.imwrite(data_path+'\\'+r'extracted_text_gray_image_binary.png', binary_image)
# print(extracted_text)
print(extracted_text_gray_image)
print(extracted_text_gray_image_binary)
