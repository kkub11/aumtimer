import { Audio } from 'expo-av';

let recording = null;

export async function startRecording(onMeteringUpdate) {
  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) {
    throw new Error('Microphone permission not granted');
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true, // keeps mic alive when screen locks
  });

  recording = new Audio.Recording();

  await recording.prepareToRecordAsync({
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });

  recording.setOnRecordingStatusUpdate((status) => {
    if (status.isRecording && status.metering !== undefined) {
      onMeteringUpdate({
        timestamp: Date.now(),
        metering: status.metering,
      });
    }
  });

  recording.setProgressUpdateInterval(100); // poll every 100ms

  await recording.startAsync();
  return recording;
}

export async function stopRecording() {
  if (recording) {
    try {
      await recording.stopAndUnloadAsync();
    } catch (e) {
      // already stopped, ignore
    }
    recording = null;
  }
}
