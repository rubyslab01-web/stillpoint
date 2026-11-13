// Port of HypnosisAppCore/Experiment/Experiment.swift (self-experiment, suggestibility,
// volume policy). Pure functions so they run in Node tests unchanged.

export const Experiment = {
  /** Sessions per arm needed before results (and each session's condition) are revealed. */
  revealThreshold: 5,

  /** Keeps arms balanced: if one arm is ahead by 2 or more, choose the other; else a fair coin. */
  assignBeatsCounts(withBeats, withoutBeats, random = Math.random) {
    if (withBeats - withoutBeats >= 2) return false;
    if (withoutBeats - withBeats >= 2) return true;
    return random() < 0.5;
  },

  assignBeats(history, moduleID, random = Math.random) {
    const h = history.filter((r) => r.moduleID === moduleID && r.inExperiment);
    return this.assignBeatsCounts(h.filter((r) => r.beatsEnabled).length, h.filter((r) => !r.beatsEnabled).length, random);
  },

  /** Improvement score for one rating (positive = better). Before+after uses the change. */
  score(r, prompt) {
    const after = r.ratingsAfter?.[prompt.id];
    if (after === undefined || after === null) return null;
    const sign = prompt.higherIsBetter ? 1 : -1;
    if (prompt.before && prompt.after) {
      const before = r.ratingsBefore?.[prompt.id];
      if (before === undefined || before === null) return null;
      return sign * (after - before);
    }
    return sign * after;
  },

  stats(xs) {
    if (!xs.length) return { n: 0, mean: 0, sd: 0 };
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.length > 1 ? xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1) : 0;
    return { n: xs.length, mean: m, sd: Math.sqrt(v) };
  },

  /** Compares arms on per-session scores. Verdict needs |d| >= 0.5 (a "medium" difference). */
  compare(metric, unit, beats, noBeats) {
    const a = this.stats(beats), b = this.stats(noBeats);
    const needed = Math.max(0, this.revealThreshold - a.n) + Math.max(0, this.revealThreshold - b.n);
    if (needed !== 0) return { metric, unit, withBeats: a, withoutBeats: b, effect: 0, verdict: 'collecting', needed, revealed: false };
    const pooled = Math.sqrt(((a.n - 1) * a.sd * a.sd + (b.n - 1) * b.sd * b.sd) / (a.n + b.n - 2));
    const diff = a.mean - b.mean;
    const d = pooled > 0 ? diff / pooled : (diff === 0 ? 0 : (diff > 0 ? 9 : -9));
    const verdict = Math.abs(d) < 0.5 ? 'noClearDifference' : (d > 0 ? 'beatsHelp' : 'beatsHurt');
    return { metric, unit, withBeats: a, withoutBeats: b, effect: d, verdict, needed: 0, revealed: true };
  },

  /** All comparisons for a module: its primary rating first, then other ratings and sleep data. */
  results(history, moduleID, prompts, primary) {
    const h = history.filter((r) => r.moduleID === moduleID && r.inExperiment);
    const on = h.filter((r) => r.beatsEnabled), off = h.filter((r) => !r.beatsEnabled);
    const out = [];
    const sorted = [...prompts].sort((x, y) => (x.id === primary ? 0 : 1) - (y.id === primary ? 0 : 1));
    for (const p of sorted) {
      const unit = p.before && p.after ? 'points of improvement' : 'points (0–10)';
      const a = on.map((r) => this.score(r, p)).filter((x) => x !== null);
      const b = off.map((r) => this.score(r, p)).filter((x) => x !== null);
      if (p.id === primary || a.length + b.length > 0) out.push(this.compare(p.id, unit, a, b));
    }
    // Sleep-tracker data (none in the web build yet; see js/app/sources.js).
    const add = (name, unit, f) => {
      const a = on.map(f).filter((x) => x !== null && x !== undefined);
      const b = off.map(f).filter((x) => x !== null && x !== undefined);
      if (a.length + b.length > 0) out.push(this.compare(name, unit, a, b));
    };
    add('Deep sleep', 'minutes', (r) => r.sleep?.deepMinutes);
    add('Time to fall asleep', 'minutes faster', (r) => (r.sleep?.onsetMinutes == null ? null : -r.sleep.onsetMinutes));
    return out;
  },

  /** Unique rating prompts across a module's sessions, in first-seen order. */
  promptsFor(sessions) {
    const acc = [];
    for (const p of sessions.flatMap((s) => s.ratings)) if (!acc.some((x) => x.id === p.id)) acc.push(p);
    return acc;
  },
};

export const Suggestibility = {
  items: [
    'I can get so absorbed in a film, book, or music that I stop noticing what is around me.',
    'When I imagine something vividly, I can almost see, hear, or feel it.',
    'If I picture biting into a lemon, my mouth waters.',
    "I sometimes drive or walk somewhere familiar and realise I don't remember part of the journey.",
    'I find it easy to relax when someone talks me through it.',
  ],
  /** Each answer is 0 (never) … 4 (very often). */
  level(answers) {
    const total = answers.reduce((a, b) => a + b, 0);
    const frac = total / Math.max(1, answers.length * 4);
    return frac < 0.4 ? 'lower' : frac < 0.7 ? 'medium' : 'higher';
  },
  explanation(l) {
    switch (l) {
      case 'higher': return 'You seem to become absorbed easily. People like you tend to respond most to hypnosis sessions, including the sleep suggestions.';
      case 'medium': return 'You are in the middle range, like most people. Hypnosis sessions may help, and tend to work better with repetition.';
      default: return 'You may respond less to hypnotic suggestion. That is common and fine. The breathing practice and rescue sessions do not depend on it, and the self-experiment will show what helps you.';
    }
  },
};

/** The in-app volume tops out at maxGain; pre-rendered audio is rendered at exactly maxGain. */
export const VolumePolicy = {
  maxGain: 0.75,
  defaultGain: 0.5,
  clamp(g) { return Math.min(Math.max(g, 0.05), this.maxGain); },
};
