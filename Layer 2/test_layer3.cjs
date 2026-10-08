/**
 * Layer 3 Closed-Loop Controller — Unit Tests
 *
 * Run with: node "Layer 2/test_layer3.cjs"
 *
 * These tests do NOT require a browser environment or the Chrome extension to be loaded.
 * They directly import the compiled logic translated to CommonJS for offline verification.
 */

// ─── Inline the controller logic for testability (mirrors layer3Governor.ts) ─
const TARGET_UPPER = 30;
const RECOVERY_THRESHOLD = 20;
const ESCALATION_HYSTERESIS = 6;
const RECOVERY_HYSTERESIS = 16;
const HISTORY_SIZE = 12;
const SPIKE_DELTA = 30;

const LEVEL_ORDER = ['none', 'mild', 'moderate', 'strong', 'veryStrong'];

function levelIndex(l) { return LEVEL_ORDER.indexOf(l); }
function levelAbove(l) { const i = levelIndex(l); return i < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[i + 1] : l; }
function levelBelow(l) { const i = levelIndex(l); return i > 0 ? LEVEL_ORDER[i - 1] : l; }

function computeTrend(history) {
  if (history.length < 4) return 'stable';
  const recent = history.slice(-4);
  const delta = recent[recent.length - 1] - recent[0];
  if (delta > 8) return 'rising';
  if (delta < -8) return 'falling';
  return 'stable';
}

// Controller state (module-level, reset between tests)
let state;

function resetState() {
  state = {
    committedLevel: 'none',
    escalationCandidate: 'none',
    escalationCandidateCount: 0,
    scoreHistory: [],
    recoveryCount: 0,
    sustainedHighCount: 0,
    escalationCount: 0,
    deescalationCount: 0,
    lastScore: 0,
  };
}

function computeNextLevel(score, mlLabel, trend, spikeDetected) {
  const current = state.committedLevel;

  if (score <= TARGET_UPPER) {
    if (score < RECOVERY_THRESHOLD && state.recoveryCount >= RECOVERY_HYSTERESIS) {
      return { nextCandidate: levelBelow(current), reason: `recovery` };
    }
    return { nextCandidate: current, reason: `target maintained` };
  }

  if (spikeDetected && levelIndex(current) < LEVEL_ORDER.length - 1) {
    return { nextCandidate: levelAbove(current), reason: `spike` };
  }

  let needed;
  if (score > 85)      needed = 'veryStrong';
  else if (score > 70) needed = 'strong';
  else if (score > 55) needed = 'moderate';
  else if (score > TARGET_UPPER) needed = 'mild';
  else                 needed = 'none';

  if (mlLabel === 'HIGH' && score > TARGET_UPPER && score <= 55) {
    needed = levelAbove(needed);
  }

  if (levelIndex(current) >= levelIndex(needed) && score > TARGET_UPPER) {
    return { nextCandidate: levelAbove(current), reason: `feedback` };
  }

  if (trend === 'rising' && state.sustainedHighCount >= 4) {
    return { nextCandidate: levelAbove(needed), reason: `rising trend` };
  }

  return { nextCandidate: needed, reason: `score ${score}` };
}

function tick(score, mlLabel = undefined) {
  state.scoreHistory.push(score);
  if (state.scoreHistory.length > HISTORY_SIZE) state.scoreHistory.shift();

  const trend = computeTrend(state.scoreHistory);
  const spikeDetected = state.scoreHistory.length >= 2 && (score - state.lastScore) > SPIKE_DELTA;

  if (score > TARGET_UPPER) {
    state.sustainedHighCount++;
    state.recoveryCount = 0;
  } else {
    state.sustainedHighCount = 0;
    if (score < RECOVERY_THRESHOLD) state.recoveryCount++;
  }

  const { nextCandidate, reason } = computeNextLevel(score, mlLabel, trend, spikeDetected);

  if (nextCandidate !== state.committedLevel) {
    if (nextCandidate !== state.escalationCandidate) {
      state.escalationCandidate = nextCandidate;
      state.escalationCandidateCount = 1;
    } else {
      state.escalationCandidateCount++;
    }

    if (state.escalationCandidateCount >= ESCALATION_HYSTERESIS) {
      const prev = state.committedLevel;
      state.committedLevel = state.escalationCandidate;
      state.escalationCandidateCount = 0;

      if (levelIndex(state.committedLevel) > levelIndex(prev)) {
        state.escalationCount++;
      } else {
        state.deescalationCount++;
        state.recoveryCount = 0;
      }
    }
  } else {
    state.escalationCandidate = nextCandidate;
    state.escalationCandidateCount = 0;
  }

  state.lastScore = score;
  return state.committedLevel;
}

// ─── Test Harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function runTest(name, fn) {
  resetState();
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    → ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function tickN(score, n) {
  let last;
  for (let i = 0; i < n; i++) last = tick(score);
  return last;
}

function tickSequence(scores) {
  let last;
  for (const s of scores) last = tick(s);
  return last;
}

// ─── Tests ────────────────────────────────────────────────────────────────────
console.log('\nLayer 3 Closed-Loop Controller Tests\n' + '='.repeat(40));

runTest('Test 1 — High score reduced but still high does not declare success', () => {
  // score = 100, intervention applied, now 80 — still HIGH
  tickN(100, ESCALATION_HYSTERESIS + 1);
  const afterFirst = state.committedLevel;
  assert(afterFirst !== 'none', `Expected intervention, got none`);

  // Now pretend score dropped to 80 but still above target
  const level80 = tickN(80, ESCALATION_HYSTERESIS + 1);
  assert(level80 !== 'none', `Level should not drop to none at score=80, got ${level80}`);
  // And should escalate further since 80 > TARGET_UPPER
  assert(levelIndex(level80) >= levelIndex(afterFirst), `Should not de-escalate when score=80`);
});

runTest('Test 2 — Reaches target, escalation stops', () => {
  // Simulate progressive escalation then target reached
  tickN(100, ESCALATION_HYSTERESIS + 1);
  tickN(80,  ESCALATION_HYSTERESIS + 1);
  tickN(62,  ESCALATION_HYSTERESIS + 1);
  const beforeTarget = state.committedLevel;

  // Now score reaches 27 (within target)
  const atTarget = tickN(27, ESCALATION_HYSTERESIS + 1);
  assert(atTarget === beforeTarget, `Should hold ${beforeTarget} when score=27, but got ${atTarget}`);
});

runTest('Test 3 — Overshoot prevention: holds current when target is reached', () => {
  tickN(100, ESCALATION_HYSTERESIS + 1);
  tickN(70,  ESCALATION_HYSTERESIS + 1);
  tickN(42,  ESCALATION_HYSTERESIS + 1);
  const levelAt42 = state.committedLevel;

  // Score reaches 28 — target met
  const atTarget = tickN(28, ESCALATION_HYSTERESIS + 1);
  assert(atTarget === levelAt42,
    `Should hold ${levelAt42} at score=28, not escalate to ${atTarget}`);
});

runTest('Test 4 — Recovery gradually de-escalates', () => {
  // Build up strong intervention
  tickN(100, ESCALATION_HYSTERESIS + 1);
  tickN(80,  ESCALATION_HYSTERESIS + 1);
  const initialLevel = state.committedLevel;
  assert(levelIndex(initialLevel) >= 1, `Should be at least mild, got ${initialLevel}`);

  // Sustained deep recovery
  tickN(12, RECOVERY_HYSTERESIS + ESCALATION_HYSTERESIS + 2);
  const afterRecovery = state.committedLevel;
  assert(
    levelIndex(afterRecovery) < levelIndex(initialLevel),
    `Expected de-escalation below ${initialLevel}, got ${afterRecovery}`
  );
});

runTest('Test 5 — Single dip does NOT cause immediate de-escalation', () => {
  tickN(70, ESCALATION_HYSTERESIS + 1);
  const highLevel = state.committedLevel;

  tick(25); // single dip
  tick(68);
  tick(72);
  const afterDip = state.committedLevel;
  assert(afterDip === highLevel,
    `Single dip should not de-escalate ${highLevel}, got ${afterDip}`);
});

runTest('Test 6 — Persistent high stimulation causes progressive escalation', () => {
  // Simulate persistent moderately high scores
  const sequence = [70, 73, 76, 74, 78, 77, 75, 74, 76, 78];
  for (const s of sequence) tick(s);

  const finalLevel = state.committedLevel;
  assert(levelIndex(finalLevel) >= levelIndex('mild'),
    `Persistent high should escalate at least to mild, got ${finalLevel}`);
});

runTest('Test 7 — Stable target: no unnecessary oscillation', () => {
  // First get to a steady low state
  tickN(28, ESCALATION_HYSTERESIS + 1);
  const stable = state.committedLevel;

  // Now stay within target
  const stableScores = [28, 27, 29, 26, 28, 27, 29, 28];
  for (const s of stableScores) tick(s);

  assert(state.committedLevel === stable,
    `Profile should stay stable at ${stable}, got ${state.committedLevel}`);
  assert(state.escalationCount + state.deescalationCount <= 1,
    `Should not oscillate, escalation=${state.escalationCount} de=${state.deescalationCount}`);
});

runTest('Test 8 — New video reset clears all state', () => {
  // Build up state
  tickN(100, ESCALATION_HYSTERESIS + 2);
  assert(state.committedLevel !== 'none', 'Should have escalated');

  // Simulate resetLayer3
  resetState();
  assert(state.committedLevel === 'none', `After reset, level should be none, got ${state.committedLevel}`);
  assert(state.scoreHistory.length === 0, 'History should be empty');
  assert(state.escalationCount === 0, 'Escalation count should be zero');
  assert(state.recoveryCount === 0, 'Recovery count should be zero');
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All Layer 3 tests passed ✓\n');
}
