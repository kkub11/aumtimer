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
import { startRecording, stopRecording, getMicPermissionGranted, micPermissionError } from '../audio/AudioEngine';
import { createAumDetector } from '../audio/AumDetector';
import { formatMs } from '../utils/formatTime';
import { muteAll, restoreAll } from '../utils/volumeControl';
import { loadAumConfig, loadMuteEnabled, loadDiagnosticsEnabled } from '../utils/aumConfig';
import { createHeadTiltDetector, DEFAULT_HEAD_TILT_CONFIG } from '../utils/HeadTiltDetector';
import { saveSessionRecording } from '../utils/sessionStore';

const DEBUG_METERING = false;

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

function describeTilt(status, startTime) {
  if (!status) return { headline: 'Waiting for camera…', detail: null };
  if (status.state === 'complete' && status.completeTime != null) {
    return {
      headline: `Head tilt complete (${formatMs(status.completeTime - startTime)})`,
      detail: formatPitch(status),
    };
  }
  if (!status.hasFace) {
    return { headline: 'No face in view', detail: formatPitch(status) };
  }
  if (status.state === 'idle' || status.state === 'calibrating' || status.baseline == null) {
    return { headline: 'Calibrating baseline…', detail: formatPitch(status) };
  }
  if (!status.armed) {
    return { headline: 'Waiting for first AUM', detail: formatPitch(status) };
  }
  if (status.state === 'watching') {
    return { headline: 'Waiting for head back', detail: formatPitch(status) };
  }
  if (status.state === 'back') {
    return { headline: 'Head back — tilt forward', detail: formatPitch(status) };
  }
  if (status.state === 'forward') {
    return { headline: 'Head forward — return to vertical', detail: formatPitch(status) };
  }
  return { headline: 'Tracking head tilt…', detail: formatPitch(status) };
}

function formatPitch(status) {
  if (status?.relativePitch != null) {
    const sign = status.relativePitch >= 0 ? '+' : '';
    return `${sign}${status.relativePitch.toFixed(0)}° from baseline`;
  }
  if (status?.smoothedPitch != null) {
    return `pitch ${status.smoothedPitch.toFixed(0)}°`;
  }
  return null;
}

export default function SessionScreen({ navigation }) {
  const [elapsedDisplay, setElapsedDisplay] = useState('0:00.0');
  const [aumCount, setAumCount] = useState(0);
  const [statusText, setStatusText] = useState('Starting…');
  const [tiltStatus, setTiltStatus] = useState(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [videoState, setVideoState] = useState('idle'); // idle | starting | recording | error
  const [diagnostics, setDiagnostics] = useState(true);
  const [micGranted, setMicGranted] = useState(null);

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
  const lastTiltUiRef = useRef(0);
  const lastTiltStateRef = useRef('');
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  // Start the elapsed timer immediately so a slow mic/camera init cannot
  // leave the clock stuck at 0:00.
  useEffect(() => {
    startTimeRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      if (sessionDoneRef.current) return;
      setElapsedDisplay(formatMs(Date.now() - startTimeRef.current));
    }, 100);
    return () => clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission().catch((e) => {
        console.warn('[SessionScreen] camera permission request failed:', e);
      });
    }
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const [aumConfig, muteEnabled, showDiag] = await Promise.all([
        loadAumConfig(),
        loadMuteEnabled(),
        loadDiagnosticsEnabled(),
      ]);
      if (cancelled) return;
      setDiagnostics(showDiag);

      headTiltDetectorRef.current = createHeadTiltDetector({
        onTiltBack: () => publishTiltStatus(true),
        onTiltForward: () => publishTiltStatus(true),
        onReturnToVertical: () => publishTiltStatus(true),
      }, {
        ...DEFAULT_HEAD_TILT_CONFIG,
        sensitivity: aumConfig.headTiltSensitivity ?? DEFAULT_HEAD_TILT_CONFIG.sensitivity,
      });

      aumDetectorRef.current = createAumDetector({
        onAumOnset: (timestamp) => {
          if (chantStartTimeRef.current === null) {
            chantStartTimeRef.current = timestamp;
            setStatusText('Chanting detected');
            headTiltDetectorRef.current?.notifyFirstAum();
            publishTiltStatus(true);
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
        await startRecording(recorderRef.current);
        if (cancelled) {
          await stopRecording(recorderRef.current);
          return;
        }
        setMicGranted(true);
        setStatusText((current) => (current === 'Starting…' ? 'Listening…' : current));
      } catch (e) {
        console.error('[SessionScreen] mic start failed:', e);
        if (cancelled) return;
        const granted = await getMicPermissionGranted();
        setMicGranted(granted);
        setStatusText(
          micPermissionError(e) || !granted
            ? 'Microphone permission needed'
            : 'Microphone failed to start — try STOP and start again'
        );
      }
    }

    init();

    return () => {
      cancelled = true;
      stopRecording(recorderRef.current);
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

  function publishTiltStatus(force) {
    const status = headTiltDetectorRef.current?.getStatus();
    if (!status) return;
    const now = Date.now();
    const key = `${status.state}:${status.armed}:${status.hasFace}:${status.completeTime ?? ''}`;
    if (!force && key === lastTiltStateRef.current && now - lastTiltUiRef.current < 200) return;
    lastTiltStateRef.current = key;
    lastTiltUiRef.current = now;
    setTiltStatus(status);
  }

  // Start video only after the preview session has actually started (or after
  // a fallback timeout) so we don't record before the Camera is mounted.
  useEffect(() => {
    if (sessionDoneRef.current || videoStartedRef.current) return;
    if (!hasPermission || !device) return;
    if (!cameraStarted) return;

    let cancelled = false;
    videoEnabledRef.current = true;
    setVideoState('starting');

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
        if (!cancelled) setVideoState('recording');
      } catch (e) {
        console.warn('[SessionScreen] video record failed to start:', e);
        videoEnabledRef.current = false;
        if (!cancelled) {
          setVideoState('error');
          setCameraError(e?.message ?? String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasPermission, device, cameraStarted]);

  // If onStarted never fires, still try to begin recording after a short wait.
  useEffect(() => {
    if (cameraStarted || !hasPermission || !device) return;
    const timer = setTimeout(() => setCameraStarted(true), 1500);
    return () => clearTimeout(timer);
  }, [cameraStarted, hasPermission, device]);

  const handleFacesDetected = useCallback((faces) => {
    if (sessionDoneRef.current) return;
    const face = largestFace(faces);
    headTiltDetectorRef.current?.feed({
      timestamp: Date.now(),
      pitch: face ? face.pitchAngle : null,
      hasFace: !!face,
    });
    publishTiltStatus(false);
  }, []);

  async function handleSessionEnd(endTimestamp) {
    if (sessionDoneRef.current) return;
    sessionDoneRef.current = true;
    setSessionEnded(true);
    clearInterval(intervalRef.current);
    stopRecording(recorderRef.current);
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
  const tiltCopy = describeTilt(tiltStatus, startTimeRef.current);

  const diagLine = diagnostics
    ? `mic ${micGranted == null ? '…' : micGranted ? 'ok' : 'no'}`
      + ` rec ${recorderState.isRecording ? 'on' : 'off'}`
      + ` · cam ${hasPermission ? 'ok' : 'no'}`
      + ` dev ${device ? 'yes' : 'no'}`
      + ` preview ${cameraStarted ? 'on' : 'off'}`
      + ` vid ${videoState}`
      + (cameraError ? ` · ${cameraError}` : '')
    : null;

  return (
    <View style={styles.root}>
      {showCamera ? (
        <FaceCamera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={!sessionEnded}
          performanceMode="fast"
          cameraFacing="front"
          onStarted={() => {
            setCameraStarted(true);
            setCameraError(null);
          }}
          onError={(error) => {
            const message = error?.message ?? String(error);
            console.warn('[SessionScreen] camera error:', message);
            setCameraError(message);
          }}
          onFacesDetected={handleFacesDetected}
          outputs={[videoOutput]}
        />
      ) : (
        <View style={styles.cameraPlaceholder}>
          <Text style={styles.cameraPlaceholderText}>
            {!hasPermission ? 'Waiting for camera permission…' : 'Looking for the front camera…'}
          </Text>
        </View>
      )}

      <View style={styles.overlay}>
        <Text style={styles.label}>ELAPSED</Text>
        <Text style={styles.timer}>{elapsedDisplay}</Text>

        <View style={styles.divider} />

        <Text style={styles.statusLabel}>STATUS</Text>
        <Text style={styles.status}>{statusText}</Text>
        <Text style={styles.tiltStatus}>{tiltCopy.headline}</Text>
        {tiltCopy.detail ? <Text style={styles.tiltDetail}>{tiltCopy.detail}</Text> : null}

        <View style={styles.divider} />

        <Text style={styles.statusLabel}>AUMS</Text>
        <Text style={styles.aumCount}>{aumCount}</Text>

        <TouchableOpacity style={styles.stopButton} onPress={() => handleSessionEnd(Date.now())}>
          <Text style={styles.stopButtonText}>STOP</Text>
        </TouchableOpacity>

        {diagLine ? <Text style={styles.diag}>{diagLine}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  cameraPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  cameraPlaceholderText: {
    fontSize: 14,
    color: '#666680',
    textAlign: 'center',
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
    marginVertical: 22,
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
  tiltStatus: {
    marginTop: 10,
    fontSize: 15,
    color: '#e8d5a3',
    fontWeight: '300',
    textAlign: 'center',
  },
  tiltDetail: {
    marginTop: 4,
    fontSize: 12,
    color: '#8888aa',
    textAlign: 'center',
  },
  aumCount: {
    fontSize: 72,
    fontWeight: '100',
    color: '#c9a84c',
    fontVariant: ['tabular-nums'],
  },
  stopButton: {
    position: 'absolute',
    bottom: 48,
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
  diag: {
    position: 'absolute',
    bottom: 16,
    left: 12,
    right: 12,
    fontSize: 10,
    color: '#9a9aaa',
    textAlign: 'center',
  },
});
