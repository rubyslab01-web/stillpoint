// Port of Packages/EntrainmentKit/Tests/EntrainmentKitTests/AudioMathTests.swift.
// Run: node --test web/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  Envelope, PhaseAccumulator, BinauralOscillator, IsochronicOscillator, FastRandom, GeneratorLevel, Decibels,
} from '../js/engine/dsp.js';
import { ResolvedTimeline, ResolveError } from '../js/engine/session.js';
import { SessionRenderer, BeatMode, InMemoryVoice, softClip } from '../js/engine/renderer.js';
import { SR, makeSession, render, measuredFrequency, slice, rmsDb, equalArrays, tonePower } from './helpers.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const REF_DB = Decibels.fromGain(GeneratorLevel.referenceRMS);

describe('Envelope', () => {
  test('smooth shape hits endpoints and midpoint', () => {
    const e = new Envelope([{ time: 0, value: 10 }, { time: 10, value: 6, shape: 'smooth' }]);
    assert.equal(e.value(-1), 10); assert.equal(e.value(0), 10);
    near(e.value(5), 8, 1e-9);
    assert.equal(e.value(10), 6); assert.equal(e.value(99), 6);
    assert.ok(e.value(1) > 10 - 0.4); // S-curve: slower than linear near the start
  });
  test('linear shape', () => {
    const e = new Envelope([{ time: 0, value: 0 }, { time: 4, value: 8, shape: 'linear' }]);
    near(e.value(1), 2, 1e-9);
  });
  test('cursor matches random access, including a backwards re-seek', () => {
    const e = new Envelope([{ time: 0, value: 10 }, { time: 5, value: 10, shape: 'linear' }, { time: 15, value: 6 },
      { time: 30, value: 6, shape: 'linear' }, { time: 40, value: 14 }]);
    const c = e.cursor();
    for (let i = 0; i < 4500; i++) { const t = i / 100; near(c.value(t), e.value(t), 1e-12); }
    near(c.value(2), e.value(2), 1e-12);
  });
  test('glide is monotonic', () => {
    const e = new Envelope([{ time: 0, value: 10 }, { time: 60, value: 3 }]);
    let prev = e.value(0);
    for (let i = 1; i <= 600; i++) { const v = e.value(i / 10); assert.ok(v <= prev + 1e-12); prev = v; }
  });
});

describe('Frequency ramps', () => {
  test('beat is the difference between ears and only the right channel moves', () => {
    const { l, r } = render(makeSession({ beats: 0, noise: -96, phases: [[10, 0, 20], [6, 20, 40]] }));
    for (const [a, b] of [[2, 18], [22, 38], [42, 58]]) near(measuredFrequency(slice(l, a, b)), 220, 0.01, 'left');
    near(measuredFrequency(slice(r, 2, 18)), 230, 0.01);
    near(measuredFrequency(slice(r, 42, 58)), 226, 0.01);
    near(measuredFrequency(slice(r, 29, 31)), 228, 0.05); // midpoint of the smooth glide = 8 Hz
  });

  test('glides are phase-continuous (no sample jump beyond the sine slope bound)', () => {
    const { l, r } = render(makeSession({ beats: 0, noise: -96, phases: [[10, 0, 5], [3, 4, 10], [14, 2, 10]] }));
    const bound = BinauralOscillator.amplitude * 2 * Math.PI * (220 + 14) / SR * 1.001;
    let maxL = 0, maxR = 0;
    for (let i = 1; i < l.length; i++) {
      maxL = Math.max(maxL, Math.abs(l[i] - l[i - 1])); maxR = Math.max(maxR, Math.abs(r[i] - r[i - 1]));
    }
    assert.ok(maxL <= bound, `left ${maxL} > ${bound}`);
    assert.ok(maxR <= bound, `right ${maxR} > ${bound}`);
  });

  test('phase accumulator stays normalised', () => {
    const p = new PhaseAccumulator();
    for (let i = 0; i < 200000; i++) { const v = p.advance(200 + (i % 50), SR); assert.ok(v >= 0 && v < 1); }
  });

  test('isochronic pulses at the beat rate', () => {
    const { l } = render(makeSession({ beats: 0, noise: -96, phases: [[10, 0, 10]] }), { mode: BeatMode.isochronic });
    const win = Math.floor(0.02 * SR);
    const env = new Float32Array(l.length - win);
    let acc = 0;
    for (let i = 0; i < l.length; i++) { acc += Math.abs(l[i]); if (i >= win) { acc -= Math.abs(l[i - win]); env[i - win] = acc / win; } }
    let mean = 0; for (const v of env) mean += v; mean /= env.length;
    const centered = env.map((v) => v - mean);
    near(measuredFrequency(centered.subarray(1 * SR, 9 * SR)), 10, 0.05);
  });

  test('isochronic pulse is a raised cosine (smooth, zero at the trough, full at the peak)', () => {
    // Pulse envelope = 0.5 - 0.5cos(2π·beat·t). Sample peaks of |signal| per carrier cycle.
    const { l } = render(makeSession({ beats: 0, noise: -96, phases: [[4, 0, 3]] }), { mode: BeatMode.isochronic });
    const iso = 10 ** (-3 / 20); // isochronicOffsetDb in makeSession
    const cyc = SR / 220;
    let maxErr = 0;
    for (let c = 2; c < 600; c++) {
      const a = Math.floor(c * cyc), b = Math.floor((c + 1) * cyc);
      let pk = 0; for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(l[i]));
      const t = (a + b) / 2 / SR;
      const expected = (0.5 - 0.5 * Math.cos(2 * Math.PI * 4 * t)) * IsochronicOscillator.amplitude * iso;
      maxErr = Math.max(maxErr, Math.abs(pk - expected));
    }
    assert.ok(maxErr < 0.02 * IsochronicOscillator.amplitude, `envelope error ${maxErr}`);
  });
});

describe('Channel separation', () => {
  test('binaural channels are independent tones (> 80 dB separation)', () => {
    const { l, r } = render(makeSession({ beats: 0, noise: -96, phases: [[10, 0, 10]] }));
    const L = slice(l, 2, 3), R = slice(r, 2, 3);
    assert.ok(10 * Math.log10(tonePower(L, 230) / tonePower(L, 220)) < -80);
    assert.ok(10 * Math.log10(tonePower(R, 220) / tonePower(R, 230)) < -80);
  });
  test('isochronic is identical in both ears', () => {
    const { l, r } = render(makeSession({ beats: 0, noise: -96, phases: [[10, 0, 5]] }), { mode: BeatMode.isochronic });
    assert.ok(equalArrays(l, r));
  });
  test('noise is decorrelated between ears', () => {
    const { l, r } = render(makeSession({ beats: -96, noise: 0, phases: [[10, 0, 5]] }));
    let dot = 0, ll = 0, rr = 0;
    for (let i = 0; i < l.length; i++) { dot += l[i] * r[i]; ll += l[i] * l[i]; rr += r[i] * r[i]; }
    assert.ok(Math.abs(dot / Math.sqrt(ll * rr)) < 0.05);
  });
  test('mode switch crossfades without clicks', () => {
    const { l, r } = render(makeSession({ beats: 0, noise: -96, phases: [[10, 0, 8]] }), {
      configure: (rd, frame) => { if (frame >= 3 * SR) rd.setMode(BeatMode.isochronic); },
    });
    const bound = IsochronicOscillator.amplitude * 2 * Math.PI * 240 / SR * 1.2;
    for (let i = 1; i < l.length; i++) assert.ok(Math.abs(l[i] - l[i - 1]) <= bound, `click at ${i}`);
    assert.ok(!equalArrays(slice(l, 1, 2), slice(r, 1, 2)));
    assert.ok(equalArrays(slice(l, 6, 7), slice(r, 6, 7)));
  });
});

describe('Mixing levels', () => {
  for (const color of ['white', 'pink', 'brown']) {
    test(`${color} noise is calibrated to the reference RMS`, () => {
      const { l } = render(makeSession({ beats: -96, noise: 0, phases: [[10, 0, 30]], color }));
      near(rmsDb(slice(l, 5, 30)), REF_DB, 1.0, color);
    });
  }
  test('binaural and isochronic tones at reference', () => {
    const s = makeSession({ beats: 0, noise: -96, phases: [[10, 0, 10]] });
    const { l, r } = render(s);
    near(rmsDb(slice(l, 1, 9)), REF_DB, 0.1); near(rmsDb(slice(r, 1, 9)), REF_DB, 0.1);
    const iso = render(s, { mode: BeatMode.isochronic });
    near(rmsDb(slice(iso.l, 1, 9)), REF_DB - 3, 0.2);
  });
  test('beats sit 18 dB under noise (within 15–20)', () => {
    const beatsOnly = render(makeSession({ beats: -32, noise: -96, phases: [[10, 0, 20]] }));
    const noiseOnly = render(makeSession({ beats: -96, noise: -14, phases: [[10, 0, 20]] }));
    const diff = rmsDb(slice(noiseOnly.l, 2, 20)) - rmsDb(slice(beatsOnly.l, 2, 20));
    near(diff, 18, 1.0); assert.ok(diff >= 15 && diff <= 20);
  });
  test('ambient calibrated', () => {
    const { l, r } = render(makeSession({ beats: -96, noise: -96, ambient: 0, phases: [[10, 0, 120]] }));
    near(rmsDb(slice(l, 0, 120)), REF_DB, 1.5); near(rmsDb(slice(r, 0, 120)), REF_DB, 1.5);
  });
  test('sham session has no beat layer and is identical to a noise-only render', () => {
    const s = makeSession({ beats: -32, noise: -14, phases: [[10, 0, 5]] });
    const on = render(s, { beatsEnabled: true }), off = render(s, { beatsEnabled: false });
    const noiseOnly = render(makeSession({ beats: -96, noise: -14, phases: [[10, 0, 5]] }));
    assert.ok(equalArrays(off.l, noiseOnly.l)); assert.ok(equalArrays(off.r, noiseOnly.r));
    assert.ok(!equalArrays(on.l, off.l));
  });
  test('background ducks under the voice and recovers', () => {
    const voice = new InMemoryVoice([new Float32Array(10 * SR)]);
    const { l } = render(makeSession({ beats: -96, noise: -14, phases: [[10, 0, 30]], segments: ['a'] }), { durations: { a: 10 }, voice });
    const before = rmsDb(slice(l, 1, 4)), during = rmsDb(slice(l, 8, 14)), after = rmsDb(slice(l, 22, 29));
    near(before - during, 6, 0.7); near(before, after, 0.7);
  });
  test('ducking starts before the voice (lead time)', () => {
    // leadSeconds 0.2 in makeSession: the background must already be dipping at 4.9 s (voice at 5 s).
    const voice = new InMemoryVoice([new Float32Array(10 * SR)]);
    const { renderer } = render(makeSession({ beats: -96, noise: -14, phases: [[10, 0, 30]], segments: ['a'] }), {
      durations: { a: 10 }, voice, seconds: 4.95,
    });
    assert.ok(renderer.duck > 0.05, `duck ${renderer.duck}`);
  });
  test('voice passes at unity and on both ears', () => {
    const tone = new Float32Array(2 * SR).map((_, i) => Math.fround(0.3 * Math.sin(2 * Math.PI * 300 * i / SR)));
    const { l, r, renderer } = render(makeSession({ beats: -96, noise: -96, phases: [[10, 0, 10]], segments: ['a'] }), {
      durations: { a: 2 }, voice: new InMemoryVoice([tone]),
    });
    assert.ok(equalArrays(slice(l, 5, 7), tone));
    assert.ok(equalArrays(l, r));
    assert.equal(renderer.underruns, 0);
    assert.ok(slice(l, 0, 5).every((v) => v === 0));
  });
  test('missing voice counts an underrun instead of crashing', () => {
    const { renderer } = render(makeSession({ beats: -96, noise: -96, phases: [[10, 0, 10]], segments: ['a'] }), {
      durations: { a: 2 }, voice: new InMemoryVoice([null]),
    });
    assert.equal(renderer.underruns, 1);
  });
  test('soft clip never exceeds full scale and is transparent below the knee', () => {
    for (let x = -8; x <= 8; x += 0.01) assert.ok(Math.abs(softClip(Math.fround(x))) <= 1.0);
    assert.equal(softClip(0.5), 0.5);
    assert.equal(softClip(Math.fround(-0.79)), Math.fround(-0.79));
  });
  test('full mix has headroom', () => {
    const { l, r } = render(makeSession({ beats: -32, noise: -14, ambient: -22, phases: [[10, 0, 30]] }));
    let pk = 0; for (let i = 0; i < l.length; i++) pk = Math.max(pk, Math.abs(l[i] + r[i]));
    assert.ok(pk < 0.5);
  });
  test('user gain scales output', () => {
    const s = makeSession({ beats: -96, noise: -14, phases: [[10, 0, 10]] });
    const full = render(s), half = render(s, { configure: (r) => r.setUserGain(0.5) });
    near(rmsDb(slice(full.l, 2, 10)) - rmsDb(slice(half.l, 2, 10)), 6.02, 0.3);
  });
});

describe('Fades', () => {
  test('session fades in from silence and out to silence', () => {
    const { l } = render(makeSession({ beats: -96, noise: -14, phases: [[10, 0, 40]], fadeIn: 8, fadeOut: 10 }));
    assert.ok(Math.abs(l[0]) < 1e-6); assert.ok(Math.abs(l[l.length - 1]) < 1e-4);
    const full = rmsDb(slice(l, 15, 25));
    near(full - rmsDb(slice(l, 3.5, 4.5)), 6, 1.5);
    near(full - rmsDb(slice(l, 34.5, 35.5)), 6, 1.5);
    let prev = -Infinity;
    for (let i = 0; i < 8; i++) { const d = rmsDb(slice(l, i, i + 1)); assert.ok(d > prev); prev = d; }
  });
  test('fade gain is continuous', () => {
    const tl = new ResolvedTimeline(makeSession({ phases: [[10, 0, 40]], fadeIn: 8, fadeOut: 10 }), {});
    const r = new SessionRenderer(tl, SR, null);
    let prev = r.sessionFade(0);
    assert.equal(prev, 0);
    for (let i = 1; i <= 40000; i++) {
      const g = r.sessionFade(i / 1000);
      assert.ok(Math.abs(g - prev) < 0.001); assert.ok(g >= 0 && g <= 1); prev = g;
    }
    assert.equal(r.sessionFade(40), 0);
  });
  test('pause fades out, holds the playhead, and fades back in', () => {
    let pausedAt = 0;
    const { l, renderer } = render(makeSession({ beats: 0, noise: -96, phases: [[10, 0, 20]] }), {
      seconds: 12,
      configure: (r, frame) => {
        if (frame >= 3 * SR && frame < 6 * SR) r.setPaused(true);
        if (frame >= 5 * SR && frame < 6 * SR) pausedAt = r.currentTime;
        if (frame >= 6 * SR) r.setPaused(false);
      },
    });
    assert.ok(slice(l, 4.5, 5.9).every((v) => v === 0));
    near(pausedAt, 4.2, 0.05);
    near(renderer.currentTime, 12 - 1.8, 0.05);
    const bound = BinauralOscillator.amplitude * 2 * Math.PI * 230 / SR * 1.05;
    let maxD = 0; for (let i = 1; i < l.length; i++) maxD = Math.max(maxD, Math.abs(l[i] - l[i - 1]));
    assert.ok(maxD <= bound);
    const mid = rmsDb(slice(l, 3.55, 3.65)), full = rmsDb(slice(l, 2, 3));
    assert.ok(full - mid > 3 && full - mid < 10);
  });
  test('hard pause then resume fades in from silence (used after the OS suspends audio)', () => {
    const { l } = render(makeSession({ beats: 0, noise: -96, phases: [[10, 0, 20]] }), {
      seconds: 6,
      configure: (r, frame) => { if (frame === 2 * SR - (2 * SR) % 512) { r.hardPause(); r.setPaused(false); } },
    });
    const at = Math.floor(2 * SR / 512) * 512;
    assert.ok(Math.abs(l[at]) < 0.001);
    assert.ok(rmsDb(l.subarray(at, at + 2400)) < rmsDb(slice(l, 4, 5)) - 6);
  });
  test('layer levels glide between phases', () => {
    const s = makeSession({ beats: -96, noise: -14, phases: [[10, 0, 10], [10, 0, 20]] });
    s.phases[1].levels.noise = -26; s.phases[1].levelGlideSeconds = 6;
    const { l } = render(s);
    const a = rmsDb(slice(l, 4, 10)), b = rmsDb(slice(l, 18, 30)), mid = rmsDb(slice(l, 12.5, 13.5));
    near(a - b, 12, 1); assert.ok(mid < a && mid > b);
  });
});

describe('Timeline', () => {
  test('voice placement and phase durations', () => {
    const s = makeSession({ phases: [[10, 0, 0], [6, 30, 100]], segments: ['a', 'b'] });
    s.phases[0].tailSeconds = 4;
    const tl = new ResolvedTimeline(s, { a: 7, b: 3 });
    assert.deepEqual(tl.voice.map((v) => v.start), [5, 13]);
    assert.equal(tl.phases[0].end, 5 + 7 + 1 + 3 + 1 + 4);
    assert.equal(tl.phases[1].end - tl.phases[1].start, 100);
    assert.equal(tl.totalDuration, tl.phases[1].end);
    assert.equal(tl.beatHz.value(tl.phases[1].start), 10);
    assert.equal(tl.beatHz.value(tl.phases[1].start + 30), 6);
    assert.equal(tl.phase(6).id, 'p0');
  });
  test('missing narration is an error', () => {
    assert.throws(() => new ResolvedTimeline(makeSession({ segments: ['nope'] }), {}), ResolveError);
  });
  test('noise bed extends the session and silences beats', () => {
    const s = makeSession({ beats: -32, noise: -14, phases: [[3, 0, 60]], fadeOut: 5 });
    s.noiseBed = { optionsMinutes: [0, 60], defaultMinutes: 0, levelDb: -20, crossfadeSeconds: 10, fadeOutSeconds: 30 };
    const tl = new ResolvedTimeline(s, {}, 60);
    assert.equal(tl.sessionDuration, 60); assert.equal(tl.totalDuration, 60 + 3600);
    assert.ok(tl.beatsDb.value(80) <= -90); assert.equal(tl.noiseDb.value(80), -20);
    assert.equal(new ResolvedTimeline(s, {}, 0).totalDuration, 60);
  });
});

describe('Noise generator parity with Swift', () => {
  test('xorshift64* matches a BigInt reference bit for bit', () => {
    for (const seed of [0xa11cen, 0xb0b5n, 11n, 29n, 0n, 0x9e3779b97f4a7c15n]) {
      let s = seed === 0n ? 0x12345678n : seed;
      const M = 0xffffffffffffffffn;
      const fast = new FastRandom(seed);
      for (let i = 0; i < 5000; i++) {
        s ^= s >> 12n; s ^= (s << 25n) & M; s ^= s >> 27n;
        const x = (s * 2685821657736338717n) & M;
        const ref = Number(x >> 11n) / 2 ** 52 - 1;
        assert.equal(fast.nextBipolar(), ref, `seed ${seed} step ${i}`);
      }
    }
  });
});

describe('Nature sounds', () => {
  const windSession = () => {
    const s = makeSession({ beats: -96, noise: -96, phases: [[10, 0, 60]] });
    s.phases[0].levels.pacer = 0;
    s.phases[0].pacer = { breathsPerMinute: 6, inhaleFraction: 0.4, lowHz: 174.61, highHz: 261.63, sound: 'wind' };
    return s;
  };
  test('forest ambience is calibrated to the reference level', () => {
    const s = makeSession({ beats: -96, noise: -96, ambient: 0, phases: [[10, 0, 120]] });
    s.ambient = 'forest';
    const { l, r } = render(s);
    near(rmsDb(slice(l, 0, 120)), REF_DB, 1.5); near(rmsDb(slice(r, 0, 120)), REF_DB, 1.5);
  });
  test('forest has sparse, soft birdsong (a few calls a minute, well under the bed)', async () => {
    const { ForestGenerator } = await import('../js/engine/dsp.js');
    const a = new ForestGenerator(), b = new ForestGenerator();
    b.makeCall = function () { return { start: this.n, notes: [], gl: 0, gr: 0, index: 0 }; }; // same forest, no birds
    let eb = 0, et = 0, birdSamples = 0, calls = 0, prev = null;
    for (let i = 0; i < SR * 60; i++) {
      a.next(SR); b.next(SR);
      if (a.call && a.call !== prev) calls++;
      prev = a.call;
      const bird = a.l - b.l;
      if (Math.abs(bird) > 1e-6) { eb += bird * bird; et += b.l * b.l; birdSamples++; }
    }
    assert.ok(calls >= 2 && calls <= 10, `${calls} calls in a minute`);
    const rel = 10 * Math.log10(eb / et);
    assert.ok(rel > -20 && rel < -6, `birds ${rel.toFixed(1)} dB relative to the bed during calls`);
  });
  test('wind breath guide: loud at the top of the inhale, quiet at the end of the exhale, at the old tone level', () => {
    const { l } = render(windSession());
    // 6 breaths/min: cycle 10 s, inhale 4 s. Peak around 2–4 s into each cycle; trough near 9–10 s.
    const peak = rmsDb(slice(l, 22.8, 23.6)), trough = rmsDb(slice(l, 29.3, 29.9));
    assert.ok(peak - trough > 10, `peak ${peak.toFixed(1)} trough ${trough.toFixed(1)}`);
    near(peak, REF_DB + 20 * Math.log10(1.4), 3);
  });
  test('wind is different in each ear (wide), the tone pacer is identical', () => {
    const { l, r } = render(windSession(), { seconds: 20 });
    let dot = 0, ll = 0, rr = 0;
    for (let i = 0; i < l.length; i++) { dot += l[i] * r[i]; ll += l[i] * l[i]; rr += r[i] * r[i]; }
    assert.ok(Math.abs(dot / Math.sqrt(ll * rr)) < 0.3);
    const t = windSession(); t.phases[0].pacer.sound = 'tone';
    const tone = render(t, { seconds: 5 });
    assert.ok(equalArrays(tone.l, tone.r));
  });
});
