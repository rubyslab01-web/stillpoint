# Research Brief: Inner Coherence

**Status: Approved 2026-11-11** (self-review: all six Phase 1 sections present; evidence graded; conflicts stated).

"Coherence" here means the calm, steady state produced by slow paced breathing at about six breaths a minute, where heart rhythm and breathing synchronise (also called resonance-frequency breathing).

## 1. Clinical and experimental evidence

| Finding | Source | n / effect | Grade |
|---|---|---|---|
| HRV biofeedback (paced breathing near 0.1 Hz with feedback) reduces self-reported stress and anxiety | Goessl, Curtiss & Hofmann 2017, *Psychol Med* meta-analysis | 24 studies, n=484; between-group g=0.83; many small, unblinded studies | **Moderate** |
| HRV biofeedback and 6/min breathing improve a broad range of symptoms; biofeedback only slightly better than plain paced breathing | Lehrer et al. 2020, *Appl Psychophysiol Biofeedback* meta-analysis | Moderate pooled effects; significant heterogeneity and bias | **Moderate**. Supports paced breathing *without* a sensor. |
| HRV biofeedback reduces depressive symptoms | Pizzoli et al. 2021, *Sci Rep* | 14 RCTs, n=794; g=0.38 | **Moderate** |
| Slow-paced breathing raises vagally mediated HRV during and after practice | Laborde et al. 2022, *Neurosci Biobehav Rev* meta-analysis (223 studies) | Reliable acute increase | **Strong** for the physiological effect |
| Breathwork lowers self-reported stress | Fincham et al. 2023, *Sci Rep* meta-analysis | 12 RCTs, n=785; g=−0.35; moderate risk of bias | **Moderate** (small–medium) |
| Five minutes a day of exhale-focused breathing improved mood more than mindfulness meditation | Balban et al. 2023, *Cell Rep Med* | Remote RCT, n≈108, 1 month | **Moderate–weak** (one trial) |
| Longer exhale than inhale increases HRV more than equal or inhale-dominant ratios | Van Diest et al. 2014; Bae et al. 2021 | Small lab studies | **Weak–moderate** |
| Adding "heart-focused positive emotion" (HeartMath's coherence technique) beyond paced breathing | Mostly developer-affiliated studies | Small, rarely with active controls | **Weak**. Included as a brief, optional element only. |
| Binaural beats for HRV or coherence | No convincing trials | None | **No evidence**; supporting layer only |

**Takeaway:** the active ingredient is the breathing rate, about six breaths a minute with a slightly longer exhale. A clear audible pacer matters more than anything else in this module.

## 2. Large-sample user feedback
- Breathing-pacer apps (Breathwrk, iBreathe, Oak, The Breathing App, Apple's Breathe/Mindfulness; hundreds of thousands of ratings) are praised for simplicity: one tap, a clear cue to follow, sessions of 1–10 minutes, and working with eyes closed through sound or haptics.
- Complaints: cues that are hard to follow with eyes closed, patterns that are too slow or too deep and cause light-headedness, forced long sessions, and voices that talk over the breathing.
- **Retention is the worst of any category:** breathing-exercise apps had a median 30-day retention of 0.0% in Baumel et al. 2019. People try breathing apps and stop. Short sessions and a felt effect in the first use matter.
- HeartMath Inner Balance users (sensor-based) report that seeing a "coherence score" motivates them, but also that chasing the score creates performance pressure.
- **Limits:** self-selected reviewers; calm ratings right after slow breathing are highly expectancy-sensitive; app-store praise says nothing about lasting benefit.

## 3. Audio parameters

| Parameter | Choice | Evidence / reasoning |
|---|---|---|
| Breath pacer | 6 breaths/min: 4 s in, 6 s out (inhale fraction 0.4). A soft tone rises in pitch on the inhale and falls on the exhale. | Lehrer 2020 and Laborde 2022 (rate); Van Diest 2014 (longer exhale); users need an eyes-closed audio cue |
| Warm-up | 1 min at 7.5 breaths/min before settling to 6 | Users report strain when dropped straight into very slow breathing |
| Session length | ≈10 min, of which 6–7 min is paced breathing | Balban 2023 (5 min/day effective); Goessl 2017 protocols typically 10–20 min; retention data favours short |
| Voice | Sparse; the voice stops during breathing blocks | User complaint: talking over the breathing |
| Entrainment | Binaural 10 Hz throughout the breathing, then 14 Hz to finish; isochronic fallback kept very quiet so the pulse doesn't compete with the pacer | No coherence-specific evidence; supporting layer |
| Carrier | 220 Hz | Awake-module default; clear of the pacer's pitch range only partly, so beats are kept at −36 dB here |
| Layers | Pink noise −18 dB, pacer −12 dB (the most prominent non-voice layer), ambient −26 dB, beats −36 dB | The pacer must be easy to follow |

## 4. Script design
- **Not a deep-trance session.** Light induction only: posture, attention to the chest, and following the tone.
- **Structure:** orient (what the tone means; breathe gently, not deeply) → warm-up breathing → paced breathing block 1 (silent except the pacer) → heart-focused appreciation (attention on the centre of the chest, recall a feeling of care or appreciation; brief) → paced breathing block 2 → return to natural breathing → alert emergence.
- **Suggestion style:** simple and instructional, with permissive reassurance ("if the pace feels too slow, breathe at your own pace and rejoin when ready").
- **Avoid:** "breathe deeply" or "fill your lungs completely" (over-breathing causes dizziness and tingling); performance language ("achieve coherence", scores); long talking during breathing blocks; breath-holding instructions.

## 5. Safety and contraindications
- Slow breathing can cause light-headedness or tingling if breaths are too big. The script says to breathe gently and return to normal breathing if dizzy.
- Use caution, and medical advice, with respiratory or cardiac conditions, pregnancy, or panic disorder (focusing on breath can trigger anxiety in some people).
- Not while driving. Seizure caution for pulsed audio. Volume limit.
- Mood-related: link to professional and crisis resources.
- Ends alert, with natural breathing restored.

## 6. Open questions and conflicts
- **Individual resonance frequency** ranges from about 4.5 to 7 breaths/min; 6 is a good population default (Lehrer). Finding a personal rate needs a sensor. *Resolution:* default to 6; the rate lives in the session file and is easy to change.
- **Users vs research on scores:** users like a coherence score; the evidence says paced breathing without feedback works nearly as well, and scores add pressure. *Resolution:* no score. With Health permission, the app shows HRV trends in the self-experiment view instead.
- **HeartMath claims vs independent evidence:** the positive-emotion component has weak independent support. Kept short and optional in wording.
- **Retention:** the category's 30-day retention is near zero. Kept to 10 minutes; the brief recommends pairing it with an existing routine.

## Addendum 2026-11-12: nature sound as the breath guide

User testing: the rising and falling pacer tone was "too high pitched, comes off as annoying". This is the kind of finding the brief says large-sample and user feedback should decide (what people will stick with), and it matches recurring complaints about artificial tones in breathing apps.

- **Evidence for nature sounds:** small experiments find natural sounds aid recovery from stress compared with traffic or noise (for example Alvarsson, Wiens & Nilsson 2010, *Int J Environ Res Public Health*, n≈40, faster skin-conductance recovery). Imaging work links natural soundscapes to a more outward-focused, restful brain state (Gould van Praag et al. 2017, *Scientific Reports*, n≈17). Grade: **weak** (small samples), but consistent, and with no evidence of harm.
- **What carries the effect:** the active part of this practice is the slow breathing pace (about six breaths a minute), not the timbre of the guide. Changing the guide from a tone to wind gusts keeps the timing exactly (same breath shape and rate) and only changes the sound.
- **Resolution:** the breath guide is now wind that swells on the inhale and settles on the exhale, over a synthesised forest. The tone remains available (`"sound": "tone"`) for anyone who prefers a precise cue.
