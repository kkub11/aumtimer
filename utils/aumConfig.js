import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULT_AUM_CONFIG = {
  aumThreshold: -35,
  aumMinDuration: 1500,
  aumEndThreshold: -45,
  aumEndSilence: 300,
  headTiltSensitivity: 1,
};

// Head-tilt detector defaults (degrees / ms). Sensitivity is the one
// Settings slider; the rest stay as code constants. See HeadTiltDetector.js.
export { DEFAULT_HEAD_TILT_CONFIG } from './HeadTiltDetector';


const CONFIG_KEY = 'aum_config';
const MUTE_KEY = 'mute_enabled';
const BEEP_START_KEY = 'beep_start_enabled';
const DIAGNOSTICS_KEY = 'diagnostics_enabled';

export async function loadAumConfig() {
  try {
    const json = await AsyncStorage.getItem(CONFIG_KEY);
    if (!json) return { ...DEFAULT_AUM_CONFIG };
    return { ...DEFAULT_AUM_CONFIG, ...JSON.parse(json) };
  } catch {
    return { ...DEFAULT_AUM_CONFIG };
  }
}

export async function saveAumConfig(partial) {
  try {
    const existing = await loadAumConfig();
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({ ...existing, ...partial }));
  } catch (e) {
    console.warn('[aumConfig] saveAumConfig failed:', e);
  }
}

export async function loadMuteEnabled() {
  try {
    const val = await AsyncStorage.getItem(MUTE_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export async function saveMuteEnabled(enabled) {
  try {
    await AsyncStorage.setItem(MUTE_KEY, String(enabled));
  } catch (e) {
    console.warn('[aumConfig] saveMuteEnabled failed:', e);
  }
}

export async function loadBeepStartEnabled() {
  try {
    const val = await AsyncStorage.getItem(BEEP_START_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function saveBeepStartEnabled(enabled) {
  try {
    await AsyncStorage.setItem(BEEP_START_KEY, String(enabled));
  } catch (e) {
    console.warn('[aumConfig] saveBeepStartEnabled failed:', e);
  }
}

export async function loadDiagnosticsEnabled() {
  try {
    const val = await AsyncStorage.getItem(DIAGNOSTICS_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export async function saveDiagnosticsEnabled(enabled) {
  try {
    await AsyncStorage.setItem(DIAGNOSTICS_KEY, String(enabled));
  } catch (e) {
    console.warn('[aumConfig] saveDiagnosticsEnabled failed:', e);
  }
}
