# Decisions

Significant choices made while building, with reasoning. Newest sections were added as work progressed.

## Environment constraints (2026-11-11)

**Xcode is not installed on this Mac, and there was not enough free disk to install it.** Only the Command Line Tools are present (Swift 6.3.1, macOS SDKs, no iOS SDK, no Simulator). Installing Xcode needs an Apple ID and roughly 35–40 GB; about 10–20 GB was free. I did not delete any files to make room.

What I did instead:
- Put all engine, data, and UI code in a Swift package (`Packages/EntrainmentKit`) that builds for both iOS and macOS. Everything except the iOS-only branches is compiled and tested on the Mac with `swift build` and `swift test`.
- Built a Mac development shell (`swift run StillpointMac`) that runs the real SwiftUI screens and audio engine, and can render the key screens to images.
- Built an offline renderer (`swift run sessionrender`) that produces a session's audio with the same renderer code the app uses.
- Generated `Stillpoint.xcodeproj` with XcodeGen from `project.yml`, so the project is ready to open once Xcode is installed.

**Not verified as a result:** `xcodebuild`, the iOS Simulator run, and compilation of the `#if os(iOS)` branches (audio session, interruptions and route changes, HealthKit queries, full-screen cover). See "Known limitations" in the README.

*Update 2026-11-12:* Xcode 26.6 has since been installed. The app builds for the iPhone 17 Simulator and launches to onboarding (see README, "Status"). It has not run on a real iPhone.

## Tools

| Job | Choice | Why |
|---|---|---|
| Narration | **Kokoro-82M** (local, no account) | Compared 10 Kokoro voices at two speeds and three macOS voices on the same hypnosis passage (`tools/compare_voices.py`). All Kokoro voices transcribed back with 0% word error. The macOS voices installed here are the compact, robotic kind and made errors (Daniel 4%, Flo 2%). |
| Hypnosis voice | **`af_nicole`, speed 0.85–0.88** | The only voice at a hypnosis pace: 102–116 words/min versus 150–225 for every other voice even when slowed. It is soft and breathy with a low spectral centre, which matches what users of sleep and hypnosis apps praise (slow, soft, unhurried). Used for Sleep, Quit Smoking main session, Gratitude, and Loving Compassion. |
| Alert voice | **`af_heart`, speed 0.8** | For the rescue sessions and Inner Coherence, which are eyes-open, instructional, and should not sound sleepy. Clearer and more present; about 160 words/min in speech, slowed further by pauses between segments. |
| Better option not used | ElevenLabs or similar cloud voices | Likely more natural, but need an account, API key, and payment. Kokoro is the best local option. To switch, change `synth()` in `tools/narrate.py`; nothing else depends on the engine. |
| Checking narration | **OpenAI Whisper `small.en`** (local; already cached on this Mac) | Each segment is transcribed and compared with its script. Any missing or wrong word fails the segment. |
| Loudness | **pyloudnorm** (ITU-R BS.1770) plus a look-ahead limiter | See "Narration pipeline". |
| Encoding | **afconvert** (Apple AAC, 64 kbps mono, 24 kHz) | Built into macOS; 32 minutes of narration is 16 MB. |
| Project file | **XcodeGen** | Generates the `.xcodeproj` from a short YAML file without needing Xcode. |
| Tests | **Swift Testing** | Ships with the Command Line Tools. `run-tests.sh` adds the framework paths the CLT needs. |
| App dependencies | **None** | Only Apple frameworks: AVFoundation, MediaPlayer, SwiftUI, Charts, Core Data, CloudKit, HealthKit. |

## Audio engine

- **One render function does all mixing** (`SessionRenderer.render`): beats, noise, ambient, breath pacer, voice, ducking, fades, pause fade, and soft clip. `AVAudioSourceNode` calls it on device; tests and the offline renderer call it directly. This is why the audio maths can be tested exactly.
- **Beat changes move only the right ear.** The left oscillator stays on the carrier; the right is carrier plus beat. Both are phase accumulators, so frequency glides are phase-continuous by construction. Glides use a raised-cosine S-curve.
- **Voice is mixed inside the same renderer** rather than through `AVAudioPlayerNode`, so voice timing is sample-accurate against the beat timeline and ducking can anticipate each segment (it starts 0.4 s before the voice). Segments are decoded about 25 s ahead on a background queue into a lock-free slot table and freed after playing.
- **Levels:** every generator is calibrated to the same reference RMS (0.16), and narration is normalised to −20 LUFS, so the dB values in session files are directly comparable. Sessions keep beats 18 dB under the noise; the validator enforces 15–20 dB.
- **Pause, interruption, and stop fade** over about 1.2 s inside the renderer, and the playhead holds while paused so nothing is skipped.
- **Headphones unplugged mid-session:** the session pauses rather than continuing aloud on the speaker. Pressing play continues in speaker (isochronic) mode.
- **Isochronic fallback** uses the same beat curve as amplitude modulation with raised-cosine pulses, 4–6 dB quieter than the binaural layer. Switching modes crossfades over 1.5 s.
- **Spatial audio:** iOS gives apps no way to switch off "Spatialize Stereo" or head tracking for engine output. The app declares non-multichannel content, detects when spatial audio is active on the route, and shows instructions to turn it off. This satisfies the brief's "warn the user if that can't be controlled".
- **Volume maximum:** the in-app volume tops out at 0.75 of full scale. That caps loudness relative to the phone's volume and keeps peaks below the soft-clip knee. The app also warns when the phone's own volume is above 80% on headphones. An app cannot set or cap the system volume.
- **Lock-screen controls:** play, pause, and stop. Scrubbing and skipping are disabled because jumping around would break the beat and phase arc.
- **Breath pacer** (for Inner Coherence) is a generic engine layer configured per phase in the session file, not module-specific code.

## Session format

- One JSON file per session in `Sessions/`, plus `Sessions/modules.json` for module titles, descriptions, honesty notes, and cautions. Adding a module or session needs no Swift changes.
- A phase states where the beat glides to and what the layer levels become; pauses between narration segments live in the session file, not in the audio.
- `SessionValidator` rejects files that break the rules: beats not 15–20 dB under noise, awake sessions that don't end at 12 Hz or above, missing narration, and so on. It runs in the unit tests, in `sessionrender --validate`, and at app launch.

## Narration pipeline

- Scripts are plain text with `[segment-id]` markers. `./narrate.sh` rebuilds only changed segments.
- **Verification is strict:** after normalising punctuation and number words, every word must come back from Whisper. Failed segments are retried at four nearby speeds, then reported. Six lines failed across all scripts; each was fixed by rewording, as the brief suggests. Typical failures were a dropped first word after a sentence break ("Your whole body, resting" lost "Your") and very short lines ("One more. In." heard as "End").
- **Loudness:** the whispery voice has sharp peaks, so plain gain-to-target left segments up to 5 dB apart. A look-ahead limiter now tames peaks instead of turning whole segments down. All 167 segments measure −20.0 LUFS with a −1.5 dB peak ceiling.

## Session design choices that depart from a first reading of the brief

- **Quit Smoking main session is about 14 minutes, not 20.** The brief I first drafted said about 20. The script came out shorter, and the evidence doesn't favour longer: users praise 10–20 minute sessions, and repeat use predicts quitting. The research brief was updated to say so.
- **Sleep voice is about 13 minutes** with pauses that lengthen toward the end, inside the 13–15 minutes specified.
- **Rescue sessions start instantly** with no pre-session screen, because lapses happen within minutes of a craving. The "before" craving rating is offered on the player screen while the audio is already playing.
- **Loving Compassion leaves out the "difficult person" step** (top source of drop-off and distress for beginners) and starts with a loved one rather than the self.
- **Gratitude suggests two or three sessions a week** and the app has no streaks anywhere.
- **Inner Coherence shows no "coherence score".** Paced breathing works nearly as well without feedback, and scores add performance pressure.

## Data and privacy

- **Core Data with `NSPersistentCloudKitContainer`, private database, instead of SwiftData.** Both are Apple frameworks using the same CloudKit mirroring. SwiftData's macros ship only with full Xcode, so I could not compile or test it here; Core Data with a model defined in code builds and is tested on this Mac.
- **Sync is switched on by an Info.plist flag** (`StillpointCloudSync`). During the Mac smoke test, CloudKit crashed the process at launch because the unsigned build lacked the iCloud entitlement. Unsigned and development builds now stay local instead of crashing.
- The local store is the source of truth, so the app works fully offline and syncs when it can.
- **Only one kind of record is stored:** a session log (which session, when, how much was played, the beats condition, ratings, an optional note, and any Health readings). Health data is read-only, requested one type at a time, each with a plain-language explanation.
- Device preferences (volume, speaker mode, onboarding answers) are kept in local settings and are not synced.
- **Delete all** removes records one by one rather than by batch, so the deletions reach iCloud.

## Self-experiment

- With the experiment on, each session is randomly assigned beats or no beats. Assignment is a fair coin unless one arm is two or more ahead, which keeps the arms balanced without being predictable.
- **Results and each session's condition stay hidden until there are five rated sessions per arm**, so expectations can't colour the ratings.
- The verdict needs at least a medium standardised difference (d ≥ 0.5) before it says beats help or hurt; otherwise it says "no clear difference". The screen says plainly that this is a small personal experiment, not proof.
- Sham sessions are identical except the beat layer is silent (tested: the output equals a noise-only render).

## Onboarding

- **Suggestibility self-assessment** is five self-report questions on absorption and imaginative involvement, which correlate modestly with hypnotic suggestibility. Validated scales (such as the Harvard Group Scale) take 45 minutes or more and need a trained administrator. The result is described as a rough guide and is used only to set expectations.

## Naming

- The app is called **Stillpoint**, with bundle identifier `com.stillpoint.hypnosis` and iCloud container `iCloud.com.stillpoint.hypnosis`. These are placeholders: change both to identifiers under your own Apple Developer team before running on a device.

## Web port (2026-11-12)

A browser version in `web/` so the app can be tested on an iPhone in Safari without a cable or Developer Mode. It is a test harness. The native app is untouched; the only files outside `web/` that changed are this one, README, TESTING.md, and `.gitignore`, plus the new `serve-web.sh` and `TESTING-WEB.md`.

### Shape

- **Plain ES modules, no build step, no dependencies.** The app is a few JavaScript files served as they are. Nothing to install, nothing to compile, and the code reads like the Swift it ports.
- **Content is read in place, at runtime.** The local server mounts `Sessions/` at `/content/Sessions/` and `App/Resources/Narration/` at `/content/Narration/`, and generates `Sessions/index.json` from the folder. Sessions are decoded with the same required fields as Swift's `Codable` and validated with a port of `SessionValidator`. A new or edited session appears with no JavaScript change.
- **The engine is ported line for line** (`web/js/engine/`): envelopes, phase accumulators, binaural and isochronic oscillators, xorshift64* noise (exact, on 32-bit halves), ambient pad, breath pacer, timeline, renderer, soft clip, including every point where Swift converts Double to Float. Checked against the Swift renderer on six renders, about 39 minutes of audio in all (parity test): **the largest sample difference is 1.5 × 10⁻⁵**, half a step of the 16-bit reference, with or without voice. Level differences per second are under 0.01 dB.

### Audio approach: pre-rendered by default, live engine as an option

The brief asked me to prototype real-time Web Audio and pre-rendered files and choose on evidence. I built both on the real players and drove Mobile Safari in the iOS 26.5 Simulator with XCUITest (`web/tests/ios-sim/`), tapping start (a real gesture), then pressing Home or locking the device, and reading back how far the audio advanced.

| Case (Simulator, Safari 26.5) | Background 45 s | Locked 45 s | Locked 20 min, Deep Sleep |
|---|---|---|---|
| A. Pre-rendered file in an `<audio>` element, streamed | kept playing | kept playing | run 1: 1,188 s of 1,200 (scrub-guard bug, below); run 2: **stalled for good at 297 s** |
| A′. Pre-rendered file played from memory (current design) | — | — | kept playing for the 9½ min it ran (581 s of 581, no jumps); stopped early, see below |
| B. Live Web Audio (AudioWorklet) + silent `<audio>` keep-alive | kept playing | kept playing | not run |
| C. Live Web Audio alone | kept playing | kept playing | kept playing (1,200.4 s of 1,200.4) |
| D. Pre-rendered; file ends while hidden, then the noise bed starts | handed over, bed playing | handed over, bed playing | — |

The real app was also walked through in Simulator Safari with real taps (onboarding, then "Craving now?", then 30 s in the background): the rescue session kept playing, with 35 s of audio advancing over 30 s away plus the app switches.

Both approaches survived in the Simulator, which is more than I expected for Web Audio. **I chose pre-rendered playback as the default anyway:**
1. A Simulator is not a phone. Real devices add battery-saving process suspension, memory pressure on a long night, and the real audio hardware. Background playback of media elements is how podcast and music sites work on iPhone, so it's the path most likely to hold on a device. Whether Web Audio keeps running on a locked iPhone has varied between iOS versions, and I can't test a device.
2. The files are rendered by the native engine itself (`swift run sessionrender`, unchanged), so what the phone plays is what the iOS app would play, bit for bit before encoding.
3. Lock-screen controls attach to a media element natively.

The live engine stays in the app as **Settings › Playback › Live engine**. It is also used automatically when a session has no up-to-date render (an edited session before `serve-web.sh` re-renders it, or offline), and for the onboarding tones. It gives the native behaviour exactly: in-app volume, 1.2 s pause and stop fades, the 1.5 s binaural⇄isochronic crossfade, and any noise-bed length. With it, "Keep the screen on" (Screen Wake Lock) defaults on. TESTING-WEB.md section 3a asks you to check both on the phone. If the live engine proves reliable when locked, it could become the default and the 544 MB of renders would go.

**What pre-rendered costs on iPhone.** iPhone Safari has historically ignored a page's `volume` on media elements (the hardware buttons own the level). The app checks at runtime: if `volume` sticks it uses it for the slider and for pause and stop fades, and otherwise it falls back as below. In the iOS 26.5 Simulator `volume` *was* settable, so the slider appeared there; a real iPhone may differ, and TESTING-WEB.md asks you to note which you see. Where it isn't settable:
- Files are rendered at the in-app maximum (0.75), and the phone's buttons set the level. The onboarding volume sample plays at the same 0.75 for calibration.
- Pause and stop can't fade on iPhone, though they do fade on desktop browsers, where volume works.
- Switching to speaker mode mid-session swaps files at the same moment, with a brief gap instead of a crossfade.
- Each session needs three files: binaural, isochronic, and no-beats. The no-beats file is the same in either mode, because the sham has no beat layer.

**Noise bed.** Swapping files is the only way to continue into the bed without a multi-hour file per bed length and condition. The Sleep file therefore ends with its normal fade-out, and the bed (one file per length: 2, 4, 8 h) fades in over the session's 120 s crossfade time. If the handoff ever failed while the phone was locked, the result would be the session simply ending, which fails safe. The Simulator showed the handoff working with the screen locked (case D).

**Scrub guard bug, found and fixed.** iPhone may show a scrubber on the lock screen for media elements. The player undoes seeks it didn't make, but the first version compared against the last reported position. While locked, Safari reports time only every few seconds and makes small seeks of its own, so in the 20-minute run the guard sent playback back about 3 s three times (the 12 missing seconds above). It now compares with the expected position (last report plus elapsed time) and ignores jumps under 10 s. A smoke test covers this.

**Streaming stalled while locked; sessions now play from memory.** Rerunning the 20-minute locked test after that fix, playback stopped for good at 4 min 57 s. The element jumped back 5 s, then never advanced, while still reporting "playing" and with JavaScript still running. Nothing failed on the server. The likeliest explanation is that Safari throttles media loading while the screen is locked, the buffer ran dry, and loading never resumed. (The small backward seeks in the first run look like the same thing, recovering that time.) For an overnight Sleep session this was the biggest risk, so playback no longer depends on the network once it starts:
- The tap starts a silent loop in the element, which keeps it unlocked for later playback.
- The app downloads the whole session file and plays it from a local blob. This takes about 1 s for rescue sessions and about 10 s for Deep Sleep over a LAN, with a progress line on the player.
- The chosen noise bed is downloaded the same way during the session.
- If a download fails, the app streams directly instead.

The cost is memory: up to 65 MB for Deep Sleep plus up to 118 MB for an 8-hour bed. A 20-minute locked rerun of this design was stopped at 9½ minutes because its sound was playing on the Mac. Up to then it was exact: 581 s of audio in 581 s, no backward jumps, well past the 5-minute stall. A full 20-minute locked run, and the noise-bed handoff from memory while locked, are untested; TESTING-WEB.md section 3 covers both on the phone.

### Encoding

- **Session files: AAC-LC, 96 kbps CBR, stereo, 48 kHz** (afconvert). I measured crosstalk through the codec on a 20-minute Sleep render: at 96 kbps the other ear's tone is 33–49 dB down; at 64 kbps and with HE-AAC it fell to −21 to −26 dB. Beat frequency, carrier, ear separation, the no-beats file and the isochronic layer are checked on the decoded files in `web/tests/audio-files.test.mjs`. Sizes: Deep Sleep is 65 MB per variant; everything together is 544 MB.
- **Noise beds: HE-AAC 32 kbps** (ffmpeg's AudioToolbox encoder). They're noise only, with no tones to protect. The 8-hour bed is 118 MB.
- **Staleness.** `renders.json` records a key computed from the session file's text and the durations of its narration segments. The browser recomputes it (cyrb53, because plain-HTTP pages don't get `crypto.subtle`), and plays any session whose key doesn't match with the live engine. The build also keys on narration file contents and the Swift engine sources, so `serve-web.sh` re-renders exactly what changed.

### Things a web page can't do, and what the app does instead

- **Headphones:** not detectable. Onboarding's headphone check (left/right tones) sets speaker mode. You can switch in the session sheet, the player, and Settings. If headphones disconnect, iOS pauses media; the player says so and suggests switching to speaker mode before pressing play.
- **Spatial Audio:** not detectable or controllable. Instructions to turn it off are always shown with headphones.
- **System volume:** not readable or cappable, so instead of a "phone volume is high" warning there's standing advice to keep it at about half.
- **Interruptions:** a call, alarm, Siri, or another app appears as a `pause` event the app didn't cause (pre-rendered) or a context leaving the `running` state (live). Both show "Paused by your phone… press play". The live engine also hard-mutes its renderer so resuming fades in from silence. The page can't see when the call ends, so it can't resume by itself.
- **Silent switch:** `navigator.audioSession.type = 'playback'` is set at load and before playback (Safari 17+). Media elements already ignore the switch.
- **Starting audio needs a tap:** every start calls `play()`, or creates and resumes the AudioContext, synchronously inside the tap handler. If Safari still refuses, the player says "Tap play to start".

### Data

- **IndexedDB for session logs** (falling back to localStorage), with the same record fields as the native `SessionRecord`. Settings are kept in localStorage. Export and delete-all cover both. Health fields are replaced by `sleep` and `heart` slots, filled by nothing yet. `web/js/app/sources.js` defines the interface for a future sleep-data source (for example a wearable). The morning check-in and the self-experiment already read those slots. Nothing Fitbit-specific was built.
- **Seven-day storage clean-up:** Safari can delete a site's storage after seven days of browsing without visiting it, but not for Home Screen web apps. The app suggests adding it to the Home Screen and exporting now and then.
- **Self-experiment:** same assignment rule, verdict threshold, and hidden-until-five-per-arm rule (ported tests). One leak specific to the web: the variant file name (`…/none.m4a`) is visible to anyone inspecting network traffic with Web Inspector. On the phone it isn't shown anywhere.

### Serving

- **`web/tools/server.py`** (Python standard library). `python3 -m http.server` doesn't support HTTP range requests, which Safari needs for `<audio>`. The server also mounts the shared folders, refuses paths outside them (and `web/.certs`, `web/tools`, `web/tests`), and sends `no-cache` with ETags so edits show at once. `serve-web.sh` runs it under `caffeinate -is`.
- **HTTPS without mkcert** (not installed, and the brief prefers tools already here): `--https` creates a local CA with `openssl`, name-constrained to `.local`, `localhost`, and private IP ranges, so a leaked key couldn't be used to impersonate public sites. OpenSSL rejects a certificate for a public name signed by it; I couldn't check iOS's enforcement of name constraints. Server certificates are valid for 397 days and are regenerated when the Mac's addresses change.
- **Service worker, HTTPS only:** network-first for the app and session files, cache-first for narration, and pre-rendered audio passed through. Offline, the Home Screen app opens with history, and sessions whose narration was played once before play with the live engine. Tested offline in headless Chrome. Over plain HTTP there's no service worker, so no offline use and no full PWA install; Add to Home Screen still works.

## First round of user testing (2026-11-12)

Feedback from listening on the Mac, and what changed. These override earlier choices where they conflict, including the brief's onboarding list (the user asked for fewer setup questions).

| Feedback | Change |
|---|---|
| Couldn't hear the volume sample at any level | Setup sounds are now ordinary audio files played like sessions: left and right ear tones, and a 25 s excerpt of a real session (voice, wind, forest, beats). The old sample was noise and beats only, 16 dB below the voice, synthesised live; with the Mac turned down it was effectively silent, and it didn't represent session loudness. |
| The guide's voice is robotic. Refer to the toon project. Keep it female | The toon project uses the same engine (Kokoro) but at almost normal speed (0.95). Stillpoint had slowed Kokoro to 0.80–0.88 for a calm delivery, and slowed Kokoro is what sounds robotic. The narration tool now synthesises sentence by sentence at natural speed and puts the calm into real pauses between sentences (`# gap:`). The main voice is `af_heart` (Kokoro's highest-rated voice) at 0.95. The soft voice is a weighted blend of `af_heart` and the breathy `af_nicole`, at 0.9, with a gentle high-shelf cut and 1.5 dB lower level (`# soft: on`). All narration was regenerated and re-verified with Whisper. A cloud voice (for example ElevenLabs) might be more natural still, but needs an account and payment; the brief prefers local tools. |
| Breathing tone too high and annoying; use a nature sound: ambient forest with wind rustles carrying the breathing | New pacer sound `wind`: band-passed pink noise whose loudness and brightness swell with the inhale and settle on the exhale, with leaves rustling at the top of each gust (gated high-passed noise), different in each ear. New ambient preset `forest`: a slowly breathing low wind bed, canopy hiss, and sparse distant birdsong (about five synthesised calls a minute, 13 dB under the bed during a call). Both are synthesised (no recordings, as the brief requires), live in the shared engine (Swift and the JavaScript port, which still match), and are selected in the session file (`"sound": "wind"`, `"ambient": "forest"`), so other sessions can use them without code. |
| Too many setup questions; keep the pre- and post-session surveys | Setup is two pages on both platforms: welcome with the safety list and "I understand", then a sound check (headphones or speaker, ear tones, volume sample). The absorption questions moved to Settings as optional. The self-experiment is on by default and explained in Settings (and on each session's start sheet). Health switches stay in Settings. Before and after ratings are unchanged. |
| From about 4 minutes, when the coherence meditation begins, the voice should soften and slow, with loving kindness | Steady Heart switches to the soft voice at `ic-b1-2` (about 4 minutes, when the eyes-closed breathing begins) through the return to normal breathing, with longer pauses. It switches back to the clear voice for the ending so the session still ends alert. |
| Also make it a sleep hypnosis track: the guided meditation, then drifting into the optimised binaural sleep track, with verbal suggestions | New session **Steady Heart for Sleep** (Sleep module, `Sessions/sleep-steady-heart.json`, script `Scripts/sleep/steady-heart-sleep.txt`). Lying down, wind-paced breathing (7.5 then 6 breaths a minute), a heart-warmth focus, then the breath guide fades and a sleep hypnosis follows the sleep brief: heaviness, a falling-leaf descent with a count from ten, explicit Cordi-style "sleep deeper" suggestions, sparser lines, and no emergence. Beats follow the Sleep timeline (10 Hz settling, glide to 6 Hz during the breathing, 3 Hz after the voice, gone by 90 minutes). The forest fades out after the voice so birdsong doesn't continue into the night. The noise bed options are the same as Deep Sleep. The voice runs about 16 minutes, slightly over the brief's 13–15, because the breathing practice comes first. |

Evidence notes for the sound changes are in `research/inner-coherence.md` and `research/sleep.md` (addenda dated 2026-11-12).
