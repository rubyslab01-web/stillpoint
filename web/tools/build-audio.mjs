#!/usr/bin/env node
// Pre-renders every session for the web app's reliable playback path (an <audio> element,
// which keeps playing with the screen locked).
//
//   node web/tools/build-audio.mjs              render sessions whose inputs changed
//   node web/tools/build-audio.mjs --force      render everything
//   node web/tools/build-audio.mjs --only sleep-deep
//
// For each session, three variants are rendered with the native engine's own offline renderer
// (`swift run sessionrender`, unchanged), so the phone hears exactly what the iOS app would make:
//   binaural   headphones
//   isochronic speaker mode
//   none       the self-experiment's no-beats condition (identical in either mode)
// Sessions with a noise bed (Sleep) also get one bed file per length option, rendered here with
// the ported noise generator. Output goes to web/audio/ with an index in web/audio/renders.json.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync, readdirSync, mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, WEB, NARRATION_DIR, AUDIO_DIR, loadContent } from './content-node.mjs';
import { ResolvedTimeline, SessionValidator, contentKey, usedSegments } from '../js/engine/session.js';
import { NoiseGenerator, Decibels } from '../js/engine/dsp.js';
import { softClip } from '../js/engine/renderer.js';

const FORMAT = 2;
const USER_GAIN = 0.75;                 // VolumePolicy.maxGain: renders sit at the in-app maximum
const SESSION_BITRATE = 96000;          // AAC-LC CBR; keeps the other ear's tone >35 dB down (see DECISIONS.md)
const BED_BITRATE = '32k';              // HE-AAC; noise only, no tones to protect
const SR = 48000;
const VARIANTS = { binaural: [], isochronic: ['--isochronic'], none: ['--no-beats'] };

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const quiet = args.includes('--quiet');
const log = (...m) => { if (!quiet) console.log(...m); };

const PKG = path.join(ROOT, 'Packages/EntrainmentKit');
const BIN = path.join(PKG, '.build/release/sessionrender');

function sha(data) { return createHash('sha256').update(data).digest('hex').slice(0, 16); }

/** Fingerprint of everything that shapes the rendered sound apart from the session itself. */
function engineFingerprint() {
  const dirs = ['Render', 'DSP', 'Math', 'Session'].map((d) => path.join(PKG, 'Sources/EntrainmentKit', d));
  const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.swift')).sort().map((f) => path.join(d, f)));
  files.push(path.join(PKG, 'Sources/sessionrender/main.swift'));
  files.push(path.join(WEB, 'js/engine/dsp.js'));
  const h = createHash('sha256');
  for (const f of files) h.update(readFileSync(f));
  h.update(JSON.stringify({ FORMAT, USER_GAIN, SESSION_BITRATE, BED_BITRATE, SR }));
  return h.digest('hex').slice(0, 16);
}

function buildSwiftRenderer() {
  log('Building the Swift offline renderer (sessionrender)…');
  execFileSync('swift', ['build', '-c', 'release', '--product', 'sessionrender'], { cwd: PKG, stdio: quiet ? 'ignore' : 'inherit' });
}

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${argv.join(' ')} failed (${code}): ${err}`))));
  });
}

function audioDuration(file) {
  const out = execFileSync('afinfo', [file], { encoding: 'utf8' });
  const m = out.match(/estimated duration: ([\d.]+)/);
  return m ? Number(m[1]) : NaN;
}

async function renderVariant(id, variant, outFile, tmp) {
  const wav = path.join(tmp, `${id}-${variant}.wav`);
  await run(BIN, [id, wav, ...VARIANTS[variant]]);
  const part = `${outFile}.part`;
  await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(SESSION_BITRATE), '-s', '0', wav, part]);
  rmSync(wav);
  renameSync(part, outFile);
}

/**
 * Noise-only bed after the session. The native app crossfades the noise straight from the
 * session level to the bed level; the web version can only start a new file once the session
 * file has ended (with its normal fade-out), so the bed fades in over the same crossfade time.
 */
function renderBed(session, minutes, outFile) {
  const bed = session.noiseBed;
  const total = Math.round(minutes * 60 * SR);
  const fadeIn = bed.crossfadeSeconds, fadeOut = bed.fadeOutSeconds, dur = minutes * 60;
  const level = Math.fround(Decibels.toGain(bed.levelDb));
  const nl = new NoiseGenerator(session.noise, 0xbed1n), nr = new NoiseGenerator(session.noise, 0xbed2n);
  const part = `${outFile}.part`;
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(SR), '-ac', '2', '-i', '-',
    '-c:a', 'aac_at', '-profile:a', '4', '-b:a', BED_BITRATE, '-f', 'ipod', part], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d) => { err += d; });
  const done = new Promise((resolve, reject) => ff.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err}`)))));
  const CH = SR * 10;
  return (async () => {
    for (let start = 0; start < total; start += CH) {
      const n = Math.min(CH, total - start);
      const buf = Buffer.allocUnsafe(n * 4);
      for (let i = 0; i < n; i++) {
        const t = (start + i) / SR;
        let g = 1;
        if (t < fadeIn) g *= 0.5 - 0.5 * Math.cos(Math.PI * t / fadeIn);
        const rem = dur - t;
        if (rem < fadeOut) g *= 0.5 - 0.5 * Math.cos(Math.PI * rem / fadeOut);
        const master = Math.fround(g * USER_GAIN);
        const l = softClip(Math.fround(Math.fround(nl.next() * level) * master));
        const r = softClip(Math.fround(Math.fround(nr.next() * level) * master));
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), i * 4);
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), i * 4 + 2);
      }
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await done;
    renameSync(part, outFile);
  })();
}

/** Shared noise-bed file for a session's bed settings and length. */
function bedFile(s, minutes) {
  const b = s.noiseBed;
  return `beds/${s.noise}_${b.levelDb}dB_in${b.crossfadeSeconds}_out${b.fadeOutSeconds}_${minutes}min.m4a`;
}

/** A short silent file. The experimental live engine plays it to hold the lock-screen controls. */
async function ensureSilence() {
  const out = path.join(WEB, 'assets/silence.m4a');
  if (existsSync(out)) return;
  mkdirSync(path.dirname(out), { recursive: true });
  const tmp = mkdtempSync(path.join(tmpdir(), 'stillpoint-'));
  const wav = path.join(tmp, 'silence.wav');
  const frames = SR * 5;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + frames * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(frames * 2, 40);
  writeFileSync(wav, Buffer.concat([h, Buffer.alloc(frames * 2)]));
  await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '32000', wav, out]);
  rmSync(tmp, { recursive: true, force: true });
}

function wavStereo(file, frames, fn) {
  const h = Buffer.alloc(44), data = Buffer.alloc(frames * 4);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  for (let i = 0; i < frames; i++) {
    const [l, r] = fn(i);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l)) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r)) * 32767), i * 4 + 2);
  }
  writeFileSync(file, Buffer.concat([h, data]));
}

/**
 * Setup sounds: left and right ear tones (port of TestTonePlayer: 330 Hz, 0.25 s ramps), and a
 * 25 s volume sample cut from a real render (voice, nature sound, noise and beats together), so
 * the level set in setup is the level sessions play at. All at the in-app maximum gain.
 */
async function ensureSetupSounds(index) {
  const dir = path.join(WEB, 'assets');
  mkdirSync(dir, { recursive: true });
  const tmp = mkdtempSync(path.join(tmpdir(), 'stillpoint-setup-'));
  try {
    for (const side of ['left', 'right']) {
      const out = path.join(dir, `tone-${side}.m4a`);
      if (existsSync(out)) continue;
      const wav = path.join(tmp, `${side}.wav`), n = Math.round(1.4 * SR), ramp = 0.25 * SR;
      const amp = 0.16 * Math.SQRT2 * 0.5 * USER_GAIN;
      wavStereo(wav, n, (i) => {
        const g = Math.min(1, i / ramp, (n - i) / ramp);
        const v = Math.sin(2 * Math.PI * 330 * i / SR) * amp * g;
        return side === 'left' ? [v, 0] : [0, v];
      });
      await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '128000', wav, out]);
    }
    const src = index.sessions['coherence-steady-heart'] ?? Object.values(index.sessions)[0];
    const out = path.join(dir, 'calibration.m4a'), stamp = path.join(dir, 'calibration.key');
    if (src && (!existsSync(out) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== src.buildKey)) {
      const { sessions, durations } = loadContent();
      const s = sessions.find((x) => x.id === Object.keys(index.sessions).find((k) => index.sessions[k] === src));
      const tl = new ResolvedTimeline(s, durations);
      const start = Math.max(0, (tl.pacers[0]?.start ?? tl.voice[0]?.start ?? 10) - 2);
      await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', '25', '-i', path.join(AUDIO_DIR, src.variants.binaural.file),
        '-af', 'afade=t=in:d=0.5,afade=t=out:st=24:d=1', '-c:a', 'aac_at', '-b:a', '128k', '-f', 'ipod', out]);
      writeFileSync(stamp, src.buildKey);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

async function main() {
  const { sessions, texts, durations, manifest, errors } = loadContent();
  for (const e of errors) console.error(`Skipping unreadable session file ${e}`);
  mkdirSync(AUDIO_DIR, { recursive: true });
  const indexFile = path.join(AUDIO_DIR, 'renders.json');
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};
  if (index.format !== FORMAT) { index.format = FORMAT; index.sessions = {}; }
  index.encoder = `AAC-LC ${SESSION_BITRATE / 1000} kbps CBR stereo, 48 kHz (afconvert); beds HE-AAC ${BED_BITRATE} (ffmpeg aac_at)`;
  index.userGain = USER_GAIN;
  index.sessions ??= {};
  const engine = engineFingerprint();

  // Decide what is stale first, so we only build the Swift tool when needed.
  const plan = [];
  for (const s of sessions) {
    if (only && s.id !== only) continue;
    const problems = SessionValidator.problems(s, durations);
    if (problems.length) { console.error(`Skipping ${s.id}: ${problems.join('; ')}`); continue; }
    const narration = createHash('sha256');
    for (const id of usedSegments(s)) narration.update(readFileSync(path.join(NARRATION_DIR, manifest.segments[id].file)));
    const ck = contentKey(texts[s.id], s, durations);
    const buildKey = sha(`${ck}|${narration.digest('hex')}|${engine}`);
    const prev = index.sessions[s.id];
    const bedOptions = (s.noiseBed?.optionsMinutes ?? []).filter((m) => m > 0);
    const files = [...Object.keys(VARIANTS).map((v) => `${s.id}/${v}.m4a`), ...bedOptions.map((m) => bedFile(s, m))];
    const fresh = prev && prev.buildKey === buildKey && files.every((f) => existsSync(path.join(AUDIO_DIR, f)));
    if (fresh && !force) continue;
    plan.push({ s, ck, buildKey, bedOptions });
  }

  // Remove renders of sessions that no longer exist.
  const ids = new Set(sessions.map((s) => s.id));
  for (const id of Object.keys(index.sessions)) {
    if (!ids.has(id)) { delete index.sessions[id]; rmSync(path.join(AUDIO_DIR, id), { recursive: true, force: true }); log(`Removed renders of deleted session ${id}`); }
  }

  await ensureSilence();
  if (!plan.length) {
    writeFileSync(indexFile, JSON.stringify(index, null, 1));
    await ensureSetupSounds(index);
    log('Pre-rendered audio is up to date.');
    return;
  }
  buildSwiftRenderer();
  const tmp = mkdtempSync(path.join(tmpdir(), 'stillpoint-render-'));
  try {
    for (const { s, ck, buildKey, bedOptions } of plan) {
      const tl = new ResolvedTimeline(s, durations);
      log(`Rendering ${s.id} (${(tl.sessionDuration / 60).toFixed(1)} min) × ${Object.keys(VARIANTS).length} variants…`);
      const dir = path.join(AUDIO_DIR, s.id);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const t0 = Date.now();
      await Promise.all(Object.keys(VARIANTS).map((v) => renderVariant(s.id, v, path.join(dir, `${v}.m4a`), tmp)));
      const entry = { contentKey: ck, buildKey, title: s.title, duration: tl.sessionDuration, variants: {}, beds: {}, renderedAt: new Date().toISOString() };
      for (const v of Object.keys(VARIANTS)) {
        const f = path.join(dir, `${v}.m4a`);
        const d = audioDuration(f);
        if (!(Math.abs(d - tl.sessionDuration) < 0.5)) throw new Error(`${s.id}/${v}: encoded length ${d}s, expected ${tl.sessionDuration}s`);
        entry.variants[v] = { file: `${s.id}/${v}.m4a`, bytes: statSync(f).size };
      }
      for (const m of bedOptions) {
        // Beds depend only on the noise colour and bed settings, so sessions share them.
        const rel = bedFile(s, m), f = path.join(AUDIO_DIR, rel);
        if (!existsSync(f) || force) {
          log(`  noise bed ${m / 60} h…`);
          mkdirSync(path.dirname(f), { recursive: true });
          await renderBed(s, m, f);
        }
        entry.beds[m] = { file: rel, bytes: statSync(f).size, duration: m * 60 };
      }
      index.sessions[s.id] = entry;
      writeFileSync(indexFile, JSON.stringify(index, null, 1));
      const mb = (Object.values(entry.variants).reduce((a, v) => a + v.bytes, 0) + Object.values(entry.beds).reduce((a, v) => a + v.bytes, 0)) / 1e6;
      log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${mb.toFixed(0)} MB`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  await ensureSetupSounds(index);
  log('Pre-rendered audio is up to date.');
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
