import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Switch, ScrollView,
  TouchableOpacity, StyleSheet, PanResponder, Platform,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEventListener } from 'expo';
import { VolumeManager } from 'react-native-volume-manager';
import { startRecording, stopRecording } from '../audio/AudioEngine';
import { loadAumConfig, saveAumConfig, loadMuteEnabled, saveMuteEnabled, DEFAULT_AUM_CONFIG } from '../utils/aumConfig';
import { loadSessionRecordings, deleteSessionRecording } from '../utils/sessionStore';
import { formatMs } from '../utils/formatTime';

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

// ── RecordingCard ─────────────────────────────────────────────────────────────
// Each card owns its own VideoView + player so hooks are called unconditionally.
function RecordingCard({ recording, onDelete }) {
  const player = useVideoPlayer(recording.videoUri, (p) => {
    p.pause();
  });

  const isDraggingRef = useRef(false);
  const [sliderPos, setSliderPos] = useState(0);
  const durationSec = (recording.duration ?? 0) / 1000;

  // Sync slider to playback position when not dragging
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (!isDraggingRef.current) {
      setSliderPos(currentTime);
    }
  });

  function onSlidingStart() {
    isDraggingRef.current = true;
  }

  function onValueChange(value) {
    setSliderPos(value);
    player.currentTime = value;  // seek live — audio plays at new position
  }

  function onSlidingComplete(value) {
    player.currentTime = value;
    isDraggingRef.current = false;
  }

  function togglePlay() {
    if (player.playing) { player.pause(); } else { player.play(); }
  }

  const date = new Date(recording.startTime);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={recStyles.card}>
      {/* Metadata row */}
      <View style={recStyles.metaRow}>
        <Text style={recStyles.metaDate}>{dateStr} {timeStr}</Text>
        <Text style={recStyles.metaDuration}>{formatMs(recording.duration ?? 0)}</Text>
        <TouchableOpacity onPress={onDelete} style={recStyles.deleteButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={recStyles.deleteText}>×</Text>
        </TouchableOpacity>
      </View>

      {/* Video with AUM overlay */}
      <TouchableOpacity activeOpacity={0.9} onPress={togglePlay}>
        <View style={recStyles.videoWrapper}>
          <VideoView player={player} style={recStyles.video} contentFit="contain" nativeControls={false} />
          <View style={recStyles.aumOverlay}>
            <Text style={recStyles.aumOverlayText}>{recording.aumCount}</Text>
            <Text style={recStyles.aumOverlayLabel}>AUMs</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Scrub slider */}
      <Slider
        style={recStyles.slider}
        minimumValue={0}
        maximumValue={durationSec || 1}
        step={0.1}
        value={sliderPos}
        onSlidingStart={onSlidingStart}
        onValueChange={onValueChange}
        onSlidingComplete={onSlidingComplete}
        minimumTrackTintColor="#c9a84c"
        maximumTrackTintColor="#2a2a3e"
        thumbTintColor="#c9a84c"
      />
    </View>
  );
}

const recStyles = StyleSheet.create({
  card: {
    backgroundColor: '#0a0a14',
    borderRadius: 8,
    marginBottom: 20,
    overflow: 'hidden',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metaDate: { fontSize: 12, color: '#8888aa', flex: 1 },
  metaDuration: { fontSize: 12, color: '#444460', marginRight: 12, fontVariant: ['tabular-nums'] },
  deleteButton: { padding: 2 },
  deleteText: { fontSize: 20, color: '#444460', lineHeight: 22 },
  videoWrapper: { position: 'relative' },
  video: { width: '100%', height: 380 },
  aumOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(15,15,26,0.65)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  aumOverlayText: { fontSize: 28, fontWeight: '100', color: '#c9a84c', fontVariant: ['tabular-nums'] },
  aumOverlayLabel: { fontSize: 9, color: '#c9a84c', letterSpacing: 2 },
  slider: { width: '100%', height: 32, paddingHorizontal: 8 },
});
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen({ navigation }) {
  const [config, setConfig] = useState(DEFAULT_AUM_CONFIG);
  const [muteEnabled, setMuteEnabled] = useState(true);
  const [volumes, setVolumes] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [sampleTick, setSampleTick] = useState(0);
  const [bandX, setBandX] = useState(null);


  const samplesRef    = useRef([]);
  const configRef     = useRef(config);
  const bandXRef      = useRef(0);
  const bandXBaseRef  = useRef(0);
  const graphWidthRef = useRef(0);

  useEffect(() => { configRef.current = config; }, [config]);

  // ── Load persisted settings ──────────────────────────────────────────────
  useEffect(() => {
    loadAumConfig().then(setConfig);
    loadMuteEnabled().then(setMuteEnabled);
    loadSessionRecordings().then(setRecordings);
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

  // ── Slider change handlers ───────────────────────────────────────────────
  function handleThresholdChange(v) { setConfig((c) => ({ ...c, aumThreshold: Math.round(v) })); }
  function handleThresholdComplete(v) { saveAumConfig({ aumThreshold: Math.round(v) }); }

  function handleEndThresholdChange(v) { setConfig((c) => ({ ...c, aumEndThreshold: Math.round(v) })); }
  function handleEndThresholdComplete(v) { saveAumConfig({ aumEndThreshold: Math.round(v) }); }

  function handleMinDurChange(v) { setConfig((c) => ({ ...c, aumMinDuration: Math.round(v / 100) * 100 })); }
  function handleMinDurComplete(v) { saveAumConfig({ aumMinDuration: Math.round(v / 100) * 100 }); }

  function handleEndSilenceChange(v) { setConfig((c) => ({ ...c, aumEndSilence: Math.round(v / 50) * 50 })); }
  function handleEndSilenceComplete(v) { saveAumConfig({ aumEndSilence: Math.round(v / 50) * 50 }); }

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

        {/* Sliders */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>THRESHOLD VALUES</Text>

          <View style={styles.sliderRow}>
            <View style={styles.sliderLabelRow}>
              <Text style={[styles.sliderLabel, { color: COLOR_ONSET }]}>Onset threshold</Text>
              <Text style={[styles.sliderValue, { color: COLOR_ONSET }]}>{config.aumThreshold} dBFS</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={-80}
              maximumValue={-1}
              step={1}
              value={config.aumThreshold}
              onValueChange={handleThresholdChange}
              onSlidingComplete={handleThresholdComplete}
              minimumTrackTintColor={COLOR_ONSET}
              maximumTrackTintColor="#2a2a3e"
              thumbTintColor={COLOR_ONSET}
            />
          </View>

          <View style={styles.sliderRow}>
            <View style={styles.sliderLabelRow}>
              <Text style={[styles.sliderLabel, { color: COLOR_DUR }]}>Min duration</Text>
              <Text style={[styles.sliderValue, { color: COLOR_DUR }]}>{config.aumMinDuration} ms</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={100}
              maximumValue={5000}
              step={100}
              value={config.aumMinDuration}
              onValueChange={handleMinDurChange}
              onSlidingComplete={handleMinDurComplete}
              minimumTrackTintColor={COLOR_DUR}
              maximumTrackTintColor="#2a2a3e"
              thumbTintColor={COLOR_DUR}
            />
          </View>

          <View style={styles.sliderRow}>
            <View style={styles.sliderLabelRow}>
              <Text style={[styles.sliderLabel, { color: COLOR_END }]}>End threshold</Text>
              <Text style={[styles.sliderValue, { color: COLOR_END }]}>{config.aumEndThreshold} dBFS</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={-80}
              maximumValue={-1}
              step={1}
              value={config.aumEndThreshold}
              onValueChange={handleEndThresholdChange}
              onSlidingComplete={handleEndThresholdComplete}
              minimumTrackTintColor={COLOR_END}
              maximumTrackTintColor="#2a2a3e"
              thumbTintColor={COLOR_END}
            />
          </View>

          <View style={styles.sliderRow}>
            <View style={styles.sliderLabelRow}>
              <Text style={[styles.sliderLabel, { color: COLOR_DUR }]}>End silence</Text>
              <Text style={[styles.sliderValue, { color: COLOR_DUR }]}>{config.aumEndSilence} ms</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={50}
              maximumValue={2000}
              step={50}
              value={config.aumEndSilence}
              onValueChange={handleEndSilenceChange}
              onSlidingComplete={handleEndSilenceComplete}
              minimumTrackTintColor={COLOR_DUR}
              maximumTrackTintColor="#2a2a3e"
              thumbTintColor={COLOR_DUR}
            />
          </View>
        </View>

        {/* Recent recordings */}
        {recordings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>RECENT RECORDINGS</Text>
            {recordings.map((rec) => (
              <RecordingCard
                key={rec.startTime}
                recording={rec}
                onDelete={async () => {
                  await deleteSessionRecording(rec.videoUri);
                  setRecordings((r) => r.filter((x) => x.startTime !== rec.startTime));
                }}
              />
            ))}
          </View>
        )}

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

  sliderRow: { marginBottom: 20 },
  sliderLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  sliderLabel: { fontSize: 13, fontWeight: '300' },
  sliderValue: { fontSize: 13, fontVariant: ['tabular-nums'] },
  slider: { width: '100%', height: 32 },
});
