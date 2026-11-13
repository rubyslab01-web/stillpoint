# Stillpoint

A personal iOS app that layers generated hypnosis narration over binaural beats (or pulsed tones on a speaker), coloured noise, and a soft synthesised pad. Five modules: Sleep, Quit Smoking, Gratitude, Inner Coherence, and Loving Compassion. Wellness, not treatment.

## Status

| Part | State |
|---|---|
| Research briefs (`research/`) | Written and approved for all five modules, plus a shared brief on entrainment for awake use |
| Audio engine, session format, app screens | Written; build and pass 46 unit tests on macOS |
| Narration | All 167 segments generated and verified word-for-word (32 minutes) |
| Sessions | 8 sessions across 5 modules; all pass validation |
| Xcode project | Generated (`Stillpoint.xcodeproj`) |
| **iOS build and Simulator run** | Done 2026-11-12 with Xcode 26.6: builds clean for the iPhone 17 Simulator and launches to onboarding. |
| Web port (`web/`) | Runs in Safari on an iPhone, served from this Mac; see "Web port" below and `TESTING-WEB.md` |

## Layout

```
CLAUDE.md                 Project brief
DECISIONS.md              What was chosen and why
TESTING.md                Checklist for testing on an iPhone
TESTING-WEB.md            Checklist for testing the web port in Safari
serve-web.sh              Serves the web port to your phone over Wi-Fi
research/                 One brief per module
Scripts/<module>/*.txt    Narration scripts (plain text)
Sessions/*.json           One file per session, plus modules.json
App/                      iOS app shell: entry point, Info.plist, entitlements, icon
App/Resources/Narration/  Generated voice audio and manifest.json
Packages/EntrainmentKit/  All code
  Sources/EntrainmentKit/     Audio engine, DSP, session format
  Sources/HypnosisAppCore/    Screens, data, Health, self-experiment
  Sources/sessionrender/      Mac tool: validate sessions, render one to an audio file
  Sources/StillpointMac/      Mac development build of the app
  Tests/                      Unit tests
tools/                    Narration pipeline (Python)
previews/                 Rendered audio for each session, and screen images
project.yml               XcodeGen definition of the Xcode project
web/                      Web port: the app in the browser (see "Web port")
```

## First run on an iPhone

1. Install Xcode (App Store; needs roughly 35–40 GB free), then run `sudo xcode-select -s /Applications/Xcode.app`.
2. Open `Stillpoint.xcodeproj`. If it is missing or stale, run `xcodegen generate` in this folder.
3. In the Stillpoint target's **Signing & Capabilities**, choose your team. Change the bundle identifier and the iCloud container to ones under your team. The container name appears in three places: `App/Stillpoint.entitlements`, `project.yml`, and `DataStore.cloudContainerID` in `Packages/EntrainmentKit/Sources/HypnosisAppCore/Data/Models.swift`.
4. Build and run. Then work through `TESTING.md`.

To build without iCloud at first, set `StillpointCloudSync` to `NO` in `App/Info.plist`. The app then stores data on the device only.

## Everyday commands

```sh
./run-tests.sh                                   # unit tests (works without Xcode)
./narrate.sh                                     # regenerate narration for edited scripts
cd Packages/EntrainmentKit
swift run sessionrender --validate               # check every session file
swift run sessionrender qs-rescue-2 out.m4a      # render a session to listen to on the Mac
swift run sessionrender sleep-deep out.m4a --seconds 1200 [--isochronic] [--no-beats]
swift run StillpointMac                          # run the app's screens and audio on the Mac
swift run StillpointMac --snapshots ../../previews/screens   # render key screens to PNG
./serve-web.sh                                   # serve the web port to your phone (renders stale audio first)
web/run-tests.sh [--parity] [--smoke]            # web port tests
```

## Edit a script and regenerate its audio

1. Open the script in `Scripts/`, for example `Scripts/gratitude/savour.txt`. Each block starts with an id in square brackets:

   ```
   # voice: af_heart*0.65+af_nicole*0.35
   # speed: 0.9
   # gap: 0.9
   # soft: on

   [gr-one-1]
   Now, let your mind drift back over today...
   ```

   The header lines apply to every block after them, and can change part-way through a file (Steady Heart switches to the soft voice at about 4 minutes):
   - `voice`: a Kokoro voice, or a weighted blend such as `af_heart*0.65+af_nicole*0.35`.
   - `speed`: keep it near 1 (0.9–1.0). Slowing Kokoro further is what made the old narration sound robotic.
   - `gap`: seconds of silence between sentences. This is where the slow, calm pacing comes from.
   - `soft: on`: a slightly darker, quieter delivery for the gentlest parts.

2. Edit the text. Write numbers as words and avoid abbreviations.
3. Run `./narrate.sh`. Only changed segments are rebuilt. Each one is transcribed back and compared with your text; the command prints `FAIL` with what was heard if a word was dropped or garbled. Reword that line and run it again.
4. Run `./run-tests.sh`. The tests confirm every session still finds its audio.

Pauses are not in the script. They are the `pauseAfter` values in the session file. `./narrate.sh --force` rebuilds everything.

## Adjust a session

Open its file in `Sessions/`. The main fields:

| Field | Meaning |
|---|---|
| `carrierHz` | Base tone in both ears |
| `noise` | `brown`, `pink`, or `white` |
| `ambient` | `warmPad`, `deepDrone`, `glow`, or omit |
| `phases[].beatHz`, `beatGlideSeconds` | Beat frequency this phase glides to, and how long the glide takes |
| `phases[].levels` | Layer levels in dB relative to the voice: `beats`, `noise`, `ambient`, `pacer`. −96 is off. |
| `phases[].segments` | Narration ids in order, each with `pauseAfter` seconds |
| `phases[].leadInSeconds`, `tailSeconds`, `minDurationSeconds` | Silence before and after the voice; minimum phase length |
| `phases[].pacer` | Optional breath guide: `breathsPerMinute`, `inhaleFraction`, pitch range |
| `ducking` | How much, and how fast, the background drops under the voice |
| `noiseBed` | Sleep only: optional noise-only continuation |
| `ratings` | Questions asked before and after, used for progress and the self-experiment |

Rules the validator enforces: beats 15–20 dB under the noise, awake sessions end at 12 Hz or above, and every narration id exists.

## Add a module

1. Write its research brief in `research/` and approve it.
2. Add an entry to `Sessions/modules.json` (id, title, tagline, SF Symbol name, colour, description, honesty note, cautions, primary rating id).
3. Write `Scripts/<module>/<name>.txt` and run `./narrate.sh`.
4. Add one or more `Sessions/<id>.json` files with `"module"` set to the new id.
5. Run `./run-tests.sh` and `swift run sessionrender --validate`. Update the expected module list in `ShippedSessionTests` and `DataStoreTests`.

No engine or screen code changes are needed.

## Web port

A browser version for testing on your iPhone without a cable or Developer Mode. It reads the same `Sessions/` files, narration and manifest in place (nothing is copied), plays the same mix, and has the same screens, onboarding, ratings, history and self-experiment. It is a test harness, not a replacement for the app; the native app is unchanged.

### Run it

1. On the Mac: `./serve-web.sh`. The first run renders each session's audio (about 7 minutes for all of them, 544 MB in `web/audio/`); later runs only re-render sessions whose file, narration or engine changed. It then prints the addresses to open, for example `http://192.168.1.20:8000/`. If macOS asks whether Python may accept incoming connections, allow it. The Mac is kept awake while the script runs. Each session is downloaded to the phone's memory when it starts (about 10 s for Deep Sleep), so after that the phone doesn't need the Mac.
2. On the iPhone, on the same Wi-Fi network: open that address in Safari.
3. To make it feel like an app: Share › **Add to Home Screen**, then open Stillpoint from its icon. A Home Screen web app opens full-screen and keeps its data. A plain Safari tab may lose it after seven days of browsing without opening Stillpoint.
4. Work through `TESTING-WEB.md`.

Serving needs only Python 3. Rendering the audio uses Swift (the native `sessionrender` tool, unchanged), `afconvert`, and Node and ffmpeg (both already installed here). If Node or Swift is missing, the script skips rendering and the app plays those sessions with its live engine.

**Optional HTTPS** (offline-capable Home Screen app): `./serve-web.sh --https`. It creates a certificate authority on this Mac with `openssl` (no accounts), limited by name constraints to local names and private-network addresses. On the phone open `http://<Mac>:8000/https.html` and follow the steps: download the certificate, install the profile, and trust it under Settings › General › About › Certificate Trust Settings. Then use `https://<Mac>:8443/`. Remove it any time in Settings › General › VPN & Device Management. The certificate files are in `web/.certs/` (the private key never leaves the Mac).

### How it differs from the native app

| | Native app | Web port |
|---|---|---|
| Playback | Real-time engine (AVAudioEngine) | **Pre-rendered** by the native engine's own offline renderer and streamed through Safari's media player (default), or the same engine ported to an AudioWorklet (**Live engine**, in Settings) |
| Headphones | Detected; switches to pulsed tones without them | Chosen by you in onboarding, in the session sheet, and in the player. If headphones disconnect, iPhone pauses the session |
| Spatial Audio | Detected, with a warning | Can't be detected; instructions are always shown |
| Volume | In-app slider up to 0.75, high-volume warning | Pre-rendered: rendered at 0.75 and set with the phone's buttons (if Safari ignores page volume, as iPhones have; the app detects this). Live engine: slider up to 0.75. No warning, because the page can't read phone volume |
| Pause and stop | 1.2 s fades | Fades with the live engine. Pre-rendered: faded where Safari lets the page set volume, otherwise immediate |
| Speaker-mode switch mid-session | 1.5 s crossfade | Live: same. Pre-rendered: switches file at the same moment (brief gap) |
| After a call or alarm | Resumes by itself | Shows "paused by your phone"; press play |
| Noise bed after Sleep | Crossfades straight to the bed level | The session fades out, then the bed fades in over 2 minutes |
| Health, iCloud | Read with permission; private sync | None. History stays in this browser. A future sleep-data source plugs into `web/js/app/sources.js` |

### Adding or editing sessions

No web code changes are needed. Edit or add `Sessions/*.json` (and narration with `./narrate.sh`) exactly as for the native app, then restart `./serve-web.sh` to render the new audio. Until it is rendered, the app plays that session with the live engine and says so on the session row.

### Online version (GitHub Pages)

The web app is published at **https://rubyslab01-web.github.io/stillpoint/** from the `gh-pages` branch of this (public) repo. Open it in Safari on the iPhone and use Share › Add to Home Screen. It works offline for history and settings, and sessions download their audio when they start.

To publish changes: commit and push as usual, then run `web/tools/deploy-pages.sh`. It renders any stale audio, builds the site, and replaces the `gh-pages` branch with a single fresh commit. The 8-hour noise bed (118 MB) is left out because GitHub rejects files over 100 MB, so that option plays with the live engine.

The repo is public: anyone with the link can use the app or read the code, scripts and research. Your history stays on your phone and is never uploaded.

### Deploying elsewhere (later)

`node web/tools/build-static.mjs` assembles `web/dist/`, a self-contained static site, about 550 MB (or 350 MB with `--no-beds`; Sleep's night-time noise then plays live). Any static host with HTTPS and HTTP range requests can serve it, for example Netlify, an S3 bucket, or your own server. Check the host's per-file size limit: the largest file is the 8-hour noise bed (118 MB), or 66 MB with `--no-beds`. No account has been set up.

### Web files

```
web/index.html, css/, icons/     The app page and its look
web/js/engine/                   Port of EntrainmentKit: DSP, session format, timeline, validator, renderer, AudioWorklet
web/js/app/                      Players, content loading, storage, self-experiment, sleep-data source hook
web/js/main.js                   Screens and app state
web/sw.js                        Service worker (HTTPS only)
web/lab/lock.html                Lock-screen lab: compares the two playback paths with the screen locked
web/tools/build-audio.mjs        Pre-renders every session (run by serve-web.sh)
web/tools/server.py              Local server (range requests, Sessions/ and narration mounted in place, HTTPS)
web/tests/                       Ported audio-maths and validator tests, Swift parity, rendered-file checks,
                                 headless-Chrome smoke test, iOS Simulator (XCUITest) harness for Safari
```

## Known limitations

- **Simulator only so far.** The app builds and launches in the iOS Simulator, but has not run on a real iPhone; audio routing, interruptions and HealthKit still need on-device checks (see TESTING.md).
- **Nothing has been heard on real headphones by a person.** Levels, channel separation, and fades are verified numerically. Whether the voice, pacing, and mix feel right is for you to judge; `previews/` has every session.
- **Spatial audio can't be turned off by an app.** The app detects it and tells you how to switch it off.
- **System volume can't be capped by an app.** The app limits its own gain and warns when phone volume is high.
- **iCloud sync is untested.** It needs a signed build with your own container.
- **Health data needs an Apple Watch or another tracker.** Heart rate and HRV readings during a session exist only if something recorded them.
- **The suggestibility check is a rough self-report**, not a validated scale.
- **Narration is synthetic.** Kokoro is good but a human or premium cloud voice would sound more natural; see DECISIONS.md.
- **English only.** Crisis and quit-line numbers cover the US, Canada, and the UK, with a link for other countries.
