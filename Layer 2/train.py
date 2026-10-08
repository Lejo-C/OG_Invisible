import os
import json
import shutil
import subprocess
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix

import validate_dataset
import extract_features

def main():
    base_dir = Path(__file__).parent
    
    # 1. Validate dataset
    if not validate_dataset.main():
        print("Dataset validation failed. Aborting training.")
        return
        
    print("\nExtracting/updating features.csv...")
    # 2. Extract features
    extract_features.main()
    
    csv_path = base_dir / "features.csv"
    if not csv_path.exists():
        print(f"Error: {csv_path} not found.")
        return
        
    df = pd.read_csv(csv_path)
    
    # Target and features
    FEATURES = [
        "mean_saturation", "mean_brightness", "mean_motion", 
        "mean_flicker", "cuts_per_min", "max_flicker", "max_motion"
    ]
    
    unique_videos = df['video_id'].unique()
    
    # Split videos into 80% train, 20% test
    train_vids, test_vids = train_test_split(unique_videos, test_size=0.2, random_state=42)
    
    print("-" * 60)
    print(f"Training on videos: {train_vids.tolist()}")
    print(f"Testing on videos:  {test_vids.tolist()}")
    print("-" * 60)
    
    train_df = df[df['video_id'].isin(train_vids)]
    test_df = df[df['video_id'].isin(test_vids)]
    
    X_train = train_df[FEATURES].values
    y_train = (train_df['label'] == 'HIGH').astype(int).values
    
    X_test = test_df[FEATURES].values
    y_test = (test_df['label'] == 'HIGH').astype(int).values
    
    # Normalize features based on training set statistics
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Train lightweight model with strong L2 regularization to prevent collinearity
    # forcing weights to remain positive and genuine, preventing false HIGHs on low inputs.
    model = LogisticRegression(random_state=42, C=0.005)
    model.fit(X_train_scaled, y_train)
    
    # Evaluate Train
    y_train_pred = model.predict(X_train_scaled)
    train_acc = accuracy_score(y_train, y_train_pred)
    
    # Evaluate Test
    y_test_pred = model.predict(X_test_scaled)
    test_acc = accuracy_score(y_test, y_test_pred)
    precision = precision_score(y_test, y_test_pred, zero_division=0)
    recall = recall_score(y_test, y_test_pred, zero_division=0)
    f1 = f1_score(y_test, y_test_pred, zero_division=0)
    cm = confusion_matrix(y_test, y_test_pred)
    
    print(f"Train Accuracy: {train_acc:.4f}")
    print(f"Test Accuracy:  {test_acc:.4f}")
    print(f"Test Precision: {precision:.4f}")
    print(f"Test Recall:    {recall:.4f}")
    print(f"Test F1 Score:  {f1:.4f}")
    print("\nConfusion Matrix (Test):")
    print(cm)
    
    # Export model to JSON for future browser usage
    model_dir = base_dir / "model"
    model_dir.mkdir(exist_ok=True)
    
    model_data = {
        "features": FEATURES,
        "normalization": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist()
        },
        "weights": model.coef_[0].tolist(),
        "bias": model.intercept_[0],
        "classes": ["LOW", "HIGH"]
    }
    
    model_json_path = model_dir / "model.json"
    with open(model_json_path, 'w', encoding='utf-8') as f:
        json.dump(model_data, f, indent=2)
        
    print(f"\nModel exported to {model_json_path}")
    
    # Also update the browser extension's copy
    ext_model_path = base_dir.parent / "src" / "content" / "model.json"
    if ext_model_path.exists():
        shutil.copy(model_json_path, ext_model_path)
        print(f"Updated extension model at {ext_model_path}")
    
    # 4. Model Verification (Part 4)
    print("\nRunning automated model verification (JS vs Python)...")
    try:
        subprocess.run(["python", str(base_dir / "dump_python_preds.py")], check=True)
        subprocess.run(["node", str(base_dir / "verify_model.cjs")], check=True)
    except Exception as e:
        print(f"Verification script failed: {e}")

if __name__ == "__main__":
    main()
