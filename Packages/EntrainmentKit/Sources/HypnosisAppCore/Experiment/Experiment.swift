import Foundation
import EntrainmentKit

/// Blinded self-experiment: some sessions randomly run without the beat layer.
public enum Experiment {
    /// Sessions per arm needed before results are revealed.
    public static let revealThreshold = 5

    /// Random assignment that keeps the two arms balanced: if one arm is ahead by 2 or more,
    /// the other arm is chosen; otherwise a fair coin.
    public static func assignBeats<G: RandomNumberGenerator>(withBeats: Int, withoutBeats: Int, using rng: inout G) -> Bool {
        if withBeats - withoutBeats >= 2 { return false }
        if withoutBeats - withBeats >= 2 { return true }
        return Bool.random(using: &rng)
    }

    public static func assignBeats(history: [SessionRecord], moduleID: String) -> Bool {
        let h = history.filter { $0.moduleID == moduleID && $0.inExperiment }
        var rng = SystemRandomNumberGenerator()
        return assignBeats(withBeats: h.filter(\.beatsEnabled).count, withoutBeats: h.filter { !$0.beatsEnabled }.count, using: &rng)
    }

    /// Improvement score for one rating in one session: positive = better.
    /// Before+after ratings use the change; after-only ratings (e.g. next-morning sleep) use the value.
    public static func score(_ r: SessionRecord, prompt: SessionDefinition.RatingPrompt) -> Double? {
        guard let after = r.ratingsAfter[prompt.id] else { return nil }
        let sign = prompt.higherIsBetter ? 1.0 : -1.0
        if prompt.before, prompt.after {
            guard let before = r.ratingsBefore[prompt.id] else { return nil }
            return sign * Double(after - before)
        }
        return sign * Double(after)
    }

    public struct ArmStats: Equatable, Sendable {
        public var n: Int
        public var mean: Double
        public var sd: Double
    }

    public enum Verdict: Equatable, Sendable {
        case collecting(needed: Int)
        case noClearDifference
        case beatsHelp
        case beatsHurt
    }

    public struct Result: Equatable, Sendable {
        public var metric: String
        public var unit: String
        public var withBeats: ArmStats
        public var withoutBeats: ArmStats
        /// Standardised difference (Cohen's d, pooled SD); positive favours beats.
        public var effect: Double
        public var verdict: Verdict
        public var revealed: Bool { if case .collecting = verdict { return false } else { return true } }
    }

    static func stats(_ xs: [Double]) -> ArmStats {
        guard !xs.isEmpty else { return ArmStats(n: 0, mean: 0, sd: 0) }
        let m = xs.reduce(0, +) / Double(xs.count)
        let v = xs.count > 1 ? xs.reduce(0) { $0 + ($1 - m) * ($1 - m) } / Double(xs.count - 1) : 0
        return ArmStats(n: xs.count, mean: m, sd: v.squareRoot())
    }

    /// Compares arms on arbitrary per-session scores (positive = better).
    public static func compare(metric: String, unit: String, beats: [Double], noBeats: [Double]) -> Result {
        let a = stats(beats), b = stats(noBeats)
        let needed = max(0, revealThreshold - a.n) + max(0, revealThreshold - b.n)
        guard needed == 0 else {
            return Result(metric: metric, unit: unit, withBeats: a, withoutBeats: b, effect: 0, verdict: .collecting(needed: needed))
        }
        let pooled = (((Double(a.n - 1) * a.sd * a.sd) + (Double(b.n - 1) * b.sd * b.sd)) / Double(a.n + b.n - 2)).squareRoot()
        let diff = a.mean - b.mean
        let d = pooled > 0 ? diff / pooled : (diff == 0 ? 0 : (diff > 0 ? 9 : -9))
        // With so few sessions, only call a difference when it is at least "medium" (d ≥ 0.5).
        let verdict: Verdict = abs(d) < 0.5 ? .noClearDifference : (d > 0 ? .beatsHelp : .beatsHurt)
        return Result(metric: metric, unit: unit, withBeats: a, withoutBeats: b, effect: d, verdict: verdict)
    }

    /// All comparisons available for a module: its primary rating, plus Health metrics if present.
    public static func results(history: [SessionRecord], moduleID: String, prompts: [SessionDefinition.RatingPrompt], primary: String) -> [Result] {
        let h = history.filter { $0.moduleID == moduleID && $0.inExperiment }
        var out: [Result] = []
        func add(_ name: String, _ unit: String, _ f: (SessionRecord) -> Double?) {
            let a = h.filter(\.beatsEnabled).compactMap(f), b = h.filter { !$0.beatsEnabled }.compactMap(f)
            if name == primary || a.count + b.count > 0 { out.append(compare(metric: name, unit: unit, beats: a, noBeats: b)) }
        }
        for p in prompts.sorted(by: { ($0.id == primary ? 0 : 1) < ($1.id == primary ? 0 : 1) }) {
            let unit = (p.before && p.after) ? "points of improvement" : "points (0–10)"
            let label = p.id == primary ? primary : p.id
            let a = h.filter(\.beatsEnabled).compactMap { score($0, prompt: p) }
            let b = h.filter { !$0.beatsEnabled }.compactMap { score($0, prompt: p) }
            if p.id == primary || a.count + b.count > 0 { out.append(compare(metric: label, unit: unit, beats: a, noBeats: b)) }
        }
        add("Deep sleep", "minutes") { $0.sleepDeepMinutes }
        add("Time to fall asleep", "minutes faster") { $0.sleepOnsetMinutes.map { -$0 } }
        add("Heart rate variability", "ms") { $0.hrvSDNN }
        return out
    }
}

/// Short self-assessment used in onboarding. Items are adapted from absorption / imaginative
/// involvement questionnaires, which correlate modestly with hypnotic suggestibility.
/// It is a rough guide for setting expectations, not a clinical scale.
public enum Suggestibility {
    public static let items = [
        "I can get so absorbed in a film, book, or music that I stop noticing what is around me.",
        "When I imagine something vividly, I can almost see, hear, or feel it.",
        "If I picture biting into a lemon, my mouth waters.",
        "I sometimes drive or walk somewhere familiar and realise I don't remember part of the journey.",
        "I find it easy to relax when someone talks me through it.",
    ]
    public enum Level: String, Sendable { case lower, medium, higher }

    /// Each answer is 0 (never) … 4 (very often).
    public static func level(answers: [Int]) -> Level {
        let total = answers.reduce(0, +)
        let maxTotal = max(1, answers.count * 4)
        let frac = Double(total) / Double(maxTotal)
        return frac < 0.4 ? .lower : (frac < 0.7 ? .medium : .higher)
    }

    public static func explanation(_ l: Level) -> String {
        switch l {
        case .higher: return "You seem to become absorbed easily. People like you tend to respond most to hypnosis sessions, including the sleep suggestions."
        case .medium: return "You are in the middle range, like most people. Hypnosis sessions may help, and tend to work better with repetition."
        case .lower: return "You may respond less to hypnotic suggestion. That is common and fine. The breathing practice and rescue sessions do not depend on it, and the self-experiment will show what helps you."
        }
    }
}

/// App-level volume policy: the user's volume slider tops out at `maxGain`, which leaves
/// headroom so peaks never clip and caps how loud the app can be relative to system volume.
public enum VolumePolicy {
    public static let maxGain = 0.75
    public static let defaultGain = 0.5
    /// System volume above which we warn on headphones.
    public static let highSystemVolume: Float = 0.8
    public static func clamp(_ g: Double) -> Double { min(max(g, 0.05), maxGain) }
}
