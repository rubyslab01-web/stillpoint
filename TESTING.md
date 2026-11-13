# Device testing checklist

For testing on a real iPhone with headphones. Items marked **(device only)** cannot be checked in the Simulator or by the unit tests.

## 0. Before anything else: first run on your iPhone

The app builds cleanly for the iOS Simulator (Xcode 26.6, iPhone 17 Simulator, 2026-11-12) and launches to onboarding, but it has not yet run on a real iPhone. Do this first.

- [ ] Open `Stillpoint.xcodeproj` in Xcode, set your team, bundle identifier, and iCloud container (see README, "First run on an iPhone").
- [ ] Run the unit tests from Xcode (Product › Test) or `./run-tests.sh`. Expect 46 passing.
- [ ] Run in the Simulator: onboarding completes, all five modules appear, and a session starts and plays.
- [ ] Build and run on your iPhone.

Can't connect a cable or turn on Developer Mode? The web port plays the same sessions in Safari: see README, "Web port", and `TESTING-WEB.md`.

## 1. Onboarding

- [ ] Setup is two pages. Safety warnings appear and "Continue" stays disabled until you switch on "I understand".
- [ ] Settings › "Optional: how easily do you get absorbed?" gives a result (lower, medium, or higher) with an explanation.
- [ ] **(device only)** Headphone check: "Play left ear" is heard only in the left ear, "Play right ear" only in the right.
- [ ] With no headphones connected, the card says pulsed tones will be used.
- [ ] Volume: the sample plays; the slider changes loudness smoothly; at maximum it is still comfortable, not loud, with phone volume at about half.
- [ ] Self-experiment and the three Health switches are explained in plain language.

## 2. Binaural beats **(device only)**

Use wired headphones or AirPods with Spatial Audio off. Start Sleep › Deep Sleep.

- [ ] Under the noise you can hear a low, steady hum that gently wavers ("wah-wah") about ten times a second at the start.
- [ ] Remove one earbud: the wavering stops and you hear a steady tone. Put it back: the wavering returns. This confirms the beat is created between your ears, not in the audio.
- [ ] The left ear's pitch never changes. Only the right ear's pitch drifts as the beat slows.
- [ ] Over the first few minutes the wavering slows (10 → 6 per second) with no click, jump, or sudden pitch change.
- [ ] The tone is clearly quieter than the noise. You should be able to ignore it.
- [ ] The voice is clear above everything, and the background dips slightly just before each line and rises gently afterwards. No pumping.
- [ ] No clicks or pops at the start of the session, or when voice lines begin and end.

## 3. Spatial audio **(device only)**

With AirPods Pro, AirPods Max, or other spatial-capable headphones:

- [ ] Turn on Spatialize Stereo (Control Center › touch and hold volume). The session prep screen and the player show a yellow warning explaining how to turn it off.
- [ ] Turn it off. The warning disappears when you return to the app.
- [ ] With Head Tracking on, turn your head: if the tone shifts between ears, tracking is still active. Turn it off.

## 4. Speaker mode (isochronic tones)

- [ ] Start a session with no headphones. The player shows "Speaker mode" and you hear a soft pulsing tone, the same in both speakers.
- [ ] **(device only)** While a session plays on headphones, switch on "Use speaker mode anyway" in Settings (or before starting). The tone changes from wavering to pulsing over about a second, with no click.
- [ ] The pulsing is gentle (no hard on/off edges) and quieter than the noise.

## 5. Background playback and lock screen **(device only)**

- [ ] Start a session and lock the phone. Audio continues.
- [ ] The lock screen shows the session title with play/pause. There is no scrubber and no skip buttons.
- [ ] Pause from the lock screen: the sound fades out over about a second. Play: it fades back in from the same place.
- [ ] Pause and play from AirPods (stem press or removing an earbud) and from Control Center.
- [ ] Switch to another app. Audio continues.
- [ ] Leave Deep Sleep running with the phone locked for 20 minutes or more. It is still playing, the voice has stopped, and the slow beat continues.
- [ ] Flip the ring/silent switch to silent. Audio continues.

## 6. Interruptions **(device only)**

- [ ] Receive a phone call mid-session. The session goes quiet. After you decline or hang up, it resumes from the same place with a fade in.
- [ ] Let a timer or alarm go off mid-session. Same behaviour.
- [ ] Start music in another app. The session stops playing and shows as paused; it does not fight the other app. Return and press play: it resumes.
- [ ] Ask Siri something mid-session. The session resumes afterwards.

## 7. Headphones connected and disconnected **(device only)**

- [ ] Unplug or disconnect headphones mid-session. The session pauses (it must not continue out loud on the speaker) and the player explains why.
- [ ] Press play without reconnecting: it continues in speaker mode with pulsed tones.
- [ ] Reconnect headphones during playback: it crossfades back to binaural.
- [ ] Switch from AirPods to wired headphones mid-session. Playback continues or pauses cleanly, with no burst of noise.

## 8. Each module

Listen to each once, start to finish, in the conditions it is meant for.

**Sleep › Deep Sleep** (in bed)
- [ ] The voice is slow and soft, with pauses that get longer. It never tells you to wake or open your eyes; it simply stops (around 13 minutes).
- [ ] After the voice ends there is no jump in the noise level.
- [ ] With "Noise through the night" set to 2 h, noise continues after 90 minutes at a slightly lower level and fades out at the end.
- [ ] By 90 minutes the tone is gone (check on a night you are awake, or trust the unit test `sleepTimelineMatchesBrief`).
- [ ] Next morning, opening the app asks how you slept.

**Quit Smoking › Breathe Free** (seated, about 14 min)
- [ ] It mentions using this alongside your quit plan, medication, or a quit line.
- [ ] It ends with a count from one to five and you feel fully awake. The tone speeds up toward the end.
- [ ] The module page shows "Use this with proven quitting methods" and a link to quit lines.

**Quit Smoking › rescue sessions**
- [ ] "Craving now?" on the home screen starts the 2-minute session in one tap, with sound within a second or two.
- [ ] The craving rating appears on the player while audio is already playing, and can be ignored.
- [ ] The breathing pauses are long enough to actually breathe in and out.
- [ ] The 5-minute and 10-minute sessions work with eyes open and end with a concrete next step.

**Gratitude › Three Good Things** (about 9 min)
- [ ] The silent gaps after each prompt feel intentional (the voice says it will be quiet).
- [ ] It ends alert. Afterwards you can write one line, and it appears in History.

**Inner Coherence › Steady Heart** (about 10 min)
- [ ] The rising and falling tone is easy to follow with eyes closed: about 4 seconds up, 6 seconds down.
- [ ] The first minute is slightly faster, then it settles. The pace feels slow but not strained. If it leaves you light-headed, note it: the rate is `breathsPerMinute` in the session file.
- [ ] The voice stays quiet during the breathing blocks.
- [ ] The tone fades away before the end and you finish breathing normally and alert.

**Loving Compassion › Warm Heart** (about 12 min)
- [ ] The phrases are unhurried, with time to feel each one.
- [ ] The self-kindness section offers the option to just rest and listen.
- [ ] It ends alert.

**Every awake session**
- [ ] You feel alert at the end. If you feel groggy, note which session.

## 9. Voice quality

- [ ] No mispronounced, clipped, or robotic-sounding words. Note the session and roughly when; fix by rewording in `Scripts/` and running `./narrate.sh`.
- [ ] Loudness is consistent from line to line and between the two voices.
- [ ] The whispery voice is intelligible at low volume.

## 10. Ratings, history, and self-experiment

- [ ] Before and after ratings are saved and appear in the module's History.
- [ ] The Progress chart shows "Before" and "After" lines.
- [ ] While collecting, the experiment card shows a progress bar and how many more rated sessions are needed. History does **not** show "Beats on/off" yet.
- [ ] **(device only)** On a no-beats session you may notice the tone is absent. That is expected; try not to check.
- [ ] After five rated sessions with beats and five without in one module, the card shows a verdict and History shows each session's condition.
- [ ] With Self-experiment switched off in Settings, every session has beats.

## 11. Apple Health **(device only)**

- [ ] Each Health switch brings up Apple's permission sheet for that one data type only.
- [ ] After a Sleep session worn with an Apple Watch, the next morning's History entry shows deep sleep minutes and time to fall asleep.
- [ ] After a daytime session wearing the watch, the entry shows average heart rate (and HRV if the watch took a reading).
- [ ] With all switches off, no Health sheet ever appears and nothing is read.
- [ ] In the Health app › Sharing › Apps › Stillpoint, only the types you enabled are listed, all read-only.

## 12. Data and privacy

- [ ] Airplane mode: every session plays, and ratings save.
- [ ] **(device only)** Signed in to iCloud on two devices with the same build: a session logged on one appears on the other within a few minutes.
- [ ] Settings › Export all my data produces a JSON file containing your sessions and ratings.
- [ ] Settings › Delete all my data asks for confirmation, then History is empty and onboarding runs again. On a second device the records disappear after sync.

## 13. Safety and honesty

- [ ] Home shows "Wellness, not treatment. Don't use while driving."
- [ ] Settings › Safety lists the driving, seizure, volume, and not-medical-treatment warnings.
- [ ] Every module except Sleep has a visible link to support and crisis lines. Check the numbers are right for your country.
- [ ] Each module page has a "What the research says" card that doesn't overstate the evidence.
- [ ] No screen claims the app treats, cures, or diagnoses anything.

## 14. Accessibility and comfort

- [ ] With VoiceOver on, the player's play/pause, end, and volume controls are labelled.
- [ ] With larger text sizes, session lists and rating buttons remain usable.
- [ ] The player screen is dim enough to use in a dark bedroom.
