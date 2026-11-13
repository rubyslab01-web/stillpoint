import Foundation

/// A piecewise curve defined by keyframes, evaluated by time (seconds).
/// Between keyframes the value moves along `shape`; before the first keyframe / after the
/// last it holds. Used for beat frequency (Hz) and layer levels (dB).
public struct Envelope: Equatable, Sendable {
    public enum Shape: String, Codable, Sendable {
        /// Straight line between values.
        case linear
        /// Raised-cosine S-curve: zero slope at both ends, so glides never "kick".
        case smooth
    }

    public struct Point: Equatable, Sendable {
        public var time: Double
        public var value: Double
        /// Shape of the segment that *ends* at this point.
        public var shape: Shape
        public init(time: Double, value: Double, shape: Shape = .smooth) {
            self.time = time; self.value = value; self.shape = shape
        }
    }

    public private(set) var points: [Point]

    public init(points: [Point]) {
        // Stable sort keeps author order for equal times (allowing deliberate steps).
        self.points = points.enumerated()
            .sorted { $0.element.time == $1.element.time ? $0.offset < $1.offset : $0.element.time < $1.element.time }
            .map(\.element)
    }

    public static func constant(_ value: Double) -> Envelope {
        Envelope(points: [Point(time: 0, value: value)])
    }

    public var isEmpty: Bool { points.isEmpty }

    /// Random-access evaluation (binary search). Fine for UI / tests.
    public func value(at t: Double) -> Double {
        guard let first = points.first else { return 0 }
        if t <= first.time { return first.value }
        guard let last = points.last, t < last.time else { return points.last!.value }
        var lo = 0, hi = points.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if points[mid].time <= t { lo = mid } else { hi = mid }
        }
        return Envelope.interpolate(points[lo], points[hi], t)
    }

    @inline(__always)
    static func interpolate(_ a: Point, _ b: Point, _ t: Double) -> Double {
        let span = b.time - a.time
        guard span > 0 else { return b.value }
        var x = (t - a.time) / span
        x = min(max(x, 0), 1)
        switch b.shape {
        case .linear: break
        case .smooth: x = 0.5 - 0.5 * cos(Double.pi * x)
        }
        return a.value + (b.value - a.value) * x
    }

    /// Real-time cursor: amortised O(1) evaluation for monotonically increasing time,
    /// no allocation. Re-seeks automatically if time jumps backwards.
    public struct Cursor: Sendable {
        public let envelope: Envelope
        private var index = 0
        public init(_ envelope: Envelope) { self.envelope = envelope }

        @inline(__always)
        public mutating func value(at t: Double) -> Double {
            let pts = envelope.points
            guard !pts.isEmpty else { return 0 }
            if t <= pts[0].time { index = 0; return pts[0].value }
            if index >= pts.count - 1 || t < pts[index].time { index = 0 }
            while index < pts.count - 1 && pts[index + 1].time <= t { index += 1 }
            if index >= pts.count - 1 { return pts[pts.count - 1].value }
            return Envelope.interpolate(pts[index], pts[index + 1], t)
        }
    }
}
