// AudioWorklet processors. The session processor runs the ported SessionRenderer in real time,
// exactly as AVAudioSourceNode runs it in the native app. Loaded with audioWorklet.addModule.

import { ResolvedTimeline } from './session.js';
import { SessionRenderer, SlotVoice, BeatMode } from './renderer.js';
import { BinauralOscillator, NoiseGenerator } from './dsp.js';

class SessionProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    const tl = new ResolvedTimeline(o.session, o.durations, o.bedMinutes ?? 0);
    this.voice = new SlotVoice(tl.voice.length);
    this.r = new SessionRenderer(tl, sampleRate, this.voice, {
      mode: BeatMode[o.mode] ?? 0, beatsEnabled: o.beatsEnabled, userGain: o.userGain,
    });
    if (o.startPaused) this.r.hardPause();
    this.lastPost = -Infinity;
    this.finishedSent = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      switch (m.type) {
        case 'voice': this.voice.install(m.index, m.samples); break;
        case 'evict': this.voice.evict(m.index); break;
        case 'mode': this.r.setMode(BeatMode[m.mode] ?? 0); break;
        case 'gain': this.r.setUserGain(m.value); break;
        case 'paused': this.r.setPaused(m.value); break;
        case 'hardPause': this.r.hardPause(); break;
        case 'resumeFromSilence': this.r.hardPause(); this.r.setPaused(false); break;
        default: break;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] ?? out[0];
    this.r.render(L, R, L.length);
    const now = currentFrame;
    if (now - this.lastPost >= sampleRate / 8) {
      this.lastPost = now;
      this.port.postMessage({
        type: 'tick', frame: this.r.frame, underruns: this.r.underruns, silent: this.r.isSilentlyPaused, ctxFrame: now,
      });
    }
    if (this.r.isFinished && !this.finishedSent) {
      this.finishedSent = true;
      this.port.postMessage({ type: 'finished', frame: this.r.frame });
    }
    return true;
  }
}
registerProcessor('stillpoint-session', SessionProcessor);

/**
 * Onboarding signals (port of TestTonePlayer): left-only and right-only identification tones,
 * and a calibration bed of pink noise with beats at session levels. 0.25 s gain ramps.
 */
class TonesProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.signal = options.processorOptions.signal;
    this.user = options.processorOptions.userGain;
    this.osc = new BinauralOscillator();
    this.nl = new NoiseGenerator('pink', 11n);
    this.nr = new NoiseGenerator('pink', 29n);
    this.gain = 0; this.target = 1;
    this.step = 1 / (0.25 * sampleRate);
    this.noiseGain = Math.fround(10 ** (-14 / 20));
    this.beatGain = Math.fround(10 ** (-32 / 20));
    this.done = false;
    this.port.onmessage = (e) => {
      if (e.data.type === 'gain') this.user = e.data.value;
      if (e.data.type === 'stop') this.target = 0;
    };
  }
  process(_i, outputs) {
    const L = outputs[0][0], R = outputs[0][1] ?? outputs[0][0];
    for (let i = 0; i < L.length; i++) {
      this.gain += this.gain < this.target ? this.step : (this.gain > this.target ? -this.step : 0);
      this.gain = Math.min(Math.max(this.gain, 0), 1);
      const g = this.gain * this.user;
      if (this.signal === 'calibration') {
        this.osc.next(220, 10, sampleRate);
        L[i] = (this.nl.next() * this.noiseGain + this.osc.l * this.beatGain) * g;
        R[i] = (this.nr.next() * this.noiseGain + this.osc.r * this.beatGain) * g;
      } else {
        this.osc.next(330, 0, sampleRate);
        L[i] = this.signal === 'left' ? this.osc.l * g * 0.5 : 0;
        R[i] = this.signal === 'right' ? this.osc.l * g * 0.5 : 0;
      }
    }
    if (this.target === 0 && this.gain === 0) { this.done = true; return false; }
    return true;
  }
}
registerProcessor('stillpoint-tones', TonesProcessor);
