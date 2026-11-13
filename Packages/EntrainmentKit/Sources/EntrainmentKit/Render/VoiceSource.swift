import Foundation
import Synchronization

/// Supplies decoded mono voice samples (already at the renderer's sample rate) for each
/// voice placement in a timeline. Must be safe to call from the audio thread: no locks,
/// no allocation — return nil if a segment isn't ready (renderer outputs silence and counts
/// an underrun).
public protocol VoiceSource: AnyObject, Sendable {
    func samples(forPlacement index: Int) -> UnsafeBufferPointer<Float>?
}

/// Test / offline implementation holding all segments in memory.
public final class InMemoryVoiceSource: VoiceSource, @unchecked Sendable {
    private var storage: [UnsafeMutableBufferPointer<Float>?]
    public init(segments: [[Float]?]) {
        storage = segments.map { seg in
            guard let seg else { return nil }
            let p = UnsafeMutableBufferPointer<Float>.allocate(capacity: seg.count)
            _ = p.initialize(from: seg)
            return p
        }
    }
    deinit { storage.forEach { $0?.deallocate() } }
    public func samples(forPlacement index: Int) -> UnsafeBufferPointer<Float>? {
        guard index >= 0, index < storage.count, let p = storage[index] else { return nil }
        return UnsafeBufferPointer(p)
    }
}

/// Lock-free slot table: a background loader fills slots; the audio thread reads them.
/// Each slot: state 0 = empty, 1 = ready. Storage is raw pointers (never a Swift array) so
/// the two threads never race on container bookkeeping. Buffers are only freed by the loader
/// after the playhead has moved past the segment's end plus a margin.
public final class SlotVoiceSource: VoiceSource, @unchecked Sendable {
    private let states: UnsafeMutablePointer<Atomic<Int>>
    private let buffers: UnsafeMutablePointer<UnsafeMutableBufferPointer<Float>?>
    public let count: Int

    public init(count: Int) {
        self.count = count
        states = .allocate(capacity: max(count, 1))
        buffers = .allocate(capacity: max(count, 1))
        for i in 0..<count {
            (states + i).initialize(to: Atomic<Int>(0))
            (buffers + i).initialize(to: nil)
        }
    }
    deinit {
        for i in 0..<count { buffers[i]?.deallocate() }
        states.deinitialize(count: count); states.deallocate()
        buffers.deinitialize(count: count); buffers.deallocate()
    }

    public func isLoaded(_ i: Int) -> Bool { states[i].load(ordering: .acquiring) == 1 }

    /// Loader thread only.
    public func install(_ samples: [Float], at i: Int) {
        guard i >= 0, i < count, states[i].load(ordering: .acquiring) == 0 else { return }
        let p = UnsafeMutableBufferPointer<Float>.allocate(capacity: samples.count)
        _ = p.initialize(from: samples)
        buffers[i] = p
        states[i].store(1, ordering: .releasing)
    }

    /// Loader thread only. Caller guarantees the renderer is no longer reading slot `i`.
    public func evict(_ i: Int) {
        guard i >= 0, i < count, states[i].load(ordering: .acquiring) == 1 else { return }
        states[i].store(0, ordering: .releasing)
        buffers[i]?.deallocate()
        buffers[i] = nil
    }

    public func samples(forPlacement index: Int) -> UnsafeBufferPointer<Float>? {
        guard index >= 0, index < count, states[index].load(ordering: .acquiring) == 1,
              let p = buffers[index] else { return nil }
        return UnsafeBufferPointer(p)
    }
}
