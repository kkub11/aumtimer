import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from 'expo-audio';
import { VolumeManager } from 'react-native-volume-manager';
import { startRecording, stopRecording, getMicPermissionGranted, micPermissionError } from '../audio/AudioEngine';
import { createBeepDetector } from '../audio/BeepDetector';
import { loadBeepStartEnabled, loadDiagnosticsEnabled } from '../utils/aumConfig';

export default function StartScreen({ navigation }) {
  const [beepStartEnabled, setBeepStartEnabled] = useState(false);
  const [listenStatus, setListenStatus] = useState('idle'); // idle | starting | listening | error
  const [listenError, setListenError] = useState(null);
  const [diagnostics, setDiagnostics] = useState(true);
  const [micGranted, setMicGranted] = useState(null);

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);

  const detectorRef = useRef(null);
  const startingRef = useRef(false);
  const focusedRef = useRef(false);
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  const beginSession = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setListenStatus('idle');
    // Never block navigation if stop hangs; Session start is queued after this stop.
    await Promise.race([
      stopRecording(recorderRef.current),
      new Promise((resolve) => setTimeout(resolve, 800)),
    ]);
    navigation.navigate('Session');
  }, [navigation]);

  useEffect(() => {
    async function ensureDndAccess() {
      try {
        const granted = await VolumeManager.checkDndAccess();
        if (!granted) {
          await VolumeManager.requestDndAccess();
        }
      } catch (e) {
        console.warn('[StartScreen] DND access check failed:', e);
      }
    }
    ensureDndAccess();
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      startingRef.current = false;
      focusedRef.current = true;

      detectorRef.current = createBeepDetector({
        onBeepDetected: () => {
          if (!cancelled) beginSession();
        },
      });

      async function maybeListen() {
        const [enabled, showDiag] = await Promise.all([
          loadBeepStartEnabled(),
          loadDiagnosticsEnabled(),
        ]);
        if (cancelled) return;
        setBeepStartEnabled(enabled);
        setDiagnostics(showDiag);

        const granted = await getMicPermissionGranted();
        if (!cancelled) setMicGranted(granted);

        if (!enabled) {
          setListenStatus('idle');
          setListenError(null);
          return;
        }

        setListenStatus('starting');
        setListenError(null);
        try {
          await startRecording(recorderRef.current);
          if (cancelled) {
            await stopRecording(recorderRef.current);
            return;
          }
          setListenStatus('listening');
          setMicGranted(true);
        } catch (e) {
          console.warn('[StartScreen] beep-start mic failed:', e);
          if (cancelled) return;
          const grantedNow = await getMicPermissionGranted();
          setMicGranted(grantedNow);
          setListenStatus('error');
          setListenError(
            micPermissionError(e) || !grantedNow
              ? 'Microphone permission needed to start on beep'
              : 'Could not start the microphone. Try opening Settings and returning, or press START.'
          );
        }
      }

      maybeListen();

      return () => {
        cancelled = true;
        focusedRef.current = false;
        setListenStatus('idle');
        stopRecording(recorderRef.current);
        detectorRef.current?.reset();
        detectorRef.current = null;
      };
    }, [beginSession])
  );

  // Restart listening when returning from a system dialog (DND / permission)
  // that may have blurred the app without an unmount.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focusedRef.current && beepStartEnabled && listenStatus !== 'starting') {
        // useFocusEffect will usually already have run; if the mic died, retry.
        if (listenStatus === 'listening' && !recorderState.isRecording) {
          startRecording(recorderRef.current)
            .then(() => setListenStatus('listening'))
            .catch(() => {});
        }
      }
    });
    return () => sub.remove();
  }, [beepStartEnabled, listenStatus, recorderState.isRecording]);

  useEffect(() => {
    if (listenStatus !== 'listening' || !recorderState.isRecording || startingRef.current) return;
    detectorRef.current?.feed({
      timestamp: Date.now(),
      metering: recorderState.metering ?? -160,
    });
  }, [recorderState, listenStatus]);

  const listenLabel = (() => {
    if (!beepStartEnabled) return null;
    if (listenStatus === 'starting') return 'Starting microphone…';
    if (listenStatus === 'listening' && recorderState.isRecording) return 'Listening for start beep…';
    if (listenStatus === 'listening' && !recorderState.isRecording) return 'Waiting for microphone…';
    if (listenStatus === 'error') return listenError;
    return null;
  })();

  const diagLine = diagnostics
    ? `beep ${beepStartEnabled ? 'on' : 'off'} · listen ${listenStatus}`
      + ` · mic ${micGranted == null ? '…' : micGranted ? 'granted' : 'denied'}`
      + ` · rec ${recorderState.isRecording ? 'on' : 'off'}`
    : null;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={() => navigation.navigate('Settings')}
        activeOpacity={0.6}
      >
        <Text style={styles.settingsIcon}>⚙</Text>
      </TouchableOpacity>

      <Text style={styles.title}>AUM Timer</Text>
      <Text style={styles.subtitle}>
        {beepStartEnabled
          ? 'Place your phone nearby and press start, or play a short beep'
          : 'Place your phone nearby and press start'}
      </Text>

      <TouchableOpacity
        style={styles.button}
        onPress={beginSession}
        activeOpacity={0.75}
      >
        <Text style={styles.buttonText}>START</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        Session ends when you press STOP
      </Text>
      {listenLabel && (
        <Text style={listenStatus === 'error' ? styles.listenError : styles.listenHint}>
          {listenLabel}
        </Text>
      )}
      {diagLine && <Text style={styles.diag}>{diagLine}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    fontSize: 36,
    fontWeight: '300',
    color: '#e8d5a3',
    letterSpacing: 8,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: '#666680',
    textAlign: 'center',
    marginBottom: 64,
    lineHeight: 22,
  },
  button: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#1a1a2e',
    borderWidth: 2,
    borderColor: '#c9a84c',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#c9a84c',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  buttonText: {
    fontSize: 22,
    fontWeight: '300',
    color: '#e8d5a3',
    letterSpacing: 6,
  },
  hint: {
    marginTop: 48,
    fontSize: 12,
    color: '#444460',
    textAlign: 'center',
  },
  listenHint: {
    marginTop: 12,
    fontSize: 13,
    color: '#c9a84c',
    textAlign: 'center',
  },
  listenError: {
    marginTop: 12,
    fontSize: 13,
    color: '#a07060',
    textAlign: 'center',
  },
  diag: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    fontSize: 10,
    color: '#555570',
    textAlign: 'center',
  },
  settingsButton: {
    position: 'absolute',
    top: 52,
    left: 24,
    padding: 8,
  },
  settingsIcon: {
    fontSize: 22,
    color: '#444460',
  },
});
