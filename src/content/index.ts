import { processFrameLayer2, resetLayer2 } from './layer2Inference';
import { updateLayer3, resetLayer3 } from './layer3Governor';
import { initAudio, setAudioEnabled, getAudioLoudness } from './audioProcessor';
import { initTimeTracker, isTimeLimitReached, tickTimeTracker } from './timeTracker';

export interface AppState {
  enabled: boolean;
  saturation: number;
  brightness: number;
  playbackRate: number;
  governorEnabled: boolean;
  audioEnabled: boolean;
}

export interface Telemetry {
  saturation: number;
  brightness: number;
  flicker: number;
  motion: number;
  cutsPerMin: number;
  audioScore: number;
  score: number;
  level: string;
  intervention: string;
  governorLevel: string;
  flashDetected: boolean;
  mlLabel?: string;
  mlProbability?: number;
  mlReady?: boolean;
  // Layer 3 shadow recommendation (preview-only, does NOT control video)
  l3Level?: string;
  l3TargetSaturation?: number;
  l3TargetBrightness?: number;
  l3TargetPlaybackRate?: number;
  // Layer 3 controller diagnostics
  l3TargetScore?: number;
  l3ControlError?: number;
  l3Trend?: string;
  l3SpikeDetected?: boolean;
  l3RecoveryDetected?: boolean;
  l3SustainedHighCount?: number;
  l3RecoveryCount?: number;
  l3EscalationCount?: number;
  l3DeescalationCount?: number;
  l3Reason?: string;
}

const DEFAULT_STATE: AppState = {
  enabled: false,
  saturation: 100,
  brightness: 100,
  playbackRate: 1.0,
  governorEnabled: false,
  audioEnabled: false,
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
  
  // Sync audio compressor state
  setAudioEnabled(currentState.audioEnabled);
}

function findVideoElement() {
  const video = (document.querySelector('video.html5-main-video') || document.querySelector('video')) as HTMLVideoElement | null;
  if (video && video !== videoElement) {
    videoElement = video;
    resetLayer2();
    resetLayer3();
    
    videoElement.addEventListener('ratechange', () => {
      if (currentState.enabled && videoElement && videoElement.playbackRate !== currentState.playbackRate) {
        videoElement.playbackRate = currentState.playbackRate;
      }
    });
    
    videoElement.addEventListener('loadeddata', applySettings);
    
    // Initialize Web Audio graph
    initAudio(videoElement);
    
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
    
    // Time tracker (runs every frame loop)
    const title = document.title.replace(' - YouTube', '').trim();
    tickTimeTracker(!isPaused, title);
    
    const motionScore = Math.min(100, (avgMotionRaw / 60) * 100); 
    const flickerRaw = isPaused ? 0 : Math.abs(avgBrightness - lastBrightness);
    const flickerScore = Math.min(100, (flickerRaw / 20) * 100); 
    
    const now = Date.now();
    const isCutBool = (avgMotionRaw > 30 && !isPaused);
    if (isCutBool) {
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

    // --- Layer 2 Shadow Mode Integration ---
    const l2Result = processFrameLayer2(
      avgSaturation,
      avgBrightness,
      motionScore,
      flickerScore,
      isCutBool,
      isPaused,
      clampedScore,
      level
    );

    let currentMlLabel = latestTelemetry?.mlLabel;
    let currentMlProb = latestTelemetry?.mlProbability;
    let currentMlReady = latestTelemetry?.mlReady || false;

    if (l2Result) {
      currentMlLabel = l2Result.mlLabel;
      currentMlProb = l2Result.mlProbability;
      currentMlReady = true;
    }
    // ---------------------------------------

    // --- Layer 3 Adaptive Controller (CONTROL MODE) ---
    const l3 = updateLayer3(clampedScore, currentMlLabel);
    // -------------------------------------------------------------------

    const governorLevel = l3.level;

    latestTelemetry = {
      saturation: Math.round(sSat),
      brightness: Math.round(sBri),
      flicker: Math.round(sFli),
      motion: Math.round(sMot),
      cutsPerMin: cutsPerMinRaw,
      audioScore: getAudioLoudness(),
      score: clampedScore,
      level,
      intervention,
      governorLevel,
      flashDetected: flickerScore >= 60,
      mlLabel: currentMlLabel,
      mlProbability: currentMlProb,
      mlReady: currentMlReady,
      // Layer 3 preview (shadow-only)
      l3Level: l3.level,
      l3TargetSaturation: l3.targetSaturation,
      l3TargetBrightness: l3.targetBrightness,
      l3TargetPlaybackRate: l3.targetPlaybackRate,
      l3TargetScore: l3.targetScore,
      l3ControlError: l3.controlError,
      l3Trend: l3.trend,
      l3SpikeDetected: l3.spikeDetected,
      l3RecoveryDetected: l3.recoveryDetected,
      l3SustainedHighCount: l3.sustainedHighCount,
      l3RecoveryCount: l3.recoveryCount,
      l3EscalationCount: l3.escalationCount,
      l3DeescalationCount: l3.deescalationCount,
      l3Reason: l3.reason,
    };

    lastImageData = new Uint8ClampedArray(imageData);
    lastBrightness = avgBrightness;

    // Run the automatic governor (applies Layer 3 targets when enabled)
    runGovernor();

    try {
      chrome.runtime.sendMessage({ type: 'TELEMETRY', payload: latestTelemetry }).catch(() => {});
    } catch(e) {}

  } catch (e) {
    console.warn('[Stimulation Governor] Frame analysis warning:', e);
  }
}

// ─── Automatic Governor (Driven by Layer 3) ────────────────────────────────
let lastGovernorLevel = 'none';

function runGovernor() {
  if (!currentState.governorEnabled || !latestTelemetry) return;

  const newLevel = latestTelemetry.governorLevel;

  // Nothing to do — already at this level
  if (newLevel === lastGovernorLevel) {
    return;
  }

  // Candidate has changed (Layer 3 handles hysteresis internally)
  lastGovernorLevel = newLevel;

  // Write the Layer 3 target values directly into the in-memory state
  // and call the existing applySettings() — the same path manual controls use.
  // We do NOT write to chrome.storage so the user's saved manual values are preserved.
  currentState = { 
    ...currentState, 
    saturation: latestTelemetry.l3TargetSaturation ?? 100,
    brightness: latestTelemetry.l3TargetBrightness ?? 100,
    playbackRate: latestTelemetry.l3TargetPlaybackRate ?? 1.0,
  };
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
        audioEnabled: incoming.audioEnabled,
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
    const incoming = message.payload as AppState;
    if (currentState.governorEnabled && incoming.governorEnabled) {
      // Governor is on: only sync the flags, not the governor-controlled fields
      currentState = {
        ...currentState,
        enabled: incoming.enabled,
        governorEnabled: incoming.governorEnabled,
        audioEnabled: incoming.audioEnabled,
      };
    } else {
      // Governor is off: full sync
      currentState = incoming;
    }
    
    // If governor was just turned off, reset its level so next enable is fresh
    if (!currentState.governorEnabled) {
      lastGovernorLevel = 'none';
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

function enforceTimeLimitBlocker() {
  if (isTimeLimitReached()) {
    if (videoElement && !videoElement.paused) {
      videoElement.pause();
    }
    let overlay = document.getElementById('og-time-blocker-overlay-full');
    if (!overlay && videoElement && videoElement.parentElement) {
      overlay = document.createElement('div');
      overlay.id = 'og-time-blocker-overlay-full';
      overlay.style.cssText = [
        'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'background-color:#0f172a', 'z-index:999999', 'display:flex',
        'flex-direction:column', 'align-items:center', 'justify-content:center',
        'color:#f8fafc', 'font-family:-apple-system, sans-serif', 'text-align:center', 'padding:20px'
      ].join(';');
      overlay.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <h1 style="font-size:24px; font-weight:bold; margin-bottom:10px;">Daily Time Limit Reached</h1>
        <p style="font-size:16px; color:#94a3b8; max-width:400px; margin:0 auto;">You have reached your daily YouTube limit. Please take a break!</p>
      `;
      videoElement.parentElement.appendChild(overlay);
    }
    if (videoElement) {
       videoElement.style.opacity = '0';
    }
  } else {
    let overlay = document.getElementById('og-time-blocker-overlay-full');
    if (overlay) {
      overlay.remove();
      if (videoElement) {
        videoElement.style.opacity = '1';
      }
    }
  }
}

setInterval(enforceTimeLimitBlocker, 500);
setInterval(analyzeFrame, 250); // 4 FPS

console.log('[Stimulation Governor] Content script loaded and active.');

// ─── On-video Status Badge ───────────────────────────────────────────────────
// Single badge element created once and reused. Never duplicated.
const BADGE_ID = 'og-stimulation-badge';

function getOrCreateBadge(): HTMLElement {
  let badge = document.getElementById(BADGE_ID);
  if (!badge) {
    badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.style.cssText = [
      'position:absolute',
      'top:12px',
      'right:12px',
      'z-index:9999',
      'background:rgba(0,0,0,0.72)',
      'color:#e2e8f0',
      'font-family:monospace',
      'font-size:11px',
      'line-height:1.6',
      'padding:6px 10px',
      'border-radius:6px',
      'pointer-events:none',
      'white-space:nowrap',
      'border:1px solid rgba(255,255,255,0.08)',
    ].join(';');
    document.body.appendChild(badge);
  }
  return badge;
}

function positionBadgeOverVideo() {
  const badge = document.getElementById(BADGE_ID);
  if (!badge || !videoElement) return;
  const container = videoElement.closest('.html5-video-container, .ytd-player, #movie_player') as HTMLElement | null;
  const parent = container || (videoElement.parentElement as HTMLElement | null);
  if (parent && badge.parentElement !== parent) {
    parent.style.position = parent.style.position || 'relative';
    parent.appendChild(badge);
  }
}

function updateBadge() {
  const badge = getOrCreateBadge();
  if (!currentState.enabled || !latestTelemetry) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'block';
  positionBadgeOverVideo();
  const t = latestTelemetry;
  const govLabel = t.governorLevel === 'veryStrong' ? 'VERY STRONG'
    : t.governorLevel === 'none' ? 'NONE'
    : t.governorLevel.toUpperCase();
  const flashLine = t.flashDetected ? '\nFLASH: DETECTED' : '';
  const mlLine = t.mlReady ? `\nML: ${t.mlLabel} ${Math.round((t.mlProbability || 0) * 100)}%` : '';
  const audioLine = `\nAUDIO: ${t.audioScore} ${currentState.audioEnabled ? '(CMP: ON)' : '(CMP: OFF)'}`;
  const l3Label = t.l3Level && t.l3Level !== 'none' ? t.l3Level === 'veryStrong' ? 'VERY STRONG' : t.l3Level.toUpperCase() : 'NONE';
  const l3Line = `\nL3: ${l3Label} → Sat:${t.l3TargetSaturation ?? 100}% Bri:${t.l3TargetBrightness ?? 100}% Spd:${(t.l3TargetPlaybackRate ?? 1.0).toFixed(2)}x`;
  badge.textContent = `STIMULATION ${t.score}  ${t.level}\nACTION: ${govLabel}${flashLine}${mlLine}${audioLine}${l3Line}`;
  badge.style.whiteSpace = 'pre';
}
// ─────────────────────────────────────────────────────────────────────────────

// Initialize modules
initTimeTracker();

// ─── Action Log ──────────────────────────────────────────────────────────────
// In-memory log; records only committed governor-level changes.
const ACTION_LOG_MAX = 10;

export interface ActionLogEntry {
  time: string;
  score: number;
  level: string;
}

const actionLog: ActionLogEntry[] = [];
let lastLoggedGovernorLevel = '';

function maybeLogAction(score: number, governorLevel: string) {
  if (governorLevel === lastLoggedGovernorLevel) return;
  lastLoggedGovernorLevel = governorLevel;
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  const label = governorLevel === 'veryStrong' ? 'Very Strong'
    : governorLevel === 'none' ? 'None'
    : governorLevel.charAt(0).toUpperCase() + governorLevel.slice(1);
  actionLog.push({ time, score, level: label });
  if (actionLog.length > ACTION_LOG_MAX) actionLog.shift();
  // Push updated log to popup if it's open
  try {
    chrome.runtime.sendMessage({ type: 'ACTION_LOG', payload: [...actionLog] }).catch(() => {});
  } catch(e) {}
}
// ─────────────────────────────────────────────────────────────────────────────

// Hook badge update and action-log into the existing analyzeFrame timer cycle.
// We attach to the same 250 ms interval indirectly: call them from within the
// existing TELEMETRY send block by extending the message handler chain.
setInterval(() => {
  updateBadge();
  if (latestTelemetry) {
    maybeLogAction(latestTelemetry.score, latestTelemetry.governorLevel);
  }
}, 500);

// Position badge whenever video element changes (SPA navigation).
// Hooks into the existing 500 ms interval already calling findVideoElement().
let _lastVideoForBadge: HTMLVideoElement | null = null;
setInterval(() => {
  if (videoElement && videoElement !== _lastVideoForBadge) {
    _lastVideoForBadge = videoElement;
    positionBadgeOverVideo();
  }
}, 600);

// Handle GET_ACTION_LOG message from popup.
// Extends the existing onMessage listener by adding a new message type.
chrome.runtime.onMessage.addListener((message, _sender2, sendResponse2) => {
  if (message.type === 'GET_ACTION_LOG') {
    sendResponse2({ actionLog: [...actionLog] });
  }
});
