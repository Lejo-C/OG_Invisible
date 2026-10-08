export interface AppState {
  enabled: boolean;
  saturation: number;
  brightness: number;
  playbackRate: number;
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
}

const DEFAULT_STATE: AppState = {
  enabled: false,
  saturation: 100,
  brightness: 100,
  playbackRate: 1.0,
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

    latestTelemetry = {
      saturation: Math.round(sSat),
      brightness: Math.round(sBri),
      flicker: Math.round(sFli),
      motion: Math.round(sMot),
      cutsPerMin: cutsPerMinRaw,
      score: clampedScore,
      level,
      intervention
    };

    lastImageData = new Uint8ClampedArray(imageData);
    lastBrightness = avgBrightness;

    try {
      chrome.runtime.sendMessage({ type: 'TELEMETRY', payload: latestTelemetry }).catch(() => {});
    } catch(e) {}

  } catch (e) {
    console.warn('[Stimulation Governor] Frame analysis warning:', e);
  }
}

// Initial load
chrome.storage.local.get(['appState'], (result) => {
  if (result.appState) {
    currentState = result.appState as AppState;
  }
  findVideoElement();
});

// Listen for storage changes as a reliable fallback for manual controls
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.appState) {
    currentState = changes.appState.newValue;
    applySettings();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'UPDATE_STATE') {
    currentState = message.payload;
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
