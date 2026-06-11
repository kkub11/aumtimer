import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';

// expo-audio uses a hook-based API, so we manage the recorder reference externally.
// This module exports setup/teardown helpers that work with a recorder ref
// created in the component via useAudioRecorder.

let _intervalId = null;
let _recorder = null;

export async function startRecording(recorder, onMeteringUpdate) {
  _recorder = recorder;

  const { granted } = await AudioModule.requestRecordingPermissionsAsync();
  if (!granted) {
    throw new Error('Microphone permission not granted');
  }

  await recorder.prepareToRecordAsync({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });

  await recorder.record();

  // Poll metering manually since expo-audio doesn't have setOnRecordingStatusUpdate
  _intervalId = setInterval(() => {
    if (recorder.isRecording) {
      const metering = recorder.currentMetering ?? -160;
      onMeteringUpdate({
        timestamp: Date.now(),
        metering,
      });
    }
  }, 100);
}

export async function stopRecording() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  if (_recorder) {
    try {
      await _recorder.stop();
    } catch (e) {
      // already stopped, ignore
    }
    _recorder = null;
  }
}
