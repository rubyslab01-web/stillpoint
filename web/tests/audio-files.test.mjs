// Checks the pre-rendered files the phone actually plays (web/audio/), after AAC encoding:
// beat arc over time, ear separation, the no-beats condition, the isochronic layer, levels
// against the JS renderer, and that every render is up to date with its session file.
// Skips if web/audio/ hasn't been built (node web/tools/build-audio.mjs).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResolvedTimeline, contentKey } from '../js/engine/session.js';
import { SessionRenderer, InMemoryVoice } from '../js/engine/renderer.js';
import { GeneratorLevel, Decibels } from '../js/engine/dsp.js';
import { ROOT, loadShipped, readWav, tonePower, rmsDb } from './helpers.mjs';

const SR = 48000;
const AUDIO = path.join(ROOT, 'web/audio');
const INDEX = path.join(AUDIO, 'renders.json');
const have = existsSync(INDEX);
const index = have ? JSON.parse(readFileSync(INDEX, 'utf8')) : null;

/** Decode [start, start+dur) seconds of a file to stereo float with ffmpeg. */
function decode(file, start, dur) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(start), '-t', String(dur), '-i', path.join(AUDIO, file),
    '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = all.length / 2, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = all[2 * i]; R[i] = all[2 * i + 1]; }
  return { L, R };
}

const db = (p) => 10 * Math.log10(p);

/** a − b, sample by sample. The variants share identical noise and voice before encoding, so
 *  this isolates the beat layer (plus the two files' coding error). */
function minus(a, b) {
  const n = Math.min(a.L.length, b.L.length), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = a.L[i] - b.L[i]; R[i] = a.R[i] - b.R[i]; }
  return { L, R };
}

/** Frequency (Hz) of the strongest tone in [lo, hi] by narrowband scan. */
function peakFrequency(x, lo, hi, step = 0.05) {
  let best = lo, bestP = -1;
  for (let f = lo; f <= hi; f += step) { const p = tonePower(x, f); if (p > bestP) { bestP = p; best = f; } }
  return best;
}

describe('Pre-rendered audio', { skip: have ? false : 'web/audio not built' }, () => {
  const { sessions, texts, durations, manifest } = loadShipped();

  test('every session has fresh renders for all three variants', () => {
    for (const s of sessions) {
      const e = index.sessions[s.id];
      assert.ok(e, `${s.id} not rendered`);
      assert.equal(e.contentKey, contentKey(texts[s.id], s, durations), `${s.id} render is stale`);
      for (const v of ['binaural', 'isochronic', 'none']) assert.ok(existsSync(path.join(AUDIO, e.variants[v].file)), `${s.id}/${v}`);
      for (const m of (s.noiseBed?.optionsMinutes ?? []).filter((x) => x > 0)) assert.ok(e.beds[m], `${s.id} bed ${m}`);
    }
  });

  test('sleep: left ear stays on the carrier while the right ear carries 10 → 6 → 3 Hz', () => {
    const e = index.sessions['sleep-deep'];
    const tl = new ResolvedTimeline(sessions.find((s) => s.id === 'sleep-deep'), durations);
    const c = tl.carrierHz;
    // Windows where the beat is steady: settling (before the induction glide), theta, delta.
    const settleEnd = tl.phases[0].end;
    const windows = [[Math.max(10, settleEnd - 20), 10], [8 * 60, 6], [30 * 60, 3], [60 * 60, 3]];
    const report = [];
    for (const [t, beat] of windows) {
      assert.ok(Math.abs(tl.beatHz.value(t) - beat) < 1e-6 && Math.abs(tl.beatHz.value(t + 20) - beat) < 1e-6, `timeline beat at ${t}`);
      const { L, R } = minus(decode(e.variants.binaural.file, t, 20), decode(e.variants.none.file, t, 20));
      const fl = peakFrequency(L, c - 1, c + 1), fr = peakFrequency(R, c + 0.5, c + 15);
      assert.ok(Math.abs(fl - c) <= 0.06, `left at ${t}s: ${fl} Hz`);
      assert.ok(Math.abs(fr - (c + beat)) <= 0.06, `right at ${t}s: ${fr} Hz, expected ${c + beat}`);
      // Ear separation after AAC encoding.
      const leakL = db(tonePower(L, c + beat) / tonePower(L, c)), leakR = db(tonePower(R, c) / tonePower(R, c + beat));
      report.push(`${(t / 60).toFixed(1)} min: ${beat} Hz, other ear's tone ${leakL.toFixed(0)} / ${leakR.toFixed(0)} dB`);
      assert.ok(leakL < -30 && leakR < -30, `separation at ${t}s: L ${leakL.toFixed(1)} dB, R ${leakR.toFixed(1)} dB`);
    }
    console.log(`  ${report.join('\n  ')}`);
  });

  test('sleep: beat tone is gone by 90 minutes and present at 60', () => {
    const f = index.sessions['sleep-deep'].variants.binaural.file;
    const at60 = decode(f, 60 * 60, 20), at895 = decode(f, 89 * 60 + 20, 20);
    const p60 = tonePower(at60.L, 240), p895 = tonePower(at895.L, 240);
    assert.ok(db(p60 / p895) > 20, `tone at 60 min only ${db(p60 / p895).toFixed(1)} dB above 89.3 min`);
  });

  test('no-beats variant differs from the beats variant only by the beat tone', () => {
    for (const [id, t] of [['sleep-deep', 30 * 60], ['qs-rescue-2', 40], ['coherence-steady-heart', 300], ['gratitude-three-good-things', 200]]) {
      const e = index.sessions[id];
      const tl = new ResolvedTimeline(sessions.find((x) => x.id === id), durations);
      const on = decode(e.variants.binaural.file, t, 8), off = decode(e.variants.none.file, t, 8);
      const d = minus(on, off);
      // What remains after removing the sham is a pure tone pair (carrier left, carrier+beat right)…
      const c = tl.carrierHz, fr = peakFrequency(d.R, c + 0.5, c + 20, 0.125);
      assert.ok(Math.abs(fr - (c + tl.beatHz.value(t + 4))) < 0.3, `${id}: right-ear tone ${fr}`);
      // …well under everything else…
      assert.ok(rmsDb(d.L) < rmsDb(off.L) - 10, `${id}: difference is not just a quiet tone`);
      // …and the rest of the sham is the same broadband sound.
      assert.ok(Math.abs(rmsDb(on.L) - rmsDb(off.L)) < 0.5, `${id}: broadband level differs`);
    }
  });

  test('isochronic variant: same pulsed tone in both ears, no binaural offset', () => {
    const e = index.sessions['sleep-deep'];
    const { L, R } = minus(decode(e.variants.isochronic.file, 30 * 60, 20), decode(e.variants.none.file, 30 * 60, 20));
    // Raised-cosine AM at 3 Hz on 240 Hz: carrier plus sidebands at 237 and 243, equal in both ears.
    for (const f of [237, 240, 243]) assert.ok(Math.abs(db(tonePower(L, f) / tonePower(R, f))) < 0.5, `${f} Hz differs between ears`);
    assert.ok(Math.abs(db(tonePower(L, 243) / tonePower(L, 240)) - db(0.25 ** 2 / 0.5 ** 2)) < 1, 'sideband ratio');
    // Same phase in both ears (a binaural pair would drift apart); broadband correlation would be
    // dominated by the two files' independent coding noise, so compare the carrier's phase.
    const phase = (x, f) => { let re = 0, im = 0; for (let i = 0; i < x.length; i++) { const a = 2 * Math.PI * f * i / SR; re += x[i] * Math.cos(a); im += x[i] * Math.sin(a); } return Math.atan2(im, re); };
    let dph = Math.abs(phase(L, 240) - phase(R, 240)); dph = Math.min(dph, 2 * Math.PI - dph);
    assert.ok(dph < 0.05, `carrier phase differs between ears by ${dph.toFixed(3)} rad`);
  });

  test('levels of the delivered file match the JS renderer second by second (qs-rescue-2)', () => {
    const s = sessions.find((x) => x.id === 'qs-rescue-2');
    const tl = new ResolvedTimeline(s, durations);
    const tmp = mkdtempSync(path.join(tmpdir(), 'stillpoint-files-'));
    try {
      const voice = new InMemoryVoice(tl.voice.map((p) => {
        const out = path.join(tmp, `${p.segmentID}.wav`);
        execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEF32@48000', '-c', '1', '-r', '96', path.join(ROOT, 'App/Resources/Narration', manifest.segments[p.segmentID].file), out]);
        return readWav(out).channels[0];
      }));
      const r = new SessionRenderer(tl, SR, voice, { userGain: index.userGain });
      const n = Math.floor(tl.totalDuration * SR), L = new Float32Array(n), R = new Float32Array(n);
      for (let d = 0; d < n; d += 8192) r.render(L, R, Math.min(8192, n - d), d);
      const file = decode(index.sessions[s.id].variants.binaural.file, 0, tl.totalDuration);
      let worst = 0;
      for (let sec = 2; sec + 1 < tl.totalDuration - 2; sec++) {
        const a = rmsDb(L.subarray(sec * SR, (sec + 1) * SR)), b = rmsDb(file.L.subarray(sec * SR, (sec + 1) * SR));
        worst = Math.max(worst, Math.abs(a - b));
      }
      assert.ok(worst < 0.5, `per-second level differs by up to ${worst.toFixed(2)} dB after encoding`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  test('noise bed: right length, quiet level, fades in and out', () => {
    const e = index.sessions['sleep-deep'];
    const s = sessions.find((x) => x.id === 'sleep-deep');
    const bed = e.beds[120];
    const d = Number(execFileSync('afinfo', [path.join(AUDIO, bed.file)], { encoding: 'utf8' }).match(/estimated duration: ([\d.]+)/)[1]);
    assert.ok(Math.abs(d - 7200) < 1, `bed length ${d}`);
    const expected = Decibels.fromGain(GeneratorLevel.referenceRMS) + s.noiseBed.levelDb + Decibels.fromGain(index.userGain);
    const mid = decode(bed.file, 1800, 10);
    assert.ok(Math.abs(rmsDb(mid.L) - expected) < 1.0, `bed level ${rmsDb(mid.L).toFixed(1)} vs ${expected.toFixed(1)} dBFS`);
    const start = decode(bed.file, 0, 1), end = decode(bed.file, 7200 - 1, 1);
    assert.ok(rmsDb(start.L) < expected - 20 && rmsDb(end.L) < expected - 20, 'bed should fade in and out');
  });

  test('download sizes stay reasonable for Wi-Fi', () => {
    let total = 0, largest = 0, largestName = '';
    const files = new Set();
    for (const e of Object.values(index.sessions)) for (const v of [...Object.values(e.variants), ...Object.values(e.beds)]) files.add(v.file);
    for (const f of files) {
      const b = statSync(path.join(AUDIO, f)).size; total += b;
      if (b > largest) { largest = b; largestName = f; }
    }
    console.log(`  web/audio: ${(total / 1e6).toFixed(0)} MB total (stays on the Mac); largest ${largestName} ${(largest / 1e6).toFixed(0)} MB`);
    assert.ok(total < 800e6);
    // One session play streams at most one variant (+ a bed). 90 min at 96 kbps ≈ 65 MB.
    for (const e of Object.values(index.sessions)) assert.ok(e.variants.binaural.bytes < 70e6, e.title);
  });
});
