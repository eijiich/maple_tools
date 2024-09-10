import cv2
import pytesseract
import numpy as np

# Step 1: Load the image
pytesseract.pytesseract.tesseract_cmd = r'C:\Users\GuilhermeIchibara\AppData\Local\Programs\Tesseract-OCR\tesseract.exe'  # Windows example
data_path = r'C:\Users\GuilhermeIchibara\OneDrive - StepWise\Guilherme Ichibara\Projects\maple_tools\data\img\output\\'
image_path = data_path+r"target_binary.png"
image = cv2.imread(image_path)
# Check if the image is None
if image is None:
    raise ValueError("Invalid image file or path.")
    
# Step 2: Preprocess the image
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
blur = cv2.GaussianBlur(gray, (3, 3), 0)
bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]

# selected a kernel with more width so that we want to connect lines
kernel_size = (15, 1) 
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, kernel_size)

# Step 3: Perform the closing operation: Dilate and then close
bw_closed = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, kernel)

# Find contours for each text line
contours, _ = cv2.findContours(bw_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

# Filter contours to select those whose width is at least 3 times its height
filtered_contours = [cnt for cnt in contours if (cv2.boundingRect(cnt)[2] / cv2.boundingRect(cnt)[3])>=3.0]

# Sort contours based on y-coordinate
sorted_contours = sorted(filtered_contours, key=lambda contour: cv2.boundingRect(contour)[1])

padding=3
i=1
for contour in sorted_contours:
    x, y, w, h = cv2.boundingRect(contour)
    x, y, w, h = (x-padding, y-padding, w+padding, h+padding) 
    # cv2.rectangle(image, (x, y), (x + w, y + h), (0, 255, 0), 2)
    # Recognize each line. Crop the image for each line and pass to OCR engine.
    line_image = image[y:y + h+2, x:x+w+2]
    line_text = pytesseract.image_to_string(line_image)
    cv2.imwrite(f'line_{i}.png',line_image)
    i+=1
    print(line_text)

cv2.imwrite('opencv_detect_text_lines.png',image)