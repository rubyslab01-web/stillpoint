#!/usr/bin/env node
// End-to-end smoke test of the web app in headless Chrome (desktop Chromium, not Safari).
// Drives the real UI over the DevTools protocol with Node's built-in WebSocket: onboarding,
// every screen, a pre-rendered session, a live-engine session, ratings, export, delete-all.
// Saves phone-size screenshots. Needs the server running (./serve-web.sh or web/tools/server.py).
//
//   node web/tests/smoke-chrome.mjs [--url http://localhost:8000/] [--shots DIR]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const URL0 = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:8000/';
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

const profile = mkdtempSync(path.join(tmpdir(), 'stillpoint-chrome-'));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', `--user-data-dir=${profile}`,
  '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, id = 0;
const pending = new Map(), errors = [], logs = [];
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(`${msg.params.entry.source}: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
  };
}
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expr.slice(0, 80)}… → ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}
const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no element ${sel.replace(/'/g, '')}'); el.click(); return true; })()`);
const text = () => js('document.body.innerText');
async function waitFor(cond, ms = 8000, what = cond) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await js(cond)) return; await sleep(100); }
  throw new Error(`timed out waiting for ${what}`);
}
let shotN = 0;
async function shot(name) {
  if (!SHOTS) return;
  await sleep(400); // let sheet animations finish
  mkdirSync(SHOTS, { recursive: true });
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(SHOTS, `${String(++shotN).padStart(2, '0')}-${name}.png`), Buffer.from(r.data, 'base64'));
}
const results = [];
async function step(name, fn) {
  const before = errors.length;
  try { await fn(); if (errors.length > before) throw new Error(errors.slice(before).join('\n')); results.push(['ok', name]); }
  catch (e) { results.push(['FAIL', `${name}: ${e.message}`]); }
}

try {
  await connect();
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: URL0 });
  await waitFor('document.body.innerText.includes("Welcome to Stillpoint")', 15000, 'onboarding');

  await step('setup: two pages (safety, then sound check with real audio files)', async () => {
    if (!(await js('document.querySelector("[data-act=ob-next]").disabled'))) throw new Error('Continue should be disabled until "I understand"');
    await shot('onboarding-welcome');
    await js('(() => { const c = document.querySelector("[data-change=ob-ack]"); c.checked = true; c.dispatchEvent(new Event("change", {bubbles:true})); })()');
    await click('[data-act="ob-next"]');
    if (!(await text()).includes('Sound check')) throw new Error('no sound check page');
    await click('[data-act="ob-tone"][data-v="left"]');
    await waitFor('window.__stillpoint.tones.playing', 4000, 'left tone playing');
    await click('[data-act="ob-heard"][data-k="heardLeft"][data-v="1"]');
    await click('[data-act="ob-sample"]');
    await waitFor('window.__stillpoint.tones.playing && window.__stillpoint.tones.el.currentTime > 0.5', 6000, 'volume sample playing');
    await shot('onboarding-sound');
    await click('[data-act="ob-sample"]');
    if (await js('window.__stillpoint.tones.playing')) throw new Error('sample did not stop');
    await click('[data-act="ob-next"]');
    await waitFor('document.body.innerText.includes("Craving now?")', 5000, 'home');
  });

  await step('optional absorption questions live in Settings', async () => {
    await js('location.hash = "#/settings"'); await sleep(150);
    await js('document.querySelector("details").open = true');
    for (let i = 0; i < 5; i++) await click(`[data-act="abs-answer"][data-i="${i}"][data-v="2"]`);
    if (await js('localStorage.getItem("stillpoint.suggestibility")') !== '"medium"') throw new Error('suggestibility not saved');
    await js('location.hash = "#/"'); await sleep(150);
  });

  await step('home lists five modules and the rescue button', async () => {
    const t = await text();
    for (const m of ['Sleep', 'Quit Smoking', 'Gratitude', 'Inner Coherence', 'Loving Compassion']) if (!t.includes(m)) throw new Error(`missing ${m}`);
    if (!t.includes('Wellness, not treatment')) throw new Error('missing disclaimer');
    await shot('home');
  });

  await step('every screen renders', async () => {
    for (const h of ['#/module/sleep', '#/module/quit-smoking', '#/module/gratitude', '#/module/inner-coherence', '#/module/loving-compassion',
      '#/progress', '#/progress/sleep', '#/settings', '#/resources', '#/web']) {
      await js(`location.hash = ${JSON.stringify(h)}`);
      await sleep(150);
      const t = await text();
      if (t.includes('not found') || t.length < 50) throw new Error(`${h} looks empty`);
      if (h === '#/module/quit-smoking' && !t.includes('Use this with proven quitting methods')) throw new Error('cessation card missing');
      if (h === '#/module/gratitude' && !t.includes('Support and crisis lines')) throw new Error('crisis link missing');
      if (h === '#/resources' && !t.includes('988')) throw new Error('crisis numbers missing');
      if (['#/module/sleep', '#/module/quit-smoking', '#/settings', '#/web', '#/resources'].includes(h)) await shot(h.replace(/[#/]+/g, '-').slice(1));
    }
  });

  await step('rescue session starts at once (pre-rendered), plays, and records a log', async () => {
    await js('location.hash = "#/"'); await sleep(150);
    await click('[data-act="start-now"]');
    await waitFor('window.__stillpoint.active && window.__stillpoint.active.player.state === "playing"', 8000, 'playing');
    const engine = await js('window.__stillpoint.active.engine');
    if (engine !== 'stream') throw new Error(`engine ${engine}`);
    await sleep(2500);
    const t = await js('window.__stillpoint.active.player.currentTime');
    if (!(t > 1.5)) throw new Error(`audio time ${t}`);
    // Rescue: before-rating offered while playing.
    if (!(await text()).includes('How strong is the craving') && !(await js('!document.querySelector("[data-ref=rescue]").classList.contains("hidden")'))) throw new Error('no in-player craving rating');
    await click('[data-act="live-rate"][data-v="7"]');
    await shot('player-rescue');
    await click('[data-act="toggle-pp"]'); await sleep(300);
    if (await js('window.__stillpoint.active.player.state') !== 'paused') throw new Error('did not pause');
    await click('[data-act="toggle-pp"]');
    await waitFor('window.__stillpoint.active.player.state === "playing"', 4000, 'resume');
  });

  await step('scrub guard: small seeks (Safari’s own) are left alone, large ones are undone to the right time', async () => {
    const P = 'window.__stillpoint.active.player';
    await sleep(1500);
    const t0 = await js(`${P}.el.currentTime`);
    await js(`${P}.el.currentTime = ${P}.el.currentTime - 0.5`);
    await sleep(800);
    const t1 = await js(`${P}.el.currentTime`);
    if (!(t1 > t0 - 0.6 && t1 < t0 + 1.2)) throw new Error(`small seek was altered: ${t0} → ${t1}`);
    await js(`${P}.el.currentTime = ${P}.el.currentTime + 60`);
    await sleep(800);
    const t2 = await js(`${P}.el.currentTime`);
    if (!(t2 > t1 && t2 < t1 + 3)) throw new Error(`large seek not undone to the expected time: ${t1} → ${t2}`);
  });

  await step('replay: restarts from the beginning, old run saved as stopped', async () => {
    const P = 'window.__stillpoint.active';
    await click('[data-act="toggle-pp"]'); await sleep(300);
    if (await js(`${P}.player.state`) !== 'paused') throw new Error('pause failed');
    await click('[data-act="toggle-pp"]');
    await waitFor(`${P}.player.state === "playing"`, 4000, 'resume');
    await sleep(1500);
    const oldID = await js(`${P}.logID`);
    await click('[data-act="replay"]');
    if (!(await text()).includes('Start again from the beginning?')) throw new Error('no replay confirm');
    await click('[data-act="dialog-yes"]');
    await waitFor(`${P} && ${P}.logID !== ${JSON.stringify(oldID)} && ${P}.player.state === "playing"`, 8000, 'replayed session playing');
    const t = await js(`${P}.player.currentTime`);
    if (!(t < 3)) throw new Error(`replay did not start from the beginning (t=${t})`);
    const old = await js(`window.__stillpoint.store.get(${JSON.stringify(oldID)})`);
    if (!old || old.finished || !(old.completedSeconds > 1)) throw new Error(`old run not saved as stopped: ${JSON.stringify(old)}`);
    await js(`(async () => { const r = window.__stillpoint.records.find(x => x.id === ${P}.logID); })()`);
    await click('[data-act="live-rate"][data-v="7"]');
  });

  await step('ending early asks to confirm, then shows after-ratings, saved to history', async () => {
    await sleep(29000); // the after-session sheet appears only after 30 s of listening
    await click('[data-act="stop"]');
    if (!(await text()).includes('End this session?')) throw new Error('no confirm');
    await shot('confirm-stop');
    await click('[data-act="dialog-yes"]');
    await waitFor('window.__stillpoint.sheet && window.__stillpoint.sheet.type === "post"', 6000, 'post sheet');
    await click('[data-act="post-rate"][data-v="3"]');
    await js('(() => { const t = document.querySelector("[data-input=post-note]"); t.value = "water helped"; t.dispatchEvent(new Event("input", {bubbles:true})); })()');
    await shot('post-session');
    await click('[data-act="post-save"]');
    await sleep(300);
    const recs = await js('window.__stillpoint.store.all()');
    const r = recs.find((x) => x.note === 'water helped');
    if (!r || r.sessionID !== 'qs-rescue-2') throw new Error('no record');
    if (r.ratingsBefore.craving !== 7 || r.ratingsAfter.craving !== 3 || r.note !== 'water helped') throw new Error(`ratings not saved: ${JSON.stringify(r)}`);
    if (!(r.completedSeconds > 25)) throw new Error(`completedSeconds ${r.completedSeconds}`);
  });

  await step('play again from the after-session sheet', async () => {
    await js('location.hash = "#/"'); await sleep(150);
    await click('[data-act="start-now"]');
    await waitFor('window.__stillpoint.active && window.__stillpoint.active.player.state === "playing"', 8000, 'playing');
    await js('window.__stillpoint.active.player.currentTime');
    // Pretend 40 s were heard, then end, so the sheet appears.
    await js('(() => { const a = window.__stillpoint.active; a.player.el.currentTime = 40; a.player.lastGood = 40; a.player.lastGoodAt = performance.now(); })()');
    await sleep(500);
    await js('window.__stillpoint.active.player.stop(false)');
    await waitFor('window.__stillpoint.sheet && window.__stillpoint.sheet.type === "post"', 6000, 'post sheet');
    await shot('post-play-again');
    await click('[data-act="play-again"]');
    await waitFor('window.__stillpoint.active && window.__stillpoint.active.player.state === "playing"', 8000, 'playing again');
    await js('window.__stillpoint.active.player.stop(false)');
    await sleep(500);
    await js('window.__stillpoint.sheet = null');
  });

  await step('live engine: prep sheet, start, audio frames advance, speaker crossfade, no underruns', async () => {
    await js('location.hash = "#/settings"'); await sleep(150);
    await click('[data-act="set-engine"][data-v="live"]');
    await js('location.hash = "#/module/gratitude"'); await sleep(150);
    await click('[data-act="prep"]');
    await click('[data-act="prep-rate"][data-v="4"]');
    await shot('prep-sheet');
    await click('[data-act="prep-start"]');
    await waitFor('window.__stillpoint.active && window.__stillpoint.active.player.state === "playing"', 10000, 'live playing');
    if (await js('window.__stillpoint.active.engine') !== 'live') throw new Error('not live');
    await sleep(3000);
    const t = await js('window.__stillpoint.active.player.currentTime');
    if (!(t > 2)) throw new Error(`live time ${t}`);
    await js('(() => { const c = document.querySelector("[data-change=speaker-live]"); c.checked = true; c.dispatchEvent(new Event("change", {bubbles:true})); })()');
    if (await js('window.__stillpoint.active.mode') !== 'isochronic') throw new Error('mode not switched');
    await shot('player-live');
    await sleep(8000);
    const under = await js('window.__stillpoint.active.player.underruns');
    if (under) throw new Error(`${under} narration underruns`);
    await js('window.__stillpoint.active.player.stop(true)');
    await sleep(2000);
    await js('(() => { const c = document.querySelector("[data-change=speaker]"); })()');
  });

  await step('progress shows history; condition hidden while collecting', async () => {
    await js('window.__stillpoint.sheet = null; location.hash = "#/progress/quit-smoking"'); await sleep(300);
    const t = await text();
    if (!t.includes('Craving 7 → 3')) throw new Error('history row missing ratings');
    if (t.includes('Beats on') || t.includes('Beats off')) throw new Error('condition revealed too early');
    if (!t.includes('Still collecting')) throw new Error('experiment card missing');
    await shot('progress-quit');
  });

  await step('self-experiment reveals after five rated sessions per arm', async () => {
    await js(`(async () => {
      const S = window.__stillpoint;
      for (let i = 0; i < 10; i++) {
        await S.store.put({ id: 'fake-' + i, sessionID: 'qs-rescue-2', moduleID: 'quit-smoking', sessionTitle: 'Rescue', startedAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
          plannedSeconds: 100, completedSeconds: 100, finished: true, beatsEnabled: i % 2 === 0, inExperiment: true, beatMode: 'binaural', engine: 'stream',
          noiseBedMinutes: 0, ratingsBefore: { craving: 8 }, ratingsAfter: { craving: i % 2 === 0 ? 2 : 6 }, note: '', awaitingMorningRatings: false, sleep: null, heart: null });
      }
      S.records = await S.store.all();
    })()`);
    await js('location.hash = "#/progress/sleep"'); await sleep(100);
    await js('location.hash = "#/progress/quit-smoking"'); await sleep(300);
    const t = await text();
    if (!t.includes('Beats seem to help')) throw new Error('verdict missing');
    if (!t.includes('Beats on')) throw new Error('condition should now show');
    await shot('progress-revealed');
  });

  await step('morning check-in appears for last night’s sleep session', async () => {
    await js(`(async () => {
      const S = window.__stillpoint;
      await S.store.put({ id: 'sleep-1', sessionID: 'sleep-deep', moduleID: 'sleep', sessionTitle: 'Deep Sleep', startedAt: new Date(Date.now() - 9 * 3600000).toISOString(),
        plannedSeconds: 5400, completedSeconds: 5400, finished: true, beatsEnabled: true, inExperiment: true, beatMode: 'binaural', engine: 'stream',
        noiseBedMinutes: 0, ratingsBefore: { tension: 6 }, ratingsAfter: {}, note: '', awaitingMorningRatings: true, sleep: null, heart: null });
      S.records = await S.store.all();
      document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    await waitFor('window.__stillpoint.sheet && window.__stillpoint.sheet.type === "morning"', 4000, 'morning sheet');
    await shot('morning');
    await click('[data-act="morning-rate"][data-id="quality"][data-v="8"]');
    await click('[data-act="morning-save"]'); await sleep(300);
    const r = await js('window.__stillpoint.store.get("sleep-1")');
    if (r.ratingsAfter.quality !== 8 || r.awaitingMorningRatings) throw new Error('morning ratings not saved');
  });

  await step('sleep prep offers the noise bed; no crisis link on Sleep', async () => {
    await js('location.hash = "#/module/sleep"'); await sleep(150);
    if ((await text()).includes('Support and crisis lines')) throw new Error('Sleep should not show crisis link (native parity)');
    await js('location.hash = "#/settings"'); await sleep(150);
    await click('[data-act="set-engine"][data-v="stream"]');
    await js('location.hash = "#/module/sleep"'); await sleep(150);
    await click('[data-act="prep"]');
    const t = await text();
    if (!t.includes('Noise through the night') || !t.includes('8 h')) throw new Error('noise bed options missing');
    await shot('prep-sleep');
    await click('[data-act="sheet-close"]');
  });

  await step('export contains sessions and settings', async () => {
    const json = JSON.parse(await js('window.__stillpoint.store.exportJSON(window.__stillpoint.settings)'));
    if (!(json.sessions.length >= 12) || !json.settings) throw new Error('export incomplete');
  });

  await step('offline (service worker): the app opens and a live session plays from cached narration', async () => {
   try {
    await js('navigator.serviceWorker.ready.then(() => true)');
    await send('Page.reload');
    await waitFor('!!(window.__stillpoint && window.__stillpoint.content)', 10000, 'reload');
    if (!(await js('!!navigator.serviceWorker.controller'))) throw new Error('page not controlled by the service worker');
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await send('Page.reload');
    await waitFor('!!(window.__stillpoint && window.__stillpoint.content)', 10000, 'offline load');
    await js('location.hash = "#/"'); await sleep(200);
    if (!(await text()).includes('Craving now?')) throw new Error(`home not shown offline: ${await js('window.__stillpoint.loadError')} | ${(await text()).slice(0, 200)}`);
    if (await js('Object.keys(window.__stillpoint.content.renders).length') !== 0) throw new Error('pre-rendered audio should be unavailable offline');
    await js('location.hash = "#/module/gratitude"'); await sleep(150);
    await click('[data-act="prep"]'); await click('[data-act="prep-start"]');
    await waitFor('window.__stillpoint.active && window.__stillpoint.active.player.state === "playing"', 10000, 'offline live playing');
    if (await js('window.__stillpoint.active.engine') !== 'live') throw new Error('expected the live engine offline');
    await sleep(2500);
    if (!(await js('window.__stillpoint.active.player.currentTime > 1.5'))) throw new Error('offline audio did not advance');
    await shot('offline-live');
    await js('window.__stillpoint.active.player.stop(false)');
    // Expected and handled: pre-rendered audio's index can't be fetched offline.
    for (let i = errors.length - 1; i >= 0; i--) if (/ERR_INTERNET_DISCONNECTED .*audio\/renders\.json/.test(errors[i])) errors.splice(i, 1);
   } finally {
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await send('Page.reload');
    await waitFor('!!(window.__stillpoint && window.__stillpoint.content)', 10000, 'online again');
   }
  });

  await step('delete all clears history and returns to onboarding', async () => {
    await js('location.hash = "#/settings"'); await sleep(150);
    await click('[data-act="delete"]');
    await click('[data-act="dialog-yes"]');
    await waitFor('document.body.innerText.includes("Welcome to Stillpoint")', 4000, 'onboarding after delete');
    const n = await js('window.__stillpoint.store.all().then(a => a.length)');
    if (n !== 0) throw new Error(`${n} records left`);
    const keys = await js('Object.keys(localStorage).filter(k => k.startsWith("stillpoint."))');
    if (keys.length) throw new Error(`settings left: ${keys}`);
  });

  await step('lab page loads', async () => {
    await send('Page.navigate', { url: new URL('lab/lock.html', URL0).href });
    await waitFor('document.getElementById("out") && document.getElementById("out").textContent.startsWith("Ready.")', 8000, 'lab ready');
  });
} catch (e) {
  results.push(['FAIL', `harness: ${e.message}`]);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

for (const [s, n] of results) console.log(`${s === 'ok' ? '✔' : '✖'} ${n}`);
if (logs.length) console.log(`\nConsole warnings/errors:\n  ${[...new Set(logs)].join('\n  ')}`);
const failed = results.filter(([s]) => s !== 'ok').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
