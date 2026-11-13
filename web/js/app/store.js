// On-device storage. One kind of record, as in the native app: a session log. Kept in
// IndexedDB in this browser only (no iCloud/CloudKit in the web build). Device preferences live
// in localStorage. Export-all and delete-all cover both.
//
// Record shape (mirrors SessionRecord in HypnosisAppCore/Data/Models.swift):
//   id, sessionID, moduleID, sessionTitle, startedAt (ISO), plannedSeconds, completedSeconds,
//   finished, beatsEnabled, inExperiment, beatMode ('binaural'|'isochronic'), engine
//   ('stream'|'live'), noiseBedMinutes, ratingsBefore {}, ratingsAfter {}, note,
//   awaitingMorningRatings,
//   sleep: null | { source, onsetMinutes, deepMinutes, remMinutes, totalMinutes }
//     (reserved for a sleep-data source such as a wearable; see sources.js. Nothing fills it yet.)
//   heart: null | { source, avgHeartRate, hrvSDNN } (reserved, as above)

import { VolumePolicy } from './experiment.js';

const DB_NAME = 'stillpoint';
const STORE = 'sessions';
const LS_FALLBACK = 'stillpoint.sessions';

export function uuid() {
  if (globalThis.crypto?.randomUUID) { try { return crypto.randomUUID(); } catch { /* insecure context */ } }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function newRecord(fields) {
  return {
    id: uuid(), sessionID: '', moduleID: '', sessionTitle: '', startedAt: new Date().toISOString(),
    plannedSeconds: 0, completedSeconds: 0, finished: false, beatsEnabled: true, inExperiment: false,
    beatMode: 'binaural', engine: 'stream', noiseBedMinutes: 0, ratingsBefore: {}, ratingsAfter: {}, note: '',
    awaitingMorningRatings: false, sleep: null, heart: null, ...fields,
  };
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class Store {
  async open() {
    try { this.db = await openDB(); this.kind = 'indexeddb'; } catch { this.db = null; this.kind = 'localstorage'; }
    // Ask the browser not to evict our data under storage pressure (secure contexts only).
    try { this.persisted = await navigator.storage?.persist?.(); } catch { this.persisted = false; }
    return this;
  }

  tx(mode) { return this.db.transaction(STORE, mode).objectStore(STORE); }
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  lsAll() { try { return JSON.parse(localStorage.getItem(LS_FALLBACK) || '[]'); } catch { return []; } }
  lsSave(list) { try { localStorage.setItem(LS_FALLBACK, JSON.stringify(list)); } catch { /* full or blocked */ } }

  /** All records, newest first. */
  async all() {
    const list = this.db ? await this.req(this.tx('readonly').getAll()) : this.lsAll();
    return list.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  async put(record) {
    if (this.db) { await this.req(this.tx('readwrite').put(record)); return; }
    const list = this.lsAll().filter((r) => r.id !== record.id);
    list.push(record); this.lsSave(list);
  }

  async get(id) {
    if (this.db) return (await this.req(this.tx('readonly').get(id))) ?? null;
    return this.lsAll().find((r) => r.id === id) ?? null;
  }

  async update(id, fn) {
    const r = await this.get(id);
    if (!r) return null;
    fn(r);
    await this.put(r);
    return r;
  }

  async deleteAll() {
    if (this.db) await this.req(this.tx('readwrite').clear());
    try { localStorage.removeItem(LS_FALLBACK); } catch { /* ignore */ }
  }

  async exportJSON(settings) {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      app: 'Stillpoint (web)',
      note: 'All personal data stored by the app in this browser. Ratings are 0-10 self-ratings. beatsEnabled shows which sessions had beats in the self-experiment.',
      settings: settings.snapshot(),
      sessions: await this.all(),
    }, null, 2);
  }
}

/** Device-local preferences (port of AppSettings). */
export class Settings {
  static keys = ['onboardingDone', 'volume', 'speakerMode', 'experimentEnabled', 'suggestibility', 'engine', 'keepScreenOn', 'headphoneCheck'];
  constructor() {
    const get = (k) => { try { const v = localStorage.getItem(`stillpoint.${k}`); return v === null ? undefined : JSON.parse(v); } catch { return undefined; } };
    this.onboardingDone = get('onboardingDone') ?? false;
    this.volume = get('volume') ?? VolumePolicy.defaultGain;
    this.speakerMode = get('speakerMode') ?? false;
    this.experimentEnabled = get('experimentEnabled') ?? true;
    this.suggestibility = get('suggestibility') ?? '';
    this.engine = get('engine') ?? 'stream';
    this.keepScreenOn = get('keepScreenOn') ?? null; // null = automatic (on for the live engine)
    this.headphoneCheck = get('headphoneCheck') ?? null;
  }
  set(k, v) {
    this[k] = v;
    try { localStorage.setItem(`stillpoint.${k}`, JSON.stringify(v)); } catch { /* private mode or full */ }
  }
  snapshot() { return Object.fromEntries(Settings.keys.map((k) => [k, this[k]])); }
  reset() {
    for (const k of Settings.keys) { try { localStorage.removeItem(`stillpoint.${k}`); } catch { /* ignore */ } }
    Object.assign(this, new Settings());
  }
}
