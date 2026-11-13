// Shared helpers for the ported tests (mirror of AudioMathTests.swift's helpers).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ResolvedTimeline, decodeSession, sortSessions } from '../js/engine/session.js';
import { SessionRenderer, BeatMode } from '../js/engine/renderer.js';

export const SR = 48000;
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Build a small session in code. Levels at -96 switch a layer off. */
export function makeSession({
  beats = -32, noise = -14, ambient = -96, phases = [[10, 0, 20]], segments = [], fadeIn = 0, fadeOut = 0,
  color = 'pink', duckDb = 6,
} = {}) {
  return {
    id: 't', module: 'test', title: 'T', subtitle: '', kind: 'main', awake: true, carrierHz: 220,
    fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut, noise: color, ambient: ambient > -90 ? 'warmPad' : null,
    isochronicOffsetDb: -3, ducking: { amountDb: duckDb, attackSeconds: 0.3, releaseSeconds: 0.5, leadSeconds: 0.2 },
    phases: phases.map(([beat, glide, min], i) => ({
      id: `p${i}`, name: `P${i}`, beatHz: beat, beatGlideSeconds: glide,
      levels: { beats, noise, ambient, pacer: -96 }, levelGlideSeconds: 1,
      leadInSeconds: i === 0 && segments.length ? 5 : 0,
      segments: i === 0 ? segments.map((id) => ({ id, pauseAfter: 1 })) : [],
      tailSeconds: 0, minDurationSeconds: min, pacer: null,
    })),
    noiseBed: null, ratings: [], sortOrder: 0,
  };
}

export function render(session, { durations = {}, voice = null, mode = BeatMode.binaural, beatsEnabled = true, seconds = null, configure = null } = {}) {
  const tl = new ResolvedTimeline(session, durations);
  const r = new SessionRenderer(tl, SR, voice, { mode, beatsEnabled });
  const n = Math.floor((seconds ?? tl.totalDuration) * SR);
  const l = new Float32Array(n), rr = new Float32Array(n);
  const block = 512;
  for (let done = 0; done < n;) {
    configure?.(r, done);
    const c = Math.min(block, n - done);
    r.render(l, rr, c, done);
    done += c;
  }
  return { l, r: rr, renderer: r };
}

/** Mean frequency over a window from positive-going zero crossings (interpolated). */
export function measuredFrequency(x, sr = SR) {
  let first = -1, last = -1, count = 0;
  for (let i = 1; i < x.length; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const c = i - 1 + (-x[i - 1]) / (x[i] - x[i - 1]);
      if (first < 0) first = c;
      last = c; count++;
    }
  }
  return count > 1 ? (count - 1) / (last - first) * sr : 0;
}

export const slice = (x, from, to, sr = SR) => x.subarray(Math.floor(from * sr), Math.floor(to * sr));

export function rmsDb(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 20 * Math.log10(Math.sqrt(s / x.length));
}

export function equalArrays(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Power of a sinusoid at f (Hz) via quadrature projection. */
export function tonePower(x, f, sr = SR) {
  let re = 0, im = 0;
  for (let i = 0; i < x.length; i++) {
    const ph = 2 * Math.PI * f * i / sr;
    re += x[i] * Math.cos(ph); im += x[i] * Math.sin(ph);
  }
  return (re * re + im * im) / (x.length * x.length);
}

export function loadShipped() {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'App/Resources/Narration/manifest.json'), 'utf8'));
  const durations = Object.fromEntries(Object.entries(manifest.segments).map(([k, v]) => [k, v.duration]));
  const dir = path.join(ROOT, 'Sessions');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'modules.json');
  const texts = {};
  const sessions = sortSessions(files.map((f) => {
    const text = readFileSync(path.join(dir, f), 'utf8');
    const s = decodeSession(JSON.parse(text), f);
    texts[s.id] = text;
    return s;
  }));
  const modules = JSON.parse(readFileSync(path.join(dir, 'modules.json'), 'utf8')).modules;
  return { manifest, durations, sessions, texts, modules };
}

/** Reads a 16-bit or float PCM WAV into per-channel Float32Arrays. */
export function readWav(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: not a WAV`);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    let size = b.readUInt32LE(off + 4);
    if (id === 'data' && (size === 0 || size === 0xffffffff || off + 8 + size > b.length)) size = b.length - off - 8;
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(off + 8), channels: b.readUInt16LE(off + 10), sampleRate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') { data = { start: off + 8, size }; break; }
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: missing fmt or data`);
  const { channels, bits } = fmt;
  const isFloat = fmt.format === 3 || (fmt.format === 0xfffe && bits === 32);
  const bytes = bits / 8, frames = Math.floor(data.size / (bytes * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const p = data.start + (i * channels + c) * bytes;
      out[c][i] = isFloat ? b.readFloatLE(p) : bits === 16 ? b.readInt16LE(p) / 32768 : b.readInt32LE(p) / 2147483648;
    }
  }
  return { sampleRate: fmt.sampleRate, channels: out };
}
