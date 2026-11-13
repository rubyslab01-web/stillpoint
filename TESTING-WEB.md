# Web port: iPhone testing checklist

For testing the browser version of Stillpoint on your iPhone in Safari, with headphones. It plays the same sessions, narration, and mix as the native app, so most of what you hear here tells you where the app itself stands. Items marked **(web only)** test the browser version itself, not the app's content.

## Known limitations (read first)

- **Lock screen: tested in the Simulator only.** In the iOS 26.5 Simulator's Safari, both playback engines kept playing through 45 seconds in the background and 45 seconds locked, and through a 20-minute lock during Deep Sleep (details in DECISIONS.md, "Web port"). A Simulator is not a phone: battery saving, memory pressure, and the real audio hardware can behave differently. Section 3 is the most important part of this list.
- **Headphones can't be detected.** You choose headphones or speaker. If headphones disconnect, iPhone pauses the session; switch to speaker mode before pressing play, or you'll hear binaural tones on the speaker.
- **Spatial Audio can't be detected or switched off** by a web page. Turn it off yourself (Control Center › touch and hold the volume slider › Spatial Audio: Off, and Head Tracking off).
- **Phone volume can't be read or capped.** With pre-rendered audio (the default), sessions play at the app's maximum level (0.75) and the volume buttons set the loudness. If Safari on your phone doesn't let a page set audio volume (iPhones historically haven't; the iOS 26.5 Simulator did), there is no in-app slider for these, and pause and stop are immediate, not faded. The app detects which.
- **After a call or alarm, press play** to continue. The native app resumes by itself.
- **Deep Sleep's noise bed** starts after the session's own fade-out, with a two-minute fade-in. The native app crossfades straight across.
- **No Apple Health and no iCloud.** History stays in Safari on this phone. Safari deletes a website's data after seven days of browsing without visiting it, unless you add it to the Home Screen.
- **The Mac must be reachable when a session starts.** Each session (and its noise bed) is downloaded into the phone's memory first: about 1 s for rescue sessions, about 10 s for Deep Sleep. After that, playback doesn't need the Mac. This is because streaming stalled during a locked test in the Simulator.

## 0. Setup

- [ ] On the Mac: `./serve-web.sh`. The first run renders any missing audio, then prints addresses such as `http://192.168.1.20:8000/`. If macOS asks whether Python may accept incoming connections, allow it.
- [ ] On the iPhone, on the same Wi-Fi: open that address in Safari. The app loads to "Welcome to Stillpoint".
- [ ] (Optional, recommended) Share › Add to Home Screen, then open Stillpoint from the Home Screen icon. It should open full-screen with the dark theme, and the status bar should not overlap the content.
- [ ] Settings › About the web version: "This browser" lists what Safari supports. Note anything marked No.

## 1. Onboarding

- [ ] "Continue" stays disabled on the safety page until you switch on "I understand".
- [ ] The five absorption questions give a result (lower, medium, or higher) with an explanation.
- [ ] **(device only)** Headphone check: "Play left ear" is heard only in the left ear, "Play right ear" only in the right. Answering No shows the swap/Spatial Audio advice.
- [ ] Choosing "Phone speaker" hides the ear test and says pulsing tones will be used.
- [ ] Volume page: the sample plays. Use the phone's volume buttons until the noise is soft, like quiet rain, with the tone barely noticeable. Note where the phone volume ended up (in steps).

## 2. Binaural beats **(device only)**

Wired headphones, or AirPods with Spatial Audio off. Start Sleep › Deep Sleep (you don't have to be in bed for this part).

- [ ] Under the noise you hear a low, steady hum that wavers ("wah-wah") about ten times a second at first.
- [ ] Remove one earbud: the wavering stops and you hear a steady tone. Put it back: the wavering returns. (AirPods may pause playback when you take one out. If so, press play and keep it out for this check.)
- [ ] Over the first few minutes the wavering slows (10 → 6 per second) with no click, jump, or sudden pitch change.
- [ ] The tone is clearly quieter than the noise.
- [ ] The voice is clear above everything, and the background dips slightly just before each line. No pumping.
- [ ] No clicks at the start or when voice lines begin and end.

## 3. Screen lock and background playback **(device only, web only)**

The key question for the web version. Use pre-rendered playback (Settings › Playback › Pre-rendered, the default).

- [ ] Start Quit Smoking › Breathe Free and lock the phone. Audio continues.
- [ ] The lock screen shows "Breathe Free" with play/pause and the app icon. Note whether a scrubber appears. If you drag it, the session should jump back to where it was (the app undoes seeks it didn't make).
- [ ] Pause from the lock screen, wait, then play. It continues from the same place. (On iPhone this is not faded.)
- [ ] Pause and play from AirPods (press the stem) and from Control Center.
- [ ] In the player, pause and play, then tap the replay button (right of play/pause). It asks first, then starts the session again from the beginning. History shows the first run as stopped.
- [ ] End a session with the stop button (it asks first). On the "How do you feel?" sheet, "Play again" restarts the same session.
- [ ] Switch to another app (not one that plays audio). Audio continues.
- [ ] **Screen auto-lock during a 20-minute session:** set Auto-Lock to 30 seconds (Settings › Display & Brightness), start Deep Sleep, and leave the phone face down for 20 minutes or more. It is still playing, the voice has finished, and the slow beat continues. Unlock: the player shows about the right time left.
- [ ] Open the app while a session plays from the lock screen: the player shows the right phase and time.

### 3a. The live engine on the lock screen **(web only)**

This decides whether the real-time engine can be relied on. Settings › Playback › Live engine, and switch off "Keep the screen on during sessions".

- [ ] Start Gratitude › Three Good Things, then lock the phone for 2 minutes. Does audio continue? Unlock: did the time advance by about 2 minutes, or did it stop?
- [ ] Repeat with a 20-minute lock during Deep Sleep.
- [ ] Optional, quick version: open `http://<Mac>:8000/lab/lock.html`, tap A, lock for a minute, unlock, and read the line "hidden … s, audio advanced … s → KEPT PLAYING / STOPPED". Do the same for B and C. Note the results.
- [ ] Switch back to Pre-rendered when done.

## 4. Silent switch **(device only)**

- [ ] With a session playing, flip the ring/silent switch to silent (or set the Action button to Silent mode). Audio continues, with both pre-rendered and live playback.
- [ ] Onboarding tones also play in silent mode. If they don't, note your iOS version; the app relies on Safari's Audio Session API for this.

## 5. Headphones disconnected **(device only)**

- [ ] Unplug or disconnect headphones mid-session. The session pauses (it must not continue on the speaker) and the player says it was paused by your phone.
- [ ] Turn on "Speaker mode" in the player, then press play. It continues with pulsing tones from the same place. (Pre-rendered: there may be a brief gap while it switches files.)
- [ ] Reconnect headphones, turn Speaker mode off, and press play if needed. The beats come back.

## 6. Calls, alarms, Siri, other audio **(device only)**

- [ ] Call the phone mid-session. The session goes quiet. After the call, the player says it was paused; press play and it continues from the same place.
- [ ] A timer or alarm mid-session: same.
- [ ] Ask Siri something mid-session: note whether it resumes by itself or needs play.
- [ ] Start music in another app. Stillpoint stops and shows as paused; it doesn't fight the other app.

## 7. Volume **(device only)**

- [ ] With phone volume at about half, the loudest part of any session is comfortable, not loud.
- [ ] The volume buttons change loudness during a session.
- [ ] Note whether the player shows an in-app volume slider for pre-rendered sessions. If it does, it should change loudness and pause should fade; if not, the player explains why.
- [ ] Live engine: the in-app slider works and tops out at a comfortable level.

## 8. Speaker mode (isochronic tones)

- [ ] With "Phone speaker" chosen before starting, the player shows "Speaker mode" and you hear a soft pulsing tone, the same from both speakers.
- [ ] The pulsing is gentle (no hard on/off edges) and quieter than the noise.
- [ ] Switching mode during a session: live engine crossfades over about 1.5 s; pre-rendered may have a brief gap. No loud click either way.

## 9. Each module

Listen to each once, start to finish, in the conditions it is meant for. These are the same checks as `TESTING.md` section 8 and 9 (voice quality), so results apply to the native app too.

**Sleep › Deep Sleep** (in bed)
- [ ] The voice is slow and soft, with pauses that get longer. It never tells you to wake; it simply stops (around 13 minutes).
- [ ] With "Noise through the night" set to 2 h: after about 90 minutes the noise fades out over a minute, then the quieter night noise fades in over two minutes and continues. **(web only)** Note whether the fade-out and fade-in woke you or felt abrupt.
- [ ] Next morning, opening the app asks how you slept.

**Quit Smoking › Breathe Free** (seated, about 14 min)
- [ ] It mentions using this alongside your quit plan, medication, or a quit line, and ends with a count from one to five. You feel fully awake.
- [ ] The module page shows "Use this with proven quitting methods" and a link to quit lines.

**Quit Smoking › rescue sessions**
- [ ] "Craving now?" on the home screen starts the 2-minute session in one tap, with sound within a second or two.
- [ ] The craving rating appears on the player while audio plays, and can be ignored.
- [ ] The 5- and 10-minute sessions work with eyes open and end with a concrete next step.

**Gratitude › Three Good Things**, **Inner Coherence › Steady Heart**, **Loving Compassion › Warm Heart**
- [ ] Each ends with you feeling alert. Note any session that leaves you groggy.
- [ ] Steady Heart: the rising and falling tone is easy to follow, about 4 seconds up and 6 down; the voice is quiet during breathing blocks.
- [ ] Each of these module pages shows "Need to talk to someone? Support and crisis lines".

## 10. Voice quality

- [ ] No mispronounced, clipped, or robotic-sounding words. Note the session and roughly when.
- [ ] Loudness is consistent from line to line and between the two voices.
- [ ] The whispery voice is intelligible at low volume.

## 11. Ratings, history, and self-experiment

- [ ] Before and after ratings are saved and appear in the module's History, with the chart showing Before (dots) and After (crosses).
- [ ] While collecting, the experiment card shows a progress bar and how many more rated sessions are needed. History does not show "Beats on/off" yet.
- [ ] On a no-beats session you may notice the tone is missing. That's expected; try not to check.
- [ ] After five rated sessions with beats and five without in one module, the card shows a verdict and History shows each session's condition.
- [ ] With Self-experiment off in Settings, every session has beats.

## 12. Data and privacy **(web only)**

- [ ] Settings › Export all my data gives you a JSON file (via the share sheet over HTTPS, or a download over HTTP) with your sessions and ratings.
- [ ] Settings › Delete all my data asks for confirmation, then History is empty and setup runs again.
- [ ] After adding to the Home Screen, history kept in the Home Screen app is separate from history in a Safari tab. That's how iOS isolates web apps.
- [ ] Turn on Airplane Mode and open the app. Over plain HTTP it won't load. Over HTTPS from the Home Screen it opens, history is there, and sessions you've played before with the live engine still play. Pre-rendered sessions need the Mac.

## 13. Safety and honesty

- [ ] Home shows "Wellness, not treatment. Don't use while driving."
- [ ] Settings › Safety lists the driving, seizure, volume, and not-medical-treatment warnings.
- [ ] Every module except Sleep links to support and crisis lines. Check the numbers are right for your country.
- [ ] Each module page has a "What the research says" card that doesn't overstate the evidence. No screen claims the app treats, cures, or diagnoses anything.

## 14. Comfort

- [ ] The player is dim enough for a dark bedroom.
- [ ] With larger text (Settings › Display & Brightness › Text Size), lists and rating buttons remain usable.
- [ ] With VoiceOver, play/pause, end, and the rating numbers are announced.

## What to send back

The results of section 3 and 3a (did each engine keep playing, and for how long), anything in section 2 that sounded wrong, your phone's iOS version, and which headphones you used.
