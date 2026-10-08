const fs = require('fs');
const path = require('path');

function predict(features, model) {
    // 1. Normalize
    const normalized = features.map((val, i) => {
        return (val - model.normalization.mean[i]) / model.normalization.scale[i];
    });
    
    // 2. Dot product
    let logits = model.bias;
    for (let i = 0; i < normalized.length; i++) {
        logits += normalized[i] * model.weights[i];
    }
    
    // 3. Sigmoid
    const prob = 1.0 / (1.0 + Math.exp(-logits));
    
    // 4. Classify
    const idx = prob >= 0.5 ? 1 : 0;
    return model.classes[idx];
}

function main() {
    const modelPath = path.join(__dirname, 'model', 'model.json');
    const predsPath = path.join(__dirname, 'python_preds.json');
    
    if (!fs.existsSync(modelPath) || !fs.existsSync(predsPath)) {
        console.error("Missing required files.");
        return;
    }
    
    const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    const testSamples = JSON.parse(fs.readFileSync(predsPath, 'utf8'));
    
    let matches = 0;
    let pyCorrect = 0;
    let jsCorrect = 0;
    const total = testSamples.length;
    
    console.log("Evaluating test samples (sample size: 3 videos)...\n");
    
    testSamples.forEach((sample, i) => {
        const jsPred = predict(sample.features, model);
        const pyPred = sample.python_pred;
        const expected = sample.expected;
        
        const isMatch = jsPred === pyPred;
        if (isMatch) matches++;
        
        if (pyPred === expected) pyCorrect++;
        if (jsPred === expected) jsCorrect++;
        
        // Print first 5 samples as requested
        if (i < 5) {
            console.log(`Expected: ${expected}`);
            console.log(`Python:   ${pyPred}`);
            console.log(`JS:       ${jsPred}`);
            console.log(isMatch ? "MATCH\n" : "MISMATCH\n");
        }
    });
    
    console.log("-".repeat(40));
    console.log(`Total test samples:      ${total}`);
    console.log(`Matching predictions:    ${matches}`);
    console.log(`Mismatching predictions: ${total - matches}`);
    console.log(`Agreement percentage:    ${((matches / total) * 100).toFixed(2)}%`);
    console.log(`Python accuracy:         ${((pyCorrect / total) * 100).toFixed(2)}%`);
    console.log(`JavaScript accuracy:     ${((jsCorrect / total) * 100).toFixed(2)}%`);
    
    if (matches === total) {
        console.log("\nExported model is ready for browser integration!");
    }
}

main();
