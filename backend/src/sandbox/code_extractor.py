import os

def generate_txt(folder_path, output_file="output.txt"):
    """
    Reads .tsx files from the specified folder and generates a formatted .txt file.
    
    Args:
        folder_path (str): The path to the folder containing .tsx files.
        output_file (str): The name of the output text file.
    """
    try:
        if not os.path.exists(folder_path):
            print(f"Error: Folder '{folder_path}' does not exist.")
            return

        tsx_files = [f for f in os.listdir(folder_path) if f.endswith('.tsx')]
        if not tsx_files:
            print("No .tsx files found in the folder.")
            return
        
        with open(output_file, 'w', encoding='utf-8') as output:
            for tsx_file in tsx_files:
                file_path = os.path.join(folder_path, tsx_file)
                with open(file_path, 'r', encoding='utf-8') as file:
                    content = file.read()
                
                # Write formatted content to the output file
                output.write(f"{tsx_file}\n\n")
                output.write("'''\n")
                output.write(content)
                output.write("\n'''\n\n")
        
        print(f"Output successfully written to '{output_file}'")

    except Exception as e:
        print(f"An error occurred: {e}")

# Example usage
# Replace 'your_folder_path' with the actual path to the folder containing .tsx files
generate_txt(r"C:\Desenvolvimento\Projects\maple_tools\frontend\src\components")
