import { AudioModule } from 'expo-audio';

// expo-audio uses a hook-based API. The recorder is created in the component
// via useAudioRecorder; metering is read via useAudioRecorderState. This module
// only handles permissions and start/stop.

let _recorder = null;

export async function startRecording(recorder) {
  _recorder = recorder;

  const { granted } = await AudioModule.requestRecordingPermissionsAsync();
  if (!granted) {
    throw new Error('Microphone permission not granted');
  }

  await recorder.prepareToRecordAsync();
  await recorder.record();
}

export async function stopRecording() {
  if (_recorder) {
    try {
      await _recorder.stop();
    } catch (e) {
      // already stopped
    }
    _recorder = null;
  }
}
