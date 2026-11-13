// Port of EntrainmentKit's DSP (Math/ and DSP/ folders). Every generator mirrors the Swift code
// line for line, including where Swift converts Double to Float, so the web renderer's output
// matches the native renderer to within float rounding (checked in tests/parity).
//
// Runs in the browser main thread, inside the AudioWorklet, and in Node (tests, bed rendering).

const f32 = Math.fround;
const TWO_PI = 2 * Math.PI;

export const GeneratorLevel = Object.freeze({ referenceRMS: 0.16 });

export const Decibels = Object.freeze({
  silenceFloorDb: -90,
  toGain(db) { return db <= -90 ? 0 : Math.pow(10, db / 20); },
  fromGain(g) { return g <= 0 ? -Infinity : 20 * Math.log10(g); },
  /** RMS of samples in dB (full-scale sine = -3 dB). */
  rmsDb(samples, from = 0, to = samples.length) {
    if (to <= from) return -Infinity;
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    return Decibels.fromGain(Math.sqrt(sum / (to - from)));
  },
});

// ---------------------------------------------------------------------------------------------
// Envelope: keyframes evaluated by time. `shape` belongs to the segment ending at that point.

export class Envelope {
  /** @param {{time:number,value:number,shape?:'linear'|'smooth'}[]} points */
  constructor(points) {
    // Array.prototype.sort is stable, which keeps author order for equal times (deliberate steps).
    this.points = points.map((p) => ({ time: p.time, value: p.value, shape: p.shape ?? 'smooth' }))
      .sort((a, b) => a.time - b.time);
  }
  static constant(v) { return new Envelope([{ time: 0, value: v }]); }

  static interpolate(a, b, t) {
    const span = b.time - a.time;
    if (!(span > 0)) return b.value;
    let x = (t - a.time) / span;
    x = Math.min(Math.max(x, 0), 1);
    if (b.shape === 'smooth') x = 0.5 - 0.5 * Math.cos(Math.PI * x);
    return a.value + (b.value - a.value) * x;
  }

  value(t) {
    const pts = this.points;
    if (pts.length === 0) return 0;
    if (t <= pts[0].time) return pts[0].value;
    const last = pts[pts.length - 1];
    if (!(t < last.time)) return last.value;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].time <= t) lo = mid; else hi = mid;
    }
    return Envelope.interpolate(pts[lo], pts[hi], t);
  }

  cursor() { return new EnvelopeCursor(this); }
}

/** Amortised O(1) evaluation for increasing time; re-seeks if time goes backwards. */
export class EnvelopeCursor {
  constructor(env) { this.pts = env.points; this.index = 0; }
  value(t) {
    const pts = this.pts, n = pts.length;
    if (n === 0) return 0;
    if (t <= pts[0].time) { this.index = 0; return pts[0].value; }
    if (this.index >= n - 1 || t < pts[this.index].time) this.index = 0;
    while (this.index < n - 1 && pts[this.index + 1].time <= t) this.index++;
    if (this.index >= n - 1) return pts[n - 1].value;
    return Envelope.interpolate(pts[this.index], pts[this.index + 1], t);
  }
}

// ---------------------------------------------------------------------------------------------
// Oscillators

/** Phase in cycles (0..<1). Only the increment changes with frequency, so glides never click. */
export class PhaseAccumulator {
  constructor(phase = 0) { this.phase = phase; }
  advance(frequency, sampleRate) {
    const current = this.phase;
    let p = this.phase + frequency / sampleRate;
    p -= Math.floor(p);
    this.phase = p;
    return current;
  }
}

const BIN_AMP = f32(GeneratorLevel.referenceRMS * Math.SQRT2);
const ISO_AMP = f32(GeneratorLevel.referenceRMS * Math.SQRT2 * Math.sqrt(8 / 3));

/** Left = carrier, right = carrier + beat. Only the right ear's frequency ever moves. */
export class BinauralOscillator {
  static amplitude = BIN_AMP;
  constructor() { this.left = new PhaseAccumulator(); this.right = new PhaseAccumulator(); this.l = 0; this.r = 0; }
  /** Writes this.l / this.r (avoids allocating a tuple per sample). */
  next(carrier, beat, sampleRate) {
    const pl = this.left.advance(carrier, sampleRate);
    const pr = this.right.advance(carrier + beat, sampleRate);
    this.l = f32(f32(Math.sin(TWO_PI * pl)) * BIN_AMP);
    this.r = f32(f32(Math.sin(TWO_PI * pr)) * BIN_AMP);
  }
}

/** One carrier pulsed at the beat rate with a raised-cosine envelope; identical in both ears. */
export class IsochronicOscillator {
  static amplitude = ISO_AMP;
  constructor() { this.carrierPhase = new PhaseAccumulator(); this.pulsePhase = new PhaseAccumulator(); }
  next(carrier, beat, sampleRate) {
    const pc = this.carrierPhase.advance(carrier, sampleRate);
    const pp = this.pulsePhase.advance(beat, sampleRate);
    const env = 0.5 - 0.5 * Math.cos(TWO_PI * pp);
    return f32(f32(Math.sin(TWO_PI * pc) * env) * ISO_AMP);
  }
}

// ---------------------------------------------------------------------------------------------
// Noise. xorshift64* on two uint32 halves so it is exact (same sequence as Swift's UInt64) and
// fast enough for the audio thread (BigInt would be too slow).

/** 32x32 -> 64-bit unsigned multiply, returned as [hi, lo]. */
function mul32(a, b) {
  const a0 = a & 0xffff, a1 = a >>> 16, b0 = b & 0xffff, b1 = b >>> 16;
  const p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  const lo = ((mid & 0xffff) << 16 | (p00 & 0xffff)) >>> 0;
  const hi = (p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16)) >>> 0;
  return [hi, lo];
}
const MUL_HI = 0x2545f491, MUL_LO = 0x4f6cdd1d; // 2685821657736338717
const TWO_52 = 4503599627370496;

export class FastRandom {
  /** @param {number|bigint} seed */
  constructor(seed = 0x9e3779b97f4a7c15n) {
    let s = BigInt(seed) & 0xffffffffffffffffn;
    if (s === 0n) s = 0x12345678n;
    this.hi = Number(s >> 32n) >>> 0;
    this.lo = Number(s & 0xffffffffn) >>> 0;
  }
  /** Uniform in [-1, 1). */
  nextBipolar() {
    let hi = this.hi, lo = this.lo;
    // state ^= state >> 12
    lo = (lo ^ ((lo >>> 12) | (hi << 20))) >>> 0; hi = (hi ^ (hi >>> 12)) >>> 0;
    // state ^= state << 25
    hi = (hi ^ ((hi << 25) | (lo >>> 7))) >>> 0; lo = (lo ^ (lo << 25)) >>> 0;
    // state ^= state >> 27
    lo = (lo ^ ((lo >>> 27) | (hi << 5))) >>> 0; hi = (hi ^ (hi >>> 27)) >>> 0;
    this.hi = hi; this.lo = lo;
    // x = state &* C  (mod 2^64)
    const [ph, pl] = mul32(lo, MUL_LO);
    const xhi = (ph + Math.imul(hi, MUL_LO) + Math.imul(lo, MUL_HI)) >>> 0;
    const xlo = pl;
    // Double(x >> 11) / 2^52 - 1
    return (xhi * 2097152 + (xlo >>> 11)) / TWO_52 - 1.0;
  }
}

const WHITE_SCALE = Math.sqrt(3);
const PINK_SCALE = 0.5618;
const BROWN_SCALE = 17.41;

export class NoiseGenerator {
  /** @param {'white'|'pink'|'brown'} color */
  constructor(color, seed) {
    this.color = color;
    this.rng = new FastRandom(seed);
    this.b0 = 0; this.b1 = 0; this.b2 = 0; this.b3 = 0; this.b4 = 0; this.b5 = 0; this.b6 = 0;
    this.brown = 0;
  }
  next() {
    const white = this.rng.nextBipolar();
    let unit;
    switch (this.color) {
      case 'white':
        unit = white * WHITE_SCALE; break;
      case 'pink': {
        this.b0 = 0.99886 * this.b0 + white * 0.0555179;
        this.b1 = 0.99332 * this.b1 + white * 0.0750759;
        this.b2 = 0.96900 * this.b2 + white * 0.1538520;
        this.b3 = 0.86650 * this.b3 + white * 0.3104856;
        this.b4 = 0.55000 * this.b4 + white * 0.5329522;
        this.b5 = -0.7616 * this.b5 - white * 0.0168980;
        const pink = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362;
        this.b6 = white * 0.115926;
        unit = pink * PINK_SCALE; break;
      }
      case 'brown':
        this.brown = (this.brown + 0.02 * white) / 1.02;
        unit = this.brown * BROWN_SCALE; break;
      default: throw new Error(`unknown noise colour ${this.color}`);
    }
    return f32(unit * GeneratorLevel.referenceRMS);
  }
}

// ---------------------------------------------------------------------------------------------
// Ambient pad: slowly breathing sine partials, detuned 0.15 Hz between ears.

export const AmbientPresets = Object.freeze({
  warmPad: [
    [73.42, 1.0, 0.043, 0.0], [110.0, 0.8, 0.057, 0.3], [146.83, 0.55, 0.071, 0.6],
    [185.0, 0.35, 0.037, 0.15], [293.66, 0.18, 0.089, 0.8],
  ],
  deepDrone: [
    [55.0, 1.0, 0.031, 0.0], [82.41, 0.6, 0.047, 0.4], [110.0, 0.4, 0.023, 0.7], [164.81, 0.15, 0.061, 0.2],
  ],
  glow: [
    [146.83, 0.9, 0.05, 0.0], [293.66, 0.6, 0.067, 0.5], [329.63, 0.45, 0.041, 0.25],
    [440.0, 0.3, 0.083, 0.75], [587.33, 0.12, 0.029, 0.1],
  ],
});

export class AmbientGenerator {
  static detune = 0.15;
  constructor(preset) {
    this.forest = preset === 'forest' ? new ForestGenerator() : null;
    const parts = this.forest ? [] : AmbientPresets[preset];
    if (!parts) throw new Error(`unknown ambient preset ${preset}`);
    this.preset = preset;
    this.freqs = parts.map((p) => p[0]);
    this.gains = parts.map((p) => p[1]);
    this.lfoRates = parts.map((p) => p[2]);
    this.lfoPhases = parts.map((p) => p[3]);
    this.phasesL = parts.map(() => 0);
    this.phasesR = parts.map(() => 0.25);
    let ms = 0;
    for (const g of this.gains) ms += g * g * 0.5 * 0.61;
    this.norm = ms > 0 ? GeneratorLevel.referenceRMS / Math.sqrt(ms) : 1;
    this.l = 0; this.r = 0;
  }
  next(sampleRate) {
    if (this.forest) { this.forest.next(sampleRate); this.l = this.forest.l; this.r = this.forest.r; return; }
    let l = 0, r = 0;
    const n = this.freqs.length;
    for (let i = 0; i < n; i++) {
      const lfo = 0.775 + 0.225 * Math.sin(TWO_PI * this.lfoPhases[i]);
      l += Math.sin(TWO_PI * this.phasesL[i]) * this.gains[i] * lfo;
      r += Math.sin(TWO_PI * this.phasesR[i]) * this.gains[i] * lfo;
      this.phasesL[i] += this.freqs[i] / sampleRate;
      this.phasesR[i] += (this.freqs[i] + AmbientGenerator.detune) / sampleRate;
      this.lfoPhases[i] += this.lfoRates[i] / sampleRate;
      if (this.phasesL[i] >= 1) this.phasesL[i] -= 1;
      if (this.phasesR[i] >= 1) this.phasesR[i] -= 1;
      if (this.lfoPhases[i] >= 1) this.lfoPhases[i] -= 1;
    }
    this.l = f32(l * this.norm);
    this.r = f32(r * this.norm);
  }
}

// ---------------------------------------------------------------------------------------------
// Breath pacer: a soft tone that rises and swells on the inhale, falls and fades on the exhale.

const PACER_AMP = f32(GeneratorLevel.referenceRMS * Math.SQRT2 * 1.4);

export class BreathPacer {
  static amplitude = PACER_AMP;
  static defaults = { breathsPerMinute: 6, inhaleFraction: 0.4, lowHz: 174.61, highHz: 261.63 };
  constructor() { this.tone = new PhaseAccumulator(); this.cyclePos = 0; this.wind = null; this.l = 0; this.r = 0; }

  static shape(x, f) {
    if (x < f) {
      const p = x / f;
      const s = 0.5 - 0.5 * Math.cos(Math.PI * p);
      return { pitch: s, amp: Math.sin(Math.PI * p) * 0.6 + s * 0.4, inhaling: true };
    }
    const p = (x - f) / (1 - f);
    const s = 0.5 + 0.5 * Math.cos(Math.PI * p);
    return { pitch: s, amp: s * Math.sin(Math.PI * Math.min(1, p + 0.5)) * 0.6 + s * 0.4, inhaling: false };
  }

  next(s, sampleRate) {
    const { pitch, amp } = BreathPacer.shape(this.cyclePos, s.inhaleFraction);
    const freq = s.lowHz * Math.pow(s.highHz / s.lowHz, pitch);
    const ph = this.tone.advance(freq, sampleRate);
    const v = Math.sin(TWO_PI * ph) + 0.18 * Math.sin(2 * TWO_PI * ph);
    this.cyclePos += s.breathsPerMinute / 60 / sampleRate;
    if (this.cyclePos >= 1) this.cyclePos -= 1;
    return f32(f32(v * amp) * PACER_AMP);
  }

  /** Stereo version: the tone is the same in both ears; wind has its own noise per ear. */
  nextStereo(s, sampleRate) {
    if (s.sound === 'wind') {
      const { pitch, amp } = BreathPacer.shape(this.cyclePos, s.inhaleFraction);
      this.wind ??= new WindVoice();
      this.wind.next(pitch, amp, sampleRate);
      this.cyclePos += s.breathsPerMinute / 60 / sampleRate;
      if (this.cyclePos >= 1) this.cyclePos -= 1;
      this.l = this.wind.l; this.r = this.wind.r;
      return;
    }
    const v = this.next(s, sampleRate);
    this.l = v; this.r = v;
  }
}

// ---------------------------------------------------------------------------------------------
// Nature sounds (added after user testing: the breath tone was too high and annoying).
// Everything is synthesised from the deterministic noise generators above; no recordings.

/** Topology-preserving state-variable filter (Zavalishin/Simper); stable under modulation. */
export class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; }
  /** Returns the band-pass output for input x with cutoff fc (Hz) and damping k = 1/Q. */
  bandpass(x, fc, k, sampleRate) {
    const g = Math.tan(Math.PI * fc / sampleRate);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return v1;
  }
}

/**
 * Breath guide as wind: a gust rises with the inhale (louder, brighter) and dies away on the
 * exhale, with leaves rustling at the top of each gust. Stereo (independent noise per ear).
 * Scaled so its RMS at the top of a gust is close to the old tone's (reference x 1.4).
 */
export class WindVoice {
  static windScale = 3.0;     // brings band-passed pink noise to unit RMS (measured 0.333)
  static rustleScale = 6.8;   // leaves at 0.35 of the wind's RMS at full gust (measured)
  static level = GeneratorLevel.referenceRMS * 1.4;
  constructor() {
    this.nl = new NoiseGenerator('pink', 0x57494e44n); this.nr = new NoiseGenerator('pink', 0x57494e45n);
    this.wl = new FastRandom(0x5255534cn); this.wr = new FastRandom(0x5255534dn);
    this.flutterRng = new FastRandom(0x464c5554n);
    this.svfL = new SVF(); this.svfR = new SVF();
    this.hpL = 0; this.hpR = 0; this.xL = 0; this.xR = 0;
    this.flutter = 0; this.flutterTarget = 0; this.flutterCount = 0;
    this.l = 0; this.r = 0;
  }
  next(pitch, amp, sampleRate) {
    const fc = 280 * Math.pow(1100 / 280, pitch);
    const k = 1 / 0.9;
    const gust = 0.12 + 0.88 * amp;
    const ref = GeneratorLevel.referenceRMS;
    const bl = this.svfL.bandpass(this.nl.next() / ref, fc, k, sampleRate);
    const br = this.svfR.bandpass(this.nr.next() / ref, fc, k, sampleRate);
    // Leaves: high-passed white noise, gated by a slowly wandering random "flutter".
    if (this.flutterCount <= 0) {
      this.flutterTarget = 0.5 + 0.5 * this.flutterRng.nextBipolar();
      this.flutterCount = Math.floor(sampleRate / 14);
    }
    this.flutterCount--;
    this.flutter += (this.flutterTarget - this.flutter) * (1 - Math.exp(-1 / (0.02 * sampleRate)));
    const a = 1 / (1 + 2 * Math.PI * 2500 / sampleRate);
    const wl = this.wl.nextBipolar(), wr = this.wr.nextBipolar();
    this.hpL = a * (this.hpL + wl - this.xL); this.xL = wl;
    this.hpR = a * (this.hpR + wr - this.xR); this.xR = wr;
    const f3 = this.flutter * this.flutter * this.flutter;
    const leaves = f3 * Math.pow(amp, 1.5) * 0.35;
    const lev = WindVoice.level;
    this.l = Math.fround((bl * WindVoice.windScale * gust + this.hpL * WindVoice.rustleScale * leaves) * lev);
    this.r = Math.fround((br * WindVoice.windScale * gust + this.hpR * WindVoice.rustleScale * leaves) * lev);
  }
}

/**
 * Forest ambience: a slowly breathing low wind bed, a soft canopy hiss, and sparse distant
 * birdsong (synthesised calls: short tweets, a gliding whistle, a trill), panned at random.
 */
export class ForestGenerator {
  static bedScale = 1.31;     // overall normalisation to the reference RMS (measured)
  constructor() {
    this.bl = new NoiseGenerator('brown', 0x464f5231n); this.br = new NoiseGenerator('brown', 0x464f5232n);
    this.cl = new NoiseGenerator('pink', 0x43414e31n); this.cr = new NoiseGenerator('pink', 0x43414e32n);
    this.svfL = new SVF(); this.svfR = new SVF();
    this.lfoA = 0; this.lfoB = 0.3; this.lfoC = 0.6;
    this.rng = new FastRandom(0xb1bdn);
    this.n = 0;
    this.nextCall = 0;
    this.call = null;
    this.birdPhase = 0;
    this.l = 0; this.r = 0;
  }
  scheduleNext(sampleRate, after) {
    this.nextCall = after + Math.floor(sampleRate * (5 + 13 * (0.5 + 0.5 * this.rng.nextBipolar())));
  }
  /** Builds one bird call: a list of notes relative to the call's start. */
  makeCall(sampleRate) {
    const r = () => 0.5 + 0.5 * this.rng.nextBipolar(); // 0..1
    const kind = Math.floor(r() * 3);
    const notes = [];
    let t = 0;
    if (kind === 0) { // a few rising tweets
      const n = 2 + Math.floor(r() * 3), base = 2900 + 900 * r();
      for (let i = 0; i < n; i++) {
        const len = 0.07 + 0.05 * r();
        notes.push({ start: t, len, f0: base, f1: base + 700 + 500 * r(), vib: 0 });
        t += len + 0.06 + 0.05 * r();
      }
    } else if (kind === 1) { // one soft gliding whistle
      const base = 2000 + 600 * r();
      notes.push({ start: 0, len: 0.45 + 0.25 * r(), f0: base, f1: base + 300 + 300 * r(), vib: 35 });
      if (r() > 0.5) notes.push({ start: 0.8, len: 0.35, f0: base + 200, f1: base - 150, vib: 30 });
    } else { // a quick trill
      const n = 8 + Math.floor(r() * 7), base = 3600 + 600 * r();
      for (let i = 0; i < n; i++) { notes.push({ start: t, len: 0.03, f0: base, f1: base - 250, vib: 0 }); t += 0.055; }
    }
    const pan = (r() - 0.5) * 1.2;
    const level = 0.5 + 0.5 * r();
    return {
      start: this.n,
      notes: notes.map((x) => ({ start: Math.floor(x.start * sampleRate), len: Math.max(1, Math.floor(x.len * sampleRate)), f0: x.f0, f1: x.f1, vib: x.vib })),
      gl: Math.sqrt(0.5 * (1 - pan)) * level, gr: Math.sqrt(0.5 * (1 + pan)) * level,
      end: 0, index: 0,
    };
  }
  next(sampleRate) {
    const ref = GeneratorLevel.referenceRMS;
    const TWO_PI_ = 2 * Math.PI;
    this.lfoA += 0.019 / sampleRate; if (this.lfoA >= 1) this.lfoA -= 1;
    this.lfoB += 0.043 / sampleRate; if (this.lfoB >= 1) this.lfoB -= 1;
    this.lfoC += 0.031 / sampleRate; if (this.lfoC >= 1) this.lfoC -= 1;
    const bedGain = 0.7 + 0.3 * Math.sin(TWO_PI_ * this.lfoA);
    const canopyGain = (0.35 + 0.35 * (0.5 + 0.5 * Math.sin(TWO_PI_ * this.lfoB))) * (0.7 + 0.3 * Math.sin(TWO_PI_ * this.lfoC));
    const cl = this.svfL.bandpass(this.cl.next() / ref, 2200, 1 / 0.6, sampleRate);
    const cr = this.svfR.bandpass(this.cr.next() / ref, 2200, 1 / 0.6, sampleRate);
    let l = this.bl.next() / ref * bedGain + cl * canopyGain;
    let r = this.br.next() / ref * bedGain + cr * canopyGain;
    // Birds
    if (this.call === null && this.n >= this.nextCall) {
      if (this.n === 0 && this.nextCall === 0) this.scheduleNext(sampleRate, 0);
      else this.call = this.makeCall(sampleRate);
    }
    if (this.call) {
      const c = this.call, k = this.n - c.start;
      while (c.index < c.notes.length && k >= c.notes[c.index].start + c.notes[c.index].len) c.index++;
      if (c.index >= c.notes.length) { this.call = null; this.scheduleNext(sampleRate, this.n); }
      else {
        const note = c.notes[c.index];
        if (k >= note.start) {
          const x = (k - note.start) / note.len;
          const f = note.f0 + (note.f1 - note.f0) * x + note.vib * Math.sin(TWO_PI_ * 7 * k / sampleRate);
          this.birdPhase += f / sampleRate; this.birdPhase -= Math.floor(this.birdPhase);
          const s = Math.sin(Math.PI * x);
          const v = Math.sin(TWO_PI_ * this.birdPhase) * s * s * 0.6;
          l += v * c.gl; r += v * c.gr;
        }
      }
    }
    this.n++;
    this.l = Math.fround(l * ForestGenerator.bedScale * ref);
    this.r = Math.fround(r * ForestGenerator.bedScale * ref);
  }
}
