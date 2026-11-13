// Stillpoint web: screens and app state (port of HypnosisAppCore: AppModel + UI/*). Plain ES
// modules, no build step and no dependencies.

import { loadContent } from './app/content.js';
import { Store, Settings, newRecord } from './app/store.js';
import { Experiment, Suggestibility, VolumePolicy } from './app/experiment.js';
import { chooseMode, variantFor } from './app/modes.js';
import { StreamPlayer } from './app/player-stream.js';
import { LivePlayer } from './app/player-live.js';
import { SamplePlayer } from './app/samples.js';
import { canSetElementVolume, useAudioSessionPlayback, keepScreenOn, isIOS, isStandalone } from './app/audio-env.js';
import { attachSleep } from './app/sources.js';
import { icon } from './app/icons.js';

const APP_BASE = new URL('./', document.baseURI).href;
const S = {
  content: null, store: null, settings: new Settings(), records: [], active: null,
  sheet: null, dialog: null, onboarding: null, tones: new SamplePlayer(new URL('assets/', document.baseURI).href), loadError: null,
};
const $app = document.getElementById('app');
const $overlay = document.getElementById('overlay');

// ---------------------------------------------------------------------------------------------
// Helpers

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = esc;
function formatDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`.replace(' 0 min', '');
  return `${Math.max(m, 1)} min`;
}
function clock(seconds) {
  const s = Math.floor(Math.max(0, seconds));
  const p = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
}
const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const tintStyle = (m) => (m ? `style="--tint:${attr(m.colorHex)}"` : '');
const moduleOf = (s) => S.content.module(s.module);
const recordsIn = (moduleID) => S.records.filter((r) => r.moduleID === moduleID);

function experimentResults(module) {
  const prompts = Experiment.promptsFor(S.content.sessionsIn(module.id));
  return Experiment.results(S.records, module.id, prompts, module.primaryRating);
}
function isRevealed(module) {
  return !S.settings.experimentEnabled || (experimentResults(module)[0]?.revealed ?? false);
}
function useSliderVolume(engine) {
  return engine === 'live' || canSetElementVolume();
}

// ---------------------------------------------------------------------------------------------
// Shared pieces

const SAFETY = [
  ['car', 'Never listen while driving, operating machinery, or doing anything that needs your full attention.'],
  ['bolt', 'If you have epilepsy or a seizure disorder, talk to your doctor first. Pulsing tones can be a trigger for some people.'],
  ['ear', 'Keep the volume low. The beats work quietly, and the app limits its own maximum volume.'],
  ['cross', 'This is a wellness app, not medical treatment. It does not diagnose, treat, or cure anything.'],
  ['brain', 'If you have a history of psychosis, dissociation, or severe trauma, check with a clinician before using hypnosis.'],
];
const safetyList = () => `<div class="safety">${SAFETY.map(([i, t]) => `<div class="item">${icon(i)}<p class="small">${esc(t)}</p></div>`).join('')}</div>`;

const SPATIAL_HELP = 'Spatial Audio blends the left and right channels and weakens the beats, and a web page can’t see or switch it. On AirPods or Beats: open Control Center, touch and hold the volume slider, and set Spatial Audio to Off (and turn Head Tracking off). Also make sure Settings › Accessibility › Audio & Visual › Mono Audio is off.';

function ratingInput(prompt, value, act, { compact = false } = {}) {
  const nums = [];
  for (let n = prompt.range[0]; n <= prompt.range[1]; n++) {
    nums.push(`<button type="button" class="${value === n ? 'on' : ''}" data-act="${act}" data-id="${attr(prompt.id)}" data-v="${n}" aria-pressed="${value === n}" aria-label="${n}">${n}</button>`);
  }
  return `<div class="rating ${compact ? 'compact' : ''}"><p class="${compact ? 'small' : ''}" style="font-weight:600">${esc(prompt.question)}</p>
    <div class="nums" style="grid-template-columns:repeat(${nums.length},1fr)" role="group" aria-label="${attr(prompt.question)}">${nums.join('')}</div>
    <div class="ends"><span>${esc(prompt.minLabel)}</span><span>${esc(prompt.maxLabel)}</span></div></div>`;
}

function toggle(label, checked, act, sub = '') {
  return `<label class="toggle"><span class="grow"><span style="font-weight:600">${label}</span>${sub ? `<span class="caption">${sub}</span>` : ''}</span>
    <input type="checkbox" data-change="${act}" ${checked ? 'checked' : ''}><span class="track" aria-hidden="true"></span></label>`;
}

function volumeControl(engine) {
  if (!useSliderVolume(engine)) {
    return `<p class="small">Use your phone’s volume buttons. This browser doesn’t let a web page set the volume of streamed audio, so the app’s maximum level (${VolumePolicy.maxGain}) is built into the audio itself.</p>
      <p class="caption">Keep your phone’s volume at about half or lower.</p>`;
  }
  const v = S.settings.volume;
  return `<div class="vol">${icon('speaker')}<input type="range" min="0.05" max="${VolumePolicy.maxGain}" step="0.01" value="${v}" data-input="volume" aria-label="Session volume">${icon('speaker')}</div>
    <p class="caption">The slider’s top end is deliberately limited. A web page can’t read or cap your phone’s own volume, so keep that at about half or lower.</p>`;
}

function outputCard() {
  const speaker = S.settings.speakerMode;
  return `<div class="card">
    <h3>${icon(speaker ? 'speaker' : 'headphones')} Listening with</h3>
    <div class="seg" role="group" aria-label="Listening with">
      <button type="button" class="${speaker ? '' : 'on'}" data-act="set-speaker" data-v="0" aria-pressed="${!speaker}">Headphones</button>
      <button type="button" class="${speaker ? 'on' : ''}" data-act="set-speaker" data-v="1" aria-pressed="${speaker}">Phone speaker</button>
    </div>
    <p class="small muted">${speaker
      ? 'Speaker mode uses gently pulsing (isochronic) tones that work without headphones.'
      : 'Binaural beats: each ear gets a slightly different tone. Wear both earbuds, left in left.'}</p>
    <p class="caption">A browser can’t tell whether headphones are connected, so choose here. If you unplug headphones during a session, iPhone pauses it; switch to Phone speaker before you press play.</p>
    ${speaker ? '' : `<div class="note warn">${icon('warning')}<span>${esc(SPATIAL_HELP)}</span></div>`}
  </div>`;
}

function crisisLink(text = 'Need to talk to someone? Support and crisis lines') {
  return `<a class="row caption" href="#/resources" style="text-decoration:none;color:var(--muted);min-height:44px">${icon('phone')}<span>${esc(text)}</span></a>`;
}

function topbar(backHref, backLabel, act = '') {
  return `<div class="topbar"><a class="back" href="${backHref}" ${act ? `data-act="${act}"` : ''}>${icon('chevronLeft')}${esc(backLabel)}</a></div>`;
}

function tabbar(active) {
  const tab = (href, key, ic, label) => `<a href="${href}" class="${active === key ? 'on' : ''}" ${active === key ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`;
  return `<nav class="tabbar" aria-label="Sections">${tab('#/', 'home', 'waveform', 'Sessions')}${tab('#/progress', 'progress', 'chart', 'Progress')}${tab('#/settings', 'settings', 'gear', 'Settings')}</nav>`;
}

// ---------------------------------------------------------------------------------------------
// Screens

function homeView() {
  const c = S.content;
  const rescue = c.sessions.find((s) => s.kind === 'rescue');
  const rm = rescue ? moduleOf(rescue) : null;
  return `<div class="page">
    <h1 class="large">Stillpoint</h1>
    ${c.problems.length ? `<div class="card"><div class="note warn">${icon('warning')}<strong>Some session files have problems</strong></div>${c.problems.map((p) => `<p class="caption">${esc(p)}</p>`).join('')}</div>` : ''}
    ${rescue && rm ? `<button class="rowcard rescue" ${tintStyle(rm)} data-act="start-now" data-id="${attr(rescue.id)}" aria-label="Craving now? Start a ${formatDuration(c.duration(rescue))} rescue session">
      ${icon('lifepreserver', 'lg')}<span class="grow"><span class="title">Craving now?</span><br><span class="sub">Start a ${formatDuration(c.duration(rescue))} rescue session</span></span>${icon('play')}</button>` : ''}
    ${c.modules.map((m) => {
      const n = recordsIn(m.id).length;
      return `<a class="rowcard" href="#/module/${attr(m.id)}">
        <span class="icon-tile" style="background:${attr(m.colorHex)}38;color:${attr(m.colorHex)}">${icon(m.icon, 'lg')}</span>
        <span class="grow"><span class="title">${esc(m.title)}</span><br><span class="sub">${esc(m.tagline)}</span></span>
        ${n ? `<span class="caption mono">${n}</span>` : ''}<span class="chev">${icon('chevronRight')}</span></a>`;
    }).join('')}
    <p class="caption" style="text-align:center;margin-top:6px">Wellness, not treatment. Don’t use while driving.</p>
  </div>`;
}

function moduleView(id) {
  const c = S.content, m = c.module(id);
  if (!m) return `<div class="page">${topbar('#/', 'Sessions')}<p>Module not found.</p></div>`;
  const sessions = c.sessionsIn(m.id);
  const group = (kind) => sessions.filter((s) => s.kind === kind);
  const kinds = ['main', 'rescue', ...new Set(sessions.map((s) => s.kind).filter((k) => k !== 'main' && k !== 'rescue'))];
  const sessionRow = (s) => {
    const live = !c.renders[s.id];
    return `<button class="rowcard" data-act="${s.kind === 'rescue' ? 'start-now' : 'prep'}" data-id="${attr(s.id)}">
      <span style="color:${attr(m.colorHex)}">${icon('play.circle', 'xl')}</span>
      <span class="grow"><span class="title">${esc(s.title)}</span><br><span class="sub">${esc(s.subtitle)}</span>
      ${live ? `<br><span class="caption warn">Plays with the live engine (no up-to-date pre-rendered audio)</span>` : ''}</span>
      <span class="caption mono">${formatDuration(c.duration(s))}</span></button>`;
  };
  return `<div class="page" ${tintStyle(m)}>
    ${topbar('#/', 'Sessions')}
    <h1 class="large">${esc(m.title)}</h1>
    <p>${esc(m.about)}</p>
    ${kinds.map((k) => {
      const g = group(k);
      if (!g.length) return '';
      const head = k === 'rescue' ? `<h2>Rescue sessions</h2><p class="small muted">Open one the moment a craving hits. They start straight away and you can keep your eyes open.</p>` : '';
      return head + g.map(sessionRow).join('');
    }).join('')}
    ${m.showCessationSupport ? `<div class="card"><h3>${icon('cross')} Use this with proven quitting methods</h3>
      <p class="small">You are far more likely to quit for good if you combine support like this with nicotine replacement or prescription medication, and advice from a doctor, pharmacist, or quit line. This app adds to those. It does not replace them.</p>
      <a href="#/resources" class="small" style="font-weight:600">Quit lines and support</a></div>` : ''}
    <div class="card"><h3>${icon('book')} What the research says</h3><p class="small">${esc(m.honesty)}</p></div>
    ${m.cautions.length ? `<div class="card"><h3>${icon('info')} Good to know</h3><ul class="bullets small">${m.cautions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <a class="rowcard" href="#/progress/${attr(m.id)}">${icon('chart')}<span class="grow">History and progress</span><span class="chev">${icon('chevronRight')}</span></a>
    ${m.showCrisisResources ? crisisLink() : ''}
  </div>`;
}

function progressOverview() {
  const c = S.content;
  return `<div class="page"><h1 class="large">Progress</h1>
    ${S.records.length ? '' : `<div class="card"><h3>No sessions yet</h3><p class="small muted">Your history and what works for you will appear here after your first session.</p></div>`}
    ${c.modules.map((m) => {
      const rs = recordsIn(m.id);
      const listened = rs.reduce((a, r) => a + r.completedSeconds, 0);
      return `<a class="rowcard" href="#/progress/${attr(m.id)}">
        <span class="icon-tile sm" style="background:${attr(m.colorHex)}38;color:${attr(m.colorHex)}">${icon(m.icon)}</span>
        <span class="grow"><span class="title">${esc(m.title)}</span><br><span class="sub">${rs.length ? `${rs.length} session${rs.length === 1 ? '' : 's'} · ${formatDuration(listened)} listened` : 'Not started'}</span></span>
        <span class="chev">${icon('chevronRight')}</span></a>`;
    }).join('')}
  </div>`;
}

function chart(prompt, records, color) {
  const both = prompt.before && prompt.after;
  const rs = [...records].reverse(); // oldest first
  const pts = [];
  rs.forEach((r, i) => {
    const b = r.ratingsBefore?.[prompt.id], a = r.ratingsAfter?.[prompt.id];
    if (both && b != null) pts.push({ i, v: b, s: 'Before' });
    if (a != null) pts.push({ i, v: a, s: both ? 'After' : 'Rating' });
  });
  if (!pts.length) return '<p class="small muted">Rate a session to see your trend here.</p>';
  const W = 320, H = 180, L = 26, R = 10, T = 10, B = 22;
  const [lo, hi] = prompt.range;
  const n = Math.max(1, rs.length - 1);
  const x = (i) => L + (rs.length === 1 ? (W - L - R) / 2 : (i / n) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const series = both ? [['Before', 'rgba(255,255,255,0.55)'], ['After', color]] : [['Rating', color]];
  const grid = [lo, (lo + hi) / 2, hi].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,0.1)"/><text x="${L - 6}" y="${y(v) + 4}" fill="rgba(255,255,255,0.6)" font-size="11" text-anchor="end">${v}</text>`).join('');
  const lines = series.map(([name, col]) => {
    const p = pts.filter((q) => q.s === name);
    const path = p.map((q, k) => `${k ? 'L' : 'M'}${x(q.i).toFixed(1)},${y(q.v).toFixed(1)}`).join(' ');
    const marks = p.map((q) => (name === 'After'
      ? `<path d="M${x(q.i) - 4},${y(q.v)}h8M${x(q.i)},${y(q.v) - 4}v8" stroke="${col}" stroke-width="2.4"/>`
      : `<circle cx="${x(q.i)}" cy="${y(q.v)}" r="3.5" fill="${col}"/>`)).join('');
    return `<path d="${path}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>${marks}`;
  }).join('');
  const first = rs[0], last = rs[rs.length - 1];
  const dates = `<text x="${L}" y="${H - 4}" fill="rgba(255,255,255,0.6)" font-size="11">${esc(new Date(first.startedAt).toLocaleDateString())}</text>${rs.length > 1 ? `<text x="${W - R}" y="${H - 4}" fill="rgba(255,255,255,0.6)" font-size="11" text-anchor="end">${esc(new Date(last.startedAt).toLocaleDateString())}</text>` : ''}`;
  const legend = both ? `<div class="legend"><span><i class="swatch" style="background:rgba(255,255,255,0.55)"></i>Before (dots)</span><span><i class="swatch" style="background:${color}"></i>After (crosses)</span></div>` : '';
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${attr(prompt.question)} over time">${grid}${lines}${dates}</svg>${legend}</div>`;
}

function moduleProgress(id) {
  const c = S.content, m = c.module(id);
  if (!m) return `<div class="page">${topbar('#/progress', 'Progress')}<p>Module not found.</p></div>`;
  const records = recordsIn(m.id);
  const prompts = c.sessionsIn(m.id).flatMap((s) => s.ratings);
  const primary = prompts.find((p) => p.id === m.primaryRating);
  const listened = records.reduce((a, r) => a + r.completedSeconds, 0);
  const revealed = isRevealed(m);
  let chartCard = '';
  if (primary) {
    const both = primary.before && primary.after;
    const deltas = both ? records.map((r) => Experiment.score(r, primary)).filter((x) => x !== null) : [];
    const avg = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
    chartCard = `<div class="card"><h3>${esc(primary.question)}</h3>${chart(primary, records, m.colorHex)}
      <p class="caption">${primary.range[0]} = ${esc(primary.minLabel)} · ${primary.range[1]} = ${esc(primary.maxLabel)}</p>
      ${avg !== null ? `<p class="small">Average change per session: ${avg >= 0 ? '+' : '−'}${Math.abs(avg).toFixed(1)} points ${avg >= 0 ? 'better' : 'worse'}</p>` : ''}</div>`;
  }
  let expCard = '';
  if (S.settings.experimentEnabled || records.some((r) => r.inExperiment)) {
    const results = experimentResults(m);
    const first = results[0];
    let body = '';
    if (first && first.verdict === 'collecting') {
      const T = Experiment.revealThreshold;
      const done = Math.min(first.withBeats.n, T) + Math.min(first.withoutBeats.n, T);
      body = `<p class="small">Still collecting. Sessions are randomly played with or without beats, and you aren’t told which, so your ratings stay unbiased.</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${T * 2}" aria-valuenow="${done}"><div style="width:${(done / (T * 2)) * 100}%"></div></div>
        <p class="caption">About ${first.needed} more rated session${first.needed === 1 ? '' : 's'} until results are revealed.</p>`;
    } else if (first) {
      const title = (r) => (r.verdict === 'beatsHelp' ? 'Beats seem to help' : r.verdict === 'beatsHurt' ? 'You do better without beats' : 'No clear difference');
      body = results.filter((r) => r.revealed).map((r) => `<div><p class="small" style="font-weight:600">${esc(cap(r.metric))}: ${title(r)}</p>
        <p class="caption mono">With beats: ${r.withBeats.mean.toFixed(1)} ${esc(r.unit)} (${r.withBeats.n} sessions)<br>Without beats: ${r.withoutBeats.mean.toFixed(1)} ${esc(r.unit)} (${r.withoutBeats.n} sessions)</p></div>`).join('')
        + '<p class="caption">This is your own small experiment, not proof. Differences can be chance, especially with few sessions.</p>';
    }
    expCard = `<div class="card"><h3>${icon('dice')} Do the beats help you?</h3>${body}</div>`;
  }
  const historyRow = (r) => {
    const lines = [];
    const seen = new Set();
    for (const p of prompts) {
      if (seen.has(p.id)) continue; seen.add(p.id);
      const b = r.ratingsBefore?.[p.id], a = r.ratingsAfter?.[p.id];
      if (b != null && a != null) lines.push(`${cap(p.id)} ${b} → ${a}`);
      else if (a != null) lines.push(`${cap(p.id)} ${a}`);
      else if (b != null) lines.push(`${cap(p.id)} ${b} before`);
    }
    return `<div class="card"><div class="row"><strong class="small grow">${esc(r.sessionTitle)}</strong><span class="caption">${esc(fmtDate(r.startedAt))}</span></div>
      <p class="caption">${r.finished ? 'Completed' : `Stopped at ${clock(r.completedSeconds)}`}${revealed ? ` · Beats ${r.beatsEnabled ? 'on' : 'off'}` : ''}</p>
      ${lines.length ? `<p class="small mono">${esc(lines.join('   '))}</p>` : ''}
      ${r.sleep?.deepMinutes != null ? `<p class="small mono">Deep sleep ${Math.round(r.sleep.deepMinutes)} min${r.sleep.onsetMinutes != null ? ` · asleep in ${Math.round(r.sleep.onsetMinutes)} min` : ''}</p>` : ''}
      ${r.note ? `<p class="small" style="font-style:italic">“${esc(r.note)}”</p>` : ''}</div>`;
  };
  return `<div class="page" ${tintStyle(m)}>${topbar('#/progress', 'Progress')}<h1 class="large">${esc(m.title)}</h1>
    <div class="stats"><div class="card"><span class="v">${records.length}</span><span class="caption">sessions</span></div>
      <div class="card"><span class="v">${records.filter((r) => r.finished).length}</span><span class="caption">completed</span></div>
      <div class="card"><span class="v">${formatDuration(listened)}</span><span class="caption">listened</span></div></div>
    ${chartCard}${expCard}
    <h2>History</h2>
    ${records.length ? records.map(historyRow).join('') : '<p class="muted">No sessions yet.</p>'}
  </div>`;
}

function settingsView() {
  const st = S.settings, c = S.content;
  const engineCard = `<div class="card"><h3>${icon('waveform')} Playback</h3>
    <div class="seg" role="group" aria-label="Playback engine">
      <button type="button" class="${st.engine === 'stream' ? 'on' : ''}" data-act="set-engine" data-v="stream" aria-pressed="${st.engine === 'stream'}">Pre-rendered</button>
      <button type="button" class="${st.engine === 'live' ? 'on' : ''}" data-act="set-engine" data-v="live" aria-pressed="${st.engine === 'live'}">Live engine</button>
    </div>
    <p class="small muted">${st.engine === 'stream'
      ? 'Recommended. Plays audio rendered ahead of time by the iPhone app’s own engine, through Safari’s media player, so it keeps playing with the screen locked and shows lock-screen controls.'
      : 'Runs the engine in the browser in real time, like the iPhone app: in-app volume, gentle pause fades, and a smooth switch to speaker mode. Safari may pause it when the screen locks, so the screen stays on during sessions unless you change that below.'}</p>
    ${toggle('Keep the screen on during sessions', keepScreenSetting(st.engine), 'keep-screen', 'The player is dark. Useful with the live engine; not needed for pre-rendered audio.')}
  </div>`;
  return `<div class="page"><h1 class="large">Settings</h1>
    <div class="card"><h3>Sound</h3>${volumeControl(st.engine)}
      ${toggle('Always use speaker mode (pulsed tones)', st.speakerMode, 'speaker')}
      <p class="caption">Binaural beats need headphones. Speaker mode uses pulsing tones instead. A browser can’t detect headphones, so this switch decides.</p></div>
    ${engineCard}
    <div class="card">${toggle('Self-experiment', st.experimentEnabled, 'experiment')}
      <p class="caption">Randomly plays about half of your sessions without beats, without telling you which, then shows whether beats changed your ratings. Turn off to always hear beats.</p></div>
    ${absorptionCard()}
    <div class="card"><h3>Your data</h3>
      <p class="caption">Session history and ratings are stored only in this browser on this device (${S.store?.kind === 'indexeddb' ? 'IndexedDB' : 'local storage'}). Nothing is sent anywhere and there is no iCloud sync in the web version.${isIOS() && !isStandalone() ? ' Safari can delete a website’s stored data after seven days of browsing without visiting it; a Home Screen app is exempt, so add Stillpoint to your Home Screen, and export now and then.' : ''}</p>
      <button class="btn link" data-act="export">${icon('download')} Export all my data</button>
      <p class="caption">The export shows which sessions had beats, so opening it reveals your self-experiment.</p>
      <button class="btn danger" data-act="delete">${icon('trash')} Delete all my data</button></div>
    <div class="card"><h3>Safety</h3>${safetyList()}</div>
    <a class="rowcard" href="#/resources">${icon('phone')}<span class="grow">Support and crisis resources</span><span class="chev">${icon('chevronRight')}</span></a>
    <a class="rowcard" href="#/web">${icon('globe')}<span class="grow">About the web version</span><span class="chev">${icon('chevronRight')}</span></a>
    <button class="btn link" data-act="rerun-setup">Run setup again</button>
    <p class="caption">Stillpoint is a wellness app. It is not a medical device and does not diagnose, treat, cure, or prevent any condition. All narration is computer-generated.</p>
    ${c.stale.length ? `<p class="caption warn">Not pre-rendered: ${c.stale.map((s) => esc(s.id)).join(', ')}. Run ./serve-web.sh on the Mac to render them.</p>` : ''}
  </div>`;
}

function keepScreenSetting(engine) {
  const v = S.settings.keepScreenOn;
  return v === null ? engine === 'live' : v;
}

const CRISIS = [
  ['In immediate danger', 'Call your local emergency number (911 in the US and Canada, 999 in the UK, 112 in the EU).', null, null],
  ['US and Canada: 988 Suicide & Crisis Lifeline', 'Call or text 988, any time.', 'tel:988', 'Call 988'],
  ['UK and Ireland: Samaritans', 'Call 116 123, any time.', 'tel:116123', 'Call 116 123'],
  ['Anywhere else', 'Find a helpline in your country.', 'https://findahelpline.com', 'findahelpline.com'],
];
const QUITTING = [
  ['US: 1-800-QUIT-NOW', 'Free coaching and, in many states, free nicotine replacement.', 'tel:18007848669', 'Call 1-800-784-8669'],
  ['Canada: Smokers’ Helpline', 'Free support by phone, text, and online.', 'tel:18663663667', 'Call 1-866-366-3667'],
  ['UK: NHS Stop Smoking Services', 'Free local support and medication advice.', 'https://www.nhs.uk/better-health/quit-smoking/', 'nhs.uk/better-health/quit-smoking'],
  ['Your doctor or pharmacist', 'Ask about nicotine replacement, varenicline, or bupropion. Combining medication with support roughly doubles the chance of quitting.', null, null],
];

function resourcesView() {
  const section = (title, items) => `<h2>${esc(title)}</h2>${items.map(([t, d, link, label]) => `<div class="card"><h3>${esc(t)}</h3><p class="small muted">${esc(d)}</p>
    ${link ? `<a href="${attr(link)}" ${link.startsWith('http') ? 'target="_blank" rel="noopener"' : ''} style="font-weight:600">${esc(label)}</a>` : ''}</div>`).join('')}`;
  return `<div class="page">${topbar('#/', 'Back', 'back')}<h1 class="large">Support</h1>
    <p>This app is not a substitute for professional care. If you are struggling, please reach out.</p>
    ${section('If you are in distress', CRISIS)}
    ${section('Ongoing support', [['Talk to a professional', 'A doctor, therapist, or counsellor can help with low mood, anxiety, sleep problems, and stress that doesn’t lift.', null, null]])}
    ${section('Help with quitting smoking', QUITTING)}
  </div>`;
}

function webView() {
  const c = S.content;
  const fresh = Object.keys(c.renders).length, total = c.sessions.length;
  const caps = [
    ['Secure context (HTTPS)', window.isSecureContext],
    ['Home Screen app', isStandalone()],
    ['Audio Session API (plays with the silent switch on)', !!navigator.audioSession],
    ['Page can set audio volume', canSetElementVolume()],
    ['Media Session (lock-screen controls)', 'mediaSession' in navigator],
    ['Screen Wake Lock', 'wakeLock' in navigator],
    ['AudioWorklet (live engine)', !!(window.AudioContext && 'audioWorklet' in AudioContext.prototype)],
    ['Storage', S.store?.kind === 'indexeddb' ? `IndexedDB${S.store.persisted ? ', persistent' : ''}` : 'local storage'],
    ['Offline support (service worker)', !!navigator.serviceWorker?.controller],
  ];
  return `<div class="page">${topbar('#/settings', 'Settings')}<h1 class="large">About the web version</h1>
    <p class="small">This is a test version of the Stillpoint iPhone app that runs in Safari. It plays the same sessions, narration, and mix, and keeps your history on this device.</p>
    <div class="card"><h3>What’s different from the iPhone app</h3><ul class="bullets small">
      <li><strong>Headphones:</strong> a browser can’t see what audio is connected. You choose headphones or speaker, and if headphones disconnect, iPhone pauses the session instead of the app switching modes for you.</li>
      <li><strong>Spatial Audio:</strong> can’t be detected or switched off by a web page. Turn it off yourself (below).</li>
      <li><strong>Volume:</strong> pre-rendered sessions play at the app’s maximum level and your phone’s buttons set the volume. Where Safari doesn’t let a page set audio volume, pause and stop are immediate rather than faded.</li>
      <li><strong>Calls and alarms:</strong> the session pauses; press play afterwards to continue (the iPhone app resumes by itself).</li>
      <li><strong>Noise bed:</strong> after Deep Sleep the noise fades out and the night-time noise fades in over two minutes, instead of a direct crossfade.</li>
      <li><strong>No Apple Health and no iCloud:</strong> nothing is read from Health, and history stays in this browser only.</li>
    </ul></div>
    <div class="card"><h3>${icon('headphones')} Turn off Spatial Audio</h3><p class="small">${esc(SPATIAL_HELP)}</p></div>
    <div class="card"><h3>${icon('screen')} Add to Home Screen</h3><p class="small">In Safari, tap the Share button, then “Add to Home Screen”. Stillpoint then opens full-screen like an app, and Safari’s seven-day clean-up of unused website data no longer applies.${window.isSecureContext ? '' : ' Over plain HTTP it opens as a bookmark-style app without offline support; see the README for the HTTPS option.'}</p></div>
    <div class="card"><h3>This browser</h3>${caps.map(([k, v]) => `<div class="row small"><span class="grow">${esc(k)}</span><span class="${v === true ? 'ok' : v === false ? 'muted' : ''}">${v === true ? 'Yes' : v === false ? 'No' : esc(v)}</span></div>`).join('')}
      <div class="row small"><span class="grow">Sessions with pre-rendered audio</span><span>${fresh} of ${total}</span></div>
      <a href="lab/lock.html" class="small">Lock-screen lab (diagnostics)</a></div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------
// Onboarding (Welcome → safety → suggestibility → headphone check → volume → experiment)

function onboardingView() {
  const o = S.onboarding ??= { step: 0, ack: false, heardLeft: null, heardRight: null, sample: false };
  const last = 1;
  const canContinue = o.step === 0 ? o.ack : true;
  let body;
  if (o.step === 0) {
    body = `<div class="hero-icon">${icon('waveform')}</div><h1 class="large">Welcome to Stillpoint</h1>
      <p>Guided hypnosis and breathing over gentle nature sounds and quiet beat tones, for sleep, quitting smoking, gratitude, inner coherence, and loving compassion.</p>
      <div class="card"><h3>${icon('shield')} Before you start</h3>${safetyList()}</div>
      <div class="card">${toggle('I understand', o.ack, 'ob-ack')}</div>`;
  } else {
    const speaker = S.settings.speakerMode;
    const slider = useSliderVolume(S.settings.engine);
    const ear = (label, sig, heard, key) => `<div class="row">
        <button class="pill" data-act="ob-tone" data-v="${sig}">${icon('play')} ${label}</button>
        <span class="grow"></span>
        <span class="caption">Only in that ear?</span>
        <button type="button" class="pill yes ${heard === true ? 'on' : ''}" data-act="ob-heard" data-k="${key}" data-v="1" aria-pressed="${heard === true}">Yes</button>
        <button type="button" class="pill no ${heard === false ? 'on' : ''}" data-act="ob-heard" data-k="${key}" data-v="0" aria-pressed="${heard === false}">No</button></div>`;
    body = `<h1 class="large">Sound check</h1>
      <div class="card"><h3>${icon(speaker ? 'speaker' : 'headphones')} Listening with</h3>
        <div class="seg" role="group" aria-label="Listening with">
          <button type="button" class="${speaker ? '' : 'on'}" data-act="set-speaker" data-v="0" aria-pressed="${!speaker}">Headphones</button>
          <button type="button" class="${speaker ? 'on' : ''}" data-act="set-speaker" data-v="1" aria-pressed="${speaker}">Speaker</button></div>
        ${speaker ? '<p class="small muted">Fine. Sessions use a gentle pulsing tone that works without headphones.</p>' : `
        ${ear('Left', 'left', o.heardLeft, 'heardLeft')}${ear('Right', 'right', o.heardRight, 'heardRight')}
        ${o.heardLeft === false || o.heardRight === false ? `<div class="note warn">${icon('warning')}<span>Swap your earbuds if the sides were reversed. If you heard both in both ears, turn off Spatial Audio.</span></div>` : ''}`}
      </div>
      <div class="card"><h3>${icon('ear')} Volume</h3>
        <button class="btn secondary" data-act="ob-sample">${icon(o.sample ? 'stop' : 'play')} ${o.sample ? 'Stop sample' : 'Play a sample'}</button>
        <p class="small">${slider ? 'Adjust until the voice is clear and the background is soft.' : 'While it plays, use your phone’s volume buttons until the voice is clear and the background is soft.'}</p>
        ${slider ? `<div class="vol">${icon('speaker')}<input type="range" min="0.05" max="${VolumePolicy.maxGain}" step="0.01" value="${S.settings.volume}" data-input="volume" aria-label="Volume">${icon('speaker')}</div>` : ''}
      </div>
      <p class="caption">You can change all of this later in Settings.</p>`;
  }
  return `<div class="onboard">
    <div class="bar"><div class="progress" role="progressbar" aria-label="Setup progress" aria-valuemin="0" aria-valuemax="${last + 1}" aria-valuenow="${o.step + 1}"><div style="width:${((o.step + 1) / (last + 1)) * 100}%"></div></div></div>
    <div class="body">${body}</div>
    <div class="foot">${o.step > 0 ? '<button class="btn ghost" data-act="ob-back">Back</button>' : ''}
      <button class="btn" data-act="ob-next" ${canContinue ? '' : 'disabled'}>${o.step === last ? 'Get started' : 'Continue'}</button></div>
  </div>`;
}

/** Optional, in Settings: the absorption questions that used to be part of setup. */
function absorptionCard() {
  const saved = S.settings.suggestibility;
  const a = S.absorption ??= Array(Suggestibility.items.length).fill(null);
  const labels = ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'];
  const done = !a.includes(null);
  return `<div class="card"><details ${done ? 'open' : ''}><summary style="font-weight:600;cursor:pointer;min-height:32px">Optional: how easily do you get absorbed?${saved ? ` <span class="caption">(${esc(saved)} responsiveness)</span>` : ''}</summary>
    <p class="caption" style="margin:8px 0">People who become absorbed easily tend to respond more to hypnosis. A rough guide, not a test.</p>
    ${Suggestibility.items.map((q, i) => `<p class="small" style="margin-top:10px">${esc(q)}</p><div class="seg" role="group" aria-label="${attr(q)}">
      ${labels.map((l, v) => `<button type="button" class="${a[i] === v ? 'on' : ''}" data-act="abs-answer" data-i="${i}" data-v="${v}" aria-pressed="${a[i] === v}">${l}</button>`).join('')}</div>`).join('')}
    ${done ? (() => { const lv = Suggestibility.level(a); return `<p class="small" style="margin-top:10px"><strong>${cap(lv)} responsiveness.</strong> ${esc(Suggestibility.explanation(lv))}</p>`; })() : ''}
  </details></div>`;
}

// ---------------------------------------------------------------------------------------------
// Sheets: session prep, post-session ratings, morning check-in; dialogs; the player

function prepSheet(sh) {
  const s = S.content.session(sh.sessionId), m = moduleOf(s);
  const engine = S.settings.engine === 'stream' && S.content.renders[s.id] ? 'stream' : 'live';
  return `<div class="sheet-wrap" data-act="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" aria-label="${attr(s.title)}" ${tintStyle(m)}>
    <div class="sheet-head"><button data-act="sheet-close">Cancel</button><h2>${esc(s.title)}</h2><span style="min-width:60px"></span></div>
    ${outputCard()}
    ${s.ratings.filter((p) => p.before).map((p) => `<div class="card">${ratingInput(p, sh.ratings[p.id], 'prep-rate')}</div>`).join('')}
    ${s.noiseBed ? `<div class="card"><h3>Noise through the night</h3><p class="small muted">After the session ends, keep quiet noise playing. The beats still fade out by 90 minutes.</p>
      <div class="seg" role="group" aria-label="Noise bed">${s.noiseBed.optionsMinutes.map((mm) => `<button type="button" class="${sh.bed === mm ? 'on' : ''}" data-act="prep-bed" data-v="${mm}" aria-pressed="${sh.bed === mm}">${mm === 0 ? 'Off' : `${mm / 60} h`}</button>`).join('')}</div></div>` : ''}
    <div class="card"><h3>Volume</h3>${volumeControl(engine)}</div>
    ${engine === 'live' ? `<div class="note warn">${icon('warning')}<span>${S.content.renders[s.id] ? 'Live engine: keep the screen on during this session.' : 'This session has no up-to-date pre-rendered audio, so it plays with the live engine. Keep the screen on, or run ./serve-web.sh on the Mac to render it.'}</span></div>` : ''}
    ${S.settings.experimentEnabled ? `<div class="note muted">${icon('dice')}<span>Self-experiment is on: this session may or may not include beats. You won’t be told which.</span></div>` : ''}
    <div class="note muted">${icon('shield')}<span>${s.awake ? 'Sit or lie somewhere safe. Never use while driving.' : 'Use in bed, ready to sleep. Never use while driving.'}</span></div>
    <button class="btn" data-act="prep-start">Start ${esc(s.title)}</button>
  </div></div>`;
}

function postSheet(sh) {
  const a = sh.active, s = a.session, m = moduleOf(s);
  const prompts = s.ratings.filter((p) => p.after && !p.timing);
  return `<div class="sheet-wrap"><div class="sheet" role="dialog" aria-modal="true" aria-label="How do you feel?" ${tintStyle(m)}>
    <div class="sheet-head"><button data-act="post-skip">Skip</button><h2>How do you feel?</h2><span style="min-width:60px"></span></div>
    <p class="small muted">Welcome back. Take a moment before you move on.</p>
    ${prompts.map((p) => `<div class="card">${ratingInput(p, sh.ratings[p.id], 'post-rate')}</div>`).join('')}
    <div class="card"><h3>${s.module === 'gratitude' ? 'One thing you noticed (optional)' : 'A note for yourself (optional)'}</h3>
      <textarea data-input="post-note" placeholder="Write a line…" aria-label="Note">${esc(sh.note)}</textarea></div>
    ${m?.showCessationSupport ? '<p class="caption">Now do one small thing: drink some water, move for a minute, or message someone.</p>' : ''}
    <button class="btn" data-act="post-save">Save</button>
    <button class="btn secondary" data-act="play-again">${icon('replay')} Play again</button>
    ${m?.showCrisisResources ? crisisLink('Feeling low or struggling? Find support') : ''}
  </div></div>`;
}

function morningSheet(sh) {
  const r = sh.record, s = S.content.session(r.sessionID), m = S.content.module(r.moduleID);
  const prompts = s?.ratings.filter((p) => p.timing === 'nextMorning') ?? [];
  const any = Object.keys(sh.ratings).length > 0;
  return `<div class="sheet-wrap"><div class="sheet" role="dialog" aria-modal="true" aria-label="Good morning" ${tintStyle(m)}>
    <div class="sheet-head"><button data-act="morning-skip">Skip</button><h2>Good morning</h2><span style="min-width:60px"></span></div>
    <p class="small muted">About your night after ${esc(r.sessionTitle)} on ${esc(fmtDate(r.startedAt))}.</p>
    ${prompts.map((p) => `<div class="card">${ratingInput(p, sh.ratings[p.id], 'morning-rate')}</div>`).join('')}
    <button class="btn" data-act="morning-save" ${any ? '' : 'disabled'}>Save</button>
  </div></div>`;
}

function dialogView(d) {
  return `<div class="dialog" role="alertdialog" aria-modal="true" aria-label="${attr(d.title)}"><div class="box">
    <div class="msg"><strong>${esc(d.title)}</strong>${d.message ? `<span class="caption">${esc(d.message)}</span>` : ''}</div>
    <button class="btn ${d.destructive ? 'destructive' : ''}" data-act="dialog-yes">${esc(d.yes)}</button>
    <button class="btn cancel" data-act="dialog-no">${esc(d.no)}</button></div></div>`;
}

function playerView() {
  const a = S.active, p = a.player, s = a.session, m = moduleOf(s);
  const speaker = a.mode === 'isochronic';
  return `<div class="player" ${tintStyle(m)} role="region" aria-label="Session player"><div class="inner">
    <div class="top"><span>${icon(speaker ? 'speaker' : 'headphones')}${speaker ? 'Speaker mode' : 'Headphones'}</span>
      <span class="mod">${icon(m?.icon ?? 'waveform')}${esc(m?.title ?? '')}</span></div>
    <div class="ring" aria-live="off"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="3.6"/>
      <circle data-ref="arc" cx="50" cy="50" r="45" fill="none" stroke="var(--tint)" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="282.74" stroke-dashoffset="282.74"/></svg>
      <div class="center" data-ref="center" role="timer"><div class="phase" data-ref="phase"></div><div class="time" data-ref="time">0:00</div><div class="caption" data-ref="rem">remaining</div></div></div>
    <div class="title">${esc(s.title)}</div>
    <p class="notice" data-ref="notice"></p>
    ${a.engineNote ? `<p class="notice info">${esc(a.engineNote)}</p>` : ''}
    <div data-ref="rescue" class="card hidden"></div>
    <div class="controls">
      <button class="stop" data-act="stop" aria-label="End session">${icon('stop', 'lg')}</button>
      <button class="play" data-act="toggle-pp" data-ref="pp" aria-label="Pause">${icon('pause', 'xl')}</button>
      <button class="stop" data-act="replay" aria-label="Start again from the beginning">${icon('replay', 'lg')}</button></div>
    <div class="opts">
      <div class="card">${volumeControl(a.engine)}</div>
      <div class="card">${toggle('Speaker mode (pulsed tones)', S.settings.speakerMode, 'speaker-live', 'Switch if you take your headphones off.')}
        ${toggle('Keep the screen on', a.wantWake, 'wake-live')}</div>
      <p class="caption" style="text-align:center">${a.engine === 'stream' ? 'Pre-rendered audio' : 'Live engine'} · Wellness, not treatment</p>
    </div>
  </div></div>`;
}

function updatePlayer() {
  const a = S.active;
  if (!a) return;
  const root = $overlay.querySelector('.player');
  if (!root) return;
  const p = a.player;
  const ref = (k) => root.querySelector(`[data-ref="${k}"]`);
  const t = p.currentTime;
  const inBed = a.bedMinutes > 0 && t >= a.timeline.sessionDuration;
  const shown = inBed ? a.timeline.totalDuration : a.timeline.sessionDuration;
  const progress = shown > 0 ? Math.min(1, t / shown) : 0;
  ref('arc').setAttribute('stroke-dashoffset', String(282.74 * (1 - progress)));
  ref('phase').textContent = p.state === 'loading' ? 'Starting…' : (a.timeline.phase(t)?.name ?? '');
  ref('time').textContent = clock(Math.max(0, shown - t));
  ref('rem').textContent = inBed ? 'of noise remaining' : 'remaining';
  const playing = p.state === 'playing' || p.state === 'loading';
  const pp = ref('pp');
  const want = playing ? 'pause' : 'play';
  if (pp.dataset.icon !== want) { pp.innerHTML = icon(want, 'xl'); pp.dataset.icon = want; pp.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
  ref('notice').textContent = p.notice ?? '';
  // Rescue sessions start instantly; the "before" rating is offered while playing.
  const box = ref('rescue');
  const s = a.session;
  const prompt = s.kind === 'rescue' ? s.ratings.find((r) => r.before) : null;
  const rec = S.records.find((r) => r.id === a.logID);
  const showRating = prompt && rec && rec.ratingsBefore?.[prompt.id] == null && t < 45;
  if (showRating && box.classList.contains('hidden')) { box.innerHTML = ratingInput(prompt, null, 'live-rate', { compact: true }); box.classList.remove('hidden'); }
  if (!showRating && !box.classList.contains('hidden')) { box.classList.add('hidden'); box.innerHTML = ''; }
}

// ---------------------------------------------------------------------------------------------
// Sessions (port of AppModel.start / sessionEnded)

function startSession(session, ratingsBefore = {}, bedMinutes = 0) {
  const c = S.content, st = S.settings, m = moduleOf(session);
  S.tones.stop();
  if (S.active) return;
  const inExperiment = st.experimentEnabled;
  const beats = inExperiment ? Experiment.assignBeats(S.records, session.module) : true;
  const mode = chooseMode(st);
  const entry = c.renders[session.id];
  const useStream = st.engine === 'stream' && !!entry && (bedMinutes === 0 || !!entry.beds?.[bedMinutes]);
  const engine = useStream ? 'stream' : 'live';
  const timeline = c.timeline(session, bedMinutes);
  const gain = VolumePolicy.clamp(st.volume);
  const handlers = { onChange: onPlayerChange, onFinish: (done, natural) => sessionEnded(done, natural) };
  let player;
  if (useStream) {
    player = new StreamPlayer({ audioBase: c.audioBase, silenceURL: c.silenceURL, ...handlers });
    player.setUserGain(gain);
    player.start({ entry, variant: variantFor(mode, beats), bedMinutes, title: session.title, album: m?.title, sessionDuration: timeline.sessionDuration });
  } else {
    player = new LivePlayer({ narrationBase: c.narrationBase, silenceURL: c.silenceURL, ...handlers });
    player.setUserGain(gain);
    player.start({ session, durations: c.durations, manifest: c.manifest, bedMinutes, mode, beatsEnabled: beats, title: session.title, album: m?.title });
  }
  const rec = newRecord({
    sessionID: session.id, moduleID: session.module, sessionTitle: session.title, plannedSeconds: timeline.sessionDuration,
    beatsEnabled: beats, inExperiment, beatMode: mode, engine, noiseBedMinutes: bedMinutes, ratingsBefore: { ...ratingsBefore },
    // Set up front so the morning check-in still happens if the page is closed overnight.
    awaitingMorningRatings: session.ratings.some((r) => r.timing === 'nextMorning'),
  });
  S.records.unshift(rec);
  S.store.put(rec);
  const engineNote = engine === 'live'
    ? (entry ? 'Live engine. If the sound stops when the screen locks, switch to pre-rendered audio in Settings.' : 'No up-to-date pre-rendered audio for this session, so it plays live. Keep the screen on.')
    : '';
  const wantWake = keepScreenSetting(engine);
  S.active = { session, logID: rec.id, startedAt: rec.startedAt, player, engine, mode, beats, timeline, bedMinutes, engineNote, wake: null, wantWake, lastSave: 0, ratingsBefore: { ...ratingsBefore } };
  if (wantWake) keepScreenOn().then((rel) => { if (S.active?.logID === rec.id) S.active.wake = rel; else rel?.(); });
  S.sheet = null;
  renderOverlay();
}

function onPlayerChange(p) {
  const a = S.active;
  if (!a || a.player !== p) return;
  if (p.state !== a.lastState || p.notice !== a.lastNotice) { a.lastState = p.state; a.lastNotice = p.notice; }
  updatePlayer();
  // Save progress now and then so an unexpected close still leaves a record of what was heard.
  const now = Date.now();
  if (now - a.lastSave > 15000 && p.currentTime > 0) {
    a.lastSave = now;
    const done = Math.min(p.currentTime, a.timeline.sessionDuration);
    S.store.update(a.logID, (r) => { r.completedSeconds = done; });
  }
}

async function sessionEnded(completed, natural) {
  const a = S.active;
  if (!a) return;
  S.active = null;
  try { a.wake?.(); } catch { /* ignore */ }
  const r = await S.store.update(a.logID, (rec) => {
    rec.completedSeconds = Math.min(completed, rec.plannedSeconds);
    // Count a session as finished if the guided part was heard (the noise bed is optional).
    rec.finished = natural || completed >= rec.plannedSeconds * 0.95;
    if (completed <= 120) rec.awaitingMorningRatings = false; // stopped almost at once
  });
  S.records = await S.store.all();
  if (r && a.session.ratings.some((p) => p.after && !p.timing) && completed > 30) {
    S.sheet = { type: 'post', active: a, ratings: {}, note: '' };
  }
  render();
}

/** Stops the current session (logged as stopped, no ratings sheet) and starts it again. */
function replaySession() {
  const a = S.active;
  if (!a) return;
  const done = Math.min(a.player.currentTime, a.timeline.sessionDuration);
  a.player.stop(false, false);
  try { a.wake?.(); } catch { /* ignore */ }
  S.active = null;
  S.store.update(a.logID, (r) => { r.completedSeconds = done; r.finished = false; r.awaitingMorningRatings = false; });
  const rec = S.records.find((r) => r.id === a.logID);
  if (rec) Object.assign(rec, { completedSeconds: done, finished: false, awaitingMorningRatings: false });
  startSession(a.session, a.ratingsBefore ?? {}, a.bedMinutes);
}

async function checkMorning() {
  if (S.active || S.sheet) return;
  const now = Date.now();
  for (const r of S.records.filter((x) => x.awaitingMorningRatings)) {
    const age = (now - new Date(r.startedAt).getTime()) / 3600000;
    if (age > 36) { await S.store.update(r.id, (x) => { x.awaitingMorningRatings = false; }); continue; }
    if (age > 4) {
      S.sheet = { type: 'morning', record: r, ratings: {} };
      attachSleep(r, S.store);
      renderOverlay();
      break;
    }
  }
  S.records = await S.store.all();
}

// ---------------------------------------------------------------------------------------------
// Rendering

function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  return { name: parts[0] ?? 'home', id: parts[1] ? decodeURIComponent(parts[1]) : null };
}

function renderMain() {
  if (S.loadError) {
    $app.innerHTML = `<div class="screen no-tabs"><div class="page"><h1 class="large">Stillpoint</h1><div class="card"><div class="note warn">${icon('warning')}<strong>Couldn’t load the sessions</strong></div><p class="small">${esc(S.loadError)}</p><p class="caption">Check that ./serve-web.sh is still running on the Mac and that the phone is on the same Wi-Fi, then reload.</p><button class="btn" onclick="location.reload()">Reload</button></div></div></div>`;
    return;
  }
  if (!S.content) return;
  if (!S.settings.onboardingDone) { $app.innerHTML = onboardingView(); return; }
  const r = route();
  let html, tab = null;
  switch (r.name) {
    case 'module': html = moduleView(r.id); tab = 'home'; break;
    case 'progress': html = r.id ? moduleProgress(r.id) : progressOverview(); tab = 'progress'; break;
    case 'settings': html = settingsView(); tab = 'settings'; break;
    case 'resources': html = resourcesView(); tab = null; break;
    case 'web': html = webView(); tab = 'settings'; break;
    default: html = homeView(); tab = 'home';
  }
  $app.innerHTML = `<main class="screen">${html}</main>${tabbar(tab)}`;
}

function renderOverlay() {
  let html = '';
  if (S.active) html += playerView();
  if (S.sheet) {
    if (S.sheet.type === 'prep') html += prepSheet(S.sheet);
    if (S.sheet.type === 'post') html += postSheet(S.sheet);
    if (S.sheet.type === 'morning') html += morningSheet(S.sheet);
  }
  if (S.dialog) html += dialogView(S.dialog);
  // Keep the sheet's scroll position when it re-renders after a tap.
  const prevSheet = $overlay.querySelector('.sheet');
  const scroll = prevSheet ? prevSheet.scrollTop : 0;
  const sameSheet = prevSheet && S.sheet && prevSheet.dataset.key === sheetKey(S.sheet);
  $overlay.innerHTML = html;
  const sheet = $overlay.querySelector('.sheet');
  if (sheet && S.sheet) { sheet.dataset.key = sheetKey(S.sheet); if (sameSheet) sheet.scrollTop = scroll; }
  document.body.style.overflow = html ? 'hidden' : '';
  updatePlayer();
}

function render() { renderMain(); renderOverlay(); }
const sheetKey = (sh) => `${sh.type}:${sh.sessionId ?? sh.active?.logID ?? sh.record?.id ?? ''}`;

function confirmDialog(d) {
  return new Promise((resolve) => { S.dialog = { ...d, resolve }; renderOverlay(); });
}

// ---------------------------------------------------------------------------------------------
// Events. Audio must start inside the tap's own event dispatch on iOS, so every handler that
// starts sound calls the player synchronously (no await before it).

const actions = {
  back: () => { if (history.length > 1) history.back(); else location.hash = '#/'; },
  'start-now': (el) => { const s = S.content.session(el.dataset.id); if (s) startSession(s); },
  prep: (el) => {
    const s = S.content.session(el.dataset.id);
    if (!s) return;
    S.sheet = { type: 'prep', sessionId: s.id, ratings: {}, bed: s.noiseBed?.defaultMinutes ?? 0 };
    renderOverlay();
  },
  'prep-rate': (el) => { S.sheet.ratings[el.dataset.id] = Number(el.dataset.v); renderOverlay(); },
  'prep-bed': (el) => { S.sheet.bed = Number(el.dataset.v); renderOverlay(); },
  'prep-start': () => {
    const sh = S.sheet, s = S.content.session(sh.sessionId);
    startSession(s, sh.ratings, sh.bed);
  },
  'sheet-close': () => { S.sheet = null; renderOverlay(); },
  'sheet-bg': (el, e) => { if (e.target === el) { S.sheet = null; renderOverlay(); } },
  'set-speaker': (el) => { setSpeaker(el.dataset.v === '1'); },
  'set-engine': (el) => { S.settings.set('engine', el.dataset.v); render(); },
  'toggle-pp': () => { S.active?.player.togglePlayPause(); updatePlayer(); },
  stop: async () => {
    const ok = await confirmDialog({ title: 'End this session?', message: canSetElementVolume() || S.active?.engine === 'live' ? 'The sound will fade out gently.' : '', yes: 'End session', no: 'Keep listening', destructive: true });
    if (ok) S.active?.player.stop(true);
  },
  'dialog-yes': () => { const d = S.dialog; S.dialog = null; d?.onYes?.(); renderOverlay(); d?.resolve(true); },
  'dialog-no': () => { const d = S.dialog; S.dialog = null; renderOverlay(); d?.resolve(false); },
  'live-rate': async (el) => {
    const a = S.active; if (!a) return;
    const id = el.dataset.id, v = Number(el.dataset.v);
    const r = S.records.find((x) => x.id === a.logID);
    if (r) r.ratingsBefore = { ...r.ratingsBefore, [id]: v };
    await S.store.update(a.logID, (x) => { x.ratingsBefore = { ...x.ratingsBefore, [id]: v }; });
    updatePlayer();
  },
  'post-rate': (el) => { S.sheet.ratings[el.dataset.id] = Number(el.dataset.v); renderOverlay(); },
  'post-save': async () => {
    const sh = S.sheet; S.sheet = null;
    await S.store.update(sh.active.logID, (r) => {
      r.ratingsAfter = { ...r.ratingsAfter, ...sh.ratings };
      const note = sh.note.trim(); if (note) r.note = note;
      r.awaitingMorningRatings = false;
    });
    S.records = await S.store.all(); render();
  },
  'post-skip': () => { S.sheet = null; render(); },
  replay: () => {
    const a = S.active; if (!a) return;
    // The restart runs inside the confirm button's tap, so iPhone lets the audio start.
    confirmDialog({ title: 'Start again from the beginning?', message: 'This session is saved as stopped and a new one starts.', yes: 'Start again', no: 'Keep listening', onYes: () => replaySession() });
  },
  'play-again': () => {
    const sh = S.sheet; if (!sh?.active) return;
    S.sheet = null;
    startSession(sh.active.session, sh.active.ratingsBefore ?? {}, sh.active.bedMinutes ?? 0);
  },
  'morning-rate': (el) => { S.sheet.ratings[el.dataset.id] = Number(el.dataset.v); renderOverlay(); },
  'morning-save': async () => {
    const sh = S.sheet; S.sheet = null;
    await S.store.update(sh.record.id, (r) => { r.ratingsAfter = { ...r.ratingsAfter, ...sh.ratings }; r.awaitingMorningRatings = false; });
    S.records = await S.store.all(); render();
  },
  'morning-skip': async () => {
    const sh = S.sheet; S.sheet = null;
    await S.store.update(sh.record.id, (r) => { r.awaitingMorningRatings = false; });
    S.records = await S.store.all(); render();
  },
  export: async () => {
    const json = await S.store.exportJSON(S.settings);
    const name = `stillpoint-export-${new Date().toISOString().slice(0, 10)}.json`;
    const file = typeof File === 'function' ? new File([json], name, { type: 'application/json' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Stillpoint data' }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  },
  delete: async () => {
    const ok = await confirmDialog({ title: 'Delete all your data?', message: 'This removes your session history, ratings, notes, and settings from this browser. It can’t be undone.', yes: 'Delete everything', no: 'Cancel', destructive: true });
    if (!ok) return;
    S.active?.player.stop(false, false); S.active = null;
    await S.store.deleteAll();
    S.settings.reset();
    S.records = []; S.sheet = null; S.onboarding = null;
    location.hash = '#/';
    render();
  },
  'rerun-setup': () => { S.settings.set('onboardingDone', false); S.onboarding = null; render(); },
  // Onboarding
  'ob-next': () => {
    const o = S.onboarding;
    S.tones.stop(); o.sample = false;
    if (o.step >= 1) {
      S.settings.set('headphoneCheck', { left: o.heardLeft, right: o.heardRight, speaker: S.settings.speakerMode });
      S.settings.set('onboardingDone', true); S.onboarding = null; location.hash = '#/'; render(); return;
    }
    o.step += 1; renderMain(); window.scrollTo(0, 0);
  },
  'ob-back': () => { const o = S.onboarding; S.tones.stop(); o.sample = false; o.step = Math.max(0, o.step - 1); renderMain(); window.scrollTo(0, 0); },
  'ob-tone': (el) => {
    S.tones.setUserGain(VolumePolicy.clamp(S.settings.volume));
    S.tones.play(`tone-${el.dataset.v}`);
  },
  'ob-heard': (el) => { S.onboarding[el.dataset.k] = el.dataset.v === '1'; renderMain(); },
  'ob-sample': () => {
    const o = S.onboarding;
    o.sample = !o.sample;
    if (o.sample) {
      S.tones.setUserGain(VolumePolicy.clamp(S.settings.volume));
      S.tones.play('calibration', { loop: true });
    } else S.tones.stop();
    renderMain();
  },
  'abs-answer': (el) => {
    const a = S.absorption;
    a[Number(el.dataset.i)] = Number(el.dataset.v);
    if (!a.includes(null)) S.settings.set('suggestibility', Suggestibility.level(a));
    renderMain();
  },
};

function setSpeaker(on) {
  S.settings.set('speakerMode', on);
  const a = S.active;
  if (a) {
    a.mode = chooseMode(S.settings);
    a.player.setVariant(a.engine === 'stream' ? variantFor(a.mode, a.beats) : a.mode);
  }
  render();
}

const changes = {
  'ob-ack': (el) => { S.onboarding.ack = el.checked; renderMain(); },
  experiment: (el) => { S.settings.set('experimentEnabled', el.checked); render(); },
  speaker: (el) => setSpeaker(el.checked),
  'speaker-live': (el) => setSpeaker(el.checked),
  'keep-screen': (el) => { S.settings.set('keepScreenOn', el.checked); render(); },
  'wake-live': async (el) => {
    const a = S.active; if (!a) return;
    a.wantWake = el.checked;
    if (el.checked && !a.wake) a.wake = await keepScreenOn();
    if (!el.checked && a.wake) { a.wake(); a.wake = null; }
  },
};

const inputs = {
  volume: (el) => {
    const v = VolumePolicy.clamp(Number(el.value));
    S.settings.set('volume', v);
    S.active?.player.setUserGain(v);
    S.tones.setUserGain(v);
  },
  'post-note': (el) => { if (S.sheet?.type === 'post') S.sheet.note = el.value; },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('change', (e) => { const el = e.target.closest('[data-change]'); if (el) changes[el.dataset.change]?.(el); });
document.addEventListener('input', (e) => { const el = e.target.closest('[data-input]'); if (el) inputs[el.dataset.input]?.(el); });
window.addEventListener('hashchange', () => { renderMain(); window.scrollTo(0, 0); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  S.active?.player.reconcile();
  updatePlayer();
  checkMorning();
});

// ---------------------------------------------------------------------------------------------
// Boot

async function boot() {
  useAudioSessionPlayback();
  try {
    const [content, store] = await Promise.all([loadContent(APP_BASE), new Store().open()]);
    S.content = content; S.store = store;
    S.records = await store.all();
  } catch (e) {
    S.loadError = e.message ?? String(e);
  }
  render();
  if (S.content) checkMorning();
  if (window.isSecureContext && 'serviceWorker' in navigator && !/[?&]nosw\b/.test(location.search)) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
  }
  window.__stillpoint = S; // for the headless smoke test
}

boot();
