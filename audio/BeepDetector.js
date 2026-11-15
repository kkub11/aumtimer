// ─── TUNING CONSTANTS ──────────────────────────────────────────────────────
// expo-audio only exposes volume metering (dBFS), not pitch/frequency, so a
// "high-pitched beep" is detected as a brief loud spike that rises above
// threshold and falls back within BEEP_MAX_DURATION. A phone timer beep at
// ~10 feet typically reads around -15 to -25 dBFS. These values are code
// constants (not Settings sliders); pass overrides via the config argument.

export const DEFAULT_BEEP_CONFIG = {
  beepThreshold: -20,     // dBFS — spike must exceed this
  beepMaxDuration: 600,   // ms  — spike must resolve within this (beeps are brief)
  beepCooldown: 2000,     // ms  — ignore further triggers after a beep fires
};

// ───────────────────────────────────────────────────────────────────────────

export function createBeepDetector({ onBeepDetected, getIsInsideAum }, config = {}) {
  const threshold   = config.beepThreshold    ?? DEFAULT_BEEP_CONFIG.beepThreshold;
  const maxDuration = config.beepMaxDuration  ?? DEFAULT_BEEP_CONFIG.beepMaxDuration;
  const cooldown    = config.beepCooldown     ?? DEFAULT_BEEP_CONFIG.beepCooldown;

  let spikeStart = null;
  let lastFiredAt = null;

  function feed({ timestamp, metering }) {
    // Optional guard (used when this detector ran during a session)
    if (getIsInsideAum?.()) {
      spikeStart = null;
      return;
    }

    if (lastFiredAt && timestamp - lastFiredAt < cooldown) {
      return;
    }

    if (metering >= threshold) {
      if (!spikeStart) {
        spikeStart = timestamp;
      }
    } else if (spikeStart) {
      const spikeDuration = timestamp - spikeStart;
      if (spikeDuration <= maxDuration) {
        lastFiredAt = timestamp;
        spikeStart = null;
        onBeepDetected(timestamp);
      } else {
        // Spike lasted too long — probably voice or room noise, not a beep
        spikeStart = null;
      }
    }
  }

  function reset() {
    spikeStart = null;
    lastFiredAt = null;
  }

  return { feed, reset };
}
