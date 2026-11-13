import Foundation

// Nature sounds, added after user testing (the breath tone was too high and annoying).
// Everything is synthesised from the deterministic noise generators; no recordings.
// Mirrored line for line in web/js/engine/dsp.js so the web port renders the same samples.

/// Topology-preserving state-variable filter (Zavalishin/Simper); stable under modulation.
public struct StateVariableFilter: Sendable {
    private var ic1 = 0.0, ic2 = 0.0
    public init() {}

    /// Band-pass output for input `x`, cutoff `fc` (Hz), damping `k` = 1/Q.
    @inline(__always)
    public mutating func bandpass(_ x: Double, fc: Double, k: Double, sampleRate: Double) -> Double {
        let g = tan(Double.pi * fc / sampleRate)
        let a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2
        let v3 = x - ic2
        let v1 = a1 * ic1 + a2 * v3
        let v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        return v1
    }
}

/// Breath guide as wind: a gust rises with the inhale (louder, brighter) and dies away on the
/// exhale, with leaves rustling at the top of each gust. Independent noise in each ear.
/// RMS at the top of a gust is the old tone's (reference × 1.4).
public final class WindVoice: @unchecked Sendable {
    static let windScale = 3.0     // band-passed pink noise to unit RMS (measured 0.333)
    static let rustleScale = 6.8   // leaves at 0.35 of the wind's RMS at full gust (measured)
    static let level = GeneratorLevel.referenceRMS * 1.4

    private var nl = NoiseGenerator(color: .pink, seed: 0x5749_4E44)
    private var nr = NoiseGenerator(color: .pink, seed: 0x5749_4E45)
    private var wl = FastRandom(seed: 0x5255_534C)
    private var wr = FastRandom(seed: 0x5255_534D)
    private var flutterRng = FastRandom(seed: 0x464C_5554)
    private var svfL = StateVariableFilter(), svfR = StateVariableFilter()
    private var hpL = 0.0, hpR = 0.0, xL = 0.0, xR = 0.0
    private var flutter = 0.0, flutterTarget = 0.0, flutterCount = 0

    public init() {}

    @inline(__always)
    public func next(pitch: Double, amp: Double, sampleRate sr: Double) -> (Float, Float) {
        let fc = 280 * pow(1100.0 / 280, pitch)
        let k = 1 / 0.9
        let gust = 0.12 + 0.88 * amp
        let ref = GeneratorLevel.referenceRMS
        let bl = svfL.bandpass(Double(nl.next()) / ref, fc: fc, k: k, sampleRate: sr)
        let br = svfR.bandpass(Double(nr.next()) / ref, fc: fc, k: k, sampleRate: sr)
        if flutterCount <= 0 {
            flutterTarget = 0.5 + 0.5 * flutterRng.nextBipolar()
            flutterCount = Int((sr / 14).rounded(.down))
        }
        flutterCount -= 1
        flutter += (flutterTarget - flutter) * (1 - exp(-1 / (0.02 * sr)))
        let a = 1 / (1 + 2 * Double.pi * 2500 / sr)
        let w1 = wl.nextBipolar(), w2 = wr.nextBipolar()
        hpL = a * (hpL + w1 - xL); xL = w1
        hpR = a * (hpR + w2 - xR); xR = w2
        let f3 = flutter * flutter * flutter
        let leaves = f3 * pow(amp, 1.5) * 0.35
        let lev = Self.level
        return (Float((bl * Self.windScale * gust + hpL * Self.rustleScale * leaves) * lev),
                Float((br * Self.windScale * gust + hpR * Self.rustleScale * leaves) * lev))
    }
}

/// Forest ambience: a slowly breathing low wind bed, a soft canopy hiss, and sparse distant
/// birdsong (synthesised calls: short tweets, a gliding whistle, a trill), panned at random.
public final class ForestGenerator: @unchecked Sendable {
    static let bedScale = 1.31     // overall normalisation to the reference RMS (measured)

    struct Note { var start: Int; var len: Int; var f0: Double; var f1: Double; var vib: Double }

    private var bl = NoiseGenerator(color: .brown, seed: 0x464F_5231)
    private var br = NoiseGenerator(color: .brown, seed: 0x464F_5232)
    private var cl = NoiseGenerator(color: .pink, seed: 0x4341_4E31)
    private var cr = NoiseGenerator(color: .pink, seed: 0x4341_4E32)
    private var svfL = StateVariableFilter(), svfR = StateVariableFilter()
    private var lfoA = 0.0, lfoB = 0.3, lfoC = 0.6
    private var rng = FastRandom(seed: 0xB1BD)
    private var n = 0
    private var nextCall = 0
    private var inCall = false
    private var callStart = 0, callIndex = 0
    private var gl = 0.0, gr = 0.0
    private var notes: [Note] = []
    private var birdPhase = 0.0

    public init() { notes.reserveCapacity(32) }

    private func r() -> Double { 0.5 + 0.5 * rng.nextBipolar() }

    private func scheduleNext(_ sr: Double, after: Int) {
        nextCall = after + Int((sr * (5 + 13 * (0.5 + 0.5 * rng.nextBipolar()))).rounded(.down))
    }

    /// Builds one bird call (no allocation: the notes array keeps its capacity).
    private func makeCall(_ sr: Double) {
        notes.removeAll(keepingCapacity: true)
        var raw: [(Double, Double, Double, Double, Double)] = []   // small; built only every few seconds
        let kind = Int((r() * 3).rounded(.down))
        var t = 0.0
        if kind == 0 {
            let count = 2 + Int((r() * 3).rounded(.down)), base = 2900 + 900 * r()
            for _ in 0..<count {
                let len = 0.07 + 0.05 * r()
                let f1 = base + 700 + 500 * r()
                raw.append((t, len, base, f1, 0))
                t += len + 0.06 + 0.05 * r()
            }
        } else if kind == 1 {
            let base = 2000 + 600 * r()
            let len = 0.45 + 0.25 * r()
            let f1 = base + 300 + 300 * r()
            raw.append((0, len, base, f1, 35))
            if r() > 0.5 { raw.append((0.8, 0.35, base + 200, base - 150, 30)) }
        } else {
            let count = 8 + Int((r() * 7).rounded(.down)), base = 3600 + 600 * r()
            for _ in 0..<count { raw.append((t, 0.03, base, base - 250, 0)); t += 0.055 }
        }
        let pan = (r() - 0.5) * 1.2
        let level = 0.5 + 0.5 * r()
        for x in raw {
            notes.append(Note(start: Int((x.0 * sr).rounded(.down)), len: max(1, Int((x.1 * sr).rounded(.down))), f0: x.2, f1: x.3, vib: x.4))
        }
        gl = (0.5 * (1 - pan)).squareRoot() * level
        gr = (0.5 * (1 + pan)).squareRoot() * level
        callStart = n; callIndex = 0; inCall = true
    }

    @inline(__always)
    public func next(sampleRate sr: Double) -> (Float, Float) {
        let ref = GeneratorLevel.referenceRMS
        lfoA += 0.019 / sr; if lfoA >= 1 { lfoA -= 1 }
        lfoB += 0.043 / sr; if lfoB >= 1 { lfoB -= 1 }
        lfoC += 0.031 / sr; if lfoC >= 1 { lfoC -= 1 }
        let bedGain = 0.7 + 0.3 * sin(2 * Double.pi * lfoA)
        let canopyGain = (0.35 + 0.35 * (0.5 + 0.5 * sin(2 * Double.pi * lfoB))) * (0.7 + 0.3 * sin(2 * Double.pi * lfoC))
        let c1 = svfL.bandpass(Double(cl.next()) / ref, fc: 2200, k: 1 / 0.6, sampleRate: sr)
        let c2 = svfR.bandpass(Double(cr.next()) / ref, fc: 2200, k: 1 / 0.6, sampleRate: sr)
        var l = Double(bl.next()) / ref * bedGain + c1 * canopyGain
        var r = Double(br.next()) / ref * bedGain + c2 * canopyGain
        if !inCall && n >= nextCall {
            if n == 0 && nextCall == 0 { scheduleNext(sr, after: 0) } else { makeCall(sr) }
        }
        if inCall {
            let k = n - callStart
            while callIndex < notes.count && k >= notes[callIndex].start + notes[callIndex].len { callIndex += 1 }
            if callIndex >= notes.count {
                inCall = false
                scheduleNext(sr, after: n)
            } else {
                let note = notes[callIndex]
                if k >= note.start {
                    let x = Double(k - note.start) / Double(note.len)
                    let f = note.f0 + (note.f1 - note.f0) * x + note.vib * sin(2 * Double.pi * 7 * Double(k) / sr)
                    birdPhase += f / sr; birdPhase -= birdPhase.rounded(.down)
                    let s = sin(Double.pi * x)
                    let v = sin(2 * Double.pi * birdPhase) * s * s * 0.6
                    l += v * gl; r += v * gr
                }
            }
        }
        n += 1
        return (Float(l * Self.bedScale * ref), Float(r * Self.bedScale * ref))
    }
}
