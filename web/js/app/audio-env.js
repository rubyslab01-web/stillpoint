// What this browser lets a page do with audio. Detected once, used by both players and the UI.

let volumeControllable = null;

/**
 * iPhone Safari has historically ignored HTMLMediaElement.volume (the hardware buttons own the level), so the
 * pre-rendered player can't fade or apply the in-app volume there. Desktop browsers can.
 */
export function canSetElementVolume() {
  if (volumeControllable === null) {
    try {
      const a = document.createElement('audio');
      a.volume = 0.5;
      volumeControllable = Math.abs(a.volume - 0.5) < 0.01;
    } catch { volumeControllable = false; }
  }
  return volumeControllable;
}

/** Keep playing when the ring/silent switch is on silent (Safari 17+). */
export function useAudioSessionPlayback() {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    return !!navigator.audioSession;
  } catch { return false; }
}

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export function setMediaSession({ title, album, onPlay, onPause, onStop }) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title, artist: 'Stillpoint', album: album ?? '',
      artwork: [192, 512].map((s) => ({ src: new URL(`icons/icon-${s}.png`, document.baseURI).href, sizes: `${s}x${s}`, type: 'image/png' })),
    });
  } catch { /* older Safari */ }
  const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ } };
  set('play', onPlay);
  set('pause', onPause);
  set('stop', onStop);
  // No scrubbing or skipping: jumping around would break the beat and phase arc.
  for (const a of ['seekto', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack']) set(a, null);
}

export function setMediaSessionState(state) {
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state; } catch { /* ignore */ }
}

export function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch { /* ignore */ }
  for (const a of ['play', 'pause', 'stop']) { try { navigator.mediaSession.setActionHandler(a, null); } catch { /* ignore */ } }
}

/** Screen Wake Lock (Safari 16.4+). Returns a release function. */
export async function keepScreenOn() {
  try {
    if (!('wakeLock' in navigator)) return null;
    let lock = await navigator.wakeLock.request('screen');
    const reacquire = async () => {
      if (document.visibilityState === 'visible' && lock?.released) {
        try { lock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
      }
    };
    document.addEventListener('visibilitychange', reacquire);
    return () => { document.removeEventListener('visibilitychange', reacquire); try { lock?.release(); } catch { /* ignore */ } };
  } catch { return null; }
}
