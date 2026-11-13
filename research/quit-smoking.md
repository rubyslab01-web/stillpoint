# Research Brief: Quit Smoking

**Status: Approved 2026-11-11** (self-review against Phase 1 checklist: evidence graded ✓, user feedback with limits ✓, audio parameters with sources ✓, script design ✓, safety ✓, open questions ✓, rescue-session feature researched ✓)

---

## 1. Clinical and experimental evidence

| Finding | Source | n / effect | Grade |
|---|---|---|---|
| Hypnotherapy vs attention-matched behavioural support: no significant difference in 6-month+ abstinence | Barnes et al. 2019, Cochrane CD001008.pub3 (14 RCTs, 1,926 people) | RR 1.21 (95% CI 0.91–1.61), 6 studies, n=957 | **Weak** (low certainty). Hypnosis is roughly as good as other behavioural support, not proven better. |
| Hypnotherapy as an adjunct to other treatment | Same review | RR 2.10 (1.31–3.35), 5 studies, n=224, I²=62% | **Weak** (high risk of bias, heterogeneous), but the most relevant result for an app used *alongside* NRT/medication. |
| Hypnotherapy vs pharmacotherapy | Same review | RR 1.68 (0.88–3.20), 2 studies, n=197 | **Weak / inconclusive** |
| Hypnotherapy vs NRT in hospitalised cardiopulmonary smokers | Hasan et al. 2014, *Complement Ther Med* 22:1–8 | n=164, 4 arms; ~50% hypnosis arms vs ~16% NRT at 26 wk in press reports, but between-arm p=0.06–0.14 | **Weak** (single centre, small arms, headline overstated) |
| Self-hypnosis apps (Reveri, Finito) | Alldredge, Elkins et al. 2024, *Tobacco Use Insights* (Finito, survey n=120); Stanford Reveri trial NCT03931772 (single-arm, n=152, no published results found) | No controlled efficacy data | **Weak** (user satisfaction only). Authors state no published efficacy evaluation of a hypnosis cessation app exists. |
| ACT-based smartphone app beats guideline app | Bricker et al. 2020, *JAMA Intern Med* (iCanQuit vs QuitGuide) | n=2,415; 30-day abstinence at 12 mo 28.2% vs 21.1%; app opened 37 vs 10 times | **Strong** for acceptance-based content (willingness to feel urges without acting) delivered by app. |
| Brief audio body scan lowers desire to smoke | Cropley/Ussher et al. 2007 (n=30, 10-min body scan); Ussher et al. 2009 (n=48; body scan ≈ isometric exercise > control) | Significant reduction immediately and at 5 min; lab effect up to 30 min, real-world only ~5 min | **Moderate** for short-term craving relief (small RCTs, consistent direction) |
| Brief physical activity reduces cravings | Haasova et al. 2013, *Addiction*, IPD meta-analysis | SMD −1.91 (strength of desire, 15 studies); −2.03 (desire to smoke, 17 studies) | **Strong** for acute craving relief |
| Thought suppression causes rebound smoking | Erskine, Georgiou & Kvavilashvili 2010, *Psychol Sci* | n=85; suppression group smoked less in week 2, then rebounded ~3 more/day above baseline in week 3 | **Moderate**. Scripts must never say "don't think about cigarettes". |
| Lapses happen within minutes of craving onset | Naughton 2017 review (*Nicotine Tob Res*); EMA studies cited in Quit Sense protocol | Half of craving-driven lapses within ~11 min of onset | **Moderate**. A rescue must start within seconds and finish within minutes. |
| Combined behavioural support + pharmacotherapy is the most effective approach | Cochrane combination reviews (Hartmann-Boyce et al.), standard clinical guidance | Roughly 70–100% relative increase in quitting vs minimal support | **Strong**. The app must point people towards it. |
| Binaural beats for smoking | No trials found | None | **No evidence**. Beats are a comfort and relaxation layer only (see `awake-entrainment.md`). |

**Takeaways for design**
- Hypnosis is a legitimate behavioural support with weak but non-negative evidence. It works best framed as an add-on to NRT, varenicline, or a quitline.
- The strongest evidence for *in-the-moment* craving relief is for brief body scanning, isometric or physical movement, and acceptance or urge-surfing framing. Rescue sessions use exactly these.
- Acceptance language (notice, allow, let it pass) outperforms suppression language in both the ACT trial and the suppression-rebound data.

## 2. Large-sample user feedback

| Pattern | Source | Notes |
|---|---|---|
| Users value goal setting, progress tracking (days smoke-free, money saved), and tools to understand and manage cravings | Bendotti et al. 2022, *Nicotine Tob Res*: 1,414 reviews of 42 cessation apps | The most consistent pattern across hundreds of reviewers |
| Functionality failures and paywalls drive the most negative reviews | Bendotti 2022; review analyses of Smoke Free and Kwit | Bugs that block a feature are rated harshly |
| Engagement predicts quitting; repeat use is key | Bricker 2020 (37 vs 10 openings); Pivot trial | Short, re-usable sessions help repeat use |
| Interruptions and failed playback recovery are rated harshly in audio apps | Aggregated 1–3★ reviews of Headspace and Calm (review-analysis sites) | Handle interruptions and resume cleanly |
| Hypnosis-app users (Reveri, Finito, Andrew Johnson, Harmony) praise short daily sessions (about 10–20 min), a calm unhurried voice, and choosing between "wake up alert" and "drift off" endings. They complain about robotic voices, music louder than the voice, and repeated identical scripts. | App Store review aggregates (thousands of ratings, 4.6–4.8★ averages) | Strong survivorship bias: high averages come from people who stayed |
| On-demand craving buttons are often tried once and abandoned when they take too long to start | Quit Sense qualitative work (Hope et al. 2025) | One tap, instant start, short |
| Retention is low across the category | Baumel et al. 2019, *JMIR*: 93 apps; median 30-day retention 3.3% (4.7% for mindfulness apps) | Design for a few high-value uses, not daily streak pressure |

**Limits of user feedback:** reviewers are self-selected. Quitters who succeed write glowing reviews and attribute success to the app (expectancy, hindsight). Relapsers mostly leave silently (survivorship). Reviews tell us about *acceptability*, not efficacy.

## 3. Audio parameters

| Parameter | Choice | Evidence / reasoning |
|---|---|---|
| Entrainment method | Binaural (headphones), isochronic fallback (speaker) | Beats have no cessation evidence. Garcia-Argibay 2019 meta-analysis (22 studies, g=0.45 pooled anxiety, attention, memory, pain) suggests a modest relaxation benefit. Ingendoh 2023 found entrainment itself inconsistent (5 of 14 supportive). Used as a supporting layer only. |
| Carrier | 220 Hz | Lower carriers rated more comfortable (Schütze et al. replication of Licklider 1950); beats hard to hear above ~1 kHz. Matches the sleep module range (200–250 Hz). |
| Beat curve, main session | 10 Hz (settling) → 6 Hz (induction and deepening) → 7.5 Hz (suggestions and rehearsal) → 14 Hz (emergence, alerting) | Alpha and theta associated with relaxed absorption (weak). End in low beta to support an alert finish (requirement: awake modules end alert). |
| Beat curve, rescue | Holds 10 Hz, rises to 14 Hz in the last 30 s | Rescue is eyes-open and alert. No deep trance during a craving (the user may be outside). |
| Levels | Voice 0 dB reference; noise −14 dB; beats −32 dB (≈18 dB under noise); 6 dB voice ducking | CLAUDE.md mixing spec; users complain when background competes with voice |
| Noise | Brown noise (main), pink noise (rescue, brighter and more grounding) | Preference only, no efficacy data |
| Main session length | ≈15 min | Inside the 10–20 min range that hypnosis-app users praise most, and long enough for full induction, deepening, anchor, and rehearsal. Longer sessions have no added evidence and cost repeat use, which is what predicts quitting (Bricker 2020). |
| Rescue lengths | 2 min ("Breathe Through"), 5 min ("Ride the Wave"), 10 min ("Body Scan Reset") | 10 min matches the Ussher body-scan RCTs. 2 and 5 min fit the ~11-minute lapse window and on-demand use; craving reductions appear within minutes. |

## 4. Script design

**Main session ("Breathe Free")**, about 15 min
1. **Pre-talk (1 min):** a wellness framing; "this works best alongside your quit plan, NRT, medication, or a quitline". Sets positive expectancy without promising outcomes.
2. **Induction (4 min):** a breath focus with progressively longer exhales, eye closure, and progressive relaxation down the body.
3. **Deepening (2 min):** a staircase count from 10 down to 1, with permissive phrasing ("you may notice…").
4. **Suggestion (8 min):**
   - *Respect for the body.* A paraphrase of the core of Spiegel's single-session method: your body needs care, and you choose to protect it. The reframe is identity and protection, not fear.
   - *Identity:* "you are becoming someone who breathes free". Affirming, present tense.
   - *Urge surfing:* cravings are waves that rise, peak, and pass. You can watch one without obeying it. (Acceptance framing: ACT, Bricker 2020.)
   - *Anchor installation:* press thumb and forefinger together and take three slow breaths to return to calm. This anchor is reused in rescue sessions.
   - *Future rehearsal:* morning coffee, after meals, stress, and social drinking. The user sees themselves handling each one calmly.
5. **Ego strengthening (1.5 min):** confidence and self-efficacy.
6. **Emergence (1.5 min):** count up from 1 to 5, energy rising, eyes open, fully alert.

**Rescue sessions:** open-eyes compatible; no deep induction, countdowns, or "close your eyes" requirement.
- Breathe Through (2 min): anchor, three long exhale breaths, naming the wave, isometric hand squeeze, choice statement.
- Ride the Wave (5 min): urge surfing, locate the sensation in the body, rate it, breathe around it, watch it peak and pass, isometric option.
- Body Scan Reset (10 min): Ussher-style body scan from feet to head, with neutral attention to sensation.

**Suggestion styles that work:** permissive or indirect ("you may find…") for induction; direct, present-tense, positive statements for core suggestions; acceptance language for urges; repeated anchor phrases.

**Language to avoid:**
- Suppression commands ("don't think about smoking", "push the craving away"): rebound risk (Erskine 2010).
- Aversive or disgust imagery and fear scripts: may increase distress and isn't needed.
- Absolute promises ("you will never want a cigarette again"): sets up shame at the first craving.
- Shame or blame language around lapses. Instead: "if you slip, it's information, not failure; return to your plan".
- Medical claims.

## 5. Safety and contraindications
- Wellness only; encourage NRT, medication, quitlines, and a doctor. Withdrawal can include low mood and irritability. Varenicline and bupropion have their own monitoring requirements: talk to a clinician.
- Provide a quitline and crisis resources link (mood can dip during withdrawal).
- Hypnosis caution: psychosis, dissociative disorders, severe PTSD (consult a clinician). Never use while driving or operating machinery. Rescue sessions explicitly say "if you're driving, pull over first or use the breath alone".
- Binaural and isochronic: epilepsy and seizure caution, especially for pulsed isochronic tones. Enforce a maximum volume.
- Pregnancy: encourage medical support (NRT decisions belong to a clinician).

## 6. Open questions and conflicts
- **Research vs users on hypnosis efficacy:** users and marketing ("10× more likely") strongly favour hypnosis; Cochrane finds it no better than matched behavioural support. *Resolution:* present hypnosis as one support among several, keep claims out of the UI, and let self-experiment data show the user what helps them.
- **Beats:** users of binaural apps report feeling calmer; there are no smoking-specific data. *Resolution:* beats stay quiet and optional, and the self-experiment randomises them (some sessions are sham with no beats).
- **Rescue length:** shorter is more usable; 10 min has the best trial support. *Resolution:* offer three lengths and default the "Craving now" button to 2 min.
- **Real-world durability:** body-scan relief lasted only ~5 min outside the lab. Rescue sessions end with a concrete next action (drink water, walk, text someone) to bridge the window.
