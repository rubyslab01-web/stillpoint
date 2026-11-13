import Foundation
import AVFoundation

/// Snapshot of the output route, abstracted so it can be tested and compiled on macOS.
public struct AudioRouteInfo: Equatable, Sendable {
    public var headphonesConnected: Bool
    /// iOS "Spatialize Stereo"/head tracking active on the current output. Apps can't switch
    /// this off for AVAudioEngine output, so we detect and warn.
    public var spatialAudioActive: Bool
    public var outputName: String
    /// System output volume 0…1 (iOS only; 0.5 on macOS).
    public var systemVolume: Float

    public init(headphonesConnected: Bool, spatialAudioActive: Bool, outputName: String, systemVolume: Float) {
        self.headphonesConnected = headphonesConnected
        self.spatialAudioActive = spatialAudioActive
        self.outputName = outputName
        self.systemVolume = systemVolume
    }

    /// Binaural needs separate ears; otherwise fall back to isochronic.
    public func preferredMode(speakerModeForced: Bool) -> BeatMode {
        (headphonesConnected && !speakerModeForced) ? .binaural : .isochronic
    }
}

#if os(iOS)
public enum AudioSessionConfigurator {
    static let headphonePorts: Set<AVAudioSession.Port> = [
        .headphones, .bluetoothA2DP, .bluetoothLE, .bluetoothHFP, .usbAudio, .lineOut,
    ]

    public static func configureForPlayback() throws {
        let s = AVAudioSession.sharedInstance()
        // .playback: keeps playing with the screen locked / ring switch on silent, and gives
        // us Now Playing / lock-screen controls (not mixable with others by design).
        try s.setCategory(.playback, mode: .default, options: [])
        try? s.setSupportsMultichannelContent(false)
        try s.setActive(true)
    }

    public static func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    public static func currentRoute() -> AudioRouteInfo {
        let s = AVAudioSession.sharedInstance()
        let outs = s.currentRoute.outputs
        let hp = outs.contains { headphonePorts.contains($0.portType) }
        let spatial = outs.contains { $0.isSpatialAudioEnabled }
        return AudioRouteInfo(headphonesConnected: hp, spatialAudioActive: spatial,
                              outputName: outs.first?.portName ?? "Speaker", systemVolume: s.outputVolume)
    }
}
#else
public enum AudioSessionConfigurator {
    public static func configureForPlayback() throws {}
    public static func deactivate() {}
    public static func currentRoute() -> AudioRouteInfo {
        AudioRouteInfo(headphonesConnected: true, spatialAudioActive: false, outputName: "Mac output", systemVolume: 0.5)
    }
}
#endif
