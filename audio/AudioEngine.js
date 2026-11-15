import {
  setAudioModeAsync,
  requestNotificationPermissionsAsync,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { Platform } from 'react-native';

// Serialize start/stop so stacked screens (Start, Settings, Session) cannot
// overlap prepare/record/stop or stop each other's recorders mid-start.

let _queue = Promise.resolve();
let _active = null;

function enqueue(fn) {
  const run = _queue.then(fn, fn);
  _queue = run.then(() => undefined, () => undefined);
  return run;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function micPermissionError(error) {
  return error?.code === 'MIC_PERMISSION';
}

export async function getMicPermissionGranted() {
  try {
    const status = await getRecordingPermissionsAsync();
    return !!status.granted;
  } catch {
    return false;
  }
}

export async function ensureMicPermission() {
  const current = await getRecordingPermissionsAsync();
  if (current.granted) return true;
  const requested = await requestRecordingPermissionsAsync();
  return !!requested.granted;
}

export async function startRecording(recorder, { retries = 2 } = {}) {
  return enqueue(async () => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await delay(300);
      try {
        await startRecordingOnce(recorder);
        return;
      } catch (e) {
        lastError = e;
        if (e?.code === 'MIC_PERMISSION') throw e;
      }
    }
    throw lastError;
  });
}

async function startRecordingOnce(recorder) {
  // Release any other recorder first so we never hold two Android audio sessions.
  if (_active && _active !== recorder) {
    try { await _active.stop(); } catch {}
    _active = null;
    await delay(80);
  }

  if (_active === recorder) {
    try { await recorder.stop(); } catch {}
    _active = null;
    await delay(80);
  }

  const granted = await ensureMicPermission();
  if (!granted) {
    const err = new Error('Microphone permission not granted');
    err.code = 'MIC_PERMISSION';
    throw err;
  }

  if (Platform.OS === 'android') {
    try { await requestNotificationPermissionsAsync(); } catch {}
  }

  await setAudioModeAsync({
    allowsRecording: true,
    allowsBackgroundRecording: true,
    playsInSilentMode: true,
  });

  try {
    await recorder.prepareToRecordAsync();
  } catch {
    try { await recorder.stop(); } catch {}
    await recorder.prepareToRecordAsync();
  }

  recorder.record();
  _active = recorder;
}

export async function stopRecording(recorder) {
  return enqueue(async () => {
    const target = recorder || _active;
    if (!target) return;
    if (_active === target) _active = null;
    try {
      await target.stop();
    } catch {
      // already stopped
    }
  });
}
