import json
import pandas as pd
import numpy as np
from pathlib import Path

def main():
    base_dir = Path(__file__).parent
    model_path = base_dir / "model" / "model.json"
    csv_path = base_dir / "features.csv"
    
    with open(model_path, 'r', encoding='utf-8') as f:
        model_data = json.load(f)
        
    df = pd.read_csv(csv_path)
    
    # Same test videos as train.py
    test_vids = ['vid004_low.mp4', 'vid002_low.mp4', 'vid001_high.mp4']
    test_df = df[df['video_id'].isin(test_vids)]
    
    FEATURES = model_data["features"]
    means = np.array(model_data["normalization"]["mean"])
    scales = np.array(model_data["normalization"]["scale"])
    weights = np.array(model_data["weights"])
    bias = model_data["bias"]
    
    X = test_df[FEATURES].values
    y_true = test_df['label'].tolist()
    
    X_scaled = (X - means) / scales
    logits = np.dot(X_scaled, weights) + bias
    probs = 1.0 / (1.0 + np.exp(-logits))
    y_pred_idx = (probs >= 0.5).astype(int)
    
    preds = [model_data["classes"][i] for i in y_pred_idx]
    
    results = []
    for i, (_, row) in enumerate(test_df.iterrows()):
        results.append({
            "expected": row['label'],
            "python_pred": preds[i],
            "features": [row[f] for f in FEATURES]
        })
        
    with open(base_dir / "python_preds.json", "w") as f:
        json.dump(results, f)

if __name__ == "__main__":
    main()
