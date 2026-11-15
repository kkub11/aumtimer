import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from 'expo-audio';
import { VolumeManager } from 'react-native-volume-manager';
import { startRecording, stopRecording } from '../audio/AudioEngine';
import { createBeepDetector } from '../audio/BeepDetector';
import { loadBeepStartEnabled } from '../utils/aumConfig';

export default function StartScreen({ navigation }) {
  const [beepStartEnabled, setBeepStartEnabled] = useState(false);
  const [listenStatus, setListenStatus] = useState('idle'); // idle | listening | error

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);

  const detectorRef = useRef(null);
  const startingRef = useRef(false);

  const beginSession = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      await stopRecording();
    } catch {
      // already stopped
    }
    navigation.navigate('Session');
  }, [navigation]);

  useEffect(() => {
    async function ensureDndAccess() {
      const granted = await VolumeManager.checkDndAccess();
      if (!granted) {
        await VolumeManager.requestDndAccess();
      }
    }
    ensureDndAccess();
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      startingRef.current = false;

      detectorRef.current = createBeepDetector({
        onBeepDetected: () => {
          if (!cancelled) beginSession();
        },
      });

      async function maybeListen() {
        const enabled = await loadBeepStartEnabled();
        if (cancelled) return;
        setBeepStartEnabled(enabled);
        if (!enabled) {
          setListenStatus('idle');
          return;
        }
        try {
          await startRecording(recorder);
          if (cancelled) {
            await stopRecording();
            return;
          }
          setListenStatus('listening');
        } catch (e) {
          console.warn('[StartScreen] beep-start mic failed:', e);
          if (!cancelled) setListenStatus('error');
        }
      }

      maybeListen();

      return () => {
        cancelled = true;
        stopRecording();
        detectorRef.current?.reset();
        detectorRef.current = null;
      };
    }, [recorder, beginSession])
  );

  useEffect(() => {
    if (listenStatus !== 'listening' || !recorderState.isRecording || startingRef.current) return;
    detectorRef.current?.feed({
      timestamp: Date.now(),
      metering: recorderState.metering ?? -160,
    });
  }, [recorderState, listenStatus]);

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
      {beepStartEnabled && listenStatus === 'listening' && (
        <Text style={styles.listenHint}>Listening for start beep…</Text>
      )}
      {beepStartEnabled && listenStatus === 'error' && (
        <Text style={styles.listenError}>Microphone permission needed to start on beep</Text>
      )}
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
