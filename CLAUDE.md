# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
# Start dev server (scan QR with Expo Go on Android)
npx expo start

# Target a specific platform
npx expo start --android
npx expo start --ios

# Build standalone APK
npx eas build -p android --profile preview
```

There is no test suite and no linter configured.

## Architecture

AumTimer is an Expo (React Native) meditation session tracker targeting Android. It uses the microphone to detect AUM chanting onset/completion and a beep to end the session — fully offline, no cloud APIs.

**Navigation flow:** `StartScreen` → `SessionScreen` → `ResultsScreen` (via `@react-navigation/native-stack`, stack defined in `App.js`).

**Audio pipeline (the core of the app):**

1. `audio/AudioEngine.js` — wraps `expo-audio`'s hook-based recorder. The component creates a recorder via `useAudioRecorder()` and passes it to `startRecording(recorder, onMeteringUpdate)`. A `setInterval` at 100ms polls `recorder.currentMetering` and invokes the callback with `{ timestamp, metering }` (dBFS, ~-160 to 0).

2. `audio/AumDetector.js` — stateful detector created via `createAumDetector({ onAumOnset, onAumComplete })`. Implements a 4-state FSM (`silent → candidate → confirmed → ending`). An AUM is confirmed when metering exceeds `AUM_THRESHOLD` for `AUM_MIN_DURATION` ms. `onAumOnset` fires once (first AUM only, marks chanting start). `onAumComplete` fires each time an AUM ends. Exposes `isInsideAum()` for the beep guard.

3. `audio/BeepDetector.js` — `createBeepDetector({ onBeepDetected, getIsInsideAum })`. Detects a brief spike: metering exceeds `BEEP_THRESHOLD` then resolves within `BEEP_MAX_DURATION` ms, while `getIsInsideAum()` is false.

4. `screens/SessionScreen.js` — creates both detectors, feeds metering to both on each poll tick. Uses `useRef` for values that must be current inside async callbacks (`startTimeRef`, `chantStartTimeRef`, `aumCountRef`, `sessionDoneRef`). On beep detection, calls `navigation.replace('Results', { startTime, chantStartTime, aumCount, endTime })`.

**Threshold tuning:** All detection constants are at the top of `AumDetector.js` and `BeepDetector.js`. Set `DEBUG_METERING = true` in `SessionScreen.js` to print raw dBFS values to the console while chanting/beeping.

**Key constraint:** `expo-audio` (v56) uses a hook-based API — `useAudioRecorder()` must be called in a component. `AudioEngine.js` does NOT call the hook itself; the component owns the recorder ref and passes it in. The spec file (`aum-timer-spec.md`) documents the older `expo-av` API — ignore those code examples and use the `expo-audio` patterns already in `AudioEngine.js`.
