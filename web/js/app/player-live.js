// Real-time playback: the ported SessionRenderer inside an AudioWorklet, fed narration that is
// decoded just ahead of the playhead (port of SessionPlayer + VoiceLoader). This gives the
// native app's behaviour exactly: in-app volume, 1.2 s pause and stop fades, a 1.5 s crossfade
// when switching to speaker mode, and any noise-bed length. Its weakness on iPhone is the lock
// screen: Safari may suspend Web Audio when the page is hidden (see DECISIONS.md, "Web port").
//
// A silent looping <audio> element plays alongside to claim the lock-screen controls (Web Audio
// alone gets none on iOS); whether it also keeps the context running is what TESTING-WEB.md asks
// you to check on the phone.

import { ResolvedTimeline } from '../engine/session.js';
import { useAudioSessionPlayback, setMediaSession, setMediaSessionState, clearMediaSession } from './audio-env.js';
import { VolumePolicy } from './experiment.js';

const LOOKAHEAD = 25;     // seconds of narration decoded ahead (VoiceLoader.lookahead)
const EVICT_MARGIN = 3;   // seconds after a segment ends before its memory is freed
const workletURL = new URL('../engine/worklet.js', import.meta.url);

export class LivePlayer {
  constructor({ narrationBase, silenceURL, onChange, onFinish }) {
    this.narrationBase = narrationBase;
    this.silenceURL = silenceURL;
    this.onChange = onChange;
    this.onFinish = onFinish;
    this.kind = 'live';
    this.state = 'idle';
    this.notice = null;
    this.userGain = VolumePolicy.defaultGain;
    this.frame = 0;
    this.sampleRate = 48000;
  }

  get isActive() { return ['loading', 'playing', 'paused', 'interrupted'].includes(this.state); }
  get currentTime() { return this.frame / this.sampleRate; }

  /** Must be called synchronously inside a tap handler (creates and resumes the AudioContext). */
  start({ session, durations, manifest, bedMinutes, mode, beatsEnabled, title, album, keepAlive = true }) {
    this.stop(false, false);
    useAudioSessionPlayback();
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    ctx.resume();
    this.ctx = ctx;
    this.sampleRate = ctx.sampleRate;
    this.timeline = new ResolvedTimeline(session, durations, bedMinutes);
    this.sessionDuration = this.timeline.sessionDuration;
    this.totalDuration = this.timeline.totalDuration;
    this.manifest = manifest;
    this.frame = 0;
    this.finished = false;
    this.notice = null;
    this.loaded = new Set();
    this.loading = new Set();
    this.state = 'loading';
    this.mode = mode;

    if (keepAlive && this.silenceURL) {
      const el = document.createElement('audio');
      el.src = this.silenceURL; el.loop = true; el.setAttribute('playsinline', ''); el.style.display = 'none';
      document.body.appendChild(el);
      el.play()?.catch?.(() => {});
      this.keepAliveEl = el;
    }
    setMediaSession({ title, album, onPlay: () => this.resume(), onPause: () => this.pause(), onStop: () => this.stop(true) });

    ctx.onstatechange = () => {
      if (this.ctx !== ctx) return;
      if (ctx.state !== 'running' && this.state === 'playing') {
        // The OS took the audio (call, alarm, Siri, other app, or the page was hidden).
        this.node?.port.postMessage({ type: 'hardPause' });
        this.state = 'interrupted';
        this.notice = 'Paused by your phone. Press play to continue from the same place.';
        setMediaSessionState('paused');
        this.changed();
      }
    };

    this.ready = (async () => {
      await ctx.audioWorklet.addModule(workletURL);
      // Load whatever the first 30 s needs before starting, like SessionPlayer.preload(upTo: 30).
      await Promise.all(this.timeline.voice.map((v, i) => (v.start <= 30 ? this.loadSegment(i, true) : null)));
      if (this.ctx !== ctx) return;
      const node = new AudioWorkletNode(ctx, 'stillpoint-session', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { session, durations, bedMinutes, mode, beatsEnabled, userGain: this.userGain },
      });
      node.channelInterpretation = 'discrete';
      node.port.onmessage = (e) => this.onWorkletMessage(e.data);
      this.node = node;
      for (const [i, samples] of this.pendingVoice ?? []) node.port.postMessage({ type: 'voice', index: i, samples }, [samples.buffer]);
      this.pendingVoice = null;
      node.connect(ctx.destination);
      this.state = ctx.state === 'running' ? 'playing' : 'paused';
      if (this.state === 'paused') this.notice = 'Tap play to start.';
      setMediaSessionState(this.state === 'playing' ? 'playing' : 'paused');
      this.changed();
    })().catch((e) => {
      this.state = 'paused';
      this.notice = `The live engine couldn't start: ${e?.message ?? e}`;
      this.changed();
    });
    this.changed();
  }

  async loadSegment(i, preload = false) {
    if (this.loaded.has(i) || this.loading.has(i)) return;
    this.loading.add(i);
    const ctx = this.ctx;
    try {
      const id = this.timeline.voice[i].segmentID;
      const res = await fetch(`${this.narrationBase}${this.manifest.segments[id].file}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const audio = await ctx.decodeAudioData(await res.arrayBuffer());
      if (this.ctx !== ctx) return;
      const samples = new Float32Array(audio.getChannelData(0)); // copy: it is transferred to the worklet
      if (this.node) this.node.port.postMessage({ type: 'voice', index: i, samples }, [samples.buffer]);
      else (this.pendingVoice ??= []).push([i, samples]);
      this.loaded.add(i);
    } catch (e) {
      if (!preload) console.warn('narration load failed', i, e);
    } finally { this.loading.delete(i); }
  }

  onWorkletMessage(m) {
    if (m.type === 'tick') {
      this.frame = m.frame;
      this.underruns = m.underruns;
      const t = this.currentTime;
      this.timeline.voice.forEach((v, i) => {
        if (v.end + EVICT_MARGIN < t) {
          if (this.loaded.has(i)) { this.node.port.postMessage({ type: 'evict', index: i }); this.loaded.delete(i); }
        } else if (v.start - LOOKAHEAD <= t) this.loadSegment(i);
      });
      if (this.stopping && m.silent) this.stopping();
      this.changed();
    } else if (m.type === 'finished') {
      this.frame = m.frame;
      this.finish(true);
    }
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
    try { this.node?.disconnect(); } catch { /* ignore */ }
    const ctx = this.ctx;
    this.ctx = null; this.node = null;
    try { ctx?.close(); } catch { /* ignore */ }
    if (this.keepAliveEl) { try { this.keepAliveEl.pause(); this.keepAliveEl.remove(); } catch { /* ignore */ } this.keepAliveEl = null; }
  }

  pause() {
    if (!this.node || this.state !== 'playing') return;
    this.node.port.postMessage({ type: 'paused', value: true });
    this.state = 'paused';
    setMediaSessionState('paused');
    this.changed();
  }

  /** From a tap (or lock-screen play). Resumes a suspended context and fades back in. */
  resume() {
    if (!this.ctx || !['paused', 'interrupted'].includes(this.state)) return;
    useAudioSessionPlayback();
    const wasInterrupted = this.state === 'interrupted';
    this.ctx.resume();
    this.keepAliveEl?.play()?.catch?.(() => {});
    this.node?.port.postMessage({ type: wasInterrupted ? 'resumeFromSilence' : 'paused', value: false });
    this.state = 'playing';
    this.notice = null;
    setMediaSessionState('playing');
    this.changed();
  }

  togglePlayPause() { if (this.state === 'playing') this.pause(); else this.resume(); }

  stop(fade = true, notify = true) {
    if (!this.ctx) { this.state = 'idle'; return; }
    const end = () => {
      this.stopping = null;
      if (!notify) { this.finished = true; this.teardown(); this.state = 'idle'; this.changed(); return; }
      this.finish(false);
    };
    if (fade && this.node && this.state === 'playing' && this.ctx.state === 'running') {
      this.node.port.postMessage({ type: 'paused', value: true });
      this.stopping = end;
      setTimeout(() => this.stopping?.(), 1600); // in case the worklet never reports silence
    } else end();
  }

  setVariant(variant) {
    // In the live engine the mode is a crossfade inside the renderer (1.5 s), as on iOS.
    this.mode = variant;
    this.node?.port.postMessage({ type: 'mode', mode: variant });
  }

  setUserGain(g) {
    this.userGain = g;
    this.node?.port.postMessage({ type: 'gain', value: g });
  }

  reconcile() {
    if (this.ctx && this.state === 'playing' && this.ctx.state !== 'running') this.ctx.onstatechange?.();
    this.changed();
  }

  changed() { this.onChange?.(this); }
}

/** Onboarding tones (port of TestTonePlayer). */
export class TonePlayer {
  play(signal, userGain) {
    this.stop();
    useAudioSessionPlayback();
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    ctx.resume();
    this.ctx = ctx;
    ctx.audioWorklet.addModule(workletURL).then(() => {
      if (this.ctx !== ctx) return;
      const node = new AudioWorkletNode(ctx, 'stillpoint-tones', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { signal, userGain },
      });
      node.channelInterpretation = 'discrete';
      node.connect(ctx.destination);
      this.node = node;
    }).catch((e) => console.warn('tones', e));
  }
  setUserGain(g) { this.node?.port.postMessage({ type: 'gain', value: g }); }
  stop() {
    const ctx = this.ctx, node = this.node;
    this.ctx = null; this.node = null;
    if (!ctx) return;
    node?.port.postMessage({ type: 'stop' });
    setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 350);
  }
}
