import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from 'expo-audio';
import { startRecording, stopRecording } from '../audio/AudioEngine';
import { createAumDetector } from '../audio/AumDetector';
import { formatMs } from '../utils/formatTime';

// Set to true during development to log raw metering values to console
// Chant AUM and watch the numbers — use them to tune thresholds in
// AumDetector.js and BeepDetector.js
const DEBUG_METERING = true;

export default function SessionScreen({ navigation }) {
  const [elapsedDisplay, setElapsedDisplay] = useState('0:00.0');
  const [aumCount, setAumCount] = useState(0);
  const [statusText, setStatusText] = useState('Listening...');

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);

  const startTimeRef = useRef(Date.now());
  const chantStartTimeRef = useRef(null);
  const aumCountRef = useRef(0);
  const intervalRef = useRef(null);
  const sessionDoneRef = useRef(false);
  const aumDetectorRef = useRef(null);

  useEffect(() => {
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
    });

    async function init() {
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
      clearInterval(intervalRef.current);
      stopRecording();
    };
  }, []);

  // Feed metering to detectors whenever recorderState updates
  useEffect(() => {
    if (!recorderState.isRecording || sessionDoneRef.current) return;
    const metering = recorderState.metering ?? -160;
    const timestamp = Date.now();

    if (DEBUG_METERING) {
      console.log(`[metering] ${metering.toFixed(1)} dBFS`);
    }

    aumDetectorRef.current?.feed({ timestamp, metering });
  }, [recorderState]);

  function handleSessionEnd(endTimestamp) {
    if (sessionDoneRef.current) return;
    sessionDoneRef.current = true;
    clearInterval(intervalRef.current);
    stopRecording();

    navigation.replace('Results', {
      startTime: startTimeRef.current,
      chantStartTime: chantStartTimeRef.current,
      aumCount: aumCountRef.current,
      endTime: endTimestamp,
    });
  }

  return (
    <View style={styles.container}>
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
  label: {
    fontSize: 11,
    color: '#444460',
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
    backgroundColor: '#2a2a3e',
    marginVertical: 28,
  },
  statusLabel: {
    fontSize: 11,
    color: '#444460',
    letterSpacing: 4,
    marginBottom: 8,
  },
  status: {
    fontSize: 18,
    color: '#8888aa',
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
    borderColor: '#444460',
  },
  stopButtonText: {
    fontSize: 13,
    color: '#8888aa',
    letterSpacing: 4,
  },
});
