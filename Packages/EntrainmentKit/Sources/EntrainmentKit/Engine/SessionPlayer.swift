import Foundation
import AVFoundation
import MediaPlayer
import Observation

/// Hosts a `SessionRenderer` inside AVAudioEngine and deals with the outside world:
/// audio session, interruptions, route changes, lock-screen controls, voice loading.
@MainActor
@Observable
public final class SessionPlayer {
    public enum State: Equatable, Sendable { case idle, playing, paused, interrupted, finished }

    public private(set) var state: State = .idle
    public private(set) var currentTime: Double = 0
    public private(set) var duration: Double = 0
    public private(set) var sessionDuration: Double = 0
    public private(set) var phaseName: String = ""
    public private(set) var route = AudioRouteInfo(headphonesConnected: false, spatialAudioActive: false, outputName: "", systemVolume: 0.5)
    public private(set) var beatMode: BeatMode = .binaural
    /// Set when headphones were unplugged mid-session (we pause rather than blast the speaker).
    public private(set) var pausedForRouteLoss = false
    public private(set) var lastError: String?
    public var speakerModeForced = false { didSet { applyMode() } }
    /// 0…1 app-level gain, already capped by the caller at the enforced maximum.
    public var userGain: Double = 0.7 { didSet { renderer?.setUserGain(userGain) } }
    public var onFinish: (@MainActor (_ completedSeconds: Double, _ finishedNaturally: Bool) -> Void)?

    public private(set) var title = ""
    private var engine: AVAudioEngine?
    private var renderer: SessionRenderer?
    private var loader: VoiceLoader?
    private var timer: Timer?
    private var observers: [NSObjectProtocol] = []
    private var timeline: ResolvedTimeline?
    private var remoteTargets: [(MPRemoteCommand, Any)] = []

    public init() { route = AudioSessionConfigurator.currentRoute() }

    public var isActive: Bool { state == .playing || state == .paused || state == .interrupted }

    // MARK: Lifecycle

    public func start(session: SessionDefinition, timeline: ResolvedTimeline, narrationDirectory: URL,
                      manifest: NarrationManifest, beatsEnabled: Bool) {
        stop(finishedNaturally: false, notify: false)
        do {
            try AudioSessionConfigurator.configureForPlayback()
            let engine = AVAudioEngine()
            let sr = engine.outputNode.outputFormat(forBus: 0).sampleRate
            let sampleRate = sr > 0 ? sr : 48_000
            guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2) else {
                throw NSError(domain: "SessionPlayer", code: 1, userInfo: [NSLocalizedDescriptionKey: "No stereo format"])
            }
            route = AudioSessionConfigurator.currentRoute()
            let mode = route.preferredMode(speakerModeForced: speakerModeForced)
            let loader = VoiceLoader(timeline: timeline, directory: narrationDirectory, manifest: manifest, sampleRate: sampleRate)
            loader.preload(upTo: 30)
            let renderer = SessionRenderer(timeline: timeline, sampleRate: sampleRate, voice: loader.source,
                                           mode: mode, beatsEnabled: beatsEnabled, userGain: userGain)
            let node = AVAudioSourceNode(format: format) { _, _, frameCount, abl -> OSStatus in
                let buffers = UnsafeMutableAudioBufferListPointer(abl)
                guard buffers.count >= 2,
                      let l = buffers[0].mData?.assumingMemoryBound(to: Float.self),
                      let r = buffers[1].mData?.assumingMemoryBound(to: Float.self) else { return noErr }
                renderer.render(left: l, right: r, frames: Int(frameCount))
                return noErr
            }
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: format)
            engine.mainMixerNode.outputVolume = 1
            try engine.start()

            self.engine = engine; self.renderer = renderer; self.loader = loader; self.timeline = timeline
            beatMode = mode
            title = session.title
            duration = timeline.totalDuration
            sessionDuration = timeline.sessionDuration
            currentTime = 0
            pausedForRouteLoss = false
            lastError = nil
            state = .playing
            installObservers()
            installRemoteCommands()
            startTimer()
            updateNowPlaying()
        } catch {
            lastError = error.localizedDescription
            state = .idle
        }
    }

    public func pause() {
        guard state == .playing else { return }
        renderer?.setPaused(true)   // renderer fades out, then holds the playhead
        state = .paused
        updateNowPlaying()
    }

    public func resume() {
        guard state == .paused || state == .interrupted else { return }
        do {
            try AudioSessionConfigurator.configureForPlayback()
            if let engine, !engine.isRunning { try engine.start() }
            pausedForRouteLoss = false
            renderer?.setPaused(false)  // fades back in
            state = .playing
            updateNowPlaying()
        } catch { lastError = error.localizedDescription }
    }

    public func togglePlayPause() { state == .playing ? pause() : resume() }

    /// User-initiated stop: fade out first, then tear down.
    public func stopWithFade() {
        guard isActive else { return }
        renderer?.setPaused(true)
        let done = currentTime
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(1300))
            self.stop(finishedNaturally: false, notify: true, completed: done)
        }
    }

    private func stop(finishedNaturally: Bool, notify: Bool, completed: Double? = nil) {
        let wasActive = isActive
        let done = completed ?? currentTime
        timer?.invalidate(); timer = nil
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers = []
        removeRemoteCommands()
        engine?.stop()
        engine = nil; renderer = nil; loader = nil; timeline = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        if wasActive {
            AudioSessionConfigurator.deactivate()
            state = finishedNaturally ? .finished : .idle
            if notify { onFinish?(done, finishedNaturally) }
        }
    }

    public func reset() { if state == .finished { state = .idle } }

    // MARK: Tick

    private func startTimer() {
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func tick() {
        guard let renderer, let timeline else { return }
        currentTime = renderer.currentTime
        phaseName = timeline.phase(at: currentTime)?.name ?? ""
        loader?.update(playhead: currentTime)
        if renderer.isFinished {
            stop(finishedNaturally: true, notify: true, completed: timeline.totalDuration)
        }
    }

    // MARK: Mode / route

    private func applyMode() {
        let mode = route.preferredMode(speakerModeForced: speakerModeForced)
        beatMode = mode
        renderer?.setMode(mode) // renderer crossfades binaural ⇄ isochronic
    }

    public func refreshRoute() {
        route = AudioSessionConfigurator.currentRoute()
        applyMode()
    }

    private func installObservers() {
        #if os(iOS)
        let nc = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
            let typeRaw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            let optRaw = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            MainActor.assumeIsolated { self?.handleInterruption(typeRaw: typeRaw, optionsRaw: optRaw) }
        })
        observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] note in
            let reasonRaw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            MainActor.assumeIsolated { self?.handleRouteChange(reasonRaw: reasonRaw) }
        })
        observers.append(nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.handleEngineReset() }
        })
        observers.append(nc.addObserver(forName: AVAudioSession.spatialPlaybackCapabilitiesChangedNotification, object: session, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshRoute() }
        })
        #endif
        if let engine {
            observers.append(NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.handleEngineReset() }
            })
        }
    }

    #if os(iOS)
    private func handleInterruption(typeRaw: UInt?, optionsRaw: UInt) {
        guard let typeRaw, let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
        switch type {
        case .began:
            // The system has already silenced us; hold the playhead so nothing is skipped,
            // and so that we fade back in (not jump) when we return.
            if state == .playing {
                renderer?.setPaused(true)
                state = .interrupted
                updateNowPlaying()
            }
        case .ended:
            let shouldResume = AVAudioSession.InterruptionOptions(rawValue: optionsRaw).contains(.shouldResume)
            if state == .interrupted {
                if shouldResume { resume() } else { state = .paused; updateNowPlaying() }
            }
        @unknown default: break
        }
    }

    private func handleRouteChange(reasonRaw: UInt?) {
        let old = route
        route = AudioSessionConfigurator.currentRoute()
        let reason = reasonRaw.flatMap { AVAudioSession.RouteChangeReason(rawValue: $0) }
        if reason == .oldDeviceUnavailable, old.headphonesConnected, !route.headphonesConnected, state == .playing {
            // Headphones pulled out: never continue out loud on the speaker unasked.
            pausedForRouteLoss = true
            pause()
        }
        applyMode()
    }
    #endif

    private func handleEngineReset() {
        guard let engine, isActive else { return }
        if !engine.isRunning, state == .playing {
            do { try AudioSessionConfigurator.configureForPlayback(); try engine.start() }
            catch { lastError = error.localizedDescription; pause() }
        }
        refreshRoute()
    }

    // MARK: Lock screen / Control Center

    private func installRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        func add(_ cmd: MPRemoteCommand, _ action: @escaping @MainActor () -> Void) {
            cmd.isEnabled = true
            let token = cmd.addTarget { _ in
                Task { @MainActor in action() }
                return .success
            }
            remoteTargets.append((cmd, token))
        }
        add(c.playCommand) { [weak self] in self?.resume() }
        add(c.pauseCommand) { [weak self] in self?.pause() }
        add(c.togglePlayPauseCommand) { [weak self] in self?.togglePlayPause() }
        add(c.stopCommand) { [weak self] in self?.stopWithFade() }
        // A hypnosis session is not scrubbable: skipping would break the beat/phase arc.
        c.changePlaybackPositionCommand.isEnabled = false
        c.nextTrackCommand.isEnabled = false
        c.previousTrackCommand.isEnabled = false
        c.skipForwardCommand.isEnabled = false
        c.skipBackwardCommand.isEnabled = false
    }

    private func removeRemoteCommands() {
        for (cmd, token) in remoteTargets { cmd.removeTarget(token) }
        remoteTargets = []
    }

    private func updateNowPlaying() {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: "Stillpoint",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: renderer?.currentTime ?? currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: state == .playing ? 1.0 : 0.0,
        ]
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        #if os(macOS)
        MPNowPlayingInfoCenter.default().playbackState = state == .playing ? .playing : .paused
        #endif
    }
}
