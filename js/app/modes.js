// Which beat layer to use. Browsers can't see the audio route, so instead of detecting
// headphones (as the native app does) the choice comes from the onboarding headphone check
// and the speaker-mode switch.

/** @returns {'binaural'|'isochronic'} */
export function chooseMode(settings) {
  return settings.speakerMode ? 'isochronic' : 'binaural';
}

/** Which pre-rendered file to play for a condition. The sham is the same in either mode. */
export function variantFor(mode, beatsEnabled) {
  return beatsEnabled ? mode : 'none';
}
