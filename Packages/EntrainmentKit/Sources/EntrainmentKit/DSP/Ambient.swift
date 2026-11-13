import Foundation

/// Self-synthesised ambient pad: a handful of slowly breathing sine partials, slightly
/// detuned between ears for width. Partials deliberately avoid 200–260 Hz so they never
/// beat against the binaural carriers.
public enum AmbientPreset: String, Codable, Sendable, CaseIterable {
    /// Open D voicing (D2, A2, D3, F#3, A3-ish air) — warm, neutral.
    case warmPad
    /// Low D drone with a fifth — darker, for sleep.
    case deepDrone
    /// Brighter open fifths (D3, A3, E4) — for awake / heart-centred sessions.
    case glow
    /// Synthesised forest: low wind, canopy hiss, sparse distant birdsong (see Nature.swift).
    case forest

    struct Partial { let freq: Double; let gain: Double; let lfoRate: Double; let lfoPhase: Double }

    var partials: [Partial] {
        switch self {
        case .warmPad:
            return [
                Partial(freq: 73.42, gain: 1.0, lfoRate: 0.043, lfoPhase: 0.0),
                Partial(freq: 110.0, gain: 0.8, lfoRate: 0.057, lfoPhase: 0.3),
                Partial(freq: 146.83, gain: 0.55, lfoRate: 0.071, lfoPhase: 0.6),
                Partial(freq: 185.0, gain: 0.35, lfoRate: 0.037, lfoPhase: 0.15),
                Partial(freq: 293.66, gain: 0.18, lfoRate: 0.089, lfoPhase: 0.8),
            ]
        case .deepDrone:
            return [
                Partial(freq: 55.0, gain: 1.0, lfoRate: 0.031, lfoPhase: 0.0),
                Partial(freq: 82.41, gain: 0.6, lfoRate: 0.047, lfoPhase: 0.4),
                Partial(freq: 110.0, gain: 0.4, lfoRate: 0.023, lfoPhase: 0.7),
                Partial(freq: 164.81, gain: 0.15, lfoRate: 0.061, lfoPhase: 0.2),
            ]
        case .forest:
            return []
        case .glow:
            return [
                Partial(freq: 146.83, gain: 0.9, lfoRate: 0.05, lfoPhase: 0.0),
                Partial(freq: 293.66, gain: 0.6, lfoRate: 0.067, lfoPhase: 0.5),
                Partial(freq: 329.63, gain: 0.45, lfoRate: 0.041, lfoPhase: 0.25),
                Partial(freq: 440.0, gain: 0.3, lfoRate: 0.083, lfoPhase: 0.75),
                Partial(freq: 587.33, gain: 0.12, lfoRate: 0.029, lfoPhase: 0.1),
            ]
        }
    }
}

public struct AmbientGenerator: Sendable {
    private var freqs: [Double] = []
    private var gains: [Double] = []
    private var lfoRates: [Double] = []
    private var phasesL: [Double] = []
    private var phasesR: [Double] = []
    private var lfoPhases: [Double] = []
    private var norm: Double = 1
    private let forest: ForestGenerator?
    public let preset: AmbientPreset

    /// Detune between ears in Hz (tiny → gentle shimmer, far below binaural-beat audibility).
    static let detune = 0.15

    public init(preset: AmbientPreset) {
        self.preset = preset
        forest = preset == .forest ? ForestGenerator() : nil
        for p in preset.partials {
            freqs.append(p.freq); gains.append(p.gain); lfoRates.append(p.lfoRate)
            phasesL.append(0); phasesR.append(0.25); lfoPhases.append(p.lfoPhase)
        }
        // Mean-square of sum of independent sines with LFO gain (0.55..1.0, mean-sq ≈ 0.6) .
        let ms = gains.reduce(0) { $0 + $1 * $1 * 0.5 * 0.61 }
        norm = ms > 0 ? GeneratorLevel.referenceRMS / ms.squareRoot() : 1
    }

    @inline(__always)
    public mutating func next(sampleRate: Double) -> (Float, Float) {
        if let forest { return forest.next(sampleRate: sampleRate) }
        var l = 0.0, r = 0.0
        for i in 0..<freqs.count {
            let lfo = 0.775 + 0.225 * sin(2 * .pi * lfoPhases[i])
            l += sin(2 * .pi * phasesL[i]) * gains[i] * lfo
            r += sin(2 * .pi * phasesR[i]) * gains[i] * lfo
            phasesL[i] += freqs[i] / sampleRate
            phasesR[i] += (freqs[i] + Self.detune) / sampleRate
            lfoPhases[i] += lfoRates[i] / sampleRate
            if phasesL[i] >= 1 { phasesL[i] -= 1 }
            if phasesR[i] >= 1 { phasesR[i] -= 1 }
            if lfoPhases[i] >= 1 { lfoPhases[i] -= 1 }
        }
        return (Float(l * norm), Float(r * norm))
    }
}
