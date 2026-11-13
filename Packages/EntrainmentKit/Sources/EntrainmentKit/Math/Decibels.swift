import Foundation

/// Level conversions. Any level at or below `silenceFloorDb` is treated as true silence (gain 0).
public enum Decibels {
    public static let silenceFloorDb: Double = -90

    @inline(__always)
    public static func toGain(_ db: Double) -> Double {
        db <= silenceFloorDb ? 0 : pow(10, db / 20)
    }

    @inline(__always)
    public static func fromGain(_ gain: Double) -> Double {
        gain <= 0 ? -Double.infinity : 20 * log10(gain)
    }

    /// RMS of a buffer, in dBFS-style dB (full-scale sine = -3 dB).
    public static func rmsDb<C: Collection>(_ samples: C) -> Double where C.Element == Float {
        guard !samples.isEmpty else { return -Double.infinity }
        var sum = 0.0
        for s in samples { sum += Double(s) * Double(s) }
        return fromGain((sum / Double(samples.count)).squareRoot())
    }
}
