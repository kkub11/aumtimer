import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { VolumeManager } from 'react-native-volume-manager';

export default function StartScreen({ navigation }) {
  useEffect(() => {
    async function ensureDndAccess() {
      const granted = await VolumeManager.checkDndAccess();
      if (!granted) {
        await VolumeManager.requestDndAccess();
      }
    }
    ensureDndAccess();
  }, []);

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
      <Text style={styles.subtitle}>Place your phone nearby and press start</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate('Session')}
        activeOpacity={0.75}
      >
        <Text style={styles.buttonText}>START</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        Session ends when it hears a beep
      </Text>
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
