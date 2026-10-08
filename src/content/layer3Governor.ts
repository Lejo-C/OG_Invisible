// ─── Layer 3 — Adaptive Governor (SHADOW MODE) ───────────────────────────────
// This module is purely advisory. It NEVER writes to currentState, NEVER calls
// applySettings(), and NEVER touches the video element. Layer 1 remains the sole
// actual controller of the video.
//
// It produces a recommendation + target preview values that the UI can display
// to make the adaptive system visible during development/evaluation.
// ─────────────────────────────────────────────────────────────────────────────

export type Layer3Level = 'none' | 'mild' | 'moderate' | 'strong' | 'veryStrong';

export interface Layer3Recommendation {
  level: Layer3Level;
  targetSaturation: number;
  targetBrightness: number;
  targetPlaybackRate: number;
}

// Mirrors the existing Layer 1 governor presets exactly.
// Brightness is in the same CSS % convention the UI already uses (100 = normal).
const LAYER3_PRESETS: Record<Layer3Level, { saturation: number; brightness: number; playbackRate: number }> = {
  none:       { saturation: 100, brightness: 100, playbackRate: 1.00 },
  mild:       { saturation:  90, brightness:  95, playbackRate: 0.95 },
  moderate:   { saturation:  80, brightness:  90, playbackRate: 0.90 },
  strong:     { saturation:  70, brightness:  82, playbackRate: 0.80 },
  veryStrong: { saturation:  60, brightness:  75, playbackRate: 0.70 },
};

// ─── Hysteresis ───────────────────────────────────────────────────────────────
// Prevents rapid oscillation. A candidate level must be stable for
// LAYER3_HYSTERESIS consecutive calls before it becomes the committed level.
// At 4 FPS (250 ms interval) this equals ~1.5 s, same as Layer 1.
const LAYER3_HYSTERESIS = 6;

let committedLevel: Layer3Level = 'none';
let candidateLevel: Layer3Level = 'none';
let candidateCount = 0;

// ─── Decision Logic ───────────────────────────────────────────────────────────
// Uses Layer 1 score as the primary signal and Layer 2 ML label as a modifier.
// If Layer 2 says HIGH when score is borderline, it nudges the level up.
function computeCandidate(layer1Score: number, mlLabel: string | undefined): Layer3Level {
  // Base level from Layer 1 score (same boundaries as Layer 1 governor)
  let base: Layer3Level;
  if (layer1Score > 85)      base = 'veryStrong';
  else if (layer1Score > 70) base = 'strong';
  else if (layer1Score > 50) base = 'moderate';
  else if (layer1Score > 30) base = 'mild';
  else                       base = 'none';

  // Layer 2 modifier: if ML says HIGH and score is borderline (30–55), nudge up one step
  if (mlLabel === 'HIGH' && layer1Score > 30 && layer1Score <= 55) {
    const nudgeMap: Record<Layer3Level, Layer3Level> = {
      none:       'mild',
      mild:       'moderate',
      moderate:   'moderate',
      strong:     'strong',
      veryStrong: 'veryStrong',
    };
    base = nudgeMap[base];
  }

  return base;
}

// ─── Public API ───────────────────────────────────────────────────────────────
// Call this once per analyzeFrame() cycle. Returns the current committed
// recommendation (unchanged until hysteresis clears).
export function updateLayer3(
  layer1Score: number,
  mlLabel: string | undefined
): Layer3Recommendation {
  const candidate = computeCandidate(layer1Score, mlLabel);

  if (candidate === committedLevel) {
    // Already at this level — reset candidate tracking
    candidateLevel = candidate;
    candidateCount = 0;
  } else if (candidate !== candidateLevel) {
    // New candidate — restart hysteresis
    candidateLevel = candidate;
    candidateCount = 1;
  } else {
    // Same candidate accumulating
    candidateCount++;
    if (candidateCount >= LAYER3_HYSTERESIS) {
      committedLevel = candidateLevel;
      candidateCount = 0;
      console.log(`[Layer 3] Recommendation committed: ${committedLevel} (score=${layer1Score}, ml=${mlLabel ?? 'n/a'})`);
    }
  }

  const preset = LAYER3_PRESETS[committedLevel];
  return {
    level: committedLevel,
    targetSaturation: preset.saturation,
    targetBrightness: preset.brightness,
    targetPlaybackRate: preset.playbackRate,
  };
}

export function resetLayer3() {
  committedLevel = 'none';
  candidateLevel = 'none';
  candidateCount = 0;
}
