import Foundation

/// A session is pure data (JSON in `Sessions/`). The engine never contains module-specific
/// logic: adding or adjusting a module means editing JSON + script text only.
public struct SessionDefinition: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var module: String              // module id, e.g. "quit-smoking"
    public var title: String
    public var subtitle: String
    /// "main", "rescue", etc. Purely for UI grouping.
    public var kind: String
    /// Awake sessions must finish alert; the validator checks the final beat target is >= 12 Hz.
    public var awake: Bool
    public var carrierHz: Double
    public var fadeInSeconds: Double
    public var fadeOutSeconds: Double
    public var noise: NoiseColor
    public var ambient: AmbientPreset?
    /// Extra attenuation applied to the beat layer in isochronic (speaker) mode.
    public var isochronicOffsetDb: Double
    public var ducking: Ducking
    public var phases: [Phase]
    /// Optional noise-only continuation after the session (sleep). Length chosen by the user.
    public var noiseBed: NoiseBed?
    /// Ratings asked before / after the session (self-experiment data).
    public var ratings: [RatingPrompt]
    /// Order within module list.
    public var sortOrder: Int

    public struct Ducking: Codable, Equatable, Sendable {
        public var amountDb: Double
        public var attackSeconds: Double
        public var releaseSeconds: Double
        /// Duck starts this long before a voice segment so speech never lands on full-level noise.
        public var leadSeconds: Double
        public init(amountDb: Double = 6, attackSeconds: Double = 0.6, releaseSeconds: Double = 2.0, leadSeconds: Double = 0.4) {
            self.amountDb = amountDb; self.attackSeconds = attackSeconds; self.releaseSeconds = releaseSeconds; self.leadSeconds = leadSeconds
        }
    }

    public struct Phase: Codable, Equatable, Sendable {
        public var id: String
        public var name: String
        /// Beat frequency the phase glides to (Hz).
        public var beatHz: Double
        /// Glide length from the previous phase's beat (s). Phase-continuous, smooth S-curve.
        public var beatGlideSeconds: Double
        /// Target layer levels (dB, relative to normalised voice). <= -90 means off.
        public var levels: Levels
        public var levelGlideSeconds: Double
        /// Silence before the first voice segment of the phase.
        public var leadInSeconds: Double
        public var segments: [Segment]
        /// Silence after the last segment.
        public var tailSeconds: Double
        /// Phase lasts at least this long (s). Lets non-voice phases (e.g. sleep delta) have length.
        public var minDurationSeconds: Double
        public var pacer: BreathPacer.Settings?
    }

    public struct Levels: Codable, Equatable, Sendable {
        public var beats: Double
        public var noise: Double
        public var ambient: Double
        public var pacer: Double
        public init(beats: Double, noise: Double, ambient: Double = -96, pacer: Double = -96) {
            self.beats = beats; self.noise = noise; self.ambient = ambient; self.pacer = pacer
        }
        enum CodingKeys: String, CodingKey { case beats, noise, ambient, pacer }
        public init(from d: Decoder) throws {
            let c = try d.container(keyedBy: CodingKeys.self)
            beats = try c.decode(Double.self, forKey: .beats)
            noise = try c.decode(Double.self, forKey: .noise)
            ambient = try c.decodeIfPresent(Double.self, forKey: .ambient) ?? -96
            pacer = try c.decodeIfPresent(Double.self, forKey: .pacer) ?? -96
        }
    }

    public struct Segment: Codable, Equatable, Sendable {
        /// Matches a narration file `<id>.m4a` and an entry in the narration manifest.
        public var id: String
        public var pauseAfter: Double
        public init(id: String, pauseAfter: Double) { self.id = id; self.pauseAfter = pauseAfter }
    }

    public struct NoiseBed: Codable, Equatable, Sendable {
        public var optionsMinutes: [Int]
        public var defaultMinutes: Int
        public var levelDb: Double
        public var crossfadeSeconds: Double
        public var fadeOutSeconds: Double
    }

    public struct RatingPrompt: Codable, Equatable, Sendable, Identifiable {
        public var id: String           // stored key, e.g. "craving"
        public var question: String
        public var minLabel: String
        public var maxLabel: String
        public var range: ClosedRange<Int>
        public var before: Bool
        public var after: Bool
        /// true if higher is better (used for progress direction).
        public var higherIsBetter: Bool
        /// "nextMorning" ratings are collected the next time the app opens (sleep).
        public var timing: String?
    }
}

extension SessionDefinition {
    public static func load(from url: URL) throws -> SessionDefinition {
        try JSONDecoder().decode(SessionDefinition.self, from: Data(contentsOf: url))
    }
}

/// Durations of generated narration segments (written by tools/narrate.py).
public struct NarrationManifest: Codable, Sendable {
    public struct Entry: Codable, Sendable {
        public var duration: Double
        public var file: String
        public var voice: String?
        public var text: String?
    }
    public var segments: [String: Entry]
    public init(segments: [String: Entry]) { self.segments = segments }

    public static func load(from url: URL) throws -> NarrationManifest {
        try JSONDecoder().decode(NarrationManifest.self, from: Data(contentsOf: url))
    }
}
