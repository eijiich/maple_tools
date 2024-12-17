from pathlib import Path
from PIL import Image

# Path to the folder containing images
def downscale(size, folder_path, result_folder):
    # Create a result folder if it doesn't exist
    result_folder.mkdir(exist_ok=True)  # Creates the folder if it doesn't exist

    # Loop through all image files in the folder
    for image_path in folder_path.glob('*'):  # Iterate over all files in the folder
        # Check if the file is an image (you can extend this to more file types)
        if image_path.suffix.lower() in {'.png', '.jpg', '.jpeg', '.bmp', '.gif'}:
            # Check if the image has already been downscaled (based on the result folder)
            downscaled_image_path = result_folder / f'downscaled{size}_{image_path.name}'
            
            # If the downscaled image already exists, skip it
            if downscaled_image_path.exists():
                print(f"Skipping already downscaled image: {downscaled_image_path}")
                continue
            # Open the image
            image = Image.open(image_path)
            # Resize the image to 30x30
            downscaled_image = image.resize((size, size), Image.Resampling.LANCZOS)
            # Save the downscaled image in the result folder
            downscaled_image.save(downscaled_image_path)
            print(f"Resized and saved: {downscaled_image_path}")

if __name__ == "__main__":
    base_dir = Path(__file__).resolve().parent.parent 
    path = base_dir / "data/img/maple_images/300x300"
    result_path = base_dir / "data/img/maple_images/result"
    size = 16
    print(path)
    downscale(size, path, result_path)