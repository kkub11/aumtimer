import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAudioRecorder } from 'expo-audio';
import { startRecording, stopRecording } from '../audio/AudioEngine';
import { createAumDetector } from '../audio/AumDetector';
import { createBeepDetector } from '../audio/BeepDetector';
import { formatMs } from '../utils/formatTime';

// Set to true during development to log raw metering values to console
// Chant AUM and watch the numbers — use them to tune thresholds in
// AumDetector.js and BeepDetector.js
const DEBUG_METERING = false;

export default function SessionScreen({ navigation }) {
  const [elapsedDisplay, setElapsedDisplay] = useState('0:00.0');
  const [aumCount, setAumCount] = useState(0);
  const [statusText, setStatusText] = useState('Listening...');

  const recorder = useAudioRecorder();

  const startTimeRef = useRef(Date.now());
  const chantStartTimeRef = useRef(null);
  const aumCountRef = useRef(0);
  const intervalRef = useRef(null);
  const sessionDoneRef = useRef(false);

  useEffect(() => {
    let aumDetector;
    let beepDetector;

    async function init() {
      aumDetector = createAumDetector({
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

      beepDetector = createBeepDetector({
        onBeepDetected: (timestamp) => {
          if (sessionDoneRef.current) return;
          sessionDoneRef.current = true;
          handleSessionEnd(timestamp);
        },
        getIsInsideAum: () => aumDetector.isInsideAum(),
      });

      try {
        await startRecording(recorder, ({ timestamp, metering }) => {
          if (DEBUG_METERING) {
            console.log(`[metering] ${metering.toFixed(1)} dBFS`);
          }
          aumDetector.feed({ timestamp, metering });
          beepDetector.feed({ timestamp, metering });
        });
      } catch (e) {
        setStatusText('Microphone error — check permissions');
        console.error(e);
      }

      // Display timer
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

  function handleSessionEnd(endTimestamp) {
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

      <Text style={styles.hint}>Session ends on beep</Text>
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
  hint: {
    position: 'absolute',
    bottom: 40,
    fontSize: 12,
    color: '#333350',
  },
});
