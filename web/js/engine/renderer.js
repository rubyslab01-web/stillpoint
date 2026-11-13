// Port of EntrainmentKit/Render/SessionRenderer.swift. One instance renders one session.
// Mix (top to bottom): voice (0 dB ref) > noise > ambient > pacer > beats (~18 dB under noise).
// Background layers duck while the voice speaks, starting `ducking.leadSeconds` early.
// Master = session fade x pause fade x user volume, then a soft clip as a last-resort safety.

import {
  Decibels, BinauralOscillator, IsochronicOscillator, NoiseGenerator, AmbientGenerator, BreathPacer,
} from './dsp.js';

const f32 = Math.fround;
const K08 = f32(0.8), K02 = f32(0.2);

export const BeatMode = Object.freeze({ binaural: 0, isochronic: 1 });

/** Transparent below 0.8; smoothly saturates above so nothing ever hard-clips. */
export function softClip(x) {
  const a = Math.abs(x);
  if (a <= K08) return x;
  const over = f32(f32(a - K08) / K02);
  const y = f32(K08 + f32(K02 * f32(Math.tanh(over))));
  return x < 0 ? -y : y;
}

/** Holds every narration segment in memory (tests, offline rendering). */
export class InMemoryVoice {
  /** @param {(Float32Array|null)[]} segments one per timeline voice placement */
  constructor(segments) { this.segments = segments; }
  samples(i) { return this.segments[i] ?? null; }
}

/** Slot table filled by the loader just ahead of the playhead and emptied after playing. */
export class SlotVoice {
  constructor(count) { this.slots = new Array(count).fill(null); }
  install(i, samples) { if (i >= 0 && i < this.slots.length) this.slots[i] = samples; }
  evict(i) { if (i >= 0 && i < this.slots.length) this.slots[i] = null; }
  isLoaded(i) { return this.slots[i] !== null; }
  samples(i) { return this.slots[i] ?? null; }
}

const onePole = (seconds, sr) => (seconds <= 0 ? 1 : 1 - Math.exp(-1 / (seconds * sr)));

export class SessionRenderer {
  /**
   * @param {import('./session.js').ResolvedTimeline} timeline
   * @param {number} sampleRate
   * @param {{samples(i:number): Float32Array|null}|null} voice
   */
  constructor(timeline, sampleRate, voice, {
    mode = BeatMode.binaural, beatsEnabled = true, userGain = 1.0, pauseFadeSeconds = 1.2, modeCrossfadeSeconds = 1.5,
  } = {}) {
    this.timeline = timeline;
    this.sampleRate = sampleRate;
    this.voice = voice;
    this.beatsEnabled = beatsEnabled;

    this.frame = 0;
    this.binaural = new BinauralOscillator();
    this.iso = new IsochronicOscillator();
    this.noiseL = new NoiseGenerator(timeline.noise, 0xa11ce);
    this.noiseR = new NoiseGenerator(timeline.noise, 0xb0b5);
    this.ambient = timeline.ambient ? new AmbientGenerator(timeline.ambient) : null;
    this.pacer = new BreathPacer();
    this.beatCur = timeline.beatHz.cursor();
    this.beatsCur = timeline.beatsDb.cursor();
    this.noiseCur = timeline.noiseDb.cursor();
    this.ambCur = timeline.ambientDb.cursor();
    this.pacCur = timeline.pacerDb.cursor();
    this.voiceIndex = 0;
    this.lastUnderrunIndex = -1;
    this.underruns = 0;
    this.voiceStartFrames = timeline.voice.map((v) => Math.round(v.start * sampleRate));
    this.voiceEndFrames = timeline.voice.map((v) => Math.round(v.end * sampleRate));
    this.activityIndex = 0;
    this.pacerIndex = 0;
    this.duck = 0;
    this.modeMix = mode === BeatMode.isochronic ? 1 : 0;
    this.userGain = userGain;
    this.pauseGain = 1;
    this.duckAttackCoef = onePole(timeline.ducking.attackSeconds, sampleRate);
    this.duckReleaseCoef = onePole(timeline.ducking.releaseSeconds, sampleRate);
    this.smoothCoef = onePole(0.05, sampleRate);
    this.pauseStep = 1 / Math.max(1, pauseFadeSeconds * sampleRate);
    this.modeStep = 1 / Math.max(1, modeCrossfadeSeconds * sampleRate);
    this.isoGain = Decibels.toGain(timeline.isochronicOffsetDb);
    this.duckDepth = timeline.ducking.amountDb;

    // Control values (set by the host between render calls).
    this.targetMode = mode;
    this.targetUserGain = userGain;
    this.paused = false;
  }

  setMode(m) { this.targetMode = m; }
  get mode() { return this.targetMode; }
  setUserGain(g) { this.targetUserGain = Math.min(Math.max(g, 0), 1); }
  /** Fades out (~1.2 s) then holds the playhead; resuming fades back in from the same spot. */
  setPaused(p) { this.paused = p; }
  /** Silences at once (used before resuming a context the OS suspended), so resume fades in. */
  hardPause() { this.paused = true; this.pauseGain = 0; }
  get currentTime() { return this.frame / this.sampleRate; }
  get isFinished() { return this.currentTime >= this.timeline.totalDuration; }
  get isSilentlyPaused() { return this.paused && this.pauseGain === 0; }

  /** Session-level fade (raised cosine in and out). */
  sessionFade(t) {
    const tl = this.timeline, total = tl.totalDuration;
    if (t < 0 || t >= total) return 0;
    let g = 1.0;
    if (tl.fadeIn > 0 && t < tl.fadeIn) g *= 0.5 - 0.5 * Math.cos(Math.PI * t / tl.fadeIn);
    const remaining = total - t;
    if (tl.fadeOut > 0 && remaining < tl.fadeOut) g *= 0.5 - 0.5 * Math.cos(Math.PI * remaining / tl.fadeOut);
    return g;
  }

  /**
   * Renders `frames` stereo samples into left/right starting at `offset`.
   * @param {Float32Array} left @param {Float32Array} right
   */
  render(left, right, frames, offset = 0) {
    const targetMode = this.targetMode;
    const targetUser = this.targetUserGain;
    const paused = this.paused;
    const sr = this.sampleRate;
    const tl = this.timeline;
    const total = tl.totalDuration;
    const carrier = tl.carrierHz;
    const activity = tl.voiceActivity;
    const nVoice = tl.voice.length;
    const pacers = tl.pacers;
    const beatsEnabled = this.beatsEnabled;
    const bin = this.binaural, iso = this.iso, amb = this.ambient;

    for (let k = 0; k < frames; k++) {
      const i = offset + k;
      if (paused) this.pauseGain = Math.max(0, this.pauseGain - this.pauseStep);
      else this.pauseGain = Math.min(1, this.pauseGain + this.pauseStep);
      if (paused && this.pauseGain === 0) { left[i] = 0; right[i] = 0; continue; }
      const frame = this.frame;
      const t = frame / sr;
      if (t >= total) { left[i] = 0; right[i] = 0; continue; }

      this.userGain += (targetUser - this.userGain) * this.smoothCoef;
      if (this.modeMix < targetMode) this.modeMix = Math.min(targetMode, this.modeMix + this.modeStep);
      else if (this.modeMix > targetMode) this.modeMix = Math.max(targetMode, this.modeMix - this.modeStep);

      // Ducking: voice-activity target with separate attack and release.
      while (this.activityIndex < activity.length && activity[this.activityIndex][1] < t) this.activityIndex++;
      const act = this.activityIndex < activity.length
        && t >= activity[this.activityIndex][0] && t <= activity[this.activityIndex][1];
      const duckTarget = act ? 1.0 : 0.0;
      this.duck += (duckTarget - this.duck) * (duckTarget > this.duck ? this.duckAttackCoef : this.duckReleaseCoef);
      const bgGain = Decibels.toGain(-this.duckDepth * this.duck);

      // Beats
      const beatHz = this.beatCur.value(t);
      let bl = 0, br = 0;
      const beatGain = beatsEnabled ? Decibels.toGain(this.beatsCur.value(t)) : 0;
      bin.next(carrier, beatHz, sr);
      const im = iso.next(carrier, beatHz, sr);
      if (beatGain > 0) {
        const bm = f32(1 - this.modeMix), imix = f32(this.modeMix * this.isoGain), bg = f32(beatGain);
        const isoPart = f32(im * imix);
        bl = f32(f32(f32(bin.l * bm) + isoPart) * bg);
        br = f32(f32(f32(bin.r * bm) + isoPart) * bg);
      }

      // Noise
      const nGain = f32(Decibels.toGain(this.noiseCur.value(t)));
      const nl = f32(this.noiseL.next() * nGain), nr = f32(this.noiseR.next() * nGain);

      // Ambient
      let al = 0, ar = 0;
      if (amb !== null) {
        const aGain = f32(Decibels.toGain(this.ambCur.value(t)));
        amb.next(sr);
        al = f32(amb.l * aGain); ar = f32(amb.r * aGain);
      }

      // Breath pacer
      let pl = 0, pr = 0;
      while (this.pacerIndex < pacers.length && pacers[this.pacerIndex].end <= t) this.pacerIndex++;
      if (this.pacerIndex < pacers.length && t >= pacers[this.pacerIndex].start) {
        const pGain = Decibels.toGain(this.pacCur.value(t));
        this.pacer.nextStereo(pacers[this.pacerIndex].settings, sr);
        if (pGain > 0) { const pg = f32(pGain); pl = f32(this.pacer.l * pg); pr = f32(this.pacer.r * pg); }
      }

      // Voice
      let v = 0;
      while (this.voiceIndex < nVoice && this.voiceEndFrames[this.voiceIndex] <= frame) this.voiceIndex++;
      if (this.voiceIndex < nVoice && frame >= this.voiceStartFrames[this.voiceIndex]) {
        const idx = frame - this.voiceStartFrames[this.voiceIndex];
        const buf = this.voice ? this.voice.samples(this.voiceIndex) : null;
        if (buf) {
          if (idx < buf.length) v = buf[idx];
        } else if (this.lastUnderrunIndex !== this.voiceIndex) {
          this.lastUnderrunIndex = this.voiceIndex;
          this.underruns++;
        }
      }

      const master = f32(this.sessionFade(t) * this.pauseGain * this.userGain);
      const bg = f32(bgGain);
      const mixL = f32(f32(f32(f32(f32(bl + nl) + al) + pl) * bg) + v);
      const mixR = f32(f32(f32(f32(f32(br + nr) + ar) + pr) * bg) + v);
      left[i] = softClip(f32(mixL * master));
      right[i] = softClip(f32(mixR * master));
      this.frame = frame + 1;
    }
  }
}
