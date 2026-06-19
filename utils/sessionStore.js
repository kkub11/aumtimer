import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

const STORE_KEY = 'session_recordings';
const MAX_RECORDINGS = 3;

export async function loadSessionRecordings() {
  try {
    const json = await AsyncStorage.getItem(STORE_KEY);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export async function saveSessionRecording(entry) {
  try {
    const existing = await loadSessionRecordings();
    const updated = [entry, ...existing].slice(0, MAX_RECORDINGS);
    // Delete files for any entries that were trimmed off
    const trimmed = [entry, ...existing].slice(MAX_RECORDINGS);
    for (const old of trimmed) {
      try { new File(old.videoUri).delete(); } catch {}
    }
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('[sessionStore] saveSessionRecording failed:', e);
  }
}

export async function deleteSessionRecording(videoUri) {
  try {
    const existing = await loadSessionRecordings();
    const updated = existing.filter((r) => r.videoUri !== videoUri);
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(updated));
    try { new File(videoUri).delete(); } catch {}
  } catch (e) {
    console.warn('[sessionStore] deleteSessionRecording failed:', e);
  }
}
