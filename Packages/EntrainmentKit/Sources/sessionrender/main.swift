// Offline tool: validates session files and renders any session to an audio file using
// exactly the same renderer the app uses, so a session can be auditioned on the Mac.
//
//   swift run sessionrender --validate
//   swift run sessionrender qs-rescue-2 out.m4a [--isochronic] [--no-beats] [--seconds 120]
import Foundation
import AVFoundation
import EntrainmentKit

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let sessionsDir = root.appendingPathComponent("Sessions")
let narrationDir = root.appendingPathComponent("App/Resources/Narration")
var args = Array(CommandLine.arguments.dropFirst())

func fail(_ m: String) -> Never { FileHandle.standardError.write(Data((m + "\n").utf8)); exit(1) }

let manifest: NarrationManifest
do { manifest = try NarrationManifest.load(from: narrationDir.appendingPathComponent("manifest.json")) }
catch { fail("Cannot read narration manifest: \(error)") }
let durations = manifest.segments.mapValues(\.duration)
let sessions: [SessionDefinition]
do { sessions = try SessionLibrary.loadSessions(in: sessionsDir) } catch { fail("\(error.localizedDescription)") }

if args.first == "--validate" || args.isEmpty {
    var bad = 0
    for s in sessions {
        let problems = SessionValidator.problems(in: s, durations: durations)
        let tl = try? ResolvedTimeline(session: s, durations: durations)
        let mins = (tl?.sessionDuration ?? 0) / 60
        print("\(problems.isEmpty ? "ok  " : "FAIL") \(s.id.padding(toLength: 26, withPad: " ", startingAt: 0)) \(String(format: "%5.1f", mins)) min  \(s.module)")
        problems.forEach { print("       - \($0)") }
        bad += problems.isEmpty ? 0 : 1
    }
    exit(bad == 0 ? 0 : 1)
}

guard args.count >= 2, let session = sessions.first(where: { $0.id == args[0] }) else {
    fail("usage: sessionrender <session-id> <output.m4a|.wav> [--isochronic] [--no-beats] [--seconds N]\nsessions: \(sessions.map(\.id).joined(separator: ", "))")
}
let outURL = URL(fileURLWithPath: args[1])
let iso = args.contains("--isochronic"), noBeats = args.contains("--no-beats")
let limit = args.firstIndex(of: "--seconds").flatMap { Double(args[$0 + 1]) }
let sr = 48_000.0
do {
    let tl = try ResolvedTimeline(session: session, durations: durations)
    let voices: [[Float]?] = try tl.voice.map { p in
        try VoiceLoader.decodeMono(url: narrationDir.appendingPathComponent(manifest.segments[p.segmentID]!.file), sampleRate: sr)
    }
    let renderer = SessionRenderer(timeline: tl, sampleRate: sr, voice: InMemoryVoiceSource(segments: voices),
                                   mode: iso ? .isochronic : .binaural, beatsEnabled: !noBeats, userGain: 0.75)
    let total = Int(min(limit ?? tl.totalDuration, tl.totalDuration) * sr)
    let format = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 2)!
    let isWav = outURL.pathExtension.lowercased() == "wav"
    let settings: [String: Any] = isWav
        ? [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: sr, AVNumberOfChannelsKey: 2, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false]
        : [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: sr, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192_000]
    try? FileManager.default.removeItem(at: outURL)
    let file = try AVAudioFile(forWriting: outURL, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    let block = 8192
    let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(block))!
    var done = 0; var peak: Float = 0
    while done < total {
        let n = min(block, total - done)
        renderer.render(left: buf.floatChannelData![0], right: buf.floatChannelData![1], frames: n)
        buf.frameLength = AVAudioFrameCount(n)
        for c in 0..<2 { for i in 0..<n { peak = max(peak, abs(buf.floatChannelData![c][i])) } }
        try file.write(from: buf)
        done += n
    }
    print("Rendered \(session.id): \(String(format: "%.1f", Double(total) / sr / 60)) min, peak \(String(format: "%.1f", Decibels.fromGain(Double(peak)))) dBFS, underruns \(renderer.underruns) → \(outURL.path)")
} catch { fail("\(error)") }
