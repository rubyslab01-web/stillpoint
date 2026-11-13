# Research Brief: Sleep

**Status: Approved 2026-11-11.** Core parameters were researched before this project and carried forward from CLAUDE.md; this brief records them, adds user-feedback and safety sections, and fixes the open details (self-review against the Phase 1 checklist: all six sections present).

## 1. Clinical and experimental evidence

| Finding | Source | n / effect | Grade |
|---|---|---|---|
| Hypnotic "sleep deeper" suggestion before a nap increased slow-wave sleep | Cordi, Schlarb & Rasch 2014, *Sleep* | n=70 young women; SWS up ~80% and wake time down ~67% in highly suggestible participants only; no benefit in low suggestibles | **Moderate** (replicated by the same group; effect confined to high suggestibles) |
| Replications in older adults and across a night | Cordi et al. 2015, 2020 | Small samples; effects strongest early in the night | **Moderate–weak** |
| Hypnosis for sleep problems generally | Chamine, Atchley & Oken 2018, *J Clin Sleep Med* systematic review | 24 studies; 58% reported benefit, 12.5% mixed, 29% none; low study quality | **Weak–moderate** |
| 3 Hz binaural beat on a 250 Hz carrier shortened latency to deep (N3) sleep and lengthened N3 | Jirakittayakorn & Wongsawat 2018, *Front Hum Neurosci* | n=24, single night | **Weak** (one small study) |
| Sequencing beat frequencies across sleep stages | Gantt 2023 | Small | **Weak** |
| Entrainment by binaural beats is inconsistent | Ingendoh et al. 2023, *PLoS One* | 5 of 14 EEG studies supportive | **Mixed / contradicted** |
| Steady pink or broadband noise as a sleep aid | Riedy et al. 2021 systematic review (38 studies) | Very low quality evidence; may mask disturbance, may also disrupt | **Weak** |

**Takeaway:** the hypnosis script is the main active ingredient, and mostly for suggestible people. Beats are a supporting layer. The noise bed is a comfort and masking feature.

## 2. Large-sample user feedback
- Sleep content is the most-used category in Calm and Headspace (Sleep Stories, sleepcasts). Aggregate reviews praise a slow, low, unhurried voice and content that *never asks anything of the listener*.
- Recurring complaints across thousands of sleep-app reviews: audio that ends abruptly or changes volume and wakes the listener; a wake-up or "open your eyes" ending in a sleep track; background louder than the voice; playback that stops when the screen locks; and no sleep timer or fade.
- Users of binaural sleep apps complain about audible tones through the night and want them to fade.
- Retention: sleep is the stickiest use case in meditation apps, but 30-day retention for the category is still only about 3–5% (Baumel et al. 2019, 93 apps).
- **Limits:** self-selected reviewers; strong expectancy effects on self-reported sleep; people who slept badly and quit rarely review.

## 3. Audio parameters

| Parameter | Choice | Source |
|---|---|---|
| Method | Binaural (headphones or sleep-band); isochronic fallback kept extra quiet | CLAUDE.md; pulsed tones are more intrusive |
| Carrier | 240 Hz (range 200–250 Hz) | Jirakittayakorn 2018 used 250 Hz; lower carriers are more comfortable |
| Timeline | 10 Hz alpha (settling) → glide to 6 Hz theta during the induction → glide to 3 Hz delta after the voice ends → beats fully faded by 90 min | CLAUDE.md; Gantt 2023; fade-out avoids interfering with the first REM period |
| Voice | ≈14 min script; whisper-soft voice at ~105 wpm | Cordi protocol (~13 min) |
| Noise | Brown noise, steady level, no changes after the voice ends | User complaints about volume changes |
| Noise bed | Optional noise-only continuation for 0, 2, 4, or 8 hours at a lower level, with a 60 s final fade | CLAUDE.md; user demand for all-night masking |
| Levels | Noise −16 dB, beats −34 dB (18 dB under), ambient drone −28 dB fading out with the voice | CLAUDE.md mix spec |

## 4. Script design
- **Structure:** settling → induction (breath, body heaviness) → deepening (descending imagery, counting down) → sleep suggestions → fade into silence. **No emergence**: the voice simply stops and the listener is left to sleep.
- **Cordi-style suggestions:** explicit "sleep deeper" language paired with a sinking image (their script used a fish swimming deeper into the sea). We use descending, sinking, and settling images, and direct phrases: "deeper and deeper", "sleep deeply", "your sleep is deep and restoring".
- **Style:** permissive, slow, progressively sparser. Sentences get shorter and pauses longer toward the end. Suggestions for carrying deep sleep through the night and for waking refreshed at the right time.
- **Avoid:** questions or tasks; anything alerting (counting up, "open your eyes"); time pressure ("you must fall asleep"), which feeds sleep effort and insomnia; startling consonant-heavy lines; bright imagery.

## 5. Safety and contraindications
- Never while driving or operating machinery.
- Keep the volume low for all-night listening (WHO guidance is under 80 dB averaged over a week; sleep listening should be far below that). The app enforces a maximum.
- Seizure-disorder caution for pulsed (isochronic) audio.
- Sleeping in earbuds can cause ear discomfort; a sleep headband or pillow speaker (isochronic mode) is gentler.
- Persistent insomnia, loud snoring, or daytime sleepiness need a clinician; CBT-I is the first-line treatment. The app is wellness, not treatment.
- Hypnosis caution for psychosis and dissociative disorders.

## 6. Open questions and conflicts
- **Suggestibility:** the benefit is concentrated in highly suggestible people. Onboarding measures suggestibility so the app can set expectations honestly.
- **Users vs research on beats:** many users swear by delta beats; EEG evidence is mixed and rests on one small study. *Resolution:* keep beats quiet, fade them by 90 min, and let the self-experiment (random nights without beats) answer it per user.
- **All-night noise:** users want it; the evidence that continuous noise helps sleep is very weak and some studies suggest disruption. *Resolution:* optional, off by default, at a reduced level.
- **Sleep-onset self-ratings are unreliable.** With permission we also read Apple Health sleep stages, noting that wearables estimate stages imperfectly.

## Addendum 2026-11-12: breathing-led sleep session

User request: a sleep version of the coherence practice. Slow paced breathing lowers physiological arousal while it is practised (see `inner-coherence.md`), and pre-sleep arousal is a main target of insomnia treatment. Evidence that a few minutes of slow breathing *before sleep* shortens sleep onset is limited to small studies, so grade it **weak**. The session therefore keeps the parts with better support, the hypnosis with explicit "sleep deeper" suggestions (Cordi et al.), and the established beat timeline. It adds the breathing as a settling routine.

- Breath guide fades out before the induction so the listener stops pacing their breath (deliberate breathing is alerting if it continues).
- Forest ambience fades after the voice; birdsong through the night would conflict with the "no changes after the voice" finding above.
