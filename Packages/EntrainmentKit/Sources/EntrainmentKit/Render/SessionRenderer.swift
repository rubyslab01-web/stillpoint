import Foundation
import Synchronization

public enum BeatMode: Int, Sendable {
    case binaural = 0
    case isochronic = 1
}

/// The real-time mixer. One instance renders one session. All state the audio thread
/// touches is either owned by it or exchanged through atomics, so `render` is lock-free
/// and allocation-free.
///
/// Mix (top → bottom): voice (0 dB ref) › noise › ambient › pacer › beats (~18 dB under noise).
/// Background layers are ducked while the voice speaks. Master = session fade × pause fade ×
/// user volume, then a gentle soft-clip as a last-resort safety.
public final class SessionRenderer: @unchecked Sendable {
    public let timeline: ResolvedTimeline
    public let sampleRate: Double
    public let beatsEnabled: Bool
    private let voice: VoiceSource?

    // Audio-thread state
    private var frame: Int64 = 0
    private var binaural = BinauralOscillator()
    private var iso = IsochronicOscillator()
    private var noiseL: NoiseGenerator
    private var noiseR: NoiseGenerator
    private var ambient: AmbientGenerator?
    private var pacer = BreathPacer()
    private var beatCur: Envelope.Cursor
    private var beatsCur: Envelope.Cursor
    private var noiseCur: Envelope.Cursor
    private var ambCur: Envelope.Cursor
    private var pacCur: Envelope.Cursor
    private var voiceIndex = 0
    private var lastUnderrunIndex = -1
    /// Voice placements in whole frames, so sample lookup is exact integer arithmetic.
    private let voiceStartFrames: [Int64]
    private let voiceEndFrames: [Int64]
    private var activityIndex = 0
    private var pacerIndex = 0
    private var duck = 0.0
    private var modeMix: Double
    private var userGain: Double
    private var pauseGain = 1.0
    private let duckAttackCoef: Double
    private let duckReleaseCoef: Double
    private let smoothCoef: Double       // ~50 ms smoothing for user gain
    private let pauseStep: Double        // linear pause fade per sample
    private let modeStep: Double         // binaural⇄isochronic crossfade per sample
    private let isoGain: Double
    private let duckDepth: Double

    // Control (written by main thread, read by audio thread)
    private let controlMode = Atomic<Int>(0)
    private let controlUserGainBits = Atomic<UInt64>(1.0.bitPattern)
    private let controlPaused = Atomic<Bool>(false)
    // Published (written by audio thread)
    private let publishedFrame = Atomic<Int64>(0)
    private let publishedUnderruns = Atomic<Int>(0)

    public init(timeline: ResolvedTimeline, sampleRate: Double, voice: VoiceSource?,
                mode: BeatMode = .binaural, beatsEnabled: Bool = true, userGain: Double = 1.0,
                pauseFadeSeconds: Double = 1.2, modeCrossfadeSeconds: Double = 1.5) {
        self.timeline = timeline
        self.sampleRate = sampleRate
        self.voice = voice
        self.beatsEnabled = beatsEnabled
        noiseL = NoiseGenerator(color: timeline.noise, seed: 0xA11CE)
        noiseR = NoiseGenerator(color: timeline.noise, seed: 0xB0B5)
        ambient = timeline.ambient.map { AmbientGenerator(preset: $0) }
        beatCur = .init(timeline.beatHz)
        beatsCur = .init(timeline.beatsDb)
        noiseCur = .init(timeline.noiseDb)
        ambCur = .init(timeline.ambientDb)
        pacCur = .init(timeline.pacerDb)
        modeMix = mode == .isochronic ? 1 : 0
        self.userGain = userGain
        controlMode.store(mode.rawValue, ordering: .relaxed)
        controlUserGainBits.store(userGain.bitPattern, ordering: .relaxed)
        duckAttackCoef = Self.onePole(timeline.ducking.attackSeconds, sampleRate)
        duckReleaseCoef = Self.onePole(timeline.ducking.releaseSeconds, sampleRate)
        smoothCoef = Self.onePole(0.05, sampleRate)
        pauseStep = 1 / max(1, pauseFadeSeconds * sampleRate)
        modeStep = 1 / max(1, modeCrossfadeSeconds * sampleRate)
        isoGain = Decibels.toGain(timeline.isochronicOffsetDb)
        duckDepth = timeline.ducking.amountDb
        voiceStartFrames = timeline.voice.map { Int64(($0.start * sampleRate).rounded()) }
        voiceEndFrames = timeline.voice.map { Int64(($0.end * sampleRate).rounded()) }
    }

    /// One-pole smoothing coefficient reaching ~63% in `seconds`.
    static func onePole(_ seconds: Double, _ sr: Double) -> Double {
        seconds <= 0 ? 1 : 1 - exp(-1 / (seconds * sr))
    }

    // MARK: Control API (any thread)

    public func setMode(_ m: BeatMode) { controlMode.store(m.rawValue, ordering: .relaxed) }
    public var mode: BeatMode { BeatMode(rawValue: controlMode.load(ordering: .relaxed)) ?? .binaural }
    public func setUserGain(_ g: Double) { controlUserGainBits.store(min(max(g, 0), 1).bitPattern, ordering: .relaxed) }
    /// Fades out (≈1 s) then holds the playhead; resuming fades back in from the same spot.
    public func setPaused(_ p: Bool) { controlPaused.store(p, ordering: .relaxed) }
    public var isPaused: Bool { controlPaused.load(ordering: .relaxed) }
    public var currentTime: Double { Double(publishedFrame.load(ordering: .relaxed)) / sampleRate }
    public var underruns: Int { publishedUnderruns.load(ordering: .relaxed) }
    public var isFinished: Bool { currentTime >= timeline.totalDuration }
    /// True once a requested pause has fully faded to silence.
    public var isSilentlyPaused: Bool { isPaused && pauseGainSnapshot.load(ordering: .relaxed) }
    private let pauseGainSnapshot = Atomic<Bool>(false)

    /// Session-level fade (raised cosine in and out).
    public func sessionFade(at t: Double) -> Double {
        let total = timeline.totalDuration
        if t < 0 || t >= total { return 0 }
        var g = 1.0
        if timeline.fadeIn > 0, t < timeline.fadeIn { g *= 0.5 - 0.5 * cos(.pi * t / timeline.fadeIn) }
        let remaining = total - t
        if timeline.fadeOut > 0, remaining < timeline.fadeOut { g *= 0.5 - 0.5 * cos(.pi * remaining / timeline.fadeOut) }
        return g
    }

    // MARK: Render (audio thread)

    /// Renders `frames` stereo samples. Pointers may alias nothing else. Returns frames written.
    public func render(left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>, frames: Int) {
        let targetMode = Double(controlMode.load(ordering: .relaxed))
        let targetUser = Double(bitPattern: controlUserGainBits.load(ordering: .relaxed))
        let paused = controlPaused.load(ordering: .relaxed)
        let sr = sampleRate
        let total = timeline.totalDuration
        let carrier = timeline.carrierHz
        let activity = timeline.voiceActivity
        let placements = timeline.voice
        let pacers = timeline.pacers

        for i in 0..<frames {
            // Pause fade: linear ramp; when fully silent the playhead holds.
            if paused { pauseGain = max(0, pauseGain - pauseStep) } else { pauseGain = min(1, pauseGain + pauseStep) }
            if paused && pauseGain == 0 {
                left[i] = 0; right[i] = 0
                continue
            }
            let t = Double(frame) / sr
            if t >= total { left[i] = 0; right[i] = 0; continue }

            // Smoothed controls
            userGain += (targetUser - userGain) * smoothCoef
            if modeMix < targetMode { modeMix = min(targetMode, modeMix + modeStep) }
            else if modeMix > targetMode { modeMix = max(targetMode, modeMix - modeStep) }

            // Ducking: voice-activity target with separate attack/release.
            while activityIndex < activity.count && activity[activityIndex].upperBound < t { activityIndex += 1 }
            let active = activityIndex < activity.count && activity[activityIndex].contains(t)
            let duckTarget = active ? 1.0 : 0.0
            duck += (duckTarget - duck) * (duckTarget > duck ? duckAttackCoef : duckReleaseCoef)
            let bgGain = Decibels.toGain(-duckDepth * duck)

            // Beats
            let beatHz = beatCur.value(at: t)
            var bl: Float = 0, br: Float = 0
            let beatGain = beatsEnabled ? Decibels.toGain(beatsCur.value(at: t)) : 0
            let (sl, sr2) = binaural.next(carrier: carrier, beat: beatHz, sampleRate: sr)
            let im = iso.next(carrier: carrier, beat: beatHz, sampleRate: sr)
            if beatGain > 0 {
                let bm = Float(1 - modeMix), imix = Float(modeMix * isoGain)
                bl = (sl * bm + im * imix) * Float(beatGain)
                br = (sr2 * bm + im * imix) * Float(beatGain)
            }

            // Noise
            let nGain = Float(Decibels.toGain(noiseCur.value(at: t)))
            let nl = noiseL.next() * nGain, nr = noiseR.next() * nGain

            // Ambient
            var al: Float = 0, ar: Float = 0
            if ambient != nil {
                let aGain = Float(Decibels.toGain(ambCur.value(at: t)))
                let (a1, a2) = ambient!.next(sampleRate: sr)
                al = a1 * aGain; ar = a2 * aGain
            }

            // Breath pacer
            var pl: Float = 0, pr: Float = 0
            while pacerIndex < pacers.count && pacers[pacerIndex].end <= t { pacerIndex += 1 }
            if pacerIndex < pacers.count && t >= pacers[pacerIndex].start {
                let pGain = Decibels.toGain(pacCur.value(at: t))
                let (s1, s2) = pacer.nextStereo(settings: pacers[pacerIndex].settings, sampleRate: sr)
                if pGain > 0 { let pg = Float(pGain); pl = s1 * pg; pr = s2 * pg }
            }

            // Voice
            var v: Float = 0
            while voiceIndex < placements.count && voiceEndFrames[voiceIndex] <= frame { voiceIndex += 1 }
            if voiceIndex < placements.count && frame >= voiceStartFrames[voiceIndex] {
                let idx = Int(frame - voiceStartFrames[voiceIndex])
                if let buf = voice?.samples(forPlacement: voiceIndex) {
                    if idx < buf.count { v = buf[idx] }
                } else if lastUnderrunIndex != voiceIndex {
                    lastUnderrunIndex = voiceIndex
                    publishedUnderruns.wrappingAdd(1, ordering: .relaxed)
                }
            }

            let master = Float(sessionFade(at: t) * pauseGain * userGain)
            let bg = Float(bgGain)
            left[i] = Self.softClip(((bl + nl + al + pl) * bg + v) * master)
            right[i] = Self.softClip(((br + nr + ar + pr) * bg + v) * master)
            frame += 1
        }
        publishedFrame.store(frame, ordering: .relaxed)
        pauseGainSnapshot.store(pauseGain == 0, ordering: .relaxed)
    }

    /// Transparent below 0.8; smoothly saturates above so nothing ever hard-clips.
    @inline(__always)
    public static func softClip(_ x: Float) -> Float {
        let a = abs(x)
        if a <= 0.8 { return x }
        let over = (a - 0.8) / 0.2
        let y = 0.8 + 0.2 * tanh(over)
        return x < 0 ? -y : y
    }
}
