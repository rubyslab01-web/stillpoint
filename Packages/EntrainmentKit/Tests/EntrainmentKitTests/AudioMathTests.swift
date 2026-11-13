import Testing
import Foundation
@testable import EntrainmentKit

let SR = 48_000.0

/// Build a small session in code. Levels at -96 switch a layer off.
func makeSession(beats: Double = -32, noise: Double = -14, ambient: Double = -96,
                 phases: [(beat: Double, glide: Double, min: Double)] = [(10, 0, 20)],
                 segments: [String] = [], fadeIn: Double = 0, fadeOut: Double = 0,
                 color: NoiseColor = .pink, duckDb: Double = 6) -> SessionDefinition {
    SessionDefinition(
        id: "t", module: "test", title: "T", subtitle: "", kind: "main", awake: true, carrierHz: 220,
        fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut, noise: color, ambient: ambient > -90 ? .warmPad : nil,
        isochronicOffsetDb: -3, ducking: .init(amountDb: duckDb, attackSeconds: 0.3, releaseSeconds: 0.5, leadSeconds: 0.2),
        phases: phases.enumerated().map { i, p in
            .init(id: "p\(i)", name: "P\(i)", beatHz: p.beat, beatGlideSeconds: p.glide,
                  levels: .init(beats: beats, noise: noise, ambient: ambient), levelGlideSeconds: 1,
                  leadInSeconds: i == 0 && !segments.isEmpty ? 5 : 0,
                  segments: i == 0 ? segments.map { .init(id: $0, pauseAfter: 1) } : [],
                  tailSeconds: 0, minDurationSeconds: p.min, pacer: nil)
        },
        noiseBed: nil, ratings: [], sortOrder: 0)
}

func render(_ session: SessionDefinition, durations: [String: Double] = [:], voice: VoiceSource? = nil,
            mode: BeatMode = .binaural, beatsEnabled: Bool = true, seconds: Double? = nil,
            configure: ((SessionRenderer, Int) -> Void)? = nil) throws -> (l: [Float], r: [Float], renderer: SessionRenderer) {
    let tl = try ResolvedTimeline(session: session, durations: durations)
    let r = SessionRenderer(timeline: tl, sampleRate: SR, voice: voice, mode: mode, beatsEnabled: beatsEnabled)
    let n = Int((seconds ?? tl.totalDuration) * SR)
    var L = [Float](repeating: 0, count: n), R = [Float](repeating: 0, count: n)
    let block = 512
    var done = 0
    L.withUnsafeMutableBufferPointer { lp in
        R.withUnsafeMutableBufferPointer { rp in
            while done < n {
                configure?(r, done)
                let c = min(block, n - done)
                r.render(left: lp.baseAddress! + done, right: rp.baseAddress! + done, frames: c)
                done += c
            }
        }
    }
    return (L, R, r)
}

/// Mean frequency over a window from positive-going zero crossings (with interpolation).
func measuredFrequency(_ x: ArraySlice<Float>) -> Double {
    var crossings: [Double] = []
    let a = Array(x)
    for i in 1..<a.count where a[i - 1] < 0 && a[i] >= 0 {
        crossings.append(Double(i - 1) + Double(-a[i - 1]) / Double(a[i] - a[i - 1]))
    }
    guard crossings.count > 1 else { return 0 }
    return Double(crossings.count - 1) / (crossings.last! - crossings.first!) * SR
}

func slice(_ x: [Float], _ from: Double, _ to: Double) -> ArraySlice<Float> { x[Int(from * SR)..<Int(to * SR)] }

@Suite struct EnvelopeTests {
    @Test func smoothShapeHitsEndpointsAndMidpoint() {
        let e = Envelope(points: [.init(time: 0, value: 10), .init(time: 10, value: 6, shape: .smooth)])
        #expect(e.value(at: -1) == 10)
        #expect(e.value(at: 0) == 10)
        #expect(abs(e.value(at: 5) - 8) < 1e-9)
        #expect(e.value(at: 10) == 6)
        #expect(e.value(at: 99) == 6)
        // S-curve: slower than linear near the start.
        #expect(e.value(at: 1) > 10 - 0.4)
    }

    @Test func linearShape() {
        let e = Envelope(points: [.init(time: 0, value: 0), .init(time: 4, value: 8, shape: .linear)])
        #expect(abs(e.value(at: 1) - 2) < 1e-9)
    }

    @Test func cursorMatchesRandomAccess() {
        let e = Envelope(points: [.init(time: 0, value: 10), .init(time: 5, value: 10, shape: .linear),
                                  .init(time: 15, value: 6), .init(time: 30, value: 6, shape: .linear), .init(time: 40, value: 14)])
        var c = Envelope.Cursor(e)
        for i in 0..<4500 {
            let t = Double(i) / 100
            #expect(abs(c.value(at: t) - e.value(at: t)) < 1e-12)
        }
        #expect(abs(c.value(at: 2) - e.value(at: 2)) < 1e-12) // re-seek backwards
    }

    @Test func glideIsMonotonic() {
        let e = Envelope(points: [.init(time: 0, value: 10), .init(time: 60, value: 3)])
        var prev = e.value(at: 0)
        for i in 1...600 { let v = e.value(at: Double(i) / 10); #expect(v <= prev + 1e-12); prev = v }
    }
}

@Suite struct FrequencyRampTests {
    @Test func beatIsDifferenceBetweenEarsAndOnlyRightChannelMoves() throws {
        // 10 Hz for 20 s, glide over 20 s to 6 Hz, hold.
        let s = makeSession(beats: 0, noise: -96, phases: [(10, 0, 20), (6, 20, 40)])
        let (l, r, _) = try render(s)
        // Left ear stays on the carrier for the whole session, including during the glide.
        for (a, b) in [(2.0, 18.0), (22.0, 38.0), (42.0, 58.0)] {
            #expect(abs(measuredFrequency(slice(l, a, b)) - 220) < 0.01)
        }
        #expect(abs(measuredFrequency(slice(r, 2, 18)) - 230) < 0.01)
        #expect(abs(measuredFrequency(slice(r, 42, 58)) - 226) < 0.01)
        // Midway through the smooth glide the beat is the midpoint (8 Hz), symmetric window.
        #expect(abs(measuredFrequency(slice(r, 29, 31)) - 228) < 0.05)
    }

    @Test func glideIsPhaseContinuous() throws {
        let s = makeSession(beats: 0, noise: -96, phases: [(10, 0, 5), (3, 4, 10), (14, 2, 10)])
        let (l, r, _) = try render(s)
        // A sine of amplitude A and frequency f can change by at most A·2π·f/SR per sample.
        // Any phase jump would exceed this bound.
        let amp = Double(BinauralOscillator.amplitude)
        let bound = Float(amp * 2 * .pi * (220 + 14) / SR * 1.001)
        var maxL: Float = 0, maxR: Float = 0
        for i in 1..<l.count {
            maxL = max(maxL, abs(l[i] - l[i - 1])); maxR = max(maxR, abs(r[i] - r[i - 1]))
        }
        #expect(maxL <= bound)
        #expect(maxR <= bound)
    }

    @Test func phaseAccumulatorStaysNormalised() {
        var p = PhaseAccumulator()
        for i in 0..<200_000 {
            let v = p.advance(frequency: 200 + Double(i % 50), sampleRate: SR)
            #expect(v >= 0 && v < 1)
        }
    }

    @Test func isochronicPulsesAtBeatRate() throws {
        let s = makeSession(beats: 0, noise: -96, phases: [(10, 0, 10)])
        let (l, _, _) = try render(s, mode: .isochronic)
        // Envelope: rectified + 20 ms moving average, then count minima-crossings.
        let win = Int(0.02 * SR)
        var env = [Float](repeating: 0, count: l.count - win)
        var acc: Float = 0
        for i in 0..<l.count {
            acc += abs(l[i]); if i >= win { acc -= abs(l[i - win]); env[i - win] = acc / Float(win) }
        }
        let mean = env.reduce(0, +) / Float(env.count)
        let centered = env.map { $0 - mean }
        let f = measuredFrequency(centered[Int(1 * SR)..<Int(9 * SR)])
        #expect(abs(f - 10) < 0.05)
    }
}

@Suite struct ChannelSeparationTests {
    @Test func binauralChannelsAreIndependentTones() throws {
        let s = makeSession(beats: 0, noise: -96, phases: [(10, 0, 10)])
        let (l, r, _) = try render(s)
        // Project each ear onto 220 Hz and 230 Hz quadrature pairs over an integer number of cycles (1 s).
        func power(_ x: ArraySlice<Float>, _ f: Double) -> Double {
            var re = 0.0, im = 0.0
            for (i, v) in x.enumerated() { let ph = 2 * Double.pi * f * Double(i) / SR; re += Double(v) * cos(ph); im += Double(v) * sin(ph) }
            return (re * re + im * im) / Double(x.count * x.count)
        }
        let L = slice(l, 2, 3), R = slice(r, 2, 3)
        let leakL = 10 * log10(power(L, 230) / power(L, 220))
        let leakR = 10 * log10(power(R, 220) / power(R, 230))
        #expect(leakL < -80) // no trace of the other ear's tone
        #expect(leakR < -80)
    }

    @Test func isochronicIsIdenticalInBothEars() throws {
        let s = makeSession(beats: 0, noise: -96, phases: [(10, 0, 5)])
        let (l, r, _) = try render(s, mode: .isochronic)
        #expect(l == r)
    }

    @Test func noiseIsDecorrelatedBetweenEars() throws {
        let s = makeSession(beats: -96, noise: 0, phases: [(10, 0, 5)])
        let (l, r, _) = try render(s)
        var dot = 0.0, ll = 0.0, rr = 0.0
        for i in 0..<l.count { dot += Double(l[i] * r[i]); ll += Double(l[i] * l[i]); rr += Double(r[i] * r[i]) }
        #expect(abs(dot / (ll * rr).squareRoot()) < 0.05)
    }

    @Test func modeSwitchCrossfadesWithoutClicks() throws {
        let s = makeSession(beats: 0, noise: -96, phases: [(10, 0, 8)])
        let (l, r, _) = try render(s) { renderer, frame in
            if frame >= Int(3 * SR) { renderer.setMode(.isochronic) }
        }
        let bound = Float(Double(IsochronicOscillator.amplitude) * 2 * .pi * 240 / SR * 1.2)
        for i in 1..<l.count { #expect(abs(l[i] - l[i - 1]) <= bound); if abs(l[i] - l[i - 1]) > bound { break } }
        #expect(slice(l, 1, 2) != slice(r, 1, 2))      // binaural before
        #expect(slice(l, 6, 7) == slice(r, 6, 7))      // isochronic after crossfade
    }
}

@Suite struct MixingLevelTests {
    @Test(arguments: NoiseColor.allCases)
    func noiseColoursAreCalibratedToReference(color: NoiseColor) throws {
        let s = makeSession(beats: -96, noise: 0, phases: [(10, 0, 30)], color: color)
        let (l, _, _) = try render(s)
        let db = Decibels.rmsDb(slice(l, 5, 30))
        let ref = Decibels.fromGain(GeneratorLevel.referenceRMS)
        #expect(abs(db - ref) < 1.0, "\(color) rms \(db) vs ref \(ref)")
    }

    @Test func binauralAndIsochronicToneAtReference() throws {
        let s = makeSession(beats: 0, noise: -96, phases: [(10, 0, 10)])
        let ref = Decibels.fromGain(GeneratorLevel.referenceRMS)
        let (l, r, _) = try render(s)
        #expect(abs(Decibels.rmsDb(slice(l, 1, 9)) - ref) < 0.1)
        #expect(abs(Decibels.rmsDb(slice(r, 1, 9)) - ref) < 0.1)
        let (il, _, _) = try render(s, mode: .isochronic)
        #expect(abs(Decibels.rmsDb(slice(il, 1, 9)) - (ref - 3)) < 0.2) // isochronicOffsetDb = -3
    }

    @Test func beatsSitEighteenDbUnderNoise() throws {
        let beatsOnly = try render(makeSession(beats: -32, noise: -96, phases: [(10, 0, 20)]))
        let noiseOnly = try render(makeSession(beats: -96, noise: -14, phases: [(10, 0, 20)]))
        let diff = Decibels.rmsDb(slice(noiseOnly.l, 2, 20)) - Decibels.rmsDb(slice(beatsOnly.l, 2, 20))
        #expect(abs(diff - 18) < 1.0)
        #expect(diff >= 15 && diff <= 20)
    }

    @Test func ambientCalibrated() throws {
        let (l, r, _) = try render(makeSession(beats: -96, noise: -96, ambient: 0, phases: [(10, 0, 120)]))
        let ref = Decibels.fromGain(GeneratorLevel.referenceRMS)
        #expect(abs(Decibels.rmsDb(slice(l, 0, 120)) - ref) < 1.5)
        #expect(abs(Decibels.rmsDb(slice(r, 0, 120)) - ref) < 1.5)
    }

    @Test func shamSessionHasNoBeatLayerButIdenticalNoise() throws {
        let s = makeSession(beats: -32, noise: -14, phases: [(10, 0, 5)])
        let on = try render(s, beatsEnabled: true), off = try render(s, beatsEnabled: false)
        let noiseOnly = try render(makeSession(beats: -96, noise: -14, phases: [(10, 0, 5)]))
        #expect(off.l == noiseOnly.l)
        #expect(on.l != off.l)
    }

    @Test func backgroundDucksUnderVoiceAndRecovers() throws {
        // Voice = 10 s of silence-valued samples so we can measure the background alone.
        let voice = InMemoryVoiceSource(segments: [[Float](repeating: 0, count: Int(10 * SR))])
        let s = makeSession(beats: -96, noise: -14, phases: [(10, 0, 30)], segments: ["a"])
        let (l, _, _) = try render(s, durations: ["a": 10], voice: voice)
        let before = Decibels.rmsDb(slice(l, 1, 4))      // voice starts at 5 s
        let during = Decibels.rmsDb(slice(l, 8, 14))
        let after = Decibels.rmsDb(slice(l, 22, 29))
        #expect(abs((before - during) - 6) < 0.7)
        #expect(abs(before - after) < 0.7)
    }

    @Test func voicePassesAtUnityAndOnBothEars() throws {
        let tone = (0..<Int(2 * SR)).map { Float(0.3 * sin(2 * Double.pi * 300 * Double($0) / SR)) }
        let voice = InMemoryVoiceSource(segments: [tone])
        let s = makeSession(beats: -96, noise: -96, phases: [(10, 0, 10)], segments: ["a"])
        let (l, r, renderer) = try render(s, durations: ["a": 2], voice: voice)
        #expect(Array(slice(l, 5, 7)) == tone)
        #expect(l == r)
        #expect(renderer.underruns == 0)
        #expect(slice(l, 0, 5).allSatisfy { $0 == 0 })
    }

    @Test func missingVoiceCountsUnderrunInsteadOfCrashing() throws {
        let voice = InMemoryVoiceSource(segments: [nil])
        let s = makeSession(beats: -96, noise: -96, phases: [(10, 0, 10)], segments: ["a"])
        let (_, _, renderer) = try render(s, durations: ["a": 2], voice: voice)
        #expect(renderer.underruns == 1)
    }

    @Test func softClipNeverExceedsFullScaleAndIsTransparentBelowKnee() {
        for x in stride(from: Float(-8), through: 8, by: 0.01) { #expect(abs(SessionRenderer.softClip(x)) <= 1.0) }
        #expect(SessionRenderer.softClip(0.5) == 0.5)
        #expect(SessionRenderer.softClip(-0.79) == -0.79)
    }

    @Test func fullMixHasHeadroom() throws {
        let s = makeSession(beats: -32, noise: -14, ambient: -22, phases: [(10, 0, 30)])
        let (l, r, _) = try render(s)
        #expect((l + r).map { abs($0) }.max()! < 0.5)
    }

    @Test func userGainScalesOutput() throws {
        let s = makeSession(beats: -96, noise: -14, phases: [(10, 0, 10)])
        let full = try render(s)
        let half = try render(s) { r, _ in r.setUserGain(0.5) }
        let d = Decibels.rmsDb(slice(full.l, 2, 10)) - Decibels.rmsDb(slice(half.l, 2, 10))
        #expect(abs(d - 6.02) < 0.3)
    }
}

@Suite struct FadeTests {
    @Test func sessionFadesInFromSilenceAndOutToSilence() throws {
        let s = makeSession(beats: -96, noise: -14, phases: [(10, 0, 40)], fadeIn: 8, fadeOut: 10)
        let (l, _, _) = try render(s)
        #expect(abs(l[0]) < 1e-6)
        #expect(abs(l[l.count - 1]) < 1e-4)
        let full = Decibels.rmsDb(slice(l, 15, 25))
        // Raised-cosine: half-way through the fade the gain is 0.5 (-6 dB).
        #expect(abs((full - Decibels.rmsDb(slice(l, 3.5, 4.5))) - 6) < 1.5)
        #expect(abs((full - Decibels.rmsDb(slice(l, 34.5, 35.5))) - 6) < 1.5)
        // Level rises monotonically through the fade-in (1 s windows).
        var prev = -Double.infinity
        for i in 0..<8 { let d = Decibels.rmsDb(slice(l, Double(i), Double(i) + 1)); #expect(d > prev); prev = d }
    }

    @Test func fadeGainIsContinuous() throws {
        let tl = try ResolvedTimeline(session: makeSession(phases: [(10, 0, 40)], fadeIn: 8, fadeOut: 10), durations: [:])
        let r = SessionRenderer(timeline: tl, sampleRate: SR, voice: nil)
        var prev = r.sessionFade(at: 0)
        #expect(prev == 0)
        for i in 1...(40 * 1000) {
            let g = r.sessionFade(at: Double(i) / 1000)
            #expect(abs(g - prev) < 0.001); prev = g
            #expect(g >= 0 && g <= 1)
        }
        #expect(r.sessionFade(at: 40) == 0)
    }

    @Test func pauseFadesOutHoldsPlayheadAndFadesBackIn() throws {
        let s = makeSession(beats: 0, noise: -96, phases: [(10, 0, 20)])
        var pausedAtTime = 0.0
        let (l, _, renderer) = try render(s, seconds: 12) { r, frame in
            if frame >= Int(3 * SR) && frame < Int(6 * SR) { r.setPaused(true) }
            if frame >= Int(5 * SR) && frame < Int(6 * SR) { pausedAtTime = r.currentTime }
            if frame >= Int(6 * SR) { r.setPaused(false) }
        }
        // Fully silent after the 1.2 s fade.
        #expect(slice(l, 4.5, 5.9).allSatisfy { $0 == 0 })
        // Playhead held while paused: 3 s + 1.2 s fade.
        #expect(abs(pausedAtTime - 4.2) < 0.05)
        #expect(abs(renderer.currentTime - (12 - 1.8)) < 0.05)
        // No click anywhere: sample-to-sample delta bounded by the sine slope.
        let bound = Float(Double(BinauralOscillator.amplitude) * 2 * .pi * 230 / SR * 1.05)
        var maxD: Float = 0
        for i in 1..<l.count { maxD = max(maxD, abs(l[i] - l[i - 1])) }
        #expect(maxD <= bound)
        // Fading, not cutting: level 0.6 s into the fade is roughly half.
        let mid = Decibels.rmsDb(slice(l, 3.55, 3.65)), full = Decibels.rmsDb(slice(l, 2, 3))
        #expect(full - mid > 3 && full - mid < 10)
    }

    @Test func layerLevelsGlideBetweenPhases() throws {
        var s = makeSession(beats: -96, noise: -14, phases: [(10, 0, 10), (10, 0, 20)])
        s.phases[1].levels.noise = -26
        s.phases[1].levelGlideSeconds = 6
        let (l, _, _) = try render(s)
        let a = Decibels.rmsDb(slice(l, 4, 10)), b = Decibels.rmsDb(slice(l, 18, 30)), mid = Decibels.rmsDb(slice(l, 12.5, 13.5))
        #expect(abs((a - b) - 12) < 1)
        #expect(mid < a && mid > b)
    }
}

@Suite struct TimelineTests {
    @Test func voicePlacementAndPhaseDurations() throws {
        var s = makeSession(phases: [(10, 0, 0), (6, 30, 100)], segments: ["a", "b"])
        s.phases[0].tailSeconds = 4
        let tl = try ResolvedTimeline(session: s, durations: ["a": 7, "b": 3])
        #expect(tl.voice.map(\.start) == [5, 13])           // 5 lead-in, a=7, pause 1
        #expect(tl.phases[0].end == 5 + 7 + 1 + 3 + 1 + 4)
        #expect(tl.phases[1].end - tl.phases[1].start == 100)
        #expect(tl.totalDuration == tl.phases[1].end)
        #expect(tl.beatHz.value(at: tl.phases[1].start) == 10)
        #expect(tl.beatHz.value(at: tl.phases[1].start + 30) == 6)
        #expect(tl.phase(at: 6)?.id == "p0")
    }

    @Test func missingNarrationIsAnError() {
        let s = makeSession(segments: ["nope"])
        #expect(throws: ResolvedTimeline.ResolveError.self) { try ResolvedTimeline(session: s, durations: [:]) }
    }

    @Test func noiseBedExtendsSessionAndSilencesBeats() throws {
        var s = makeSession(beats: -32, noise: -14, phases: [(3, 0, 60)], fadeOut: 5)
        s.noiseBed = .init(optionsMinutes: [0, 60], defaultMinutes: 0, levelDb: -20, crossfadeSeconds: 10, fadeOutSeconds: 30)
        let tl = try ResolvedTimeline(session: s, durations: [:], noiseBedMinutes: 60)
        #expect(tl.sessionDuration == 60)
        #expect(tl.totalDuration == 60 + 3600)
        #expect(tl.beatsDb.value(at: 80) <= -90)
        #expect(tl.noiseDb.value(at: 80) == -20)
        let none = try ResolvedTimeline(session: s, durations: [:], noiseBedMinutes: 0)
        #expect(none.totalDuration == 60)
    }

    @Test func routeChoosesIsochronicWithoutHeadphones() {
        let speaker = AudioRouteInfo(headphonesConnected: false, spatialAudioActive: false, outputName: "Speaker", systemVolume: 0.5)
        let phones = AudioRouteInfo(headphonesConnected: true, spatialAudioActive: false, outputName: "AirPods", systemVolume: 0.5)
        #expect(speaker.preferredMode(speakerModeForced: false) == .isochronic)
        #expect(phones.preferredMode(speakerModeForced: false) == .binaural)
        #expect(phones.preferredMode(speakerModeForced: true) == .isochronic)
    }
}

/// Validates the real shipping content: every session file, against the real narration manifest.
@Suite struct ShippedSessionTests {
    static let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    @Test func everySessionFileIsValid() throws {
        let manifest = try NarrationManifest.load(from: Self.root.appendingPathComponent("App/Resources/Narration/manifest.json"))
        let durations = manifest.segments.mapValues(\.duration)
        let sessions = try SessionLibrary.loadSessions(in: Self.root.appendingPathComponent("Sessions"))
        #expect(Set(sessions.map(\.module)) == ["sleep", "quit-smoking", "gratitude", "inner-coherence", "loving-compassion"])
        for s in sessions {
            let problems = SessionValidator.problems(in: s, durations: durations)
            #expect(problems.isEmpty, "\(s.id): \(problems)")
            for seg in s.phases.flatMap(\.segments) {
                let f = Self.root.appendingPathComponent("App/Resources/Narration/\(seg.id).m4a")
                #expect(FileManager.default.fileExists(atPath: f.path), "missing audio \(seg.id)")
            }
        }
    }

    @Test func everyAwakeSessionEndsAlertAndSleepDoesNot() throws {
        let sessions = try SessionLibrary.loadSessions(in: Self.root.appendingPathComponent("Sessions"))
        for s in sessions where s.awake { #expect(s.phases.last!.beatHz >= 12, "\(s.id)") }
        let sleep = try #require(sessions.first { $0.id == "sleep-deep" })
        #expect(!sleep.awake)
        #expect(sleep.phases.last!.beatHz == 3)
    }

    @Test func sleepTimelineMatchesBrief() throws {
        let manifest = try NarrationManifest.load(from: Self.root.appendingPathComponent("App/Resources/Narration/manifest.json"))
        let sleep = try SessionLibrary.loadSessions(in: Self.root.appendingPathComponent("Sessions")).first { $0.id == "sleep-deep" }!
        let tl = try ResolvedTimeline(session: sleep, durations: manifest.segments.mapValues(\.duration))
        #expect(tl.beatHz.value(at: 0) == 10)                         // alpha settling
        #expect(tl.beatHz.value(at: 8 * 60) == 6)                     // theta during hypnosis
        #expect(abs(tl.beatHz.value(at: 30 * 60) - 3) < 1e-9)         // delta after the voice
        #expect(tl.beatsDb.value(at: 60 * 60) == -34)
        #expect(tl.beatsDb.value(at: 89.5 * 60) <= -90)               // beats gone by 90 min
        #expect(abs(tl.sessionDuration - 90 * 60) < 1)
        #expect(tl.voice.last!.end < 15 * 60)
        #expect((200...250).contains(tl.carrierHz))
        let bed = try ResolvedTimeline(session: sleep, durations: manifest.segments.mapValues(\.duration), noiseBedMinutes: 480)
        #expect(abs(bed.totalDuration - (90 + 480) * 60) < 1)
    }
}

@Suite struct NatureSoundTests {
    func windSession() -> SessionDefinition {
        var s = makeSession(beats: -96, noise: -96, phases: [(10, 0, 60)])
        s.phases[0].levels.pacer = 0
        s.phases[0].pacer = .init(breathsPerMinute: 6, inhaleFraction: 0.4, sound: .wind)
        return s
    }

    @Test func forestCalibratedToReference() throws {
        var s = makeSession(beats: -96, noise: -96, ambient: 0, phases: [(10, 0, 120)])
        s.ambient = .forest
        let (l, r, _) = try render(s)
        let ref = Decibels.fromGain(GeneratorLevel.referenceRMS)
        #expect(abs(Decibels.rmsDb(slice(l, 0, 120)) - ref) < 1.5)
        #expect(abs(Decibels.rmsDb(slice(r, 0, 120)) - ref) < 1.5)
    }

    @Test func windFollowsTheBreathAtTheOldToneLevel() throws {
        let (l, _, _) = try render(windSession())
        let peak = Decibels.rmsDb(slice(l, 22.8, 23.6)), trough = Decibels.rmsDb(slice(l, 29.3, 29.9))
        #expect(peak - trough > 10)
        #expect(abs(peak - (Decibels.fromGain(GeneratorLevel.referenceRMS) + 20 * log10(1.4))) < 3)
    }

    @Test func windIsWideToneIsCentred() throws {
        let (l, r, _) = try render(windSession(), seconds: 20)
        var dot = 0.0, ll = 0.0, rr = 0.0
        for i in 0..<l.count { dot += Double(l[i] * r[i]); ll += Double(l[i] * l[i]); rr += Double(r[i] * r[i]) }
        #expect(abs(dot / (ll * rr).squareRoot()) < 0.3)
        var t = windSession(); t.phases[0].pacer?.sound = .tone
        let tone = try render(t, seconds: 5)
        #expect(tone.l == tone.r)
    }

    @Test func pacerSoundDefaultsToToneWhenAbsentFromJSON() throws {
        let json = #"{"breathsPerMinute": 6, "inhaleFraction": 0.4, "lowHz": 174.61, "highHz": 261.63}"#
        let p = try JSONDecoder().decode(BreathPacer.Settings.self, from: Data(json.utf8))
        #expect(p.sound == nil)
    }
}
