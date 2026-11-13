import Foundation

/// Audible breath guide for paced (resonance-frequency) breathing. A soft tone rises in pitch
/// and swells during the inhale, then falls and fades during the exhale. Both ears identical.
public struct BreathPacer: Sendable {
    public struct Settings: Codable, Equatable, Sendable {
        /// Breaths per minute (≈6 for resonance breathing).
        public var breathsPerMinute: Double
        /// Fraction of the cycle spent inhaling (0.4 → exhale longer than inhale).
        public var inhaleFraction: Double
        public var lowHz: Double
        public var highHz: Double
        /// "tone" (default: rising and falling tone) or "wind" (gusts that swell with the inhale).
        public var sound: PacerSound?
        public init(breathsPerMinute: Double = 6, inhaleFraction: Double = 0.4, lowHz: Double = 174.61, highHz: Double = 261.63, sound: PacerSound? = nil) {
            self.breathsPerMinute = breathsPerMinute; self.inhaleFraction = inhaleFraction
            self.lowHz = lowHz; self.highHz = highHz; self.sound = sound
        }
    }

    public enum PacerSound: String, Codable, Sendable { case tone, wind }

    private var tone = PhaseAccumulator()
    private let wind = WindVoice()
    private var cyclePos: Double = 0 // 0..<1 through the breath

    public init() {}

    /// Returns (sample, isInhaling). `progress` 0..1 within the current half is used for pitch.
    public static func shape(cyclePosition x: Double, inhaleFraction f: Double) -> (pitch: Double, amp: Double, inhaling: Bool) {
        if x < f {
            let p = x / f                       // 0→1 inhale
            let s = 0.5 - 0.5 * cos(.pi * p)    // smooth rise
            return (s, sin(.pi * p) * 0.6 + s * 0.4, true)
        } else {
            let p = (x - f) / (1 - f)           // 0→1 exhale
            let s = 0.5 + 0.5 * cos(.pi * p)    // smooth fall
            return (s, s * sin(.pi * min(1, p + 0.5)) * 0.6 + s * 0.4, false)
        }
    }

    public static let amplitude = Float(GeneratorLevel.referenceRMS * 2.0.squareRoot() * 1.4)

    @inline(__always)
    public mutating func next(settings s: Settings, sampleRate: Double) -> Float {
        let (pitch, amp, _) = Self.shape(cyclePosition: cyclePos, inhaleFraction: s.inhaleFraction)
        let freq = s.lowHz * pow(s.highHz / s.lowHz, pitch)
        let ph = tone.advance(frequency: freq, sampleRate: sampleRate)
        // Soft timbre: fundamental + a quiet octave.
        let v = sin(2 * .pi * ph) + 0.18 * sin(4 * .pi * ph)
        cyclePos += s.breathsPerMinute / 60 / sampleRate
        if cyclePos >= 1 { cyclePos -= 1 }
        return Float(v * amp) * Self.amplitude
    }

    /// Stereo: the tone is the same in both ears; wind has its own noise in each ear.
    @inline(__always)
    public mutating func nextStereo(settings s: Settings, sampleRate: Double) -> (Float, Float) {
        if s.sound == .wind {
            let (pitch, amp, _) = Self.shape(cyclePosition: cyclePos, inhaleFraction: s.inhaleFraction)
            let out = wind.next(pitch: pitch, amp: amp, sampleRate: sampleRate)
            cyclePos += s.breathsPerMinute / 60 / sampleRate
            if cyclePos >= 1 { cyclePos -= 1 }
            return out
        }
        let v = next(settings: s, sampleRate: sampleRate)
        return (v, v)
    }
}
