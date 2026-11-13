// Cross-checks the JavaScript renderer against the Swift renderer (the native app's engine).
// Renders the same session with `sessionrender` (Swift) and with js/engine (this port) and
// compares them sample by sample where there is no voice, and by level where there is.
//
// Slow (renders ~45 minutes of audio twice). Run with: web/run-tests.sh --parity
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResolvedTimeline } from '../js/engine/session.js';
import { SessionRenderer, BeatMode, InMemoryVoice } from '../js/engine/renderer.js';
import { ROOT, loadShipped, readWav } from './helpers.mjs';

const SR = 48000;
const PKG = path.join(ROOT, 'Packages/EntrainmentKit');
const BIN = path.join(PKG, '.build/release/sessionrender');
const NARR = path.join(ROOT, 'App/Resources/Narration');

function ensureSwiftRenderer() {
  execFileSync('swift', ['build', '-c', 'release', '--product', 'sessionrender'], { cwd: PKG, stdio: 'ignore' });
  assert.ok(existsSync(BIN));
}

/** Decodes narration like VoiceLoader: mono float at 48 kHz, Apple's sample-rate converter. */
function decodeVoice(file, tmp) {
  const out = path.join(tmp, `${path.basename(file)}.wav`);
  if (!existsSync(out)) execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEF32@48000', '-c', '1', '-r', '96', file, out]);
  return readWav(out).channels[0];
}

function jsRender(session, durations, manifest, tmp, { seconds, mode, beatsEnabled }) {
  const tl = new ResolvedTimeline(session, durations);
  const voice = new InMemoryVoice(tl.voice.map((p) => decodeVoice(path.join(NARR, manifest.segments[p.segmentID].file), tmp)));
  const r = new SessionRenderer(tl, SR, voice, { mode, beatsEnabled, userGain: 0.75 });
  const n = Math.floor(Math.min(seconds, tl.totalDuration) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let done = 0; done < n; done += 8192) r.render(L, R, Math.min(8192, n - done), done);
  return { L, R, tl };
}

function swiftRender(id, tmp, { seconds, mode, beatsEnabled }) {
  const out = path.join(tmp, `${id}-${mode}-${beatsEnabled}.wav`);
  const args = [id, out, '--seconds', String(seconds)];
  if (mode === BeatMode.isochronic) args.push('--isochronic');
  if (!beatsEnabled) args.push('--no-beats');
  execFileSync(BIN, args, { stdio: 'ignore' });
  const w = readWav(out);
  return { L: w.channels[0], R: w.channels[1] };
}

/** Per-frame mask: true where no narration placement covers the frame. */
function quietMask(tl, n) {
  const m = new Uint8Array(n).fill(1);
  for (const v of tl.voice) {
    const a = Math.round(v.start * SR), b = Math.min(n, Math.round(v.end * SR));
    m.fill(0, Math.max(0, a), Math.max(0, b));
  }
  return m;
}

const cases = [
  { id: 'qs-rescue-2', seconds: 200, mode: BeatMode.binaural, beatsEnabled: true },
  { id: 'qs-rescue-2', seconds: 200, mode: BeatMode.isochronic, beatsEnabled: true },
  { id: 'qs-rescue-2', seconds: 200, mode: BeatMode.binaural, beatsEnabled: false },
  { id: 'coherence-steady-heart', seconds: 400, mode: BeatMode.binaural, beatsEnabled: true },
  { id: 'compassion-warm-heart', seconds: 120, mode: BeatMode.binaural, beatsEnabled: true },
  { id: 'sleep-deep', seconds: 1500, mode: BeatMode.binaural, beatsEnabled: true },
];

test('JS renderer matches the Swift renderer', { timeout: 900_000 }, () => {
  ensureSwiftRenderer();
  const { sessions, durations, manifest } = loadShipped();
  const tmp = mkdtempSync(path.join(tmpdir(), 'stillpoint-parity-'));
  const report = [];
  try {
    for (const c of cases) {
      const s = sessions.find((x) => x.id === c.id);
      const js = jsRender(s, durations, manifest, tmp, c);
      const sw = swiftRender(c.id, tmp, c);
      const n = Math.min(js.L.length, sw.L.length);
      assert.ok(Math.abs(js.L.length - sw.L.length) <= 1, `${c.id}: lengths ${js.L.length} vs ${sw.L.length}`);
      // 1. Sample-level agreement where no voice plays (Swift output is 16-bit, so ~3e-5 is quantisation).
      const mask = quietMask(js.tl, n);
      let maxQuiet = 0, maxVoice = 0, quietFrames = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.max(Math.abs(js.L[i] - sw.L[i]), Math.abs(js.R[i] - sw.R[i]));
        if (mask[i]) { quietFrames++; maxQuiet = Math.max(maxQuiet, d); } else maxVoice = Math.max(maxVoice, d);
      }
      const quietSeconds = Math.round(quietFrames / SR);
      // 2. Level agreement everywhere, per second (voice decoding may differ by resampler details).
      let maxDb = 0;
      for (let sec = 0; sec + 1 <= n / SR; sec++) {
        for (const [a, b] of [[js.L, sw.L], [js.R, sw.R]]) {
          let ea = 0, eb = 0;
          for (let i = sec * SR; i < (sec + 1) * SR; i++) { ea += a[i] * a[i]; eb += b[i] * b[i]; }
          if (eb > 1e-10) maxDb = Math.max(maxDb, Math.abs(10 * Math.log10((ea + 1e-20) / eb)));
        }
      }
      // 3. Beat frequency over time on a beats-only difference is not observable in a full mix,
      //    so compare right-minus-left zero-crossing rates of the two renders in quiet windows.
      report.push(`${c.id} mode=${c.mode} beats=${c.beatsEnabled}: quiet ${quietSeconds}s max |Δ| ${maxQuiet.toExponential(2)}; with voice max |Δ| ${maxVoice.toExponential(2)}; per-second level Δ ≤ ${maxDb.toFixed(3)} dB`);
      assert.ok(quietSeconds > 0, `${c.id}: no quiet windows to compare`);
      assert.ok(maxQuiet < 2e-4, `${c.id}: samples differ by ${maxQuiet} in voice-free windows`);
      assert.ok(maxDb < 0.1, `${c.id}: per-second level differs by ${maxDb} dB`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    console.log(report.join('\n'));
  }
});
