export interface AppState {
  enabled: boolean;
  saturation: number;
  brightness: number;
  playbackRate: number;
  governorEnabled: boolean;
}

export interface Telemetry {
  saturation: number;
  brightness: number;
  flicker: number;
  motion: number;
  cutsPerMin: number;
  score: number;
  level: string;
  intervention: string;
  governorLevel: string;
}

const DEFAULT_STATE: AppState = {
  enabled: false,
  saturation: 100,
  brightness: 100,
  playbackRate: 1.0,
  governorEnabled: false,
};

let currentState: AppState = { ...DEFAULT_STATE };
let videoElement: HTMLVideoElement | null = null;
let latestTelemetry: Telemetry | null = null;

function applySettings() {
  if (!videoElement) return;

  if (currentState.enabled) {
    videoElement.style.filter = `saturate(${currentState.saturation}%) brightness(${currentState.brightness}%)`;
    if (videoElement.playbackRate !== currentState.playbackRate) {
      videoElement.playbackRate = currentState.playbackRate;
    }
  } else {
    videoElement.style.filter = '';
    if (videoElement.playbackRate !== 1.0) {
      videoElement.playbackRate = 1.0;
    }
  }
}

function findVideoElement() {
  const video = (document.querySelector('video.html5-main-video') || document.querySelector('video')) as HTMLVideoElement | null;
  if (video && video !== videoElement) {
    videoElement = video;
    
    videoElement.addEventListener('ratechange', () => {
      if (currentState.enabled && videoElement && videoElement.playbackRate !== currentState.playbackRate) {
        videoElement.playbackRate = currentState.playbackRate;
      }
    });
    
    videoElement.addEventListener('loadeddata', applySettings);
    applySettings();
  }
}

// Telemetry Logic
const CANVAS_WIDTH = 64;
const CANVAS_HEIGHT = 36;
const canvas = document.createElement('canvas');
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let lastImageData: Uint8ClampedArray | null = null;
let lastBrightness = 0;
let cutTimestamps: number[] = [];

class RollingAverage {
  values: number[] = [];
  constructor(public size: number) {}
  add(val: number) {
    this.values.push(val);
    if (this.values.length > this.size) this.values.shift();
    return this.get();
  }
  get() {
    return this.values.length ? this.values.reduce((a, b) => a + b, 0) / this.values.length : 0;
  }
}

const smoothSaturation = new RollingAverage(4);
const smoothBrightness = new RollingAverage(4);
const smoothFlicker = new RollingAverage(4);
const smoothMotion = new RollingAverage(4);
const smoothScore = new RollingAverage(4);

function getBrightnessAndSaturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  let s = 0;
  if (max !== min) {
    s = l > 0.5 ? (max - min) / (2.0 - max - min) : (max - min) / (max + min);
  }
  return { brightness: l * 100, saturation: s * 100 };
}

function analyzeFrame() {
  if (!videoElement || videoElement.readyState < 2 || !ctx) return;
  
  try {
    ctx.drawImage(videoElement, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const imageData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data;
    
    let totalBrightness = 0;
    let totalSaturation = 0;
    let totalMotion = 0;
    
    for (let i = 0; i < imageData.length; i += 4) {
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];
      
      const { brightness, saturation } = getBrightnessAndSaturation(r, g, b);
      totalBrightness += brightness;
      totalSaturation += saturation;
      
      if (lastImageData) {
        const diffR = Math.abs(r - lastImageData[i]);
        const diffG = Math.abs(g - lastImageData[i + 1]);
        const diffB = Math.abs(b - lastImageData[i + 2]);
        totalMotion += (diffR + diffG + diffB) / 3;
      }
    }
    
    const numPixels = CANVAS_WIDTH * CANVAS_HEIGHT;
    const avgBrightness = totalBrightness / numPixels;
    const avgSaturation = totalSaturation / numPixels;
    const isPaused = videoElement.paused;
    const avgMotionRaw = (lastImageData && !isPaused) ? (totalMotion / numPixels) : 0;
    
    const motionScore = Math.min(100, (avgMotionRaw / 60) * 100); 
    const flickerRaw = isPaused ? 0 : Math.abs(avgBrightness - lastBrightness);
    const flickerScore = Math.min(100, (flickerRaw / 20) * 100); 
    
    const now = Date.now();
    if (avgMotionRaw > 30 && !isPaused) {
      cutTimestamps.push(now);
    }
    cutTimestamps = cutTimestamps.filter(t => now - t < 60000);
    const cutsPerMinRaw = cutTimestamps.length;
    const cutScore = Math.min(100, (cutsPerMinRaw / 15) * 100);

    const sSat = smoothSaturation.add(avgSaturation);
    const sBri = smoothBrightness.add(avgBrightness);
    const sFli = smoothFlicker.add(flickerScore);
    const sMot = smoothMotion.add(motionScore);
    
    const scoreRaw = 
      (sSat * 0.25) + 
      (sBri * 0.15) + 
      (sFli * 0.25) + 
      (cutScore * 0.20) + 
      (sMot * 0.15);
      
    const finalScore = Math.round(smoothScore.add(scoreRaw));
    const clampedScore = Math.max(0, Math.min(100, finalScore));
    
    let level = 'CALM';
    let intervention = 'No intervention';
    if (clampedScore > 80) {
      level = 'VERY HIGH';
      intervention = 'Strong intervention';
    } else if (clampedScore > 60) {
      level = 'HIGH';
      intervention = 'Medium intervention';
    } else if (clampedScore > 30) {
      level = 'MODERATE';
      intervention = 'Low intervention';
    }

    const governorLevel = getGovernorLevel(clampedScore);

    latestTelemetry = {
      saturation: Math.round(sSat),
      brightness: Math.round(sBri),
      flicker: Math.round(sFli),
      motion: Math.round(sMot),
      cutsPerMin: cutsPerMinRaw,
      score: clampedScore,
      level,
      intervention,
      governorLevel,
    };

    lastImageData = new Uint8ClampedArray(imageData);
    lastBrightness = avgBrightness;

    // Run the automatic governor (additive — only when enabled)
    runGovernor(clampedScore);

    try {
      chrome.runtime.sendMessage({ type: 'TELEMETRY', payload: latestTelemetry }).catch(() => {});
    } catch(e) {}

  } catch (e) {
    console.warn('[Stimulation Governor] Frame analysis warning:', e);
  }
}

// ─── Automatic Governor ─────────────────────────────────────────────────────
// This is a NEW additive layer. It does NOT modify any existing functions.
// It reuses applySettings() and currentState to apply its adjustments.

const GOVERNOR_PRESETS: Record<string, { saturation: number; brightness: number; playbackRate: number }> = {
  none:       { saturation: 100, brightness: 100, playbackRate: 1.00 },
  mild:       { saturation:  90, brightness:  95, playbackRate: 0.95 },
  moderate:   { saturation:  80, brightness:  90, playbackRate: 0.90 },
  strong:     { saturation:  70, brightness:  82, playbackRate: 0.80 },
  veryStrong: { saturation:  60, brightness:  75, playbackRate: 0.70 },
};

function getGovernorLevel(score: number): string {
  if (score > 85) return 'veryStrong';
  if (score > 70) return 'strong';
  if (score > 50) return 'moderate';
  if (score > 30) return 'mild';
  return 'none';
}

let lastGovernorLevel = 'none';
let governorCandidateLevel = 'none'; // level being evaluated for hysteresis
let governorStableCount = 0;         // consecutive frames candidate has been stable
const GOVERNOR_HYSTERESIS = 6;       // ~1.5 s at 4 FPS before a level change commits

function runGovernor(score: number) {
  if (!currentState.governorEnabled) return;

  const newLevel = getGovernorLevel(score);

  // Nothing to do — already at this level
  if (newLevel === lastGovernorLevel) {
    governorCandidateLevel = newLevel;
    governorStableCount = 0;
    return;
  }

  // A different level is being proposed — track how long it stays stable
  if (newLevel !== governorCandidateLevel) {
    // Candidate changed; restart hysteresis countdown
    governorCandidateLevel = newLevel;
    governorStableCount = 1;
    return;
  }

  // Same candidate as last frame — accumulate
  governorStableCount++;
  if (governorStableCount < GOVERNOR_HYSTERESIS) return;

  // Candidate has been stable long enough — commit it
  governorStableCount = 0;
  lastGovernorLevel = newLevel;

  const preset = GOVERNOR_PRESETS[newLevel];
  // Write the governor's target values directly into the in-memory state
  // and call the existing applySettings() — the same path manual controls use.
  // We do NOT write to chrome.storage so the user's saved manual values are preserved.
  currentState = { ...currentState, ...preset };
  applySettings();
}
// ─────────────────────────────────────────────────────────────────────────────

// Initial load
chrome.storage.local.get(['appState'], (result) => {
  if (result.appState) {
    currentState = result.appState as AppState;
  }
  findVideoElement();
});

// Listen for storage changes as a reliable fallback for manual controls.
// When the governor is active, preserve its in-memory values so storage writes
// from other sources (popup re-sync) do not undo the governor's adjustments.
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.appState) {
    const incoming = changes.appState.newValue as AppState;
    if (currentState.governorEnabled && incoming.governorEnabled) {
      // Governor is on: only sync the flags, not the governor-controlled fields
      currentState = {
        ...currentState,
        enabled: incoming.enabled,
        governorEnabled: incoming.governorEnabled,
      };
    } else {
      // Governor is off: full sync (existing behaviour)
      currentState = incoming;
    }
    applySettings();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'UPDATE_STATE') {
    currentState = message.payload;
    // If governor was just turned off, reset its level so next enable is fresh
    if (!currentState.governorEnabled) {
      lastGovernorLevel = 'none';
      governorCandidateLevel = 'none';
      governorStableCount = 0;
    }
    applySettings();
  } else if (message.type === 'GET_TELEMETRY') {
    sendResponse({ telemetry: latestTelemetry });
  }
});

setInterval(() => {
  findVideoElement();
  applySettings();
}, 500);

setInterval(analyzeFrame, 250); // 4 FPS

console.log('[Stimulation Governor] Content script loaded and active.');
