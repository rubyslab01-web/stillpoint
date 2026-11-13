// Port of ShippedSessionTests and AppCoreTests: the validator over every real session file,
// the Sleep timeline from the brief, and the self-experiment / onboarding logic.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ResolvedTimeline, SessionValidator, decodeSession, SessionFormatError, contentKey } from '../js/engine/session.js';
import { Experiment, Suggestibility, VolumePolicy } from '../js/app/experiment.js';
import { chooseMode } from '../js/app/modes.js';
import { ROOT, loadShipped } from './helpers.mjs';

describe('Shipped sessions', () => {
  const { sessions, durations, modules, texts } = loadShipped();

  test('every session file is valid and its narration exists', () => {
    assert.deepEqual(new Set(sessions.map((s) => s.module)), new Set(['sleep', 'quit-smoking', 'gratitude', 'inner-coherence', 'loving-compassion']));
    for (const s of sessions) {
      assert.deepEqual(SessionValidator.problems(s, durations), [], s.id);
      for (const seg of s.phases.flatMap((p) => p.segments)) {
        assert.ok(existsSync(path.join(ROOT, 'App/Resources/Narration', `${seg.id}.m4a`)), `missing audio ${seg.id}`);
      }
    }
  });

  test('every module in modules.json has sessions, and every session has a module', () => {
    const ids = new Set(modules.map((m) => m.id));
    for (const s of sessions) assert.ok(ids.has(s.module), s.id);
    for (const m of modules) assert.ok(sessions.some((s) => s.module === m.id), m.id);
  });

  test('every awake session ends alert and Sleep does not', () => {
    for (const s of sessions.filter((x) => x.awake)) assert.ok(s.phases[s.phases.length - 1].beatHz >= 12, s.id);
    const sleep = sessions.find((s) => s.id === 'sleep-deep');
    assert.equal(sleep.awake, false);
    assert.equal(sleep.phases[sleep.phases.length - 1].beatHz, 3);
  });

  test('sleep timeline matches the brief: 10 → 6 → 3 Hz, beats gone by 90 minutes', () => {
    const sleep = sessions.find((s) => s.id === 'sleep-deep');
    const tl = new ResolvedTimeline(sleep, durations);
    assert.equal(tl.beatHz.value(0), 10);
    assert.equal(tl.beatHz.value(8 * 60), 6);
    assert.ok(Math.abs(tl.beatHz.value(30 * 60) - 3) < 1e-9);
    assert.equal(tl.beatsDb.value(60 * 60), -34);
    assert.ok(tl.beatsDb.value(89.5 * 60) <= -90);
    assert.ok(Math.abs(tl.sessionDuration - 90 * 60) < 1);
    assert.ok(tl.voice[tl.voice.length - 1].end < 15 * 60);
    assert.ok(tl.carrierHz >= 200 && tl.carrierHz <= 250);
    const bed = new ResolvedTimeline(sleep, durations, 480);
    assert.ok(Math.abs(bed.totalDuration - (90 + 480) * 60) < 1);
  });

  test('validator catches the rule violations the native one does', () => {
    const base = structuredClone(sessions.find((s) => s.id === 'qs-rescue-2'));
    const bad = structuredClone(base);
    bad.phases[0].levels.beats = bad.phases[0].levels.noise - 10;
    bad.phases[bad.phases.length - 1].beatHz = 8;
    bad.phases[0].segments.push({ id: 'does-not-exist', pauseAfter: 1 });
    const p = SessionValidator.problems(bad, durations);
    assert.ok(p.some((x) => x.includes('dB under noise')));
    assert.ok(p.some((x) => x.startsWith('awake session must end at ≥ 12.0 Hz')));
    assert.ok(p.some((x) => x.includes("narration 'does-not-exist' missing")));
  });

  test('decoding rejects a file missing required fields, like Swift Codable', () => {
    const raw = JSON.parse(texts['qs-rescue-2']);
    delete raw.ducking;
    assert.throws(() => decodeSession(raw, 'x.json'), SessionFormatError);
    const ok = JSON.parse(texts['qs-rescue-2']);
    delete ok.phases[0].levels.ambient; // optional, defaults to -96
    assert.equal(decodeSession(ok).phases[0].levels.ambient, -96);
  });

  test('content key changes when the session or a narration duration changes', () => {
    const s = sessions.find((x) => x.id === 'gratitude-three-good-things');
    const k = contentKey(texts[s.id], s, durations);
    assert.notEqual(contentKey(texts[s.id] + ' ', s, durations), k);
    const seg = s.phases[0].segments[0].id;
    assert.notEqual(contentKey(texts[s.id], s, { ...durations, [seg]: durations[seg] + 0.001 }), k);
    assert.equal(contentKey(texts[s.id], s, durations), k);
  });
});

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const rec = (o) => ({ inExperiment: true, ratingsBefore: {}, ratingsAfter: {}, ...o });

describe('Self-experiment', () => {
  test('assignment stays balanced and is not predictable', () => {
    const rnd = seeded(42);
    let on = 0, off = 0; const seq = [];
    for (let i = 0; i < 200; i++) {
      const b = Experiment.assignBeatsCounts(on, off, rnd);
      seq.push(b); if (b) on++; else off++;
      assert.ok(Math.abs(on - off) <= 2);
    }
    assert.ok(on > 80 && off > 80);
    assert.ok(seq.some((v, i) => i > 0 && v === seq[i - 1]));
  });
  test('forced arm when unbalanced', () => {
    assert.equal(Experiment.assignBeatsCounts(5, 3), false);
    assert.equal(Experiment.assignBeatsCounts(1, 3), true);
  });
  const craving = { id: 'craving', before: true, after: true, higherIsBetter: false, timing: null };
  const quality = { id: 'quality', before: false, after: true, higherIsBetter: true, timing: 'nextMorning' };
  test('score is signed so positive means better', () => {
    assert.equal(Experiment.score(rec({ ratingsBefore: { craving: 8 }, ratingsAfter: { craving: 3 } }), craving), 5);
    assert.equal(Experiment.score(rec({ ratingsAfter: { quality: 7 } }), quality), 7);
    assert.equal(Experiment.score(rec({ ratingsAfter: { craving: 3 } }), craving), null);
  });
  test('results stay hidden until five rated sessions per arm', () => {
    const r = Experiment.compare('m', '', [1, 2, 3, 4, 5, 6], [1, 2, 3]);
    assert.equal(r.verdict, 'collecting'); assert.equal(r.needed, 2); assert.equal(r.revealed, false);
  });
  test('verdicts', () => {
    assert.equal(Experiment.compare('m', '', [5, 6, 5, 6, 5], [2, 3, 2, 3, 2]).verdict, 'beatsHelp');
    assert.equal(Experiment.compare('m', '', [2, 3, 2, 3, 2], [5, 6, 5, 6, 5]).verdict, 'beatsHurt');
    assert.equal(Experiment.compare('m', '', [1, 5, 3, 4, 2], [2, 4, 3, 5, 1]).verdict, 'noClearDifference');
    const same = Experiment.compare('m', '', [3, 3, 3, 3, 3], [3, 3, 3, 3, 3]);
    assert.equal(same.verdict, 'noClearDifference'); assert.equal(same.effect, 0);
  });
  test('module results use only experiment sessions of that module', () => {
    const h = [];
    for (let i = 0; i < 5; i++) {
      h.push(rec({ moduleID: 'quit-smoking', beatsEnabled: true, ratingsBefore: { craving: 8 }, ratingsAfter: { craving: 2 + (i % 2) } }));
      h.push(rec({ moduleID: 'quit-smoking', beatsEnabled: false, ratingsBefore: { craving: 8 }, ratingsAfter: { craving: 6 + (i % 2) } }));
      h.push(rec({ moduleID: 'sleep', beatsEnabled: true, ratingsAfter: { quality: 1 } }));
      h.push(rec({ moduleID: 'quit-smoking', beatsEnabled: false, inExperiment: false, ratingsBefore: { craving: 8 }, ratingsAfter: { craving: 0 } }));
    }
    const res = Experiment.results(h, 'quit-smoking', [craving], 'craving');
    assert.equal(res.length, 1);
    assert.equal(res[0].withBeats.n, 5); assert.equal(res[0].withoutBeats.n, 5);
    assert.equal(res[0].verdict, 'beatsHelp');
    assert.ok(Math.abs(res[0].withBeats.mean - 5.6) < 1e-9);
  });
});

describe('Onboarding and policy', () => {
  test('suggestibility levels', () => {
    assert.equal(Suggestibility.level([0, 1, 1, 0, 1]), 'lower');
    assert.equal(Suggestibility.level([2, 2, 2, 2, 2]), 'medium');
    assert.equal(Suggestibility.level([4, 3, 4, 3, 3]), 'higher');
    assert.equal(Suggestibility.items.length, 5);
  });
  test('volume is capped at 0.75', () => {
    assert.equal(VolumePolicy.clamp(1), 0.75); assert.equal(VolumePolicy.clamp(0), 0.05); assert.equal(VolumePolicy.clamp(0.4), 0.4);
  });
  test('speaker mode chooses isochronic; headphones choose binaural', () => {
    assert.equal(chooseMode({ speakerMode: true }), 'isochronic');
    assert.equal(chooseMode({ speakerMode: false }), 'binaural');
  });
});
