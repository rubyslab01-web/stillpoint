import Foundation
import AVFoundation

/// Tiny standalone player for onboarding: left/right identification tones for the headphone
/// check and a looping reference bed (noise + beats at session levels) for volume calibration.
@MainActor
public final class TestTonePlayer {
    public enum Signal: Sendable { case leftOnly, rightOnly, calibration }

    private var engine: AVAudioEngine?
    private final class Box: @unchecked Sendable {
        var osc = BinauralOscillator()
        var noiseL = NoiseGenerator(color: .pink, seed: 11)
        var noiseR = NoiseGenerator(color: .pink, seed: 29)
        var gain: Float = 0
        var target: Float = 1
        var user: Float = 0.7
    }
    private var box: Box?

    public init() {}

    public func setUserGain(_ g: Double) { box?.user = Float(g) }

    public func play(_ signal: Signal, userGain: Double) {
        stop()
        do {
            try AudioSessionConfigurator.configureForPlayback()
            let engine = AVAudioEngine()
            let sr0 = engine.outputNode.outputFormat(forBus: 0).sampleRate
            let sr = sr0 > 0 ? sr0 : 48_000
            guard let format = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 2) else { return }
            let box = Box(); box.user = Float(userGain)
            let step = Float(1 / (0.25 * sr))
            let noiseGain = Float(Decibels.toGain(-14)), beatGain = Float(Decibels.toGain(-32))
            let node = AVAudioSourceNode(format: format) { _, _, n, abl -> OSStatus in
                let b = UnsafeMutableAudioBufferListPointer(abl)
                guard b.count >= 2, let l = b[0].mData?.assumingMemoryBound(to: Float.self),
                      let r = b[1].mData?.assumingMemoryBound(to: Float.self) else { return noErr }
                for i in 0..<Int(n) {
                    box.gain += box.gain < box.target ? step : (box.gain > box.target ? -step : 0)
                    box.gain = min(max(box.gain, 0), 1)
                    let g = box.gain * box.user
                    switch signal {
                    case .leftOnly, .rightOnly:
                        let (s, _) = box.osc.next(carrier: 330, beat: 0, sampleRate: sr)
                        l[i] = signal == .leftOnly ? s * g * 0.5 : 0
                        r[i] = signal == .rightOnly ? s * g * 0.5 : 0
                    case .calibration:
                        let (sl, sr2) = box.osc.next(carrier: 220, beat: 10, sampleRate: sr)
                        l[i] = (box.noiseL.next() * noiseGain + sl * beatGain) * g
                        r[i] = (box.noiseR.next() * noiseGain + sr2 * beatGain) * g
                    }
                }
                return noErr
            }
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: format)
            try engine.start()
            self.engine = engine; self.box = box
        } catch { NSLog("TestTonePlayer: \(error)") }
    }

    public func stop() {
        guard let engine else { return }
        box?.target = 0
        let e = engine
        self.engine = nil; self.box = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { e.stop() }
    }
}
