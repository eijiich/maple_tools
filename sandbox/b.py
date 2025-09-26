from pathlib import Path
import cv2
import pytesseract
import matplotlib.pyplot as plt

base_dir = Path(__file__).resolve().parent.parent  # Adjust according to the file's structure
custom_config = r'--oem 3 --psm 6 -c tessedit_char_whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+%:()."' 

# Define paths relative to the base directory
data_path = base_dir/'data'/'img'/'dataset'
output_path = base_dir/'data'/'img'/'output'

# Converting Path objects to strings for compatibility with OpenCV
data_path = str(data_path)
output_path = str(output_path)

# Path to your image
image_path = data_path+'\\'+r'\extracted_text_gray_image_binary.png'

# Load image
image = cv2.imread(str(image_path))

# Convert to grayscale
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

# Upscale (2x)
scale = 2
gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)

# Threshold
_, thresh = cv2.threshold(gray, 160, 255, cv2.THRESH_BINARY)

# Show preprocessing result
cv2.imshow("thresh", thresh)
cv2.waitKey(0)
cv2.destroyAllWindows()


# Slight blur helps smooth edges
blur = cv2.medianBlur(thresh, 3)

# Optional: Apply dilation/erosion to strengthen text
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 1))
processed = cv2.morphologyEx(blur, cv2.MORPH_CLOSE, kernel)

cv2.imshow("Processed", processed)
cv2.waitKey(0)
cv2.destroyAllWindows()

# Run pytesseract OCR
text = pytesseract.image_to_string(processed, config=custom_config)

print("=== Extracted Text ===")
print(text)
