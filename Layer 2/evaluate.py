import os
import json
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix

def main():
    base_dir = Path(__file__).parent
    model_path = base_dir / "model" / "model.json"
    csv_path = base_dir / "features.csv"
    
    if not model_path.exists():
        print(f"Model not found at {model_path}")
        return
        
    with open(model_path, 'r', encoding='utf-8') as f:
        model_data = json.load(f)
        
    if not csv_path.exists():
        print(f"Error: {csv_path} not found.")
        return
        
    df = pd.read_csv(csv_path)
    
    FEATURES = model_data["features"]
    means = np.array(model_data["normalization"]["mean"])
    scales = np.array(model_data["normalization"]["scale"])
    weights = np.array(model_data["weights"])
    bias = model_data["bias"]
    
    print(f"Evaluating loaded model.json on entire features.csv...")
    print("-" * 50)
    
    X = df[FEATURES].values
    y_true = (df['label'] == 'HIGH').astype(int).values
    
    # Scale exactly like training
    X_scaled = (X - means) / scales
    
    # Predict (Logistic Regression inference)
    logits = np.dot(X_scaled, weights) + bias
    probs = 1.0 / (1.0 + np.exp(-logits))
    y_pred = (probs >= 0.5).astype(int)
    
    acc = accuracy_score(y_true, y_pred)
    prec = precision_score(y_true, y_pred, zero_division=0)
    rec = recall_score(y_true, y_pred, zero_division=0)
    f1 = f1_score(y_true, y_pred, zero_division=0)
    cm = confusion_matrix(y_true, y_pred)
    
    print(f"Accuracy:  {acc:.4f}")
    print(f"Precision: {prec:.4f}")
    print(f"Recall:    {rec:.4f}")
    print(f"F1 Score:  {f1:.4f}")
    print("\nConfusion Matrix:")
    print(cm)

if __name__ == "__main__":
    main()
