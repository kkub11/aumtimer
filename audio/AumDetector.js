// ─── TUNING CONSTANTS ──────────────────────────────────────────────────────
// Adjust these after running debug mode to see your actual metering values.
// In debug mode, watch the console: chant AUM and note where metering peaks,
// then sit silent and note the floor. Set thresholds between those values.

const AUM_THRESHOLD = -30;      // dBFS — metering must exceed this to start a candidate
const AUM_MIN_DURATION = 1500;  // ms  — must stay above threshold this long to confirm AUM
const AUM_END_THRESHOLD = -40;  // dBFS — below this counts as silence
const AUM_END_SILENCE = 400;    // ms  — silence needed to close out one AUM

// ───────────────────────────────────────────────────────────────────────────

export function createAumDetector({ onAumOnset, onAumComplete }) {
  let state = 'silent'; // 'silent' | 'candidate' | 'confirmed' | 'ending'
  let candidateStart = null;
  let silenceStart = null;
  let firstOnsetFired = false;

  function feed({ timestamp, metering }) {
    switch (state) {
      case 'silent':
        if (metering >= AUM_THRESHOLD) {
          // Sound started — begin candidate window
          state = 'candidate';
          candidateStart = timestamp;
        }
        break;

      case 'candidate':
        if (metering < AUM_THRESHOLD) {
          // Dropped out too fast — not an AUM, reset
          state = 'silent';
          candidateStart = null;
        } else if (timestamp - candidateStart >= AUM_MIN_DURATION) {
          // Sustained long enough — confirmed AUM onset
          state = 'confirmed';
          if (!firstOnsetFired) {
            firstOnsetFired = true;
            onAumOnset(candidateStart); // mark chanting start time (first AUM only)
          }
        }
        break;

      case 'confirmed':
        if (metering < AUM_END_THRESHOLD) {
          // Sound dropping — start watching for end of this AUM
          state = 'ending';
          silenceStart = timestamp;
        }
        break;

      case 'ending':
        if (metering >= AUM_THRESHOLD) {
          // Sound came back — still the same AUM or a new one starting
          state = 'confirmed';
          silenceStart = null;
        } else if (timestamp - silenceStart >= AUM_END_SILENCE) {
          // Silence held long enough — this AUM is complete
          state = 'silent';
          silenceStart = null;
          candidateStart = null;
          onAumComplete(); // increment count
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
