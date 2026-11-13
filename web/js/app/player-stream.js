// Pre-rendered playback through one <audio> element. This is the path that keeps playing with
// the screen locked on iPhone: Safari treats it like a podcast, with lock-screen controls via
// the Media Session API. The session's sound was rendered offline by the native engine
// (web/tools/build-audio.mjs), so mixing, ducking, fades and the soft clip are already in it.
// Each file is downloaded whole and played from memory (see start()), so a locked phone never
// depends on Safari loading more of it over the network.
//
// What a page can't do here on iPhone: set the element's volume (so no in-app volume or
// pause fades; the render is made at the in-app maximum of 0.75 and the side buttons set the
// level), or see calls and route changes directly (they arrive as an unexplained 'pause').

import { canSetElementVolume, useAudioSessionPlayback, setMediaSession, setMediaSessionState, clearMediaSession } from './audio-env.js';
import { VolumePolicy } from './experiment.js';

const FADE_SECONDS = 1.2;
const SCRUB_THRESHOLD = 10; // seconds; smaller jumps are Safari's own and are left alone

export class StreamPlayer {
  /**
   * @param {object} o
   * @param {string} o.audioBase URL prefix of web/audio/
   * @param {(p: StreamPlayer) => void} o.onChange called on every state or time change
   * @param {(completedSeconds: number, natural: boolean) => void} o.onFinish
   */
  constructor({ audioBase, silenceURL, onChange, onFinish }) {
    this.audioBase = audioBase;
    this.silenceURL = silenceURL;
    this.onChange = onChange;
    this.onFinish = onFinish;
    this.kind = 'stream';
    this.state = 'idle';
    this.notice = null;
    this.el = null;
    this.userGain = VolumePolicy.defaultGain;
    this.volumeControllable = canSetElementVolume();
  }

  get isActive() { return ['loading', 'playing', 'paused', 'interrupted'].includes(this.state); }

  /** Seconds into the whole experience (session, then any noise bed). */
  get currentTime() {
    if (!this.el || this.preparing) return 0;
    return this.inBed ? this.sessionDuration + this.el.currentTime : this.el.currentTime;
  }

  /**
   * Must be called synchronously inside a tap handler: iOS only lets a page start audio from a
   * user gesture, and the element keeps that permission for later source changes.
   */
  start({ entry, variant, bedMinutes, title, album, sessionDuration }) {
    this.stop(false, false);
    useAudioSessionPlayback();
    this.entry = entry;
    this.variant = variant;
    this.sessionDuration = sessionDuration;
    this.bed = bedMinutes > 0 ? entry.beds?.[bedMinutes] ?? null : null;
    this.totalDuration = sessionDuration + (this.bed ? this.bed.duration : 0);
    this.inBed = false;
    this.userPaused = false;
    this.finished = false;
    this.lastGood = 0;
    this.lastGoodAt = 0;
    this.ourSeek = false;
    this.notice = null;

    const el = document.createElement('audio');
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    el.style.display = 'none';
    document.body.appendChild(el);
    this.el = el;
    if (this.volumeControllable) this.applyVolume(1); // the render already fades in
    this.wire(el);
    this.state = 'loading';
    // Play a silent loop now, inside the tap, so the element is allowed to play; then download
    // the whole session file and play it from memory. Streaming it straight from the Mac stalled
    // for good in a 20-minute locked test in the Simulator (Safari throttles media loading when
    // the screen is locked), so playback must not depend on the network once it has started.
    this.preparing = true;
    el.loop = true;
    el.src = this.silenceURL;
    this.notice = 'Loading session audio…';
    this.download(entry.variants[variant].file, el).then((url) => {
      if (this.el !== el) return;
      this.blobURL = url;
      this.beginMain(el, url);
      if (this.bed) {
        this.download(this.bed.file, el).then((u) => { if (this.el === el) this.bedURL = u; }).catch(() => { /* bed streams instead */ });
      }
    }).catch(() => {
      if (this.el !== el) return;
      this.beginMain(el, this.url(entry.variants[variant].file)); // fall back to streaming
    });
    setMediaSession({
      title, album,
      onPlay: () => this.resume(),
      onPause: () => this.pause(),
      onStop: () => this.stop(true),
    });
    const p = el.play();
    if (p?.catch) {
      p.catch((e) => {
        if (this.el !== el) return;
        this.state = 'paused';
        this.notice = e?.name === 'NotAllowedError' ? 'Tap play to start. The browser needs a tap before it plays sound.' : `Couldn't start audio: ${e?.message ?? e}`;
        this.changed();
      });
    }
    this.changed();
  }

  url(file) { return `${this.audioBase}${file}`; }

  /** Fetches a whole file into memory and returns an object URL for it. */
  async download(file, el) {
    const res = await fetch(this.url(file));
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (this.el !== el) { reader.cancel(); throw new Error('cancelled'); }
      parts.push(value); got += value.length;
      if (this.preparing && total) { this.notice = `Loading session audio… ${Math.round((got / total) * 100)}%`; this.changed(); }
    }
    return URL.createObjectURL(new Blob(parts, { type: 'audio/mp4' }));
  }

  beginMain(el, src) {
    this.preparing = false;
    this.notice = null;
    el.loop = false;
    el.src = src;
    if (this.userPaused) { this.state = 'paused'; this.changed(); return; }
    this.state = 'loading';
    el.play()?.catch?.((e) => {
      if (this.el !== el) return;
      this.state = 'paused';
      this.notice = e?.name === 'NotAllowedError' ? 'Tap play to start.' : `Couldn't start audio: ${e?.message ?? e}`;
      this.changed();
    });
    this.changed();
    if (this.pendingVariant && this.pendingVariant !== this.variant) { const v = this.pendingVariant; this.pendingVariant = null; this.setVariant(v); }
  }

  /** Where the playhead should be, from the last reported position plus time since then. */
  expectedTime() {
    const playing = this.state === 'playing' && this.lastGoodAt;
    const t = this.lastGood + (playing ? (performance.now() - this.lastGoodAt) / 1000 : 0);
    const d = this.el?.duration;
    return Number.isFinite(d) ? Math.min(t, d) : t;
  }

  wire(el) {
    // While the silent placeholder plays, its events are not the session's.
    const on = (ev, fn) => el.addEventListener(ev, (e) => { if (this.el === el && !this.preparing) fn(e); });
    on('playing', () => {
      this.state = 'playing'; this.notice = null; this.userPaused = false;
      setMediaSessionState('playing'); this.changed();
    });
    on('pause', () => {
      if (this.finished || el.ended) return;
      if (!this.userPaused) {
        // Not us: a call, Siri, an alarm, another app, or headphones disconnected.
        this.state = 'interrupted';
        this.notice = 'Paused by your phone (a call, another app, or headphones disconnected). Press play to continue from here.';
      } else this.state = 'paused';
      setMediaSessionState('paused');
      this.changed();
    });
    on('timeupdate', () => {
      if (!el.seeking && !this.ourSeek) { this.lastGood = el.currentTime; this.lastGoodAt = performance.now(); }
      this.changed();
    });
    on('seeking', () => {
      // Lock-screen scrubbing can't be fully hidden on iPhone, so undo large seeks we didn't make.
      // Compare with where playback should be *now*: while the screen is locked Safari sends
      // timeupdate only every few seconds, and Safari itself makes small seeks (seen in the
      // Simulator while locked). Reverting those to a stale position replayed ~3 s of audio.
      if (this.ourSeek) return;
      const expected = this.expectedTime();
      if (Math.abs(el.currentTime - expected) > SCRUB_THRESHOLD) {
        this.ourSeek = true;
        el.currentTime = expected;
        this.lastGood = expected; this.lastGoodAt = performance.now();
      }
    });
    on('seeked', () => { this.ourSeek = false; });
    on('waiting', () => { if (this.state === 'playing') { this.notice = 'Buffering… If this lasts, check the Mac is still serving.'; this.changed(); } });
    on('stalled', () => { if (this.state === 'playing') { this.notice = 'Waiting for audio from the Mac…'; this.changed(); } });
    on('ended', () => this.handleEnded());
    on('error', () => {
      const code = el.error?.code;
      this.state = 'paused';
      this.notice = `Audio failed to load (${['', 'aborted', 'network', 'decode', 'unsupported'][code] ?? 'error'}). Check the Mac is still serving, then press play.`;
      this.changed();
    });
  }

  handleEnded() {
    if (this.bed && !this.inBed) {
      // Continue with the noise bed in the same element (it keeps the tap's permission).
      this.inBed = true;
      this.lastGood = 0; this.lastGoodAt = 0;
      this.el.src = this.bedURL ?? this.url(this.bed.file);
      const p = this.el.play();
      p?.catch?.(() => this.finish(true));
      this.changed();
      return;
    }
    this.finish(true);
  }

  finish(natural) {
    if (this.finished) return;
    this.finished = true;
    const done = Math.min(this.currentTime, this.totalDuration);
    this.state = 'finished';
    this.teardown();
    this.onFinish?.(done, natural);
    this.changed();
  }

  teardown() {
    clearMediaSession();
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    if (this.el) {
      const el = this.el;
      this.el = null;
      try { el.pause(); el.removeAttribute('src'); el.load(); el.remove(); } catch { /* ignore */ }
    }
    for (const k of ['blobURL', 'bedURL']) { if (this[k]) { URL.revokeObjectURL(this[k]); this[k] = null; } }
  }

  pause() {
    if (!this.el || !['playing', 'loading'].includes(this.state)) return;
    this.userPaused = true;
    if (this.volumeControllable) this.fadeTo(0, FADE_SECONDS, () => this.el?.pause());
    else this.el.pause();
    this.state = 'paused';
    this.changed();
  }

  /** Call from a tap or a lock-screen play. */
  resume() {
    if (!this.el || !['paused', 'interrupted'].includes(this.state)) return;
    useAudioSessionPlayback();
    this.userPaused = false;
    if (this.preparing) { this.state = 'loading'; this.el.play()?.catch?.(() => {}); this.changed(); return; }
    this.notice = null;
    if (this.volumeControllable) { this.applyVolume(0); this.fadeTo(1, FADE_SECONDS); }
    // If a pause fade was still running, the element never actually paused, so no 'playing'
    // event will follow: mark it playing here.
    if (!this.el.paused) { this.state = 'playing'; setMediaSessionState('playing'); }
    const p = this.el.play();
    p?.catch?.((e) => { this.notice = `Couldn't resume: ${e?.message ?? e}`; this.changed(); });
    this.changed();
  }

  togglePlayPause() { if (this.state === 'playing' || this.state === 'loading') this.pause(); else this.resume(); }

  /** Ends the session early. Fades where the browser allows it. */
  stop(fade = true, notify = true) {
    if (!this.el) { this.state = 'idle'; return; }
    const end = () => {
      if (!notify) { this.finished = true; this.teardown(); this.state = 'idle'; this.changed(); return; }
      this.finish(false);
    };
    if (fade && this.volumeControllable && this.state === 'playing') this.fadeTo(0, FADE_SECONDS, end);
    else end();
  }

  /** Switch between the binaural and isochronic renders at the same moment (a tap). */
  setVariant(variant) {
    if (!this.el || variant === this.variant || this.inBed) { if (!this.el || this.inBed) this.variant = variant; return; }
    if (this.preparing) { this.pendingVariant = variant; return; }
    const el = this.el;
    this.variant = variant;
    this.notice = 'Switching…';
    this.changed();
    // Keep playing the current file until the other one is in memory, then swap at that moment.
    this.download(this.entry.variants[variant].file, el).catch(() => this.url(this.entry.variants[variant].file)).then((src) => {
      if (this.el !== el || this.variant !== variant) { if (src.startsWith('blob:')) URL.revokeObjectURL(src); return; }
      const t = el.currentTime, wasPlaying = !el.paused;
      if (this.blobURL) URL.revokeObjectURL(this.blobURL);
      this.blobURL = src.startsWith('blob:') ? src : null;
      this.ourSeek = true;
      el.src = src;
      el.addEventListener('loadedmetadata', () => { el.currentTime = t; this.lastGood = t; this.lastGoodAt = performance.now(); }, { once: true });
      if (wasPlaying) el.play()?.catch?.(() => {});
      this.notice = null;
      this.changed();
    });
  }

  setUserGain(g) {
    this.userGain = g;
    if (this.volumeControllable && !this.fadeTimer) this.applyVolume(1);
  }

  /** Element volume = fade × (user gain ÷ the gain the file was rendered at). */
  applyVolume(fade) {
    if (!this.el || !this.volumeControllable || fade === null) return;
    this.fade = fade;
    this.el.volume = Math.max(0, Math.min(1, fade * this.userGain / VolumePolicy.maxGain));
  }

  fadeTo(target, seconds, then) {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    const from = this.fade ?? 1, t0 = performance.now();
    this.fadeTimer = setInterval(() => {
      const x = Math.min(1, (performance.now() - t0) / (seconds * 1000));
      this.applyVolume(from + (target - from) * (0.5 - 0.5 * Math.cos(Math.PI * x)));
      if (x >= 1) { clearInterval(this.fadeTimer); this.fadeTimer = null; then?.(); }
    }, 30);
  }

  /** Re-sync after the page was frozen (screen locked): an 'ended' may have been missed. */
  reconcile() {
    if (this.el?.ended && !this.finished) this.handleEnded();
    this.changed();
  }

  changed() { this.onChange?.(this); }
}
