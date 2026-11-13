// Port of EntrainmentKit/Session: the session file format, the resolved timeline, and the
// validator. Session files are read at runtime from the repository's Sessions/ folder, never
// copied, so a new or edited session needs no code change here.

import { Envelope } from './dsp.js';

export class SessionFormatError extends Error {}

const NOISE = ['white', 'pink', 'brown'];
const AMBIENT = ['warmPad', 'deepDrone', 'glow', 'forest'];
const PACER_SOUNDS = ['tone', 'wind'];

function need(obj, key, type, where) {
  const v = obj?.[key];
  if (v === undefined || v === null) throw new SessionFormatError(`${where}: missing "${key}"`);
  if (type === 'array' ? !Array.isArray(v) : typeof v !== type) {
    throw new SessionFormatError(`${where}: "${key}" should be ${type}`);
  }
  return v;
}
function opt(obj, key, type, where) {
  const v = obj?.[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== type) throw new SessionFormatError(`${where}: "${key}" should be ${type}`);
  return v;
}

/**
 * Decodes a session object with the same rules as Swift's Codable `SessionDefinition`:
 * every non-optional field must be present; `levels.ambient`/`levels.pacer` default to -96.
 */
export function decodeSession(raw, where = 'session') {
  const s = {};
  for (const k of ['id', 'module', 'title', 'subtitle', 'kind']) s[k] = need(raw, k, 'string', where);
  s.awake = need(raw, 'awake', 'boolean', where);
  for (const k of ['carrierHz', 'fadeInSeconds', 'fadeOutSeconds', 'isochronicOffsetDb', 'sortOrder']) s[k] = need(raw, k, 'number', where);
  s.noise = need(raw, 'noise', 'string', where);
  if (!NOISE.includes(s.noise)) throw new SessionFormatError(`${where}: unknown noise "${s.noise}"`);
  s.ambient = opt(raw, 'ambient', 'string', where) ?? null;
  if (s.ambient !== null && !AMBIENT.includes(s.ambient)) throw new SessionFormatError(`${where}: unknown ambient "${s.ambient}"`);
  const d = need(raw, 'ducking', 'object', where);
  s.ducking = {};
  for (const k of ['amountDb', 'attackSeconds', 'releaseSeconds', 'leadSeconds']) s.ducking[k] = need(d, k, 'number', `${where}.ducking`);
  s.phases = need(raw, 'phases', 'array', where).map((p, i) => {
    const w = `${where}.phases[${i}]`;
    const ph = {};
    for (const k of ['id', 'name']) ph[k] = need(p, k, 'string', w);
    for (const k of ['beatHz', 'beatGlideSeconds', 'levelGlideSeconds', 'leadInSeconds', 'tailSeconds', 'minDurationSeconds']) ph[k] = need(p, k, 'number', w);
    const l = need(p, 'levels', 'object', w);
    ph.levels = {
      beats: need(l, 'beats', 'number', `${w}.levels`),
      noise: need(l, 'noise', 'number', `${w}.levels`),
      ambient: opt(l, 'ambient', 'number', `${w}.levels`) ?? -96,
      pacer: opt(l, 'pacer', 'number', `${w}.levels`) ?? -96,
    };
    ph.segments = need(p, 'segments', 'array', w).map((g, j) => ({
      id: need(g, 'id', 'string', `${w}.segments[${j}]`),
      pauseAfter: need(g, 'pauseAfter', 'number', `${w}.segments[${j}]`),
    }));
    const pc = p.pacer;
    if (pc !== undefined && pc !== null) {
      ph.pacer = {};
      for (const k of ['breathsPerMinute', 'inhaleFraction', 'lowHz', 'highHz']) ph.pacer[k] = need(pc, k, 'number', `${w}.pacer`);
      ph.pacer.sound = opt(pc, 'sound', 'string', `${w}.pacer`) ?? 'tone';
      if (!PACER_SOUNDS.includes(ph.pacer.sound)) throw new SessionFormatError(`${w}.pacer: unknown sound "${ph.pacer.sound}"`);
    } else ph.pacer = null;
    return ph;
  });
  const bed = raw.noiseBed;
  if (bed !== undefined && bed !== null) {
    const w = `${where}.noiseBed`;
    s.noiseBed = {
      optionsMinutes: need(bed, 'optionsMinutes', 'array', w),
      defaultMinutes: need(bed, 'defaultMinutes', 'number', w),
      levelDb: need(bed, 'levelDb', 'number', w),
      crossfadeSeconds: need(bed, 'crossfadeSeconds', 'number', w),
      fadeOutSeconds: need(bed, 'fadeOutSeconds', 'number', w),
    };
  } else s.noiseBed = null;
  s.ratings = need(raw, 'ratings', 'array', where).map((r, i) => {
    const w = `${where}.ratings[${i}]`;
    const range = need(r, 'range', 'array', w);
    if (range.length !== 2 || range[0] > range[1]) throw new SessionFormatError(`${w}: bad range`);
    return {
      id: need(r, 'id', 'string', w), question: need(r, 'question', 'string', w),
      minLabel: need(r, 'minLabel', 'string', w), maxLabel: need(r, 'maxLabel', 'string', w),
      range: [range[0], range[1]],
      before: need(r, 'before', 'boolean', w), after: need(r, 'after', 'boolean', w),
      higherIsBetter: need(r, 'higherIsBetter', 'boolean', w),
      timing: opt(r, 'timing', 'string', w) ?? null,
    };
  });
  return s;
}

/** Sorts like SessionLibrary: by (module, sortOrder). */
export function sortSessions(list) {
  return [...list].sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : a.sortOrder - b.sortOrder));
}

// ---------------------------------------------------------------------------------------------

export class ResolveError extends Error {}

/** A session resolved against real narration durations into absolute-time curves. */
export class ResolvedTimeline {
  /**
   * @param {object} session decoded session
   * @param {Record<string, number>} durations narration segment durations (seconds)
   * @param {number} noiseBedMinutes user-selected noise bed length (0 = none)
   */
  constructor(session, durations, noiseBedMinutes = 0) {
    if (!session.phases.length) throw new ResolveError('Session has no phases');
    this.carrierHz = session.carrierHz;
    this.ducking = session.ducking;
    this.fadeIn = session.fadeInSeconds;
    this.fadeOut = session.fadeOutSeconds;
    this.noise = session.noise;
    this.ambient = session.ambient;
    this.isochronicOffsetDb = session.isochronicOffsetDb;

    const beat = [], beats = [], noise = [], amb = [], pac = [];
    const phases = [], voice = [], pacers = [];
    let t = 0;
    session.phases.forEach((phase, i) => {
      const start = t;
      if (i === 0) {
        beat.push({ time: 0, value: phase.beatHz });
        beats.push({ time: 0, value: phase.levels.beats });
        noise.push({ time: 0, value: phase.levels.noise });
        amb.push({ time: 0, value: phase.levels.ambient });
        pac.push({ time: 0, value: phase.levels.pacer });
      } else {
        // Hold the previous value until the phase boundary, then glide.
        const glide = (arr, v, g) => {
          const prev = arr[arr.length - 1].value;
          arr.push({ time: start, value: prev, shape: 'linear' });
          arr.push({ time: start + Math.max(g, 0.001), value: v, shape: 'smooth' });
        };
        glide(beat, phase.beatHz, phase.beatGlideSeconds);
        glide(beats, phase.levels.beats, phase.levelGlideSeconds);
        glide(noise, phase.levels.noise, phase.levelGlideSeconds);
        glide(amb, phase.levels.ambient, phase.levelGlideSeconds);
        glide(pac, phase.levels.pacer, phase.levelGlideSeconds);
      }
      let cursor = start + phase.leadInSeconds;
      for (const seg of phase.segments) {
        const d = durations[seg.id];
        if (d === undefined) throw new ResolveError(`Narration segment '${seg.id}' not in manifest`);
        voice.push({ segmentID: seg.id, start: cursor, duration: d, end: cursor + d });
        cursor += d + seg.pauseAfter;
      }
      cursor += phase.tailSeconds;
      const end = Math.max(cursor, start + phase.minDurationSeconds);
      phases.push({ id: phase.id, name: phase.name, start, end });
      if (phase.pacer) pacers.push({ start, end, settings: phase.pacer });
      t = end;
    });
    this.sessionDuration = t;
    let total = t;
    const bed = session.noiseBed;
    if (bed && noiseBedMinutes > 0) {
      const xf = bed.crossfadeSeconds;
      const fadeTo = (arr, v) => {
        const prev = arr[arr.length - 1].value;
        arr.push({ time: t, value: prev, shape: 'linear' });
        arr.push({ time: t + xf, value: v, shape: 'smooth' });
      };
      fadeTo(beats, -96); fadeTo(amb, -96); fadeTo(pac, -96);
      fadeTo(noise, bed.levelDb);
      total = t + noiseBedMinutes * 60;
      phases.push({ id: 'noise-bed', name: 'Noise bed', start: t, end: total });
      this.fadeOut = bed.fadeOutSeconds;
    }
    this.totalDuration = total;
    this.beatHz = new Envelope(beat);
    this.beatsDb = new Envelope(beats);
    this.noiseDb = new Envelope(noise);
    this.ambientDb = new Envelope(amb);
    this.pacerDb = new Envelope(pac);
    this.phases = phases;
    this.voice = voice;
    this.pacers = pacers;
    const lead = session.ducking.leadSeconds;
    this.voiceActivity = voice.map((v) => [v.start - lead, v.end]);
  }

  phase(t) {
    return this.phases.find((p) => t >= p.start && t < p.end) ?? (t >= this.totalDuration ? this.phases[this.phases.length - 1] : null);
  }
}

// ---------------------------------------------------------------------------------------------

/** Swift prints Doubles as "12.0"; mirror that so messages read the same on both platforms. */
const num = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const within = (x, lo, hi) => x >= lo && x <= hi;

/** Rules every session file must satisfy (port of SessionValidator). */
export const SessionValidator = {
  alertBeatHz: 12,
  problems(s, durations) {
    const out = [];
    if (!s.phases.length) out.push('no phases');
    if (!within(s.carrierHz, 100, 500)) out.push(`carrier ${num(s.carrierHz)} Hz outside 100–500 Hz`);
    const seen = new Set();
    for (const p of s.phases) {
      if (!within(p.beatHz, 0.5, 40)) out.push(`${p.id}: beat ${num(p.beatHz)} Hz outside 0.5–40 Hz`);
      if (p.levels.beats > -90 && p.levels.noise > -90) {
        const under = p.levels.noise - p.levels.beats;
        if (!within(under, 15, 20)) out.push(`${p.id}: beats are ${num(under)} dB under noise (must be 15–20)`);
      }
      for (const l of [p.levels.noise, p.levels.ambient, p.levels.pacer, p.levels.beats]) {
        if (l > -6) out.push(`${p.id}: a background layer at ${num(l)} dB would compete with the voice (max -6)`);
      }
      for (const seg of p.segments) {
        if (durations[seg.id] === undefined) out.push(`${p.id}: narration '${seg.id}' missing from manifest`);
        if (seen.has(seg.id)) out.push(`${p.id}: narration '${seg.id}' used twice`); else seen.add(seg.id);
        if (seg.pauseAfter < 0) out.push(`${p.id}: negative pause`);
      }
      if (p.pacer && !within(p.pacer.breathsPerMinute, 3, 12)) out.push(`${p.id}: pacer ${num(p.pacer.breathsPerMinute)} breaths/min outside 3–12`);
    }
    if (s.awake) {
      const last = s.phases[s.phases.length - 1];
      if (last && last.beatHz < this.alertBeatHz) out.push(`awake session must end at ≥ ${num(this.alertBeatHz)} Hz (ends at ${num(last.beatHz)})`);
      if (s.noiseBed) out.push('awake session must not have a noise bed');
    }
    if (s.fadeInSeconds <= 0 || s.fadeOutSeconds <= 0) out.push('fade in/out must be > 0');
    for (const r of s.ratings) if (!(r.before || r.after)) out.push(`rating ${r.id} is never asked`);
    if (!out.length) {
      try {
        const tl = new ResolvedTimeline(s, durations);
        if (tl.sessionDuration < 30) out.push('session shorter than 30 s');
        if (tl.fadeIn + tl.fadeOut > tl.sessionDuration) out.push('fades longer than session');
      } catch { /* resolve errors are already reported above */ }
    }
    return out;
  },
};

/** Narration segment ids a session uses, in order. */
export function usedSegments(session) {
  return session.phases.flatMap((p) => p.segments.map((s) => s.id));
}

/**
 * Identifies the exact inputs a pre-rendered file was made from: the session file's text and the
 * duration of every narration segment it uses. Computed identically in Node (when rendering) and
 * in the browser (to detect stale renders). cyrb53: tiny, fast, and available without
 * crypto.subtle, which plain-HTTP pages don't get.
 */
export function contentKey(sessionText, session, durations) {
  const segs = usedSegments(session).map((id) => `${id}:${durations[id]}`).join(',');
  return cyrb53(`${sessionText}\n${segs}`);
}

export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
