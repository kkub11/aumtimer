import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, Switch, ScrollView,
  TouchableOpacity, StyleSheet, PanResponder, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from 'expo-audio';
import { VolumeManager } from 'react-native-volume-manager';
import { startRecording, stopRecording } from '../audio/AudioEngine';
import { loadAumConfig, saveAumConfig, loadMuteEnabled, saveMuteEnabled, DEFAULT_AUM_CONFIG } from '../utils/aumConfig';

const GRAPH_HEIGHT = 160;
const BAR_WIDTH = 3;
const BAR_GAP = 1;
const BAR_PITCH = BAR_WIDTH + BAR_GAP;
const MAX_SAMPLES = 100;
const MIN_DB = -60;
const MAX_DB = 0;

const COLOR_ONSET = '#c9a84c';  // amber  — onset threshold
const COLOR_END   = '#4ca8c9';  // blue   — end threshold
const COLOR_DUR   = '#9b7acc';  // purple — duration bands

const STREAM_LABELS = {
  music: 'Music', ring: 'Ring', alarm: 'Alarm',
  notification: 'Notification', call: 'Call', system: 'System',
};

function dbToTop(db) {
  const ratio = (Math.max(MIN_DB, Math.min(MAX_DB, db)) - MIN_DB) / (MAX_DB - MIN_DB);
  return GRAPH_HEIGHT - ratio * GRAPH_HEIGHT;
}

function durationToPx(ms) {
  return (ms / 100) * BAR_PITCH;
}

export default function SettingsScreen({ navigation }) {
  const [config, setConfig] = useState(DEFAULT_AUM_CONFIG);
  const [muteEnabled, setMuteEnabled] = useState(true);
  const [volumes, setVolumes] = useState(null);
  const [sampleTick, setSampleTick] = useState(0);
  const [bandX, setBandX] = useState(null);

  const [thresholdText, setThresholdText]       = useState(String(DEFAULT_AUM_CONFIG.aumThreshold));
  const [minDurText, setMinDurText]             = useState(String(DEFAULT_AUM_CONFIG.aumMinDuration));
  const [endThresholdText, setEndThresholdText] = useState(String(DEFAULT_AUM_CONFIG.aumEndThreshold));
  const [endSilenceText, setEndSilenceText]     = useState(String(DEFAULT_AUM_CONFIG.aumEndSilence));

  const samplesRef    = useRef([]);
  const configRef     = useRef(config);
  const bandXRef      = useRef(0);
  const bandXBaseRef  = useRef(0);
  const graphWidthRef = useRef(0);

  useEffect(() => { configRef.current = config; }, [config]);

  // ── Load persisted settings ──────────────────────────────────────────────
  useEffect(() => {
    loadAumConfig().then((c) => {
      setConfig(c);
      setThresholdText(String(c.aumThreshold));
      setMinDurText(String(c.aumMinDuration));
      setEndThresholdText(String(c.aumEndThreshold));
      setEndSilenceText(String(c.aumEndSilence));
    });
    loadMuteEnabled().then(setMuteEnabled);
    if (Platform.OS === 'android') {
      VolumeManager.getVolume().then(setVolumes);
    }
  }, []);

  // ── Clamp band position when duration values change via textbox ──────────
  useEffect(() => {
    if (!graphWidthRef.current) return;
    const totalW = durationToPx(config.aumMinDuration) + durationToPx(config.aumEndSilence);
    const maxX = Math.max(0, graphWidthRef.current - totalW);
    if (bandXRef.current > maxX) {
      setBandX(maxX);
      bandXRef.current = maxX;
    }
  }, [config.aumMinDuration, config.aumEndSilence]);

  // ── Mic for calibration graph ────────────────────────────────────────────
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recState = useAudioRecorderState(recorder, 100);

  useEffect(() => {
    startRecording(recorder).catch(console.error);
    return () => { stopRecording(); };
  }, []);

  useEffect(() => {
    if (!recState.isRecording) return;
    const db = recState.metering ?? MIN_DB;
    const buf = samplesRef.current;
    buf.push(db);
    if (buf.length > MAX_SAMPLES) buf.shift();
    setSampleTick((t) => t + 1);
  }, [recState]);

  // ── PanResponder: drag combined duration band ────────────────────────────
  const bandPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dx, dy }) => Math.abs(dx) > Math.abs(dy),
      onPanResponderGrant: () => {
        bandXBaseRef.current = bandXRef.current;
      },
      onPanResponderMove: (_, { dx }) => {
        const { aumMinDuration, aumEndSilence } = configRef.current;
        const totalW = durationToPx(aumMinDuration) + durationToPx(aumEndSilence);
        const newX = Math.max(0, Math.min(graphWidthRef.current - totalW, bandXBaseRef.current + dx));
        setBandX(newX);
        bandXRef.current = newX;
      },
    })
  ).current;

  function handleGraphLayout({ nativeEvent: { layout: { width } } }) {
    if (graphWidthRef.current) return;
    graphWidthRef.current = width;
    const totalW = durationToPx(configRef.current.aumMinDuration) + durationToPx(configRef.current.aumEndSilence);
    const initialX = Math.max(0, (width - totalW) / 2);
    setBandX(initialX);
    bandXRef.current = initialX;
  }

  // ── Commit helpers ───────────────────────────────────────────────────────
  function commitThreshold() {
    const v = Math.round(Math.max(-80, Math.min(-1, parseFloat(thresholdText) || config.aumThreshold)));
    setConfig((c) => ({ ...c, aumThreshold: v }));
    setThresholdText(String(v));
    saveAumConfig({ aumThreshold: v });
  }

  function commitEndThreshold() {
    const v = Math.round(Math.max(-80, Math.min(-1, parseFloat(endThresholdText) || config.aumEndThreshold)));
    setConfig((c) => ({ ...c, aumEndThreshold: v }));
    setEndThresholdText(String(v));
    saveAumConfig({ aumEndThreshold: v });
  }

  function commitMinDur() {
    const v = Math.max(100, Math.min(10000, parseInt(minDurText, 10) || config.aumMinDuration));
    setConfig((c) => ({ ...c, aumMinDuration: v }));
    setMinDurText(String(v));
    saveAumConfig({ aumMinDuration: v });
  }

  function commitEndSilence() {
    const v = Math.max(100, Math.min(5000, parseInt(endSilenceText, 10) || config.aumEndSilence));
    setConfig((c) => ({ ...c, aumEndSilence: v }));
    setEndSilenceText(String(v));
    saveAumConfig({ aumEndSilence: v });
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const samples = samplesRef.current;

  return (
    <SafeAreaView style={styles.safeArea}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.6}>
        <Text style={styles.backText}>← SETTINGS</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

        {/* Mute toggle */}
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Mute device during session</Text>
            <Switch
              value={muteEnabled}
              onValueChange={(v) => { setMuteEnabled(v); saveMuteEnabled(v); }}
              trackColor={{ false: '#2a2a3e', true: 'rgba(201,168,76,0.35)' }}
              thumbColor={muteEnabled ? '#c9a84c' : '#444460'}
            />
          </View>
        </View>

        {/* Volume levels */}
        {Platform.OS === 'android' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>CURRENT VOLUMES</Text>
            {volumes
              ? Object.entries(STREAM_LABELS).map(([key, label]) => (
                  <View key={key} style={styles.volumeRow}>
                    <Text style={styles.volLabel}>{label}</Text>
                    <Text style={styles.volValue}>{Math.round((volumes[key] ?? 0) * 100)}%</Text>
                  </View>
                ))
              : <Text style={styles.dimText}>Loading...</Text>
            }
          </View>
        )}

        {/* Calibration graph */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CHANT DETECTION CALIBRATION</Text>
          <Text style={styles.graphHint}>Chant AUM and watch the waveform</Text>

          <View style={styles.graphContainer} onLayout={handleGraphLayout}>

            {/* Waveform line */}
            <View style={styles.barsRow}>
              {samples.map((db, i) => {
                const nextDb = samples[i + 1];
                const y = dbToTop(db);
                const nextY = nextDb !== undefined ? dbToTop(nextDb) : y;
                const dy = nextY - y;
                const segLen = Math.sqrt(BAR_PITCH * BAR_PITCH + dy * dy);
                const angle = Math.atan2(dy, BAR_PITCH) * (180 / Math.PI);
                return (
                  <View
                    key={i}
                    style={{
                      position: 'absolute',
                      left: i * BAR_PITCH,
                      top: y,
                      width: segLen,
                      height: 2,
                      backgroundColor: db >= config.aumThreshold ? COLOR_ONSET : '#2a2a3e',
                      transformOrigin: '0 50%',
                      transform: [{ rotate: `${angle}deg` }],
                    }}
                  />
                );
              })}
            </View>

            {/* Combined duration band — drag horizontally to reposition */}
            {bandX !== null && (
              <View
                style={[styles.durationBandGroup, { left: bandX }]}
                {...bandPan.panHandlers}
              >
                <View style={[styles.durationSection, styles.minDurSection, { width: durationToPx(config.aumMinDuration) }]} />
                <View style={[styles.durationSection, styles.endSilenceSection, { width: durationToPx(config.aumEndSilence) }]} />
              </View>
            )}

            {/* Threshold lines */}
            <View style={[styles.thresholdLine, { top: dbToTop(config.aumThreshold), borderColor: COLOR_ONSET }]} />
            <View style={[styles.thresholdLine, { top: dbToTop(config.aumEndThreshold), borderColor: COLOR_END, opacity: 0.7 }]} />

            {/* Y-axis labels */}
            <Text style={[styles.axisLabel, { top: dbToTop(config.aumThreshold) - 14, color: COLOR_ONSET }]}>
              onset {config.aumThreshold}
            </Text>
            <Text style={[styles.axisLabel, { top: dbToTop(config.aumEndThreshold) - 14, color: COLOR_END }]}>
              end {config.aumEndThreshold}
            </Text>

          </View>

          {/* Legend */}
          <View style={styles.legendRow}>
            <View style={[styles.legendSwatch, { backgroundColor: 'rgba(155,122,204,0.35)' }]} />
            <View style={[styles.legendSwatch, { backgroundColor: 'rgba(155,122,204,0.18)', marginLeft: 2 }]} />
            <Text style={styles.legendText}>
              Min duration ({config.aumMinDuration} ms) + End silence ({config.aumEndSilence} ms) — drag to move
            </Text>
          </View>
        </View>

        {/* Numeric inputs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>THRESHOLD VALUES</Text>

          <View style={styles.inputRow}>
            <Text style={[styles.inputLabel, { color: COLOR_ONSET }]}>Onset threshold (dBFS)</Text>
            <TextInput
              style={[styles.input, { borderColor: COLOR_ONSET, color: COLOR_ONSET }]}
              value={thresholdText}
              onChangeText={setThresholdText}
              keyboardType="numeric"
              onBlur={commitThreshold}
              onSubmitEditing={commitThreshold}
              selectionColor={COLOR_ONSET}
              placeholderTextColor="#444460"
            />
          </View>

          <View style={styles.inputRow}>
            <Text style={[styles.inputLabel, { color: COLOR_DUR }]}>Min duration (ms)</Text>
            <TextInput
              style={[styles.input, { borderColor: COLOR_DUR, color: COLOR_DUR }]}
              value={minDurText}
              onChangeText={setMinDurText}
              keyboardType="numeric"
              onBlur={commitMinDur}
              onSubmitEditing={commitMinDur}
              selectionColor={COLOR_DUR}
              placeholderTextColor="#444460"
            />
          </View>

          <View style={styles.inputRow}>
            <Text style={[styles.inputLabel, { color: COLOR_END }]}>End threshold (dBFS)</Text>
            <TextInput
              style={[styles.input, { borderColor: COLOR_END, color: COLOR_END }]}
              value={endThresholdText}
              onChangeText={setEndThresholdText}
              keyboardType="numeric"
              onBlur={commitEndThreshold}
              onSubmitEditing={commitEndThreshold}
              selectionColor={COLOR_END}
              placeholderTextColor="#444460"
            />
          </View>

          <View style={styles.inputRow}>
            <Text style={[styles.inputLabel, { color: COLOR_DUR }]}>End silence (ms)</Text>
            <TextInput
              style={[styles.input, { borderColor: COLOR_DUR, color: COLOR_DUR }]}
              value={endSilenceText}
              onChangeText={setEndSilenceText}
              keyboardType="numeric"
              onBlur={commitEndSilence}
              onSubmitEditing={commitEndSilence}
              selectionColor={COLOR_DUR}
              placeholderTextColor="#444460"
            />
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f0f1a' },
  backButton: { paddingHorizontal: 20, paddingVertical: 14 },
  backText: { fontSize: 11, color: '#666680', letterSpacing: 3 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 48 },

  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 10, color: '#444460', letterSpacing: 4, marginBottom: 14 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  toggleLabel: { fontSize: 15, color: '#8888aa', fontWeight: '300' },

  volumeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#15152a' },
  volLabel: { fontSize: 13, color: '#666680' },
  volValue: { fontSize: 13, color: '#8888aa', fontVariant: ['tabular-nums'] },
  dimText: { fontSize: 13, color: '#444460' },

  graphHint: { fontSize: 12, color: '#444460', marginBottom: 10 },
  graphContainer: { height: GRAPH_HEIGHT, backgroundColor: '#0a0a14', borderRadius: 4, overflow: 'hidden', position: 'relative' },
  barsRow: { position: 'absolute', top: 0, left: 0, right: 0, height: GRAPH_HEIGHT },

  durationBandGroup: { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row' },
  durationSection: { height: '100%' },
  minDurSection: {
    backgroundColor: 'rgba(155,122,204,0.22)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(155,122,204,0.55)',
  },
  endSilenceSection: {
    backgroundColor: 'rgba(155,122,204,0.12)',
    borderRightWidth: 2,
    borderRightColor: 'rgba(155,122,204,0.45)',
  },

  thresholdLine: { position: 'absolute', left: 0, right: 0, height: 0, borderTopWidth: 1, borderStyle: 'dashed' },
  axisLabel: { position: 'absolute', right: 4, fontSize: 9 },

  legendRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 0 },
  legendSwatch: { width: 12, height: 12, borderRadius: 2, marginRight: 4 },
  legendText: { fontSize: 11, color: '#666680', flex: 1, marginLeft: 4 },

  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#15152a' },
  inputLabel: { fontSize: 13, color: '#666680', flex: 1 },
  input: {
    width: 80,
    textAlign: 'right',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#15152a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
});
