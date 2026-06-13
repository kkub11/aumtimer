// ─── TUNING CONSTANTS ──────────────────────────────────────────────────────
// Adjust these after running debug mode to see your actual metering values.
// In debug mode, watch the console: chant AUM and note where metering peaks,
// then sit silent and note the floor. Set thresholds between those values.

const AUM_THRESHOLD = -35;      // dBFS — metering must exceed this to start a candidate
const AUM_MIN_DURATION = 1500;  // ms  — must stay above threshold this long to confirm AUM
const AUM_END_THRESHOLD = -45;  // dBFS — below this counts as silence
const AUM_END_SILENCE = 300;    // ms  — silence needed to close out one AUM

// ───────────────────────────────────────────────────────────────────────────

export function createAumDetector({ onAumOnset, onAumComplete }, config = {}) {
  const threshold    = config.aumThreshold    ?? AUM_THRESHOLD;
  const minDuration  = config.aumMinDuration  ?? AUM_MIN_DURATION;
  const endThreshold = config.aumEndThreshold ?? AUM_END_THRESHOLD;
  const endSilence   = config.aumEndSilence   ?? AUM_END_SILENCE;

  let state = 'silent'; // 'silent' | 'candidate' | 'confirmed' | 'ending'
  let candidateStart = null;
  let silenceStart = null;
  let firstOnsetFired = false;

  function feed({ timestamp, metering }) {
    switch (state) {
      case 'silent':
        if (metering >= threshold) {
          state = 'candidate';
          candidateStart = timestamp;
        }
        break;

      case 'candidate':
        if (metering < threshold) {
          state = 'silent';
          candidateStart = null;
        } else if (timestamp - candidateStart >= minDuration) {
          state = 'confirmed';
          if (!firstOnsetFired) {
            firstOnsetFired = true;
            onAumOnset(candidateStart);
          }
        }
        break;

      case 'confirmed':
        if (metering < endThreshold) {
          state = 'ending';
          silenceStart = timestamp;
        }
        break;

      case 'ending':
        if (metering >= threshold) {
          state = 'confirmed';
          silenceStart = null;
        } else if (timestamp - silenceStart >= endSilence) {
          state = 'silent';
          silenceStart = null;
          candidateStart = null;
          onAumComplete();
        }
        break;
    }
  }

  function reset() {
    state = 'silent';
    candidateStart = null;
    silenceStart = null;
    firstOnsetFired = false;
  }

  // Returns true if we're currently inside an active AUM (for beep guard)
  function isInsideAum() {
    return state === 'confirmed' || state === 'ending';
  }

  return { feed, reset, isInsideAum };
}
