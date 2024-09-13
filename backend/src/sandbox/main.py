import cv2
from PIL import Image
import pytesseract

# If tesseract is not in your PATH, you need to specify the path to the executable
pytesseract.pytesseract.tesseract_cmd = r'C:\Users\GuilhermeIchibara\AppData\Local\Programs\Tesseract-OCR\tesseract.exe'  # Windows example
data_path = r'C:\Users\GuilhermeIchibara\OneDrive - StepWise\Guilherme Ichibara\Projects\computer_vision\data\img\\'
# Load the image
image_path = data_path+r'\TrixterPants_HR.png'
image = cv2.imread(image_path)
gray_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
_, binary_image = cv2.threshold(gray_image, 150, 255, cv2.THRESH_BINARY_INV)
# Use Tesseract to extract text
extracted_text = pytesseract.image_to_string(image)
extracted_text_gray_image = pytesseract.image_to_string(gray_image)
extracted_text_gray_image_binary = pytesseract.image_to_string(binary_image)

# print(extracted_text_gray_image_binary)
name_path = data_path+r'\Name.png'
image = cv2.imread(name_path)
gray_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
extracted_text = pytesseract.image_to_string(image)
extracted_text_gray_image = pytesseract.image_to_string(gray_image)
print(extracted_text_gray_image)

just_stats = data_path+r'\JustStats.png'
image = cv2.imread(just_stats)
extracted_text = pytesseract.image_to_string(image)
gray_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
_, binary_image = cv2.threshold(gray_image, 75, 255, cv2.THRESH_BINARY_INV)
extracted_text_gray_image = pytesseract.image_to_string(gray_image)
extracted_text_gray_image_binary = pytesseract.image_to_string(binary_image)
cv2.imwrite(data_path+r'JustStatsGray.png', gray_image)
cv2.imwrite(data_path+r'JustStatsBinary.png', binary_image)
print(extracted_text)
print(extracted_text_gray_image_binary)
