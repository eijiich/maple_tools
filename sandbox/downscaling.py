from pathlib import Path
from PIL import Image

def downscale(size, folder_path, result_folder):
    result_folder.mkdir(exist_ok=True)

    for image_path in folder_path.glob('*'):
        if image_path.suffix.lower() in {'.png', '.jpg', '.jpeg', '.bmp', '.gif'}:
            downscaled_image_path = result_folder / f'downscaled{size}_{image_path.stem}'
            
            if downscaled_image_path.exists():
                print(f"Skipping already downscaled image: {downscaled_image_path.stem}")
                continue
            image = Image.open(image_path)
            downscaled_image = image.resize((size, size), Image.Resampling.LANCZOS)
            if downscaled_image.mode == 'RGBA':
                downscaled_image = downscaled_image.convert('RGB')
            downscaled_image.save(str(downscaled_image_path)+'.jpg', format='JPEG', quality=100)  # quality can be adjusted (1-100)
            downscaled_image.save(str(downscaled_image_path)+'.png')
            print(f"Resized and saved: {downscaled_image_path}")

if __name__ == "__main__":
    base_dir = Path(__file__).resolve().parent.parent 
    path = base_dir / "data/img/maple_images/300x300"
    path = base_dir / "data"#/img/maple_images/300x300"
    result_path = base_dir / "data/img/maple_images/result"
    size = 17
    print(path)
    downscale(size, path, result_path)