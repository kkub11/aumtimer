import { VolumeManager, RINGER_MODE } from 'react-native-volume-manager';
import { Platform } from 'react-native';

const STREAMS = ['music', 'call', 'system', 'ring', 'alarm', 'notification'];

let _saved = null;

export async function muteAll() {
  if (Platform.OS !== 'android') return;
  try {
    const [volumes, ringerMode] = await Promise.all([
      VolumeManager.getVolume(),
      VolumeManager.getRingerMode(),
    ]);
    _saved = { volumes, ringerMode };

    await Promise.all([
      VolumeManager.setRingerMode(RINGER_MODE.silent),
      ...STREAMS.map((type) =>
        VolumeManager.setVolume(0, { type, showUI: false, playSound: false })
      ),
    ]);
  } catch (e) {
    console.warn('[volumeControl] muteAll failed:', e);
  }
}

export async function restoreAll() {
  if (Platform.OS !== 'android') return;
  if (!_saved) return;
  const { volumes, ringerMode } = _saved;
  _saved = null;
  try {
    await Promise.all([
      VolumeManager.setRingerMode(ringerMode),
      ...STREAMS.map((type) =>
        VolumeManager.setVolume(volumes[type] ?? volumes.volume ?? 0, {
          type,
          showUI: false,
          playSound: false,
        })
      ),
    ]);
  } catch (e) {
    console.warn('[volumeControl] restoreAll failed:', e);
  }
}
