// ─── TUNING CONSTANTS ──────────────────────────────────────────────────────
// BEEP_THRESHOLD should be higher (louder) than AUM_THRESHOLD so normal
// chanting doesn't accidentally trigger a stop. A phone timer beep at 10 feet
// should read around -15 to -25 dBFS depending on your phone volume.

const BEEP_THRESHOLD = -20;     // dBFS — spike must exceed this
const BEEP_MAX_DURATION = 600;  // ms  — spike must resolve within this (beeps are brief)
const BEEP_COOLDOWN = 2000;     // ms  — ignore further triggers after a beep fires

// ───────────────────────────────────────────────────────────────────────────

export function createBeepDetector({ onBeepDetected, getIsInsideAum }) {
  let spikeStart = null;
  let lastFiredAt = null;

  function feed({ timestamp, metering }) {
    // Don't trigger while chanting is active
    if (getIsInsideAum()) {
      spikeStart = null;
      return;
    }

    // Don't trigger during cooldown
    if (lastFiredAt && timestamp - lastFiredAt < BEEP_COOLDOWN) {
      return;
    }

    if (metering >= BEEP_THRESHOLD) {
      if (!spikeStart) {
        spikeStart = timestamp; // spike began
      }
    } else {
      if (spikeStart) {
        const spikeDuration = timestamp - spikeStart;
        if (spikeDuration <= BEEP_MAX_DURATION) {
          // Brief spike that resolved — it's a beep
          lastFiredAt = timestamp;
          spikeStart = null;
          onBeepDetected(timestamp);
        } else {
          // Spike lasted too long — probably a voice sound, not a beep
          spikeStart = null;
        }
      }
    }
  }

  function reset() {
    spikeStart = null;
    lastFiredAt = null;
  }

  return { feed, reset };
}
