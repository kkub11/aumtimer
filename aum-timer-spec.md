# AUM Timer — Technical Specification

A personal meditation session tracker built with Expo (React Native) for Android.
Detects the start of chanting, counts AUM repetitions, and stops on a beep — all offline, no cloud APIs.

---

## 1. Project Setup

```bash
npx create-expo-app AumTimer --template blank
cd AumTimer
npx expo install expo-av
```

Run on device during development:
```bash
npx expo start
# Scan QR code with Expo Go app on Android
```

When ready to install as a standalone APK:
```bash
npx eas build -p android --profile preview
```

---

## 2. File Structure

```
AumTimer/
├── App.js                  # Root: navigation between screens
├── screens/
│   ├── StartScreen.js      # Single start button
│   ├── SessionScreen.js    # Live timer + recording logic
│   └── ResultsScreen.js    # Summary display
├── audio/
│   ├── AudioEngine.js      # Mic recording loop (raw metering)
│   ├── AumDetector.js      # AUM chanting detection logic
│   └── BeepDetector.js     # Beep stop-trigger detection logic
└── utils/
    └── formatTime.js       # ms → "mm:ss.ms" display helper
```

---

## 3. Screen Flow

```
[StartScreen]
     |
  Press START
     |
[SessionScreen]  ←── live mic loop running
     |                 - timer counting up
     |                 - watching for AUM onset
     |                 - watching for beep
     |
  Beep detected
     |
[ResultsScreen]
     - Pre-chant duration
     - AUM count
     - Total session time
     |
  Press RESET → back to [StartScreen]
```

---

## 4. Audio Detection Strategy

### Why no ML or cloud API
"Aum" is a sustained, voiced, low-frequency sound (~80–300 Hz fundamental, strong low harmonics). At 10 feet in a quiet room, it produces a reliable energy signature distinct from silence and ambient noise. A frequency-band energy approach is sufficient and keeps everything offline and simple.

### How it works

**Expo AV metering** gives you a `metering` value (dBFS, roughly -160 to 0) on each recording status update, polled ~every 100ms.

You cannot get raw FFT data from `expo-av` directly. Instead, use energy levels across two recording "profiles" — one low-pass filtered, one broadband — to approximate frequency-band separation.

**Practical workaround:** Record in two parallel passes using different audio settings to simulate low/high band sensitivity is complex. Instead, use the simpler single-meter approach with tuned thresholds and duration gates:

#### AUM Detection (AumDetector.js)
- Input: stream of `{ timestamp, metering }` objects (~10/sec)
- AUM is a **sustained** sound (typically 3–8 seconds per repetition)
- Logic:
  1. When metering crosses above `AUM_THRESHOLD` (e.g., -30 dBFS), start a candidate window
  2. If metering stays above threshold for `AUM_MIN_DURATION` (e.g., 1500ms), confirm it as an AUM onset
  3. When metering drops below `AUM_END_THRESHOLD` (e.g., -40 dBFS) for `AUM_END_SILENCE` (e.g., 400ms), mark that AUM as complete → increment count
  4. First confirmed AUM onset marks the "chanting began" timestamp

#### Beep Detection (BeepDetector.js)
- A beep is a **sharp, brief** spike — high energy, short duration
- Logic:
  1. When metering jumps above `BEEP_THRESHOLD` (e.g., -20 dBFS)
  2. AND the spike resolves (drops back) within `BEEP_MAX_DURATION` (e.g., 500ms)
  3. AND it's not during an active AUM window (guard against false triggers)
  4. → trigger session stop

#### Threshold Tuning
All thresholds are constants at the top of their respective files. You will need to calibrate them for your room by running a debug mode that logs raw metering values. Add a `__DEV__` flag to print metering to console during development.

```js
// AumDetector.js — top of file
const AUM_THRESHOLD = -30;       // dBFS — metering must exceed this
const AUM_MIN_DURATION = 1500;   // ms — must sustain to confirm AUM
const AUM_END_THRESHOLD = -40;   // dBFS — below this = silence
const AUM_END_SILENCE = 400;     // ms — silence needed to end an AUM

// BeepDetector.js — top of file
const BEEP_THRESHOLD = -20;      // dBFS — beep spike must exceed this
const BEEP_MAX_DURATION = 500;   // ms — spike must resolve within this
```

---

## 5. AudioEngine.js

Core recording loop. Starts mic, polls metering, feeds values to both detectors.

```js
import { Audio } from 'expo-av';

export async function startRecording(onMeteringUpdate) {
  await Audio.requestPermissionsAsync();
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync({
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });

  recording.setOnRecordingStatusUpdate((status) => {
    if (status.isRecording && status.metering !== undefined) {
      onMeteringUpdate({
        timestamp: Date.now(),
        metering: status.metering,
      });
    }
  });

  recording.setProgressUpdateInterval(100); // poll every 100ms
  await recording.startAsync();
  return recording; // caller holds reference to stop it later
}

export async function stopRecording(recording) {
  await recording.stopAndUnloadAsync();
}
```

---

## 6. SessionScreen.js — State Model

```js
const [phase, setPhase] = useState('running'); // 'running' | 'done'
const [startTime] = useState(Date.now());
const [chantStartTime, setChantStartTime] = useState(null); // null until first AUM
const [aumCount, setAumCount] = useState(0);
const [endTime, setEndTime] = useState(null);
const [elapsedDisplay, setElapsedDisplay] = useState('0:00.0');
```

**On mount:** start `AudioEngine`, start a `setInterval` (100ms) to update `elapsedDisplay`.

**AumDetector callback `onAumOnset`:** if `chantStartTime === null`, set it now.

**AumDetector callback `onAumComplete`:** `setAumCount(c => c + 1)`.

**BeepDetector callback `onBeepDetected`:** set `endTime`, stop recording, clear interval, navigate to ResultsScreen with session data.

---

## 7. ResultsScreen.js — Data & Display

Receives via navigation params:
```js
{
  startTime,       // ms timestamp
  chantStartTime,  // ms timestamp (or null if no AUM detected)
  aumCount,        // integer
  endTime,         // ms timestamp
}
```

Computed display values:
```js
const preChantDuration = chantStartTime
  ? chantStartTime - startTime
  : endTime - startTime;

const totalDuration = endTime - startTime;
```

Display:
```
Before chanting:   0:47.3
AUMs counted:      12
Total session:     8:23.1
```

---

## 8. formatTime.js

```js
export function formatMs(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}
```

---

## 9. Permissions

In `app.json`:
```json
{
  "expo": {
    "plugins": [
      [
        "expo-av",
        {
          "microphonePermission": "Allow AUM Timer to use the microphone for session detection."
        }
      ]
    ]
  }
}
```

---

## 10. UI Design Notes

Keep it minimal and calm — this is a meditation tool.

- **StartScreen:** Dark background (~#1a1a2e), single large circular START button, soft warm glow (amber/gold). No clutter.
- **SessionScreen:** Large centered timer in a monospace font. Small status line below ("Waiting for chant..." → "Chanting — 3 AUMs"). No stop button — the beep controls everything.
- **ResultsScreen:** Clean list of three stats, large type. Single RESET button at bottom.
- Font suggestion: `expo-google-fonts` with `Rajdhani` for timer display (technical but calm), `Inter` for labels.

---

## 11. Development Order (Shortest Path)

1. **Scaffold** — create-expo-app, install expo-av, get Expo Go running on phone
2. **AudioEngine** — start/stop recording, log raw metering to console, confirm mic works at 10 feet
3. **Threshold calibration** — chant AUM in your room, note metering values; set constants
4. **AumDetector** — implement onset/end logic, test with console logs
5. **BeepDetector** — implement spike logic, test with a phone beep or timer alarm
6. **SessionScreen** — wire up state, connect detectors
7. **StartScreen + ResultsScreen** — simple UI, navigation
8. **Polish** — styling per UI notes above

---

## 12. Known Edge Cases to Handle

| Situation | Mitigation |
|---|---|
| Room noise triggers false AUM | Raise `AUM_THRESHOLD`; require longer `AUM_MIN_DURATION` |
| Loud exhale triggers false beep | Beep guard: spike must be brief AND not inside active AUM window |
| Two AUMs run together | Require `AUM_END_SILENCE` gap between them |
| App goes to background | Set `staysActiveInBackground: true` in `Audio.setAudioModeAsync` |
| No AUM detected before beep | Show "No chanting detected" gracefully on results screen |

---

## 13. Dependencies Summary

| Package | Purpose |
|---|---|
| `expo` | Core framework |
| `expo-av` | Microphone access + metering |
| `@react-navigation/native` | Screen navigation |
| `@react-navigation/native-stack` | Stack navigator |
| `expo-google-fonts` (optional) | Custom typography |

Install navigation:
```bash
npx expo install @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context
```

## Instructions from Claude
A few things worth highlighting before you hand this to Claude Code:
The most important first step is calibration — before writing any detection logic, just run the AudioEngine and log raw metering values to the console while you chant and while it's silent. That 15-minute exercise will tell you exactly where to set your thresholds and will save you a lot of guesswork later.
The background recording edge case is critical for a meditation app — make sure staysActiveInBackground: true gets set in the audio mode config or the session will die the moment your screen locks.
Development order matters — the spec lays out a sequence that keeps you testing on real hardware from step 2 onward. Don't build all the UI first; get the mic working and calibrated before touching screens.

First thing to do before a real session: open SessionScreen.js and temporarily set DEBUG_METERING = true at the top. Then run a test — chant a few AUMs and trigger your beep sound. Watch the console in the terminal and note what numbers you see. Then open AumDetector.js and BeepDetector.js and tune the threshold constants at the top of each file to match your room. Set it back to false when done.
That calibration step is the difference between it working first try and spending an hour wondering why it's not detecting anything.
