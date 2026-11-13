// Lock-screen lab: runs the real StreamPlayer and LivePlayer and records whether audio time
// keeps advancing while the page is hidden. Used by tests/ios-sim (XCUITest drives Safari) and
// by hand on a phone.
import { loadContent } from '../js/app/content.js';
import { StreamPlayer } from '../js/app/player-stream.js';
import { LivePlayer } from '../js/app/player-live.js';

const out = document.getElementById('out');
const SESSION = new URLSearchParams(location.search).get('session') || 'qs-rescue-10';
let content, player = null, run = null, wall0 = 0, t0 = 0;
const events = [];
let lastHidden = null;

function diag(kind, extra = {}) {
  const body = JSON.stringify({
    kind, run, vis: document.visibilityState, wall: (performance.now() - wall0) / 1000,
    t: player?.currentTime ?? 0, state: player?.state, inBed: player?.inBed ?? null, ctx: player?.ctx?.state ?? null,
    ctxTime: player?.ctx?.currentTime ?? null, el: player?.el?.currentTime ?? player?.keepAliveEl?.currentTime ?? null, ...extra,
  });
  try { fetch('/__diag', { method: 'POST', body, keepalive: true }).catch(() => {}); } catch { /* ignore */ }
  return body;
}

function show() {
  if (!run) { out.textContent = content ? `Ready. Session: ${SESSION}` : 'Loading…'; return; }
  const wall = (performance.now() - wall0) / 1000, t = (player?.currentTime ?? 0) - t0;
  out.textContent = [
    `RUN ${run}  state=${player?.state}  ctx=${player?.ctx?.state ?? '-'}${player?.inBed ? '  IN BED' : ''}`,
    `audio time advanced ${t.toFixed(1)} s in ${wall.toFixed(1)} s wall time`,
    lastHidden ? `last hidden period: ${lastHidden}` : '',
    ...events.slice(-12),
  ].filter(Boolean).join('\n');
}

let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = { wall: performance.now(), t: player?.currentTime ?? 0 };
  } else if (hiddenAt) {
    const dw = (performance.now() - hiddenAt.wall) / 1000, dt = (player?.currentTime ?? 0) - hiddenAt.t;
    lastHidden = `hidden ${dw.toFixed(1)} s, audio advanced ${dt.toFixed(1)} s → ${dt > dw * 0.9 ? 'KEPT PLAYING' : dt < 1 ? 'STOPPED' : 'PARTLY'}`;
    events.push(`${new Date().toLocaleTimeString()} ${lastHidden}`);
    diag('hiddenSummary', { hiddenSeconds: dw, advanced: dt, verdict: dt > dw * 0.9 ? 'kept' : dt < 1 ? 'stopped' : 'partly' });
    player?.reconcile?.();
  }
  events.push(`${new Date().toLocaleTimeString()} visibility ${document.visibilityState}`);
  diag('visibility');
  show();
});

setInterval(() => { if (run) diag('tick'); show(); }, 1000);

function onChange(p) { if (p.state !== onChange.last) { events.push(`${new Date().toLocaleTimeString()} state ${p.state}${p.notice ? ` (${p.notice})` : ''}`); onChange.last = p.state; diag('state'); } }
function onFinish() { events.push('finished'); diag('finished'); }

function start(which) {
  player?.stop(false, false);
  const s = content.session(SESSION);
  run = which; wall0 = performance.now(); events.length = 0; lastHidden = null; onChange.last = null;
  if (which === 'D') {
    // Start 20 s before the end of a short session, with the Sleep 2 h bed as the next file, to see
    // whether the handoff to the bed happens while the page is hidden.
    player = new StreamPlayer({ audioBase: content.audioBase, silenceURL: content.silenceURL, onChange, onFinish });
    const entry = { ...content.renders['qs-rescue-2'], beds: { 120: content.renders['sleep-deep'].beds[120] } };
    player.start({ entry, variant: 'binaural', bedMinutes: 120, title: 'Handoff test', album: 'Lab', sessionDuration: content.duration(content.session('qs-rescue-2')) });
    const seekD = () => { if (player.preparing) { setTimeout(seekD, 100); return; } player.el.addEventListener('loadedmetadata', () => { player.ourSeek = true; player.el.currentTime = player.sessionDuration - 20; player.lastGood = player.el.currentTime; player.lastGoodAt = performance.now(); }, { once: true }); };
    seekD();
  } else if (which === 'A') {
    player = new StreamPlayer({ audioBase: content.audioBase, silenceURL: content.silenceURL, onChange, onFinish });
    const entry = content.renders[SESSION];
    player.start({ entry, variant: 'binaural', bedMinutes: 0, title: s.title, album: 'Lab', sessionDuration: content.duration(s) });
  } else {
    player = new LivePlayer({ narrationBase: content.narrationBase, silenceURL: which === 'B' ? content.silenceURL : null, onChange, onFinish });
    player.start({ session: s, durations: content.durations, manifest: content.manifest, bedMinutes: 0, mode: 'binaural', beatsEnabled: true, title: s.title, album: 'Lab', keepAlive: which === 'B' });
  }
  t0 = 0;
  diag('start');
  show();
}

document.getElementById('a').onclick = () => start('A');
document.getElementById('b').onclick = () => start('B');
document.getElementById('c').onclick = () => start('C');
document.getElementById('d').onclick = () => start('D');
document.getElementById('stop').onclick = () => { player?.stop(true); diag('stop'); run = null; show(); };

loadContent(new URL('../', location.href).href).then((c) => { content = c; show(); diag('loaded', { ua: navigator.userAgent, audioSession: !!navigator.audioSession }); })
  .catch((e) => { out.textContent = `Failed to load content: ${e.message}`; });
