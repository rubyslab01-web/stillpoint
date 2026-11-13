import Foundation

/// Phase accumulator in cycles (0..<1). Frequency may change every sample; because only the
/// *increment* changes, the waveform is always phase-continuous (no clicks on glides).
public struct PhaseAccumulator: Sendable {
    public private(set) var phase: Double // cycles, 0..<1
    public init(phase: Double = 0) { self.phase = phase }

    @inline(__always)
    public mutating func advance(frequency: Double, sampleRate: Double) -> Double {
        let current = phase
        phase += frequency / sampleRate
        phase -= phase.rounded(.down)
        return current
    }
}

/// Two hard-panned sines. Left = carrier, right = carrier + beat. Only the right channel's
/// frequency ever moves, which is what CLAUDE.md asks for.
public struct BinauralOscillator: Sendable {
    public var left = PhaseAccumulator()
    public var right = PhaseAccumulator()
    public init() {}

    /// Peak amplitude chosen so RMS of each channel ≈ the shared generator reference level.
    public static let amplitude = Float(GeneratorLevel.referenceRMS * 2.0.squareRoot())

    @inline(__always)
    public mutating func next(carrier: Double, beat: Double, sampleRate: Double) -> (Float, Float) {
        let pl = left.advance(frequency: carrier, sampleRate: sampleRate)
        let pr = right.advance(frequency: carrier + beat, sampleRate: sampleRate)
        return (Float(sin(2 * .pi * pl)) * Self.amplitude, Float(sin(2 * .pi * pr)) * Self.amplitude)
    }
}

/// Isochronic tone: one carrier, amplitude-pulsed at the beat rate with a raised-cosine
/// envelope (no hard edges → no clicks). Identical in both ears, so it works on a speaker.
public struct IsochronicOscillator: Sendable {
    public var carrierPhase = PhaseAccumulator()
    public var pulsePhase = PhaseAccumulator()
    public init() {}

    // Raised cosine has mean-square 3/8 of the carrier's, so boost to keep RMS equal to the
    // binaural layer: sqrt(8/3).
    public static let amplitude = Float(GeneratorLevel.referenceRMS * 2.0.squareRoot() * (8.0 / 3.0).squareRoot())

    @inline(__always)
    public mutating func next(carrier: Double, beat: Double, sampleRate: Double) -> Float {
        let pc = carrierPhase.advance(frequency: carrier, sampleRate: sampleRate)
        let pp = pulsePhase.advance(frequency: beat, sampleRate: sampleRate)
        let env = 0.5 - 0.5 * cos(2 * .pi * pp)
        return Float(sin(2 * .pi * pc) * env) * Self.amplitude
    }
}

/// All synthesized layers are normalised to this RMS so that layer levels in session files
/// are directly comparable to each other and to normalised voice (~ -16 LUFS ≈ RMS 0.16).
public enum GeneratorLevel {
    public static let referenceRMS: Double = 0.16
}
