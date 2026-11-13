import Foundation

public enum NoiseColor: String, Codable, Sendable, CaseIterable {
    case white, pink, brown
}

/// Fast deterministic PRNG (xorshift64*), real-time safe.
public struct FastRandom: Sendable {
    private var state: UInt64
    public init(seed: UInt64 = 0x9E37_79B9_7F4A_7C15) { state = seed == 0 ? 0x1234_5678 : seed }

    /// Uniform in [-1, 1).
    @inline(__always)
    public mutating func nextBipolar() -> Double {
        state ^= state >> 12
        state ^= state << 25
        state ^= state >> 27
        let x = state &* 2_685_821_657_736_338_717
        return Double(x >> 11) / Double(1 << 52) - 1.0
    }
}

/// White, pink (Paul Kellet's refined filter) and brown (leaky integrator) noise,
/// each scaled to `GeneratorLevel.referenceRMS`. Stereo output uses two decorrelated
/// generators so noise feels wide rather than centred.
public struct NoiseGenerator: Sendable {
    public var color: NoiseColor
    private var rng: FastRandom
    private var b0 = 0.0, b1 = 0.0, b2 = 0.0, b3 = 0.0, b4 = 0.0, b5 = 0.0, b6 = 0.0
    private var brown = 0.0

    public init(color: NoiseColor, seed: UInt64) {
        self.color = color
        rng = FastRandom(seed: seed)
    }

    // Empirical scale factors measured to bring each colour to unit RMS (verified in tests).
    static let whiteScale = 3.0.squareRoot()       // uniform[-1,1) has RMS 1/sqrt(3)
    static let pinkScale = 0.5618                   // measured: Kellet filter output RMS ≈ 1.78 for unit-uniform input
    static let brownScale = 17.41                  // 1 / sqrt(b²σ²/(1-a²)), a = 1/1.02, b = 0.02/1.02, σ² = 1/3

    @inline(__always)
    public mutating func next() -> Float {
        let white = rng.nextBipolar()
        let unit: Double
        switch color {
        case .white:
            unit = white * Self.whiteScale
        case .pink:
            b0 = 0.99886 * b0 + white * 0.0555179
            b1 = 0.99332 * b1 + white * 0.0750759
            b2 = 0.96900 * b2 + white * 0.1538520
            b3 = 0.86650 * b3 + white * 0.3104856
            b4 = 0.55000 * b4 + white * 0.5329522
            b5 = -0.7616 * b5 - white * 0.0168980
            let pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362
            b6 = white * 0.115926
            unit = pink * Self.pinkScale
        case .brown:
            brown = (brown + 0.02 * white) / 1.02
            unit = brown * Self.brownScale
        }
        return Float(unit * GeneratorLevel.referenceRMS)
    }
}
