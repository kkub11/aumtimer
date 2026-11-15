import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { formatMs } from '../utils/formatTime';

function elapsedOrDash(startTime, eventTime) {
  if (startTime == null || eventTime == null) return '—';
  return formatMs(eventTime - startTime);
}

export default function ResultsScreen({ navigation, route }) {
  const { startTime, chantStartTime, lastAumEndTime, headTiltCompleteTime, aumCount, endTime } = route.params;

  const totalDuration = endTime - startTime;
  const chantingDetected = chantStartTime != null;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Session Complete</Text>

      <View style={styles.card}>
        <StatRow
          label="AUMs began"
          value={elapsedOrDash(startTime, chantStartTime)}
        />
        <View style={styles.rowDivider} />
        <StatRow
          label="AUMs ended"
          value={elapsedOrDash(startTime, lastAumEndTime)}
        />
        <View style={styles.rowDivider} />
        <StatRow
          label="Head tilt complete"
          value={elapsedOrDash(startTime, headTiltCompleteTime)}
        />
        <View style={styles.rowDivider} />
        <StatRow
          label="Total session"
          value={formatMs(totalDuration)}
        />
        <View style={styles.rowDivider} />
        <StatRow
          label="AUMs counted"
          value={(aumCount ?? 0).toString()}
          valueStyle={styles.aumValue}
        />
      </View>

      {!chantingDetected && (
        <Text style={styles.warning}>No chanting was detected this session</Text>
      )}

      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.replace('Start')}
        activeOpacity={0.75}
      >
        <Text style={styles.buttonText}>NEW SESSION</Text>
      </TouchableOpacity>
    </View>
  );
}

function StatRow({ label, value, valueStyle }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueStyle]}>{value}</Text>
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
  heading: {
    fontSize: 13,
    color: '#555570',
    letterSpacing: 4,
    marginBottom: 40,
    textTransform: 'uppercase',
  },
  card: {
    width: '100%',
    backgroundColor: '#15152a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a40',
    padding: 8,
    marginBottom: 32,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#1e1e32',
    marginHorizontal: 20,
  },
  rowLabel: {
    fontSize: 14,
    color: '#666680',
    fontWeight: '300',
  },
  rowValue: {
    fontSize: 22,
    color: '#e8d5a3',
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
  },
  aumValue: {
    fontSize: 36,
    color: '#c9a84c',
  },
  warning: {
    fontSize: 13,
    color: '#664433',
    marginBottom: 24,
    textAlign: 'center',
  },
  button: {
    marginTop: 8,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: '#2a2a40',
  },
  buttonText: {
    fontSize: 13,
    color: '#666680',
    letterSpacing: 4,
  },
});
