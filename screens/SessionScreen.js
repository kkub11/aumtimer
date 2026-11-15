import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import {
  useCameraDevice,
  useCameraPermission,
  useVideoOutput,
} from 'react-native-vision-camera';
import { Camera as FaceCamera } from 'react-native-vision-camera-face-detector';
import { startRecording, stopRecording } from '../audio/AudioEngine';
import { createAumDetector } from '../audio/AumDetector';
import { formatMs } from '../utils/formatTime';
import { muteAll, restoreAll } from '../utils/volumeControl';
import { loadAumConfig, loadMuteEnabled } from '../utils/aumConfig';
import { createHeadTiltDetector, DEFAULT_HEAD_TILT_CONFIG } from '../utils/HeadTiltDetector';
import { saveSessionRecording } from '../utils/sessionStore';

const DEBUG_METERING = true;

function largestFace(faces) {
  if (!faces || faces.length === 0) return null;
  let best = faces[0];
  let bestArea = 0;
  for (const face of faces) {
    const b = face.bounds;
    const area = (b?.width ?? 0) * (b?.height ?? 0);
    if (area >= bestArea) {
      best = face;
      bestArea = area;
    }
  }
  return best;
}

function toFileUri(path) {
  if (!path) return null;
  return path.startsWith('file:') ? path : `file://${path}`;
}

export default function SessionScreen({ navigation }) {
  const [elapsedDisplay, setElapsedDisplay] = useState('0:00.0');
  const [aumCount, setAumCount] = useState(0);
  const [statusText, setStatusText] = useState('Listening...');

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  // Record video silently so the expo-audio mic stays free for AUM metering
  const videoOutput = useVideoOutput({ enableAudio: false });

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);

  const startTimeRef = useRef(Date.now());
  const chantStartTimeRef = useRef(null);
  const lastAumEndTimeRef = useRef(null);
  const aumCountRef = useRef(0);
  const intervalRef = useRef(null);
  const sessionDoneRef = useRef(false);
  const aumDetectorRef = useRef(null);
  const headTiltDetectorRef = useRef(null);
  const videoRecorderRef = useRef(null);
  const recordingPromiseRef = useRef(null);
  const videoEnabledRef = useRef(false);
  const videoStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!hasPermission) {
        await requestPermission();
      }

      const [aumConfig, muteEnabled] = await Promise.all([
        loadAumConfig(),
        loadMuteEnabled(),
      ]);
      if (cancelled) return;

      headTiltDetectorRef.current = createHeadTiltDetector({}, {
        ...DEFAULT_HEAD_TILT_CONFIG,
        sensitivity: aumConfig.headTiltSensitivity ?? DEFAULT_HEAD_TILT_CONFIG.sensitivity,
      });

      aumDetectorRef.current = createAumDetector({
        onAumOnset: (timestamp) => {
          if (chantStartTimeRef.current === null) {
            chantStartTimeRef.current = timestamp;
            setStatusText('Chanting detected');
            headTiltDetectorRef.current?.notifyFirstAum();
          }
        },
        onAumComplete: (endedAt) => {
          aumCountRef.current += 1;
          setAumCount(aumCountRef.current);
          lastAumEndTimeRef.current = endedAt;
        },
      }, aumConfig);

      if (muteEnabled) await muteAll();
      if (cancelled) { restoreAll(); return; }

      try {
        await startRecording(recorder);
      } catch (e) {
        setStatusText('Microphone error — check permissions');
        console.error(e);
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
      const rec = videoRecorderRef.current;
      videoRecorderRef.current = null;
      if (rec) {
        rec.stopRecording().catch(() => {
          rec.cancelRecording?.().catch(() => {});
        });
      }
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

  // Start video once the front camera and permission are actually available
  // (useCameraDevice is often undefined until permission is granted).
  useEffect(() => {
    if (sessionDoneRef.current || videoStartedRef.current) return;
    if (!hasPermission || !device) return;

    let cancelled = false;
    videoEnabledRef.current = true;

    (async () => {
      try {
        const recordingsDir = new Directory(Paths.document, 'recordings');
        if (!recordingsDir.exists) recordingsDir.create();
        const videoRecorder = await videoOutput.createRecorder({});
        if (cancelled) {
          try { await videoRecorder.cancelRecording(); } catch {}
          return;
        }
        videoRecorderRef.current = videoRecorder;
        recordingPromiseRef.current = new Promise((resolve, reject) => {
          videoRecorder.startRecording(
            (filePath) => resolve(filePath),
            (error) => reject(error),
          ).catch(reject);
        });
        videoStartedRef.current = true;
      } catch (e) {
        console.warn('[SessionScreen] video record failed to start:', e);
        videoEnabledRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasPermission, device]);

  const handleFacesDetected = useCallback((faces) => {
    if (sessionDoneRef.current) return;
    const face = largestFace(faces);
    headTiltDetectorRef.current?.feed({
      timestamp: Date.now(),
      pitch: face ? face.pitchAngle : null,
      hasFace: !!face,
    });
  }, []);

  async function handleSessionEnd(endTimestamp) {
    if (sessionDoneRef.current) return;
    sessionDoneRef.current = true;
    clearInterval(intervalRef.current);
    stopRecording();
    restoreAll();

    const startTime = startTimeRef.current;
    const aumCount = aumCountRef.current;
    const duration = endTimestamp - startTime;
    const tiltTimes = headTiltDetectorRef.current?.getTimes() ?? {};

    if (videoEnabledRef.current && videoRecorderRef.current && recordingPromiseRef.current) {
      try {
        await videoRecorderRef.current.stopRecording();
        const filePath = await recordingPromiseRef.current;
        const uri = toFileUri(filePath);
        if (uri) {
          const srcFile = new File(uri);
          const destFile = new File(Paths.document, 'recordings', startTime + '.mp4');
          await srcFile.copy(destFile);
          await saveSessionRecording({
            videoUri: destFile.uri,
            startTime,
            aumCount,
            duration,
            chantStartTime: chantStartTimeRef.current,
            lastAumEndTime: lastAumEndTimeRef.current,
            headTiltCompleteTime: tiltTimes.completeTime ?? null,
            headTiltBackTime: tiltTimes.tiltBackTime ?? null,
            headTiltForwardTime: tiltTimes.tiltForwardTime ?? null,
          });
        }
      } catch (e) {
        console.warn('[SessionScreen] video save failed:', e);
      }
    }

    navigation.replace('Results', {
      startTime,
      chantStartTime: chantStartTimeRef.current,
      lastAumEndTime: lastAumEndTimeRef.current,
      headTiltCompleteTime: tiltTimes.completeTime ?? null,
      aumCount,
      endTime: endTimestamp,
    });
  }

  const showCamera = hasPermission && !!device;

  return (
    <View style={styles.root}>
      {showCamera && (
        <FaceCamera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={!sessionDoneRef.current}
          performanceMode="fast"
          cameraFacing="front"
          onFacesDetected={handleFacesDetected}
          outputs={[videoOutput]}
        />
      )}

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
