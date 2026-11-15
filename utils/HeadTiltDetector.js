// Detects the head-tilt sequence after the AUM section:
//   tilt all the way back → all the way forward → return to vertical (held).
// Pitch comes from ML Kit via VisionCamera (headEulerAngleX / pitchAngle, degrees).
// Positive pitch means looking up (head tilted back) in ML Kit's coordinate system.
// If a front camera appears inverted on a given device, flip pitchSign to -1.

export const DEFAULT_HEAD_TILT_CONFIG = {
  backThresholdDeg: 28,       // degrees above baseline to count as "all the way back"
  forwardThresholdDeg: 28,    // degrees below baseline to count as "all the way forward"
  verticalBandDeg: 12,        // |pitch - baseline| must stay in this band to count as vertical
  holdMs: 500,                // how long the return-to-vertical must be held
  smoothWindow: 5,            // moving-average sample count
  faceLostToleranceMs: 450,   // ignore brief face-lost gaps without resetting the sequence
  calibrationMs: 4000,        // collect baseline samples for this long at session start
  calibrationMinSamples: 12,
  pitchSign: 1,               // +1: positive pitch = looking up
  sensitivity: 1,             // >1 shrinks thresholds (easier to trigger); <1 loosens them
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function createHeadTiltDetector({ onTiltBack, onTiltForward, onReturnToVertical } = {}, config = {}) {
  const cfg = { ...DEFAULT_HEAD_TILT_CONFIG, ...config };
  const sensitivity = Math.max(0.4, Number(cfg.sensitivity) || 1);
  const backTh = cfg.backThresholdDeg / sensitivity;
  const fwdTh = cfg.forwardThresholdDeg / sensitivity;
  const vertBand = cfg.verticalBandDeg / sensitivity;

  let baseline = null;
  let calibrationSamples = [];
  let calibrationStart = null;
  let armed = false; // true once the first AUM has been detected
  // idle → calibrating → watching → back → forward → complete
  let state = 'idle';
  let pitchWindow = [];
  let lastFaceAt = null;
  let verticalHoldStart = null;
  let tiltBackTime = null;
  let tiltForwardTime = null;
  let completeTime = null;
  let lastSmoothed = null;
  let lastHasFace = false;

  function maybeWatch() {
    if (completeTime) return;
    if (armed && baseline != null && (state === 'idle' || state === 'calibrating')) {
      state = 'watching';
    }
  }

  function notifyFirstAum() {
    armed = true;
    maybeWatch();
  }

  function smooth(pitch) {
    pitchWindow.push(pitch);
    if (pitchWindow.length > cfg.smoothWindow) pitchWindow.shift();
    return pitchWindow.reduce((sum, v) => sum + v, 0) / pitchWindow.length;
  }

  function feed({ timestamp, pitch, hasFace }) {
    if (completeTime) return;

    if (!hasFace || pitch == null || Number.isNaN(pitch)) {
      if (lastFaceAt && timestamp - lastFaceAt <= cfg.faceLostToleranceMs) {
        return; // brief dropout — keep state and last smoothed pitch
      }
      lastHasFace = false;
      verticalHoldStart = null;
      return;
    }

    lastFaceAt = timestamp;
    lastHasFace = true;
    const smoothed = smooth(pitch * cfg.pitchSign);
    lastSmoothed = smoothed;

    if (baseline == null) {
      state = 'calibrating';
      if (calibrationStart == null) calibrationStart = timestamp;
      calibrationSamples.push(smoothed);
      if (
        timestamp - calibrationStart >= cfg.calibrationMs &&
        calibrationSamples.length >= cfg.calibrationMinSamples
      ) {
        baseline = median(calibrationSamples);
        maybeWatch();
      }
      return;
    }

    if (!armed || state === 'complete') return;

    const rel = smoothed - baseline;

    if (state === 'watching') {
      if (rel >= backTh) {
        state = 'back';
        tiltBackTime = timestamp;
        onTiltBack?.(timestamp);
      }
      return;
    }

    if (state === 'back') {
      // Hysteresis: stay in "back" until the forward threshold is crossed
      if (rel <= -fwdTh) {
        state = 'forward';
        tiltForwardTime = timestamp;
        onTiltForward?.(timestamp);
        verticalHoldStart = null;
      }
      return;
    }

    if (state === 'forward') {
      if (Math.abs(rel) <= vertBand) {
        if (verticalHoldStart == null) verticalHoldStart = timestamp;
        else if (timestamp - verticalHoldStart >= cfg.holdMs) {
          state = 'complete';
          completeTime = timestamp;
          onReturnToVertical?.(timestamp, { tiltBackTime, tiltForwardTime });
        }
      } else {
        verticalHoldStart = null;
      }
    }
  }

  function getTimes() {
    return {
      tiltBackTime,
      tiltForwardTime,
      completeTime,
      baseline,
    };
  }

  function getStatus() {
    const rel = (baseline != null && lastSmoothed != null)
      ? lastSmoothed - baseline
      : null;
    return {
      state,
      armed,
      hasFace: lastHasFace,
      baseline,
      smoothedPitch: lastSmoothed,
      relativePitch: rel,
      completeTime,
    };
  }

  function reset() {
    baseline = null;
    calibrationSamples = [];
    calibrationStart = null;
    armed = false;
    state = 'idle';
    pitchWindow = [];
    lastFaceAt = null;
    verticalHoldStart = null;
    tiltBackTime = null;
    tiltForwardTime = null;
    completeTime = null;
    lastSmoothed = null;
    lastHasFace = false;
  }

  return { feed, notifyFirstAum, getTimes, getStatus, reset };
}
