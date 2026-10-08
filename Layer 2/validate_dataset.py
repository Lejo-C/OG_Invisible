import os
import cv2
from pathlib import Path

def main():
    base_dir = Path(__file__).parent
    dataset_dir = base_dir / "Dataset"
    high_dir = dataset_dir / "High"
    low_dir = dataset_dir / "Low"

    print("DATASET VALIDATION")
    print("-" * 18)

    if not high_dir.exists() or not low_dir.exists():
        print("Error: High or Low directory missing.")
        print("Status: NOT READY")
        return False

    high_files = list(high_dir.glob("*.mp4"))
    low_files = list(low_dir.glob("*.mp4"))

    print(f"HIGH videos: {len(high_files)}")
    print(f"LOW videos: {len(low_files)}\n")

    all_files = high_files + low_files
    
    # Check for duplicates
    filenames = [f.name for f in all_files]
    duplicates = len(filenames) - len(set(filenames))
    
    valid_count = 0
    invalid_count = 0

    for f in all_files:
        cap = cv2.VideoCapture(str(f))
        if not cap.isOpened():
            invalid_count += 1
            print(f"Invalid (cannot open): {f.name}")
            continue
            
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        if fps <= 0 or frame_count <= 0:
            invalid_count += 1
            print(f"Invalid (duration/fps 0): {f.name}")
        else:
            valid_count += 1
            
        cap.release()

    print(f"Readable: {valid_count}/{len(all_files)}")
    print(f"Invalid: {invalid_count}")
    print(f"Duplicates: {duplicates}\n")

    if invalid_count == 0 and duplicates == 0 and valid_count > 0:
        print("Status: READY")
        return True
    else:
        print("Status: NOT READY")
        return False

if __name__ == "__main__":
    main()
