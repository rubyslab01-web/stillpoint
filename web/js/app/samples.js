// Setup sounds (left/right ear check and the volume sample), played as ordinary audio files
// through an <audio> element, the same path the sessions use. The first version synthesised
// them live with Web Audio and the user heard nothing on the volume page, so these are files
// made by web/tools/build-audio.mjs: the ear tones, and an excerpt of a real session (voice,
// nature sound, noise and beats) so the level you set is the level sessions play at.

import { canSetElementVolume, useAudioSessionPlayback } from './audio-env.js';
import { VolumePolicy } from './experiment.js';

export class SamplePlayer {
  constructor(base) { this.base = base; this.el = null; this.userGain = VolumePolicy.defaultGain; }

  /** Call inside a tap. `name`: 'tone-left', 'tone-right' or 'calibration'. */
  play(name, { loop = false, onEnd = null } = {}) {
    this.stop();
    useAudioSessionPlayback();
    const el = document.createElement('audio');
    el.src = `${this.base}${name}.m4a`;
    el.loop = loop;
    el.setAttribute('playsinline', '');
    el.style.display = 'none';
    document.body.appendChild(el);
    this.el = el;
    this.apply();
    el.addEventListener('ended', () => { if (this.el === el) { this.stop(); onEnd?.(); } });
    return el.play()?.catch?.(() => {});
  }

  /** The files are made at the in-app maximum (0.75); scale down where the page may. */
  apply() {
    if (this.el && canSetElementVolume()) this.el.volume = Math.min(1, this.userGain / VolumePolicy.maxGain);
  }

  setUserGain(g) { this.userGain = g; this.apply(); }

  get playing() { return !!this.el && !this.el.paused; }

  stop() {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    try { el.pause(); el.removeAttribute('src'); el.load(); el.remove(); } catch { /* ignore */ }
  }
}
