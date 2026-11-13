import Foundation
import AVFoundation

/// Decodes narration files just ahead of the playhead and frees them after they've played,
/// so a 20-minute session never holds more than ~a minute of decoded voice in memory.
public final class VoiceLoader: @unchecked Sendable {
    public let source: SlotVoiceSource
    private let placements: [ResolvedTimeline.VoicePlacement]
    private let fileURLs: [URL]
    private let sampleRate: Double
    private let queue = DispatchQueue(label: "voice-loader", qos: .userInitiated)
    public var lookahead: Double = 25
    public var evictMargin: Double = 3

    public init(timeline: ResolvedTimeline, directory: URL, manifest: NarrationManifest, sampleRate: Double) {
        placements = timeline.voice
        fileURLs = placements.map { p in
            directory.appendingPathComponent(manifest.segments[p.segmentID]?.file ?? "\(p.segmentID).m4a")
        }
        self.sampleRate = sampleRate
        source = SlotVoiceSource(count: placements.count)
    }

    /// Synchronously load everything needed for the first `seconds` (call before starting).
    public func preload(upTo seconds: Double) {
        for i in placements.indices where placements[i].start <= seconds { load(i) }
    }

    /// Call periodically from the main thread with the renderer playhead.
    public func update(playhead: Double) {
        queue.async { [self] in
            for i in placements.indices {
                let p = placements[i]
                if p.end + evictMargin < playhead {
                    source.evict(i)
                } else if p.start - lookahead <= playhead, !source.isLoaded(i) {
                    load(i)
                }
            }
        }
    }

    private func load(_ i: Int) {
        guard !source.isLoaded(i) else { return }
        do {
            let samples = try Self.decodeMono(url: fileURLs[i], sampleRate: sampleRate)
            source.install(samples, at: i)
        } catch {
            NSLog("VoiceLoader: failed to decode \(fileURLs[i].lastPathComponent): \(error)")
        }
    }

    /// Decode any AVFoundation-readable file to mono Float at `sampleRate`.
    public static func decodeMono(url: URL, sampleRate: Double) throws -> [Float] {
        let file = try AVAudioFile(forReading: url)
        let inFormat = file.processingFormat
        guard let inBuf = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: AVAudioFrameCount(file.length)) else { return [] }
        try file.read(into: inBuf)
        guard let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: inFormat, to: outFormat) else { return [] }
        let ratio = sampleRate / inFormat.sampleRate
        let cap = AVAudioFrameCount(Double(inBuf.frameLength) * ratio) + 1024
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap) else { return [] }
        var fed = false
        var err: NSError?
        converter.sampleRateConverterQuality = AVAudioQuality.high.rawValue
        let status = converter.convert(to: outBuf, error: &err) { _, outStatus in
            if fed { outStatus.pointee = .endOfStream; return nil }
            fed = true
            outStatus.pointee = .haveData
            return inBuf
        }
        if status == .error, let err { throw err }
        guard let ch = outBuf.floatChannelData else { return [] }
        return Array(UnsafeBufferPointer(start: ch[0], count: Int(outBuf.frameLength)))
    }
}
