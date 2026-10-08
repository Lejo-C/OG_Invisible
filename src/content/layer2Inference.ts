import modelData from './model.json';

const WINDOW_SECONDS = 5;
const FPS_TARGET = 4;
const FRAMES_PER_WINDOW = WINDOW_SECONDS * FPS_TARGET;

let frameBuffer: any[] = [];
let cutsInWindow = 0;

// Evaluation Storage
const evalHeader = "timestamp,video_id,layer1_score,layer1_level,mean_saturation,mean_brightness,mean_motion,mean_flicker,cuts_per_min,max_flicker,max_motion,ml_label,ml_probability";
const evalRecords: string[] = [evalHeader];

// Agreement Analysis Metrics
let evalTotalWindows = 0;
let evalL1HighL2High = 0;
let evalL2High = 0;
let evalL2Low = 0;
let evalDisagreements = 0;

export interface Layer2Result {
  mlLabel: string;
  mlProbability: number;
  mlReady: boolean;
}

// Attach export function to window so it can be called from DevTools
(window as any).exportLayer2Eval = () => {
  const csvContent = evalRecords.join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `layer2_eval_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log(`[Layer 2] Exported ${evalRecords.length - 1} evaluation records.`);
};

export function resetLayer2() {
  frameBuffer = [];
  cutsInWindow = 0;
}

export function processFrameLayer2(
  saturation: number,
  brightness: number,
  motionScore: number,
  flickerScore: number,
  isCut: boolean,
  isPaused: boolean,
  layer1Score: number,
  layer1Level: string
): Layer2Result | null {
  if (isPaused) {
    return null; // Do not accumulate when paused
  }

  // Handle cases where frame is invalid (NaN/Infinity)
  if (!Number.isFinite(saturation) || !Number.isFinite(brightness) || 
      !Number.isFinite(motionScore) || !Number.isFinite(flickerScore)) {
    return null;
  }

  frameBuffer.push({ saturation, brightness, motionScore, flickerScore });
  if (isCut) {
    cutsInWindow++;
  }

  // We only run inference once the window is full
  if (frameBuffer.length >= FRAMES_PER_WINDOW) {
    try {
      // calculate means/maxes
      let sumSat = 0;
      let sumBri = 0;
      let sumMot = 0;
      let sumFli = 0;
      let maxMot = 0;
      let maxFli = 0;

      for (const f of frameBuffer) {
        sumSat += f.saturation;
        sumBri += f.brightness;
        sumMot += f.motionScore;
        sumFli += f.flickerScore;
        if (f.motionScore > maxMot) maxMot = f.motionScore;
        if (f.flickerScore > maxFli) maxFli = f.flickerScore;
      }

      const meanSat = sumSat / frameBuffer.length;
      const meanBri = sumBri / frameBuffer.length;
      const meanMot = sumMot / frameBuffer.length;
      const meanFli = sumFli / frameBuffer.length;
      const cutsPerMin = cutsInWindow * (60.0 / WINDOW_SECONDS);

      // feature array matching train.py
      const features = [meanSat, meanBri, meanMot, meanFli, cutsPerMin, maxFli, maxMot];

      // Inference
      let logits = modelData.bias;
      for (let i = 0; i < features.length; i++) {
        const normalized = (features[i] - modelData.normalization.mean[i]) / modelData.normalization.scale[i];
        logits += normalized * modelData.weights[i];
      }

      const prob = 1.0 / (1.0 + Math.exp(-logits));
      const label = prob >= 0.5 ? modelData.classes[1] : modelData.classes[0];

      console.log(`[Layer 2] Window: ${frameBuffer.length} samples / ${WINDOW_SECONDS} seconds`);
      console.log(`[Layer 2] Features\n` +
                  `mean_saturation: ${meanSat.toFixed(2)}\n` +
                  `mean_brightness: ${meanBri.toFixed(2)}\n` +
                  `mean_motion: ${meanMot.toFixed(2)}\n` +
                  `mean_flicker: ${meanFli.toFixed(2)}\n` +
                  `cuts_per_min: ${cutsPerMin.toFixed(2)}\n` +
                  `max_flicker: ${maxFli.toFixed(2)}\n` +
                  `max_motion: ${maxMot.toFixed(2)}\n\n` +
                  `[Layer 2] Prediction: ${label} (${(prob * 100).toFixed(2)}%)`);

      // ─── Evaluation Logger ───
      const timestamp = new Date().toISOString();
      const videoId = window.location.search ? new URLSearchParams(window.location.search).get('v') || 'unknown' : 'unknown';
      
      const record = `${timestamp},${videoId},${layer1Score},${layer1Level},${meanSat.toFixed(2)},${meanBri.toFixed(2)},${meanMot.toFixed(2)},${meanFli.toFixed(2)},${cutsPerMin.toFixed(2)},${maxFli.toFixed(2)},${maxMot.toFixed(2)},${label},${prob.toFixed(4)}`;
      evalRecords.push(record);
      
      // ─── Agreement Analysis ───
      evalTotalWindows++;
      
      const isL1High = (layer1Score > 60); // HIGH or VERY HIGH
      const isL2High = (label === "HIGH");
      
      if (isL2High) evalL2High++;
      else evalL2Low++;
      
      if (isL1High && isL2High) evalL1HighL2High++;
      
      if (isL1High !== isL2High) evalDisagreements++;
      
      const agreementCount = evalTotalWindows - evalDisagreements;
      const agreementPct = (agreementCount / evalTotalWindows) * 100;
      
      console.log(`LAYER 2 EVALUATION`);
      console.log(`------------------`);
      console.log(`Windows analyzed: ${evalTotalWindows}\n`);
      console.log(`Agreement: ${agreementCount}/${evalTotalWindows} (${agreementPct.toFixed(1)}%)\n`);
      console.log(`ML HIGH: ${evalL2High}`);
      console.log(`ML LOW: ${evalL2Low}\n`);
      console.log(`Disagreements: ${evalDisagreements}\n`);

      const result: Layer2Result = {
        mlLabel: label,
        mlProbability: prob,
        mlReady: true
      };

      // Reset buffer for the next window
      resetLayer2();

      return result;
    } catch (e) {
      console.error("[Layer 2] Inference failed", e);
      resetLayer2();
      return null;
    }
  }

  return null;
}
