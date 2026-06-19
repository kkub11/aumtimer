import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from 'expo-audio';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { startRecording, stopRecording } from '../audio/AudioEngine';
import { createAumDetector } from '../audio/AumDetector';
import { formatMs } from '../utils/formatTime';
import { muteAll, restoreAll } from '../utils/volumeControl';
import { loadAumConfig, loadMuteEnabled } from '../utils/aumConfig';
import { saveSessionRecording } from '../utils/sessionStore';

const DEBUG_METERING = true;

export default function SessionScreen({ navigation }) {
  const [elapsedDisplay, setElapsedDisplay] = useState('0:00.0');
  const [aumCount, setAumCount] = useState(0);
  const [statusText, setStatusText] = useState('Listening...');

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);

  const startTimeRef = useRef(Date.now());
  const chantStartTimeRef = useRef(null);
  const aumCountRef = useRef(0);
  const intervalRef = useRef(null);
  const sessionDoneRef = useRef(false);
  const aumDetectorRef = useRef(null);
  const cameraRef = useRef(null);
  const recordingPromiseRef = useRef(null);
  const videoEnabledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Request camera permission (non-blocking — video is best-effort)
      let camGranted = cameraPermission?.granted;
      if (!camGranted) {
        const result = await requestCameraPermission();
        camGranted = result.granted;
      }
      videoEnabledRef.current = camGranted;

      const [aumConfig, muteEnabled] = await Promise.all([
        loadAumConfig(),
        loadMuteEnabled(),
      ]);
      if (cancelled) return;

      aumDetectorRef.current = createAumDetector({
        onAumOnset: (timestamp) => {
          if (chantStartTimeRef.current === null) {
            chantStartTimeRef.current = timestamp;
            setStatusText('Chanting detected');
          }
        },
        onAumComplete: () => {
          aumCountRef.current += 1;
          setAumCount(aumCountRef.current);
        },
      }, aumConfig);

      if (muteEnabled) await muteAll();
      if (cancelled) { restoreAll(); return; }

      // Ensure recordings directory exists
      if (camGranted) {
        const recordingsDir = new Directory(Paths.document, 'recordings');
        if (!recordingsDir.exists) recordingsDir.create();
      }

      try {
        await startRecording(recorder);
      } catch (e) {
        setStatusText('Microphone error — check permissions');
        console.error(e);
      }

      // Start video recording (fire-and-forget — resolves when stopRecording called)
      if (camGranted && cameraRef.current) {
        recordingPromiseRef.current = cameraRef.current.recordAsync({ maxDuration: 3600 });
      }

      intervalRef.current = setInterval(() => {
        setElapsedDisplay(formatMs(Date.now() - startTimeRef.current));
      }, 100);
    }

    init();

    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
      stopRecording();
      restoreAll();
    };
  }, []);

  useEffect(() => {
    if (!recorderState.isRecording || sessionDoneRef.current) return;
    const metering = recorderState.metering ?? -160;
    const timestamp = Date.now();

    if (DEBUG_METERING) {
      console.log(`[metering] ${metering.toFixed(1)} dBFS`);
    }

    aumDetectorRef.current?.feed({ timestamp, metering });
  }, [recorderState]);

  async function handleSessionEnd(endTimestamp) {
    if (sessionDoneRef.current) return;
    sessionDoneRef.current = true;
    clearInterval(intervalRef.current);
    stopRecording();
    restoreAll();

    const startTime = startTimeRef.current;
    const aumCount = aumCountRef.current;
    const duration = endTimestamp - startTime;

    // Stop video and save
    if (videoEnabledRef.current && cameraRef.current && recordingPromiseRef.current) {
      try {
        cameraRef.current.stopRecording();
        const { uri } = await recordingPromiseRef.current;
        const srcFile = new File(uri);
        const destFile = new File(Paths.document, 'recordings', startTime + '.mp4');
        await srcFile.copy(destFile);
        const permanentUri = destFile.uri;
        await saveSessionRecording({
          videoUri: permanentUri,
          startTime,
          aumCount,
          duration,
          chantStartTime: chantStartTimeRef.current,
        });
      } catch (e) {
        console.warn('[SessionScreen] video save failed:', e);
      }
    }

    navigation.replace('Results', {
      startTime,
      chantStartTime: chantStartTimeRef.current,
      aumCount,
      endTime: endTimestamp,
    });
  }

  return (
    <View style={styles.root}>
      {/* Camera feed behind UI */}
      {cameraPermission?.granted && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="front"
          mode="video"
        />
      )}

      {/* Session UI overlaid on camera */}
      <View style={styles.overlay}>
        <Text style={styles.label}>ELAPSED</Text>
        <Text style={styles.timer}>{elapsedDisplay}</Text>

        <View style={styles.divider} />

        <Text style={styles.statusLabel}>STATUS</Text>
        <Text style={styles.status}>{statusText}</Text>

        <View style={styles.divider} />

        <Text style={styles.statusLabel}>AUMS</Text>
        <Text style={styles.aumCount}>{aumCount}</Text>

        <TouchableOpacity style={styles.stopButton} onPress={() => handleSessionEnd(Date.now())}>
          <Text style={styles.stopButtonText}>STOP</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: 'rgba(15,15,26,0.55)',
  },
  label: {
    fontSize: 11,
    color: '#ccccdd',
    letterSpacing: 4,
    marginBottom: 8,
  },
  timer: {
    fontSize: 64,
    fontWeight: '100',
    color: '#e8d5a3',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
  divider: {
    width: 40,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginVertical: 28,
  },
  statusLabel: {
    fontSize: 11,
    color: '#ccccdd',
    letterSpacing: 4,
    marginBottom: 8,
  },
  status: {
    fontSize: 18,
    color: '#aaaacc',
    fontWeight: '300',
  },
  aumCount: {
    fontSize: 72,
    fontWeight: '100',
    color: '#c9a84c',
    fontVariant: ['tabular-nums'],
  },
  stopButton: {
    position: 'absolute',
    bottom: 40,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(15,15,26,0.5)',
  },
  stopButtonText: {
    fontSize: 13,
    color: '#aaaacc',
    letterSpacing: 4,
  },
});
