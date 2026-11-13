import Foundation

/// A session resolved against real narration durations into absolute-time curves.
public struct ResolvedTimeline: Sendable {
    public struct PhaseSpan: Sendable, Equatable {
        public var id: String
        public var name: String
        public var start: Double
        public var end: Double
    }
    public struct VoicePlacement: Sendable, Equatable {
        public var segmentID: String
        public var start: Double
        public var duration: Double
        public var end: Double { start + duration }
    }
    public struct PacerSpan: Sendable, Equatable {
        public var start: Double
        public var end: Double
        public var settings: BreathPacer.Settings
    }

    public var carrierHz: Double
    public var beatHz: Envelope
    public var beatsDb: Envelope
    public var noiseDb: Envelope
    public var ambientDb: Envelope
    public var pacerDb: Envelope
    public var pacers: [PacerSpan]
    public var phases: [PhaseSpan]
    public var voice: [VoicePlacement]
    /// Duck envelope as a 0…1 "voice active" target; renderer smooths it with attack/release.
    public var voiceActivity: [ClosedRange<Double>]
    public var ducking: SessionDefinition.Ducking
    public var fadeIn: Double
    public var fadeOut: Double
    /// End of the guided session (excluding any noise bed).
    public var sessionDuration: Double
    /// Total render length including the optional noise bed.
    public var totalDuration: Double
    public var noise: NoiseColor
    public var ambient: AmbientPreset?
    public var isochronicOffsetDb: Double

    public enum ResolveError: Error, CustomStringConvertible {
        case missingSegment(String)
        case invalid(String)
        public var description: String {
            switch self {
            case .missingSegment(let s): return "Narration segment '\(s)' not in manifest"
            case .invalid(let s): return s
            }
        }
    }

    /// - Parameter noiseBedMinutes: user-selected noise bed length (0 = none).
    public init(session: SessionDefinition, durations: [String: Double], noiseBedMinutes: Int = 0) throws {
        guard !session.phases.isEmpty else { throw ResolveError.invalid("Session has no phases") }
        carrierHz = session.carrierHz
        ducking = session.ducking
        fadeIn = session.fadeInSeconds
        fadeOut = session.fadeOutSeconds
        noise = session.noise
        ambient = session.ambient
        isochronicOffsetDb = session.isochronicOffsetDb

        var beat: [Envelope.Point] = []
        var beats: [Envelope.Point] = [], noiseP: [Envelope.Point] = [], amb: [Envelope.Point] = [], pac: [Envelope.Point] = []
        var phases: [PhaseSpan] = []
        var voice: [VoicePlacement] = []
        var pacers: [PacerSpan] = []
        var t = 0.0

        for (i, phase) in session.phases.enumerated() {
            let start = t
            if i == 0 {
                beat.append(.init(time: 0, value: phase.beatHz))
                beats.append(.init(time: 0, value: phase.levels.beats))
                noiseP.append(.init(time: 0, value: phase.levels.noise))
                amb.append(.init(time: 0, value: phase.levels.ambient))
                pac.append(.init(time: 0, value: phase.levels.pacer))
            } else {
                // Hold the previous value until the phase boundary, then glide.
                func glide(_ arr: inout [Envelope.Point], to v: Double, over g: Double) {
                    let prev = arr.last!.value
                    arr.append(.init(time: start, value: prev, shape: .linear))
                    arr.append(.init(time: start + max(g, 0.001), value: v, shape: .smooth))
                }
                glide(&beat, to: phase.beatHz, over: phase.beatGlideSeconds)
                glide(&beats, to: phase.levels.beats, over: phase.levelGlideSeconds)
                glide(&noiseP, to: phase.levels.noise, over: phase.levelGlideSeconds)
                glide(&amb, to: phase.levels.ambient, over: phase.levelGlideSeconds)
                glide(&pac, to: phase.levels.pacer, over: phase.levelGlideSeconds)
            }
            var cursor = start + phase.leadInSeconds
            for seg in phase.segments {
                guard let d = durations[seg.id] else { throw ResolveError.missingSegment(seg.id) }
                voice.append(VoicePlacement(segmentID: seg.id, start: cursor, duration: d))
                cursor += d + seg.pauseAfter
            }
            cursor += phase.tailSeconds
            let end = max(cursor, start + phase.minDurationSeconds)
            phases.append(PhaseSpan(id: phase.id, name: phase.name, start: start, end: end))
            if let p = phase.pacer { pacers.append(PacerSpan(start: start, end: end, settings: p)) }
            t = end
        }
        sessionDuration = t
        // Session-level fade-out of the guided layers happens inside the final `fadeOut` seconds;
        // with a noise bed, beats/ambient/pacer fade but noise crossfades to the bed level.
        var total = t
        if let bed = session.noiseBed, noiseBedMinutes > 0 {
            let xf = bed.crossfadeSeconds
            func fadeTo(_ arr: inout [Envelope.Point], _ v: Double) {
                let prev = arr.last!.value
                arr.append(.init(time: t, value: prev, shape: .linear))
                arr.append(.init(time: t + xf, value: v, shape: .smooth))
            }
            fadeTo(&beats, -96); fadeTo(&amb, -96); fadeTo(&pac, -96)
            fadeTo(&noiseP, bed.levelDb)
            total = t + Double(noiseBedMinutes) * 60
            phases.append(PhaseSpan(id: "noise-bed", name: "Noise bed", start: t, end: total))
            fadeOut = bed.fadeOutSeconds
        }
        totalDuration = total
        beatHz = Envelope(points: beat)
        beatsDb = Envelope(points: beats)
        noiseDb = Envelope(points: noiseP)
        ambientDb = Envelope(points: amb)
        pacerDb = Envelope(points: pac)
        self.phases = phases
        self.voice = voice
        self.pacers = pacers
        let lead = session.ducking.leadSeconds
        voiceActivity = voice.map { ($0.start - lead)...$0.end }
    }

    public func phase(at t: Double) -> PhaseSpan? {
        phases.first { t >= $0.start && t < $0.end } ?? (t >= totalDuration ? phases.last : nil)
    }
}
