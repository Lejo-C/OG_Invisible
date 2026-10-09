// ─── Layer 3 — Closed-Loop Adaptive Stimulation Controller ───────────────────
//
// ARCHITECTURE:
//   Layer 1 measures stimulation (score 0–100)
//   Layer 2 provides ML classification (LOW / HIGH)
//   Layer 3 adaptively chooses an intervention profile and observes whether
//           the resulting stimulation reaches the target range.
//
// CONTROL MODE: This module acts as the brain. It evaluates conditions and returns
// target values. index.ts takes these targets and applies them directly to the
// video element via the runGovernor() loop.
//
// CLOSED-LOOP CONCEPT:
//   OBSERVE stimulation → ANALYZE vs target → INTERVENE → OBSERVE result →
//   ADJUST if not at target → REPEAT
// ─────────────────────────────────────────────────────────────────────────────

// ─── Tunable Constants ────────────────────────────────────────────────────────
/** Upper bound of the "acceptable" stimulation zone. Escalate if score exceeds this. */
const TARGET_UPPER = 30;
/** Sustained recovery must stay below this before de-escalation is considered. */
const RECOVERY_THRESHOLD = 20;
/** Number of consecutive samples a new profile must be stable before committing (escalation). */
const ESCALATION_HYSTERESIS = 6;   // ~1.5 s at 4 FPS
/** Number of consecutive samples score must stay below RECOVERY_THRESHOLD to de-escalate. */
const RECOVERY_HYSTERESIS = 16;    // ~4 s — conservative to prevent premature drop
/** Number of samples used for recent trend / spike detection. */
const HISTORY_SIZE = 12;           // ~3 s
/** Score jump in a single frame considered a spike. */
const SPIKE_DELTA = 30;
// ─────────────────────────────────────────────────────────────────────────────

export type Layer3Level = 'none' | 'mild' | 'moderate' | 'strong' | 'veryStrong';

const LEVEL_ORDER: Layer3Level[] = ['none', 'mild', 'moderate', 'strong', 'veryStrong'];

// Intervention profiles — brightness uses the same CSS % convention as Layer 1
// (100 = normal, values below 100 reduce brightness).
const LAYER3_PRESETS: Record<Layer3Level, { saturation: number; brightness: number; playbackRate: number }> = {
  none:       { saturation: 100, brightness: 100, playbackRate: 1.00 },
  mild:       { saturation:  90, brightness:  95, playbackRate: 0.95 },
  moderate:   { saturation:  80, brightness:  90, playbackRate: 0.90 },
  strong:     { saturation:  70, brightness:  82, playbackRate: 0.80 },
  veryStrong: { saturation:  60, brightness:  75, playbackRate: 0.70 },
};

export interface Layer3Telemetry {
  level: Layer3Level;
  targetSaturation: number;
  targetBrightness: number;
  targetPlaybackRate: number;
  // Controller diagnostics
  targetScore: number;
  controlError: number;       // currentScore - TARGET_UPPER (positive = need intervention)
  trend: 'rising' | 'falling' | 'stable';
  spikeDetected: boolean;
  recoveryDetected: boolean;
  sustainedHighCount: number;
  recoveryCount: number;
  escalationCount: number;
  deescalationCount: number;
  reason: string;
}

// ─── Controller State ─────────────────────────────────────────────────────────
let committedLevel: Layer3Level = 'none';
let escalationCandidate: Layer3Level = 'none';
let escalationCandidateCount = 0;

let scoreHistory: number[] = [];
let recoveryCount = 0;        // consecutive samples below RECOVERY_THRESHOLD
let sustainedHighCount = 0;   // consecutive samples above TARGET_UPPER
let escalationCount = 0;      // lifetime escalation events this video
let deescalationCount = 0;    // lifetime de-escalation events this video
let lastScore = 0;
// ─────────────────────────────────────────────────────────────────────────────

function levelIndex(l: Layer3Level): number {
  return LEVEL_ORDER.indexOf(l);
}

function levelAbove(l: Layer3Level): Layer3Level {
  const i = levelIndex(l);
  return i < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[i + 1] : l;
}

function levelBelow(l: Layer3Level): Layer3Level {
  const i = levelIndex(l);
  return i > 0 ? LEVEL_ORDER[i - 1] : l;
}

function computeTrend(history: number[]): 'rising' | 'falling' | 'stable' {
  if (history.length < 4) return 'stable';
  const recent = history.slice(-4);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const delta = last - first;
  if (delta > 8) return 'rising';
  if (delta < -8) return 'falling';
  return 'stable';
}


// ─── Core Adaptive Decision ───────────────────────────────────────────────────
function computeNextLevel(
  score: number,
  mlLabel: string | undefined,
  trend: 'rising' | 'falling' | 'stable',
  spikeDetected: boolean
): { nextCandidate: Layer3Level; reason: string } {
  const current = committedLevel;

  // ── CASE: Score within acceptable target ──────────────────────────────────
  if (score <= TARGET_UPPER) {
    // Target reached — do NOT increase intervention.
    // Recovery: if below RECOVERY_THRESHOLD long enough, de-escalate.
    if (score < RECOVERY_THRESHOLD && recoveryCount >= RECOVERY_HYSTERESIS) {
      const next = levelBelow(current);
      return { nextCandidate: next, reason: `Sustained recovery (${recoveryCount} samples below ${RECOVERY_THRESHOLD})` };
    }
    // Otherwise hold current profile — the intervention is working.
    return { nextCandidate: current, reason: `Target maintained (score=${score})` };
  }

  // Spike: score jumped dramatically in one frame — react one level faster
  if (spikeDetected && levelIndex(current) < LEVEL_ORDER.length - 1) {
    const spikeTarget = levelAbove(current);
    return { nextCandidate: spikeTarget, reason: `Spike detected (delta=${score - lastScore})` };
  }

  // Determine the required profile based on how far we are above target.
  // This is not a fixed mapping — it escalates beyond what is "normally" needed
  // if the current intervention has already been applied and score is still high.
  let needed: Layer3Level;
  if (score > 85)      needed = 'veryStrong';
  else if (score > 70) needed = 'strong';
  else if (score > 55) needed = 'moderate';
  else if (score > TARGET_UPPER) needed = 'mild';
  else                 needed = 'none';

  // If ML says HIGH, boost needed one step at borderline zone (30–55)
  if (mlLabel === 'HIGH' && score > TARGET_UPPER && score <= 55) {
    needed = levelAbove(needed);
  }

  // FEEDBACK ADJUSTMENT: if we already committed a profile and score is still
  // above target, the profile is insufficient — escalate beyond `needed`.
  if (levelIndex(current) >= levelIndex(needed) && score > TARGET_UPPER) {
    // Current intervention didn't bring us to target. Go one step higher.
    const feedbackNext = levelAbove(current);
    return {
      nextCandidate: feedbackNext,
      reason: `Feedback: ${current} insufficient (score=${score} > target=${TARGET_UPPER})`
    };
  }

  // Rising trend with sustained high — be proactive
  if (trend === 'rising' && sustainedHighCount >= 4) {
    const rising = levelAbove(needed);
    return { nextCandidate: rising, reason: `Rising trend + sustained (score=${score})` };
  }

  return { nextCandidate: needed, reason: `Score ${score} > target ${TARGET_UPPER}, needed ${needed}` };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call once per analyzeFrame() cycle (every ~250ms).
 * Returns the full controller telemetry including advisory profile.
 */
export function updateLayer3(
  layer1Score: number,
  mlLabel: string | undefined
): Layer3Telemetry {
  // ── Update history ────────────────────────────────────────────────────────
  scoreHistory.push(layer1Score);
  if (scoreHistory.length > HISTORY_SIZE) scoreHistory.shift();

  const trend = computeTrend(scoreHistory);
  const spikeDetected = scoreHistory.length >= 2
    && (layer1Score - lastScore) > SPIKE_DELTA;
  const recoveryDetected = layer1Score < RECOVERY_THRESHOLD;

  // Track sustained counters
  if (layer1Score > TARGET_UPPER) {
    sustainedHighCount++;
    recoveryCount = 0;
  } else {
    sustainedHighCount = 0;
    if (layer1Score < RECOVERY_THRESHOLD) {
      recoveryCount++;
    } else {
      // Between thresholds — hold, don't count either way
    }
  }

  // ── Compute desired next candidate ───────────────────────────────────────
  const { nextCandidate, reason } = computeNextLevel(layer1Score, mlLabel, trend, spikeDetected);

  let loggedReason = reason;

  // ── Hysteresis gate ───────────────────────────────────────────────────────
  // A candidate (different from committed) must be stable for ESCALATION_HYSTERESIS
  // calls before we commit it. Recovery de-escalation is allowed through computeNextLevel
  // directly since it already checks recoveryCount >= RECOVERY_HYSTERESIS.
  if (nextCandidate !== committedLevel) {
    if (nextCandidate !== escalationCandidate) {
      escalationCandidate = nextCandidate;
      escalationCandidateCount = 1;
    } else {
      escalationCandidateCount++;
    }

    if (escalationCandidateCount >= ESCALATION_HYSTERESIS) {
      const prev = committedLevel;
      committedLevel = escalationCandidate;
      escalationCandidateCount = 0;

      if (levelIndex(committedLevel) > levelIndex(prev)) {
        escalationCount++;
        console.log(`[Layer 3] ESCALATE ${prev} → ${committedLevel} | ${loggedReason}`);
      } else {
        deescalationCount++;
        // De-escalation committed — also reset recovery counter to prevent
        // immediately de-escalating again on the next call.
        recoveryCount = 0;
        console.log(`[Layer 3] DE-ESCALATE ${prev} → ${committedLevel} | ${loggedReason}`);
      }
    }
  } else {
    // Candidate matches committed — reset candidate tracking
    escalationCandidate = nextCandidate;
    escalationCandidateCount = 0;
  }

  lastScore = layer1Score;

  const preset = LAYER3_PRESETS[committedLevel];
  const controlError = layer1Score - TARGET_UPPER;

  return {
    level: committedLevel,
    targetSaturation: preset.saturation,
    targetBrightness: preset.brightness,
    targetPlaybackRate: preset.playbackRate,
    targetScore: TARGET_UPPER,
    controlError,
    trend,
    spikeDetected,
    recoveryDetected,
    sustainedHighCount,
    recoveryCount,
    escalationCount,
    deescalationCount,
    reason: loggedReason,
  };
}

export function resetLayer3() {
  committedLevel = 'none';
  escalationCandidate = 'none';
  escalationCandidateCount = 0;
  scoreHistory = [];
  recoveryCount = 0;
  sustainedHighCount = 0;
  escalationCount = 0;
  deescalationCount = 0;
  lastScore = 0;
  console.log('[Layer 3] Reset — new video session.');
}
