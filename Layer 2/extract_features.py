import os
import cv2
import csv
import numpy as np
from pathlib import Path

# --- Configuration matching Layer 1 ---
CANVAS_WIDTH = 64
CANVAS_HEIGHT = 36
FPS_TARGET = 4
WINDOW_SECONDS = 5

def get_brightness_and_saturation(frame):
    """
    Computes average brightness and saturation of a frame, matching Layer 1's HSL calculation.
    Expects frame as BGR numpy array from cv2.
    """
    # Convert BGR to RGB
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    # Normalize to [0, 1]
    r = rgb_frame[:, :, 0].astype(np.float32) / 255.0
    g = rgb_frame[:, :, 1].astype(np.float32) / 255.0
    b = rgb_frame[:, :, 2].astype(np.float32) / 255.0

    cmax = np.maximum(np.maximum(r, g), b)
    cmin = np.minimum(np.minimum(r, g), b)
    
    l = (cmax + cmin) / 2.0

    delta = cmax - cmin
    
    # Calculate saturation based on lightness threshold exactly like Layer 1
    s = np.zeros_like(l)
    
    mask_delta = delta != 0
    mask_l_high = l > 0.5
    
    mask_low = mask_delta & ~mask_l_high
    if np.any(mask_low):
        s[mask_low] = delta[mask_low] / (cmax[mask_low] + cmin[mask_low])
        
    mask_high = mask_delta & mask_l_high
    if np.any(mask_high):
        s[mask_high] = delta[mask_high] / (2.0 - cmax[mask_high] - cmin[mask_high])

    brightness = l * 100.0
    saturation = s * 100.0

    return np.mean(brightness), np.mean(saturation)

def process_video(video_path, label, csv_writer):
    print(f"Processing {label}: {video_path.name}")
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"  -> Failed to open {video_path}")
        return

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0
        
    # Calculate how many original frames to skip to hit ~4 FPS target
    frame_interval = max(1, int(fps / FPS_TARGET))
    
    # State tracking
    last_frame = None
    last_brightness = 0
    
    # Window aggregation
    window_start_time = 0.0
    
    window_saturations = []
    window_brightnesses = []
    window_motions = []
    window_flickers = []
    window_cuts = 0
    
    frame_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        current_time = frame_count / fps
        frame_count += 1
        
        # Sample at TARGET_FPS
        if frame_count % frame_interval != 0:
            continue
            
        # Resize to 64x36
        small_frame = cv2.resize(frame, (CANVAS_WIDTH, CANVAS_HEIGHT), interpolation=cv2.INTER_AREA)
        
        avg_brightness, avg_saturation = get_brightness_and_saturation(small_frame)
        
        motion_raw = 0
        if last_frame is not None:
            # Motion: abs diff of RGB (approximating Layer 1 logic)
            # Layer 1 logic: totalMotion += (diffR + diffG + diffB) / 3
            diff = np.abs(small_frame.astype(np.float32) - last_frame.astype(np.float32))
            motion_raw = np.mean(diff)
            
        flicker_raw = abs(avg_brightness - last_brightness) if last_frame is not None else 0
        
        # Compute scores exactly like Layer 1
        motion_score = min(100, (motion_raw / 60) * 100)
        flicker_score = min(100, (flicker_raw / 20) * 100)
        
        # Cut detection (Layer 1 trigger is > 30)
        if motion_raw > 30:
            window_cuts += 1
            
        window_saturations.append(avg_saturation)
        window_brightnesses.append(avg_brightness)
        window_motions.append(motion_score)
        window_flickers.append(flicker_score)
        
        last_frame = small_frame
        last_brightness = avg_brightness
        
        # Check window completion
        if current_time - window_start_time >= WINDOW_SECONDS:
            if window_saturations:
                mean_sat = np.mean(window_saturations)
                mean_bri = np.mean(window_brightnesses)
                mean_mot = np.mean(window_motions)
                mean_fli = np.mean(window_flickers)
                max_mot = np.max(window_motions)
                max_fli = np.max(window_flickers)
                
                # Normalize cuts to per-minute
                cuts_per_min = window_cuts * (60.0 / WINDOW_SECONDS)
                
                csv_writer.writerow([
                    video_path.name,
                    round(window_start_time, 2),
                    round(mean_sat, 2),
                    round(mean_bri, 2),
                    round(mean_mot, 2),
                    round(mean_fli, 2),
                    round(cuts_per_min, 2),
                    round(max_fli, 2),
                    round(max_mot, 2),
                    label
                ])
                
            # Reset window state for next 5-second chunk
            window_start_time = current_time
            window_saturations = []
            window_brightnesses = []
            window_motions = []
            window_flickers = []
            window_cuts = 0
            
    cap.release()

def main():
    base_dir = Path(__file__).parent
    dataset_dir = base_dir / "Dataset"
    high_dir = dataset_dir / "High"
    low_dir = dataset_dir / "Low"
    
    # Ensure directories exist
    high_dir.mkdir(parents=True, exist_ok=True)
    low_dir.mkdir(parents=True, exist_ok=True)
        
    out_csv = base_dir / "features.csv"
    
    with open(out_csv, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        # Write CSV header matching user requirements
        writer.writerow([
            "video_id", "window_start", "mean_saturation", "mean_brightness", 
            "mean_motion", "mean_flicker", "cuts_per_min", 
            "max_flicker", "max_motion", "label"
        ])
        
        # Process High folder
        high_videos = list(high_dir.glob("*.mp4"))
        for p in high_videos:
            process_video(p, "HIGH", writer)
            
        # Process Low folder
        low_videos = list(low_dir.glob("*.mp4"))
        for p in low_videos:
            process_video(p, "LOW", writer)
            
    print(f"\nFeature extraction complete! Saved to {out_csv}")

if __name__ == "__main__":
    main()
