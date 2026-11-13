// Reads the shared content (Sessions/, narration manifest) from the repository for Node tools.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decodeSession, sortSessions } from '../js/engine/session.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const WEB = path.join(ROOT, 'web');
export const SESSIONS_DIR = path.join(ROOT, 'Sessions');
export const NARRATION_DIR = path.join(ROOT, 'App/Resources/Narration');
export const AUDIO_DIR = path.join(WEB, 'audio');

export function sessionFiles() {
  return readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json') && f !== 'modules.json').sort();
}

export function loadContent() {
  const manifest = JSON.parse(readFileSync(path.join(NARRATION_DIR, 'manifest.json'), 'utf8'));
  const durations = Object.fromEntries(Object.entries(manifest.segments).map(([k, v]) => [k, v.duration]));
  const texts = {}, files = {};
  const errors = [];
  const sessions = [];
  for (const f of sessionFiles()) {
    const text = readFileSync(path.join(SESSIONS_DIR, f), 'utf8');
    try {
      const s = decodeSession(JSON.parse(text), f);
      texts[s.id] = text; files[s.id] = f;
      sessions.push(s);
    } catch (e) { errors.push(`${f}: ${e.message}`); }
  }
  const modules = JSON.parse(readFileSync(path.join(SESSIONS_DIR, 'modules.json'), 'utf8')).modules;
  return { manifest, durations, sessions: sortSessions(sessions), texts, files, modules, errors };
}
