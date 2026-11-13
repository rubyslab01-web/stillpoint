# Project: Personal Hypnosis & Audio Entrainment App (iOS)

## Your role
You're building a personal iOS app that combines guided hypnosis with layered audio: binaural beats, isochronic tones, and ambient noise. It has five modules: Sleep, Quit Smoking, Gratitude, Inner Coherence, and Loving Compassion. Work in two phases. Research each module first, then build. Don't write module-specific audio parameters or scripts until that module's research brief is complete.

You work autonomously from start to finish. You approve your own research briefs and make your own design and implementation decisions. Don't stop to ask me questions or wait for approval. I will test the final build.

## Platform decisions
- Platform: iOS (native, Swift/SwiftUI)
- Voice: AI-generated narration. I won't record anything; you generate all audio.

## Tool choice
You choose the best tools for every part of the job: text-to-speech, audio processing, speech recognition for checking, Swift frameworks and packages, build and test tooling, and anything else. Any tool named in this file is a suggestion or a known-good default, not a requirement. If you find something better for the task, use it and record why in `DECISIONS.md`.
- Known-good default for narration: Kokoro text-to-speech, which runs locally on my Apple Silicon Mac and worked well in a previous project. Compare it against other options for calm, natural hypnosis delivery before committing.
- Prefer tools that run locally on my Mac and don't need accounts, API keys, or payment, since you're working without me. If a tool that needs any of these is clearly better, choose the best local option for now and note the alternative in `DECISIONS.md`.
- Prefer Apple's built-in frameworks where they do the job well, and keep third-party dependencies to those that clearly earn their place.
- Data storage: cloud sync

## Working in this project
- This file is the project brief. Re-read it at the start of each session.
- Save each research brief as a Markdown file in `research/` (for example, `research/sleep.md`).
- Before building from a brief, review it yourself against the Phase 1 requirements below. Fix any gaps, then mark it "Approved" at the top with the date.
- When something is ambiguous, choose the option best supported by the research and the requirements in this file, and keep going. Record each significant decision and your reasoning in `DECISIONS.md`.
- Keep session configuration files in their own folder, separate from engine code.
- Verify your work as you go: build with `xcodebuild`, run in the iOS Simulator, and write unit tests for the audio math (frequency ramps, phase continuity, channel separation, mixing levels, fades).
- Generate all narration yourself with the text-to-speech tool you choose, so the final build contains finished voice audio for every module, with no placeholders.
- I'll test the final build on a real iPhone with headphones. When you finish, write `TESTING.md`: a checklist of what to listen and check for on the device, especially things the simulator can't verify (binaural separation, background playback, interruptions, Health data).

## Phase 1: Research (one brief per module)

For each module, produce a research brief that covers:
1. Clinical and experimental evidence. Prioritize meta-analyses, systematic reviews, and RCTs. Grade the strength of each finding (strong, moderate, weak, contradicted). Report effect sizes and sample sizes where available.
2. Large-sample user feedback, which carries significant weight. Sources include app store reviews of comparable apps (in aggregate, not cherry-picked), large published app-usage studies, retention and engagement data, and large community discussions. Look for recurring patterns across hundreds or thousands of users, not single anecdotes.
3. Audio parameters: beat frequency, carrier tone, entrainment method, session length, and phase timeline, each with its evidence source.
4. Script design: hypnotic structure (induction, deepening, suggestion, emergence), suggestion styles that work, and language to avoid.
5. Safety and contraindications.
6. Open questions and conflicts between sources.

### How to weigh the two kinds of evidence
- Use research for what works physiologically or psychologically: frequencies, mechanisms, and efficacy claims.
- Use large-sample user feedback for what people will actually stick with: voice qualities, session length, background sounds, annoyances, drop-off points, and what makes users quit.
- When the two conflict, say so explicitly. For example, users may report loving a frequency that studies show does nothing, or the reverse. Recommend a resolution, but don't silently pick one side.
- Flag the limits of user feedback: self-selection, placebo and expectancy effects, and survivorship bias (unhappy users leave without reviewing).
- Don't present weak or contradicted evidence as established. The evidence on binaural beat entrainment is mixed overall, so treat beats as a supporting layer unless a module's research shows otherwise.

### Research leads (starting points, not conclusions)
- Quit Smoking: survey the evidence on hypnotherapy and audio interventions for smoking cessation.
- Gratitude: survey the evidence on gratitude interventions and effective session formats.
- Inner Coherence: survey the evidence on coherence-focused practices and audio or breath-guided approaches.
- Loving Compassion: survey the evidence on compassion and loving-kindness practices and effective session structures.
- All awake modules: survey the evidence on which entrainment frequencies, if any, suit awake practice.

### Requested features (include these; use research to design them well)
- Quit Smoking rescue sessions: short, on-demand sessions a user can open during a craving. Research the best length, structure, and delivery for in-the-moment use.

## Sleep module (already researched, carry forward)
- Carrier tone: 200–250 Hz, with a sine wave in each ear. The beat is the difference between left and right.
- Timeline: start with 10 Hz alpha for settling, glide to 6 Hz theta during the hypnosis induction, glide to 3 Hz delta after the voice ends, then fade the beats out by about 90 minutes so they don't interfere with REM. Optionally continue a noise-only bed through the night.
- Hypnosis: a script of about 13–15 minutes with explicit "sleep deeper" suggestions. Effects are strongest early in the night and mainly in highly suggestible people.
- Key sources: Jirakittayakorn & Wongsawat 2018 (3 Hz beat on a 250 Hz carrier shortened time to deep sleep); Cordi, Schlarb & Rasch 2014 and Cordi et al. 2020 (hypnotic suggestion increased slow-wave sleep); Gantt 2023 (sequencing frequencies across sleep stages); Ingendoh et al. 2023 (systematic review finding mixed evidence for entrainment).

## Shared architecture (build this first; it serves every module)
1. Audio engine (AVAudioEngine)
   - Generate tones in real time with AVAudioSourceNode: two oscillators, each hard-panned to one stereo channel.
   - Change the beat by ramping only one channel's frequency. Keep the waveform's phase continuous. Never jump abruptly.
   - Enable background audio so sessions keep playing with the screen locked, with lock-screen controls.
   - Handle interruptions (calls, alarms, other apps) and audio route changes (headphones connected or disconnected) gracefully, with fades rather than abrupt stops.
   - Detect headphones via the audio session route. When none are connected, or the user chooses speaker mode, fall back to isochronic tones (pulsed tones that work without headphones).
   - Turn off spatial audio and head tracking for sessions where possible, since they can blend the left and right channels and break the binaural effect. Warn the user if that can't be controlled.
   - Include pink, brown, and white noise generators plus an optional ambient layer (such as soft drones or pads). Generate or synthesize this yourself; use no licensed music or third-party recordings.
   - Mix the voice on top, the noise in the middle, and the beats about 15–20 dB under the noise. Lower the background automatically while the voice speaks, and fade every layer in and out.
2. Sessions as data. Each module's session is a configuration file (JSON), not code. It defines phases, durations, beat curves, layer volumes, and recorded script segments. Adding or adjusting a module should never require engine changes.
3. Voice (generated)
   - Generate narration at build time on the Mac with the text-to-speech tool you choose and bundle it into the app as audio files. The app itself doesn't run text-to-speech.
   - Choose the voice and speaking rate that best suit hypnosis, guided by your research on what users find calming and trustworthy. Hypnosis generally calls for a slower, softer delivery than standard narration. You can pick a different voice for awake modules if that's better supported.
   - Generate each script as separate segments, so pauses and timing are controlled by the session file rather than baked into the audio.
   - Check the generated audio for pronunciation problems, skipped or garbled words, and clipping. For example, transcribe each segment back to text with a local speech-recognition model and compare it to the script. Fix problems by rewording or adjusting the text, and regenerate.
   - Normalize loudness across segments so the voice level stays consistent.
   - Write a script that regenerates all narration from the script text files, so any line can be edited and rebuilt with one command.
4. Self-experiment mode: randomly assign some nights or sessions to run without beats, without telling the user which. Track before-and-after self-ratings for each module (e.g., time to fall asleep, craving intensity, mood, sense of calm). With permission, read relevant Apple Health data (sleep stages, heart rate, heart rate variability). Show the user which version actually works for them.
5. Onboarding: a short hypnotic suggestibility self-assessment, a headphone check, and a comfortable-volume calibration.
6. Session history and a simple progress view for each module.

## Data and privacy
- Sync with iCloud (CloudKit) using the user's private database, so data stays in the user's own iCloud account.
- Session logs, mood ratings, craving data, and Apple Health readings are sensitive. Store and sync only what's needed, request Health permissions per data type, and explain each permission in plain language.
- The app must work fully offline, syncing when a connection is available.
- Include a way to export and delete all personal data.

## Safety and honesty requirements
- Make no medical claims. Label the app as wellness, not treatment.
- Show warnings: don't use while driving or operating machinery; seizure-disorder caution; keep volume low (enforce a maximum).
- Quit Smoking must encourage combining the app with proven cessation methods and medical support, never replacing them.
- Any module that touches mood should include a visible, non-intrusive path to professional and crisis resources.
- Every awake module must end in an alert state.

## Deliverables and order of work
1. Write and self-approve the Phase 1 research briefs, one module at a time.
2. Build the shared audio engine and session format, with Sleep as the first working module.
3. Add each remaining module from its approved brief.
4. Write the scripts for every module and generate all narration.
5. Write a short README explaining how to add or adjust a module, and how to edit a script and regenerate its audio.
6. Write `TESTING.md` with the device testing checklist, and finish with a short summary of what was built and any known limitations.
