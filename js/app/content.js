// Loads everything the app shows and plays, at runtime, from the same files the native app
// bundles: Sessions/*.json, Sessions/modules.json and the narration manifest. Nothing is copied
// or compiled in, so a new or edited session appears with no code change (port of
// ContentLibrary). Pre-rendered audio is used only when its render matches the session file
// exactly; otherwise that session plays with the live engine and the app says why.

import { decodeSession, sortSessions, ResolvedTimeline, SessionValidator, contentKey } from '../engine/session.js';

export async function loadContent(base) {
  const url = (p) => new URL(p, base).href;
  const fetchOK = async (p, as = 'json') => {
    const r = await fetch(url(p), { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    return as === 'json' ? r.json() : r.text();
  };

  const problems = [];
  const [index, modulesFile, manifest] = await Promise.all([
    fetchOK('content/Sessions/index.json'),
    fetchOK('content/Sessions/modules.json'),
    fetchOK('content/Narration/manifest.json'),
  ]);
  const durations = Object.fromEntries(Object.entries(manifest.segments).map(([k, v]) => [k, v.duration]));

  const texts = {};
  const loaded = await Promise.all(index.files.map(async (f) => {
    try {
      const text = await fetchOK(`content/Sessions/${encodeURIComponent(f)}`, 'text');
      const s = decodeSession(JSON.parse(text), f);
      texts[s.id] = text;
      return s;
    } catch (e) { problems.push(`${f}: ${e.message}`); return null; }
  }));
  const sessions = sortSessions(loaded.filter(Boolean));
  for (const s of sessions) problems.push(...SessionValidator.problems(s, durations).map((p) => `${s.id}: ${p}`));

  let rendersFile = null;
  try { rendersFile = await fetchOK('audio/renders.json'); } catch { /* no pre-rendered audio: live engine only */ }
  const renders = {}, stale = [];
  for (const s of sessions) {
    const e = rendersFile?.sessions?.[s.id];
    if (!e) { stale.push({ id: s.id, reason: 'not rendered' }); continue; }
    if (e.contentKey !== contentKey(texts[s.id], s, durations)) { stale.push({ id: s.id, reason: 'session or narration changed since it was rendered' }); continue; }
    renders[s.id] = e;
  }

  const durationCache = new Map();
  return {
    base,
    modules: modulesFile.modules,
    sessions,
    manifest,
    durations,
    problems,
    renders,
    stale,
    renderedGain: rendersFile?.userGain ?? 0.75,
    audioBase: url('audio/'),
    narrationBase: url('content/Narration/'),
    silenceURL: url('assets/silence.m4a'),
    module(id) { return this.modules.find((m) => m.id === id) ?? null; },
    session(id) { return this.sessions.find((s) => s.id === id) ?? null; },
    sessionsIn(moduleID) { return this.sessions.filter((s) => s.module === moduleID).sort((a, b) => a.sortOrder - b.sortOrder); },
    /** Length of the guided session in seconds. */
    duration(s) {
      if (!durationCache.has(s.id)) {
        let d = 0;
        try { d = new ResolvedTimeline(s, durations).sessionDuration; } catch { /* reported in problems */ }
        durationCache.set(s.id, d);
      }
      return durationCache.get(s.id);
    },
    timeline(s, bedMinutes = 0) { return new ResolvedTimeline(s, durations, bedMinutes); },
  };
}
