import Foundation
import Observation
import CoreData
import EntrainmentKit

/// Device-local preferences (not personal data; not synced).
@MainActor
@Observable
public final class AppSettings {
    private let d: UserDefaults
    public var onboardingDone: Bool { didSet { d.set(onboardingDone, forKey: "onboardingDone") } }
    public var volume: Double { didSet { d.set(volume, forKey: "volume") } }
    public var speakerMode: Bool { didSet { d.set(speakerMode, forKey: "speakerMode") } }
    public var experimentEnabled: Bool { didSet { d.set(experimentEnabled, forKey: "experimentEnabled") } }
    public var suggestibility: String { didSet { d.set(suggestibility, forKey: "suggestibility") } }
    public var healthEnabled: [String: Bool] { didSet { d.set(healthEnabled, forKey: "healthEnabled") } }

    public init(defaults: UserDefaults = .standard) {
        d = defaults
        onboardingDone = d.bool(forKey: "onboardingDone")
        volume = d.object(forKey: "volume") as? Double ?? VolumePolicy.defaultGain
        speakerMode = d.bool(forKey: "speakerMode")
        experimentEnabled = d.object(forKey: "experimentEnabled") as? Bool ?? true
        suggestibility = d.string(forKey: "suggestibility") ?? ""
        healthEnabled = d.dictionary(forKey: "healthEnabled") as? [String: Bool] ?? [:]
    }

    public func isHealthOn(_ k: HealthDataKind) -> Bool { healthEnabled[k.rawValue] ?? false }

    public func reset() {
        for k in ["onboardingDone", "volume", "speakerMode", "experimentEnabled", "suggestibility", "healthEnabled"] { d.removeObject(forKey: k) }
        onboardingDone = false; volume = VolumePolicy.defaultGain; speakerMode = false
        experimentEnabled = true; suggestibility = ""; healthEnabled = [:]
    }
}

@MainActor
@Observable
public final class AppModel {
    public struct ActiveSession: Equatable {
        public var session: SessionDefinition
        public var logID: UUID
        public var startedAt: Date
    }

    public let library: ContentLibrary
    public let store: DataStore
    public let settings: AppSettings
    public let player = SessionPlayer()
    public let health = HealthService()
    public let tones = TestTonePlayer()

    public private(set) var records: [SessionRecord] = []
    public private(set) var active: ActiveSession?
    /// Log awaiting its after-session ratings (drives the post-session sheet).
    public var pendingPost: ActiveSession?
    /// Sleep log awaiting next-morning ratings.
    public var pendingMorning: SessionRecord?
    private var observer: NSObjectProtocol?

    public init(library: ContentLibrary = .load(), store: DataStore? = nil, settings: AppSettings? = nil) {
        self.library = library
        self.store = store ?? DataStore()
        self.settings = settings ?? AppSettings()
        player.userGain = VolumePolicy.clamp(self.settings.volume)
        player.speakerModeForced = self.settings.speakerMode
        player.onFinish = { [weak self] seconds, natural in self?.sessionEnded(completed: seconds, natural: natural) }
        observer = NotificationCenter.default.addObserver(forName: .NSManagedObjectContextObjectsDidChange,
                                                          object: self.store.context, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.reload() }
        }
        reload()
    }

    public func reload() { records = store.allLogs().map(\.record) }

    public func records(in moduleID: String) -> [SessionRecord] { records.filter { $0.moduleID == moduleID } }

    // MARK: Volume / mode

    public func setVolume(_ v: Double) {
        let c = VolumePolicy.clamp(v)
        settings.volume = c
        player.userGain = c
        tones.setUserGain(c)
    }

    public func setSpeakerMode(_ on: Bool) {
        settings.speakerMode = on
        player.speakerModeForced = on
    }

    // MARK: Sessions

    public func start(_ session: SessionDefinition, ratingsBefore: [String: Int] = [:], noiseBedMinutes: Int = 0) {
        guard let timeline = try? ResolvedTimeline(session: session, durations: library.durations, noiseBedMinutes: noiseBedMinutes) else { return }
        tones.stop()
        let inExperiment = settings.experimentEnabled
        let beats = inExperiment ? Experiment.assignBeats(history: records, moduleID: session.module) : true
        player.userGain = VolumePolicy.clamp(settings.volume)
        player.speakerModeForced = settings.speakerMode
        player.start(session: session, timeline: timeline, narrationDirectory: library.narrationDirectory,
                     manifest: library.manifest, beatsEnabled: beats)
        guard player.state == .playing else { return }
        let log = store.newLog(sessionID: session.id, moduleID: session.module, sessionTitle: session.title,
                               plannedSeconds: timeline.sessionDuration, beatsEnabled: beats, inExperiment: inExperiment,
                               beatMode: player.beatMode == .binaural ? "binaural" : "isochronic", noiseBedMinutes: noiseBedMinutes)
        log.ratingsBefore = ratingsBefore
        // Set up front so the morning check-in still happens if the app is closed overnight.
        log.awaitingMorningRatings = session.ratings.contains { $0.timing == "nextMorning" }
        store.save()
        active = ActiveSession(session: session, logID: log.id!, startedAt: log.startedAt!)
    }

    /// Rescue sessions can record the "before" rating while already playing.
    public func setBeforeRating(_ id: String, _ value: Int) {
        guard let a = active, let log = store.log(id: a.logID) else { return }
        var r = log.ratingsBefore; r[id] = value; log.ratingsBefore = r
        store.save()
    }

    public func beforeRating(_ id: String) -> Int? {
        guard let a = active else { return nil }
        return records.first { $0.id == a.logID }?.ratingsBefore[id]
    }

    private func sessionEnded(completed: Double, natural: Bool) {
        guard let a = active, let log = store.log(id: a.logID) else { active = nil; return }
        log.completedSeconds = min(completed, log.plannedSeconds)
        // Count a session as finished if the guided part was heard (the noise bed is optional).
        log.finished = natural || completed >= log.plannedSeconds * 0.95
        let prompts = a.session.ratings
        if completed <= 120 { log.awaitingMorningRatings = false }   // stopped almost at once: nothing to ask about
        store.save()
        active = nil
        player.reset()
        if prompts.contains(where: { $0.after && $0.timing == nil }) && completed > 30 { pendingPost = a }
        let end = Date()
        Task { await attachHealth(logID: a.logID, start: a.startedAt, end: end) }
    }

    public func saveAfterRatings(logID: UUID, ratings: [String: Int], note: String) {
        guard let log = store.log(id: logID) else { return }
        var r = log.ratingsAfter
        ratings.forEach { r[$0.key] = $0.value }
        log.ratingsAfter = r
        if !note.isEmpty { log.note = note }
        log.awaitingMorningRatings = false
        store.save()
    }

    public func dismissMorning(logID: UUID) {
        if let log = store.log(id: logID) { log.awaitingMorningRatings = false; store.save() }
        pendingMorning = nil
    }

    /// Called when the app becomes active: ask for last night's sleep ratings if due.
    public func checkMorning(now: Date = Date()) {
        guard pendingMorning == nil, !player.isActive else { return }
        // Due once at least 4 hours have passed; dropped silently after 36 hours.
        for r in records where r.awaitingMorningRatings {
            let age = now.timeIntervalSince(r.startedAt)
            if age > 36 * 3600 { dismissMorning(logID: r.id) }
            else if age > 4 * 3600 {
                pendingMorning = r
                Task { await attachSleep(logID: r.id, start: r.startedAt) }
                break
            }
        }
    }

    // MARK: Health

    private func attachHealth(logID: UUID, start: Date, end: Date) async {
        guard health.isAvailable else { return }
        var hr: Double?, hrv: Double?
        if settings.isHealthOn(.heartRate) { hr = await health.averageHeartRate(from: start, to: end) }
        if settings.isHealthOn(.hrv) { hrv = await health.hrv(from: start, to: end) }
        guard hr != nil || hrv != nil, let log = store.log(id: logID) else { return }
        if let hr { log.avgHeartRate = NSNumber(value: hr) }
        if let hrv { log.hrvSDNN = NSNumber(value: hrv) }
        store.save()
    }

    private func attachSleep(logID: UUID, start: Date) async {
        guard health.isAvailable, settings.isHealthOn(.sleep), let s = await health.sleepSummary(after: start),
              let log = store.log(id: logID) else { return }
        if let o = s.onsetMinutes { log.sleepOnsetMinutes = NSNumber(value: o) }
        log.sleepDeepMinutes = NSNumber(value: s.deepMinutes)
        log.sleepRemMinutes = NSNumber(value: s.remMinutes)
        log.sleepTotalMinutes = NSNumber(value: s.totalAsleepMinutes)
        store.save()
    }

    public func setHealth(_ kind: HealthDataKind, on: Bool) async {
        if on {
            let ok = await health.requestAccess(kind)
            settings.healthEnabled[kind.rawValue] = ok
        } else {
            settings.healthEnabled[kind.rawValue] = false
        }
    }

    // MARK: Experiment / data

    public func experimentResults(for module: ModuleInfo) -> [Experiment.Result] {
        let prompts = library.sessions(in: module.id).flatMap(\.ratings).reduce(into: [SessionDefinition.RatingPrompt]()) { acc, p in
            if !acc.contains(where: { $0.id == p.id }) { acc.append(p) }
        }
        return Experiment.results(history: records, moduleID: module.id, prompts: prompts, primary: module.primaryRating)
    }

    /// Whether the beats/no-beats condition may be shown for this module yet.
    public func isRevealed(_ module: ModuleInfo) -> Bool {
        !settings.experimentEnabled || (experimentResults(for: module).first?.revealed ?? false)
    }

    public func deleteAllData() {
        store.deleteAll()
        settings.reset()
        pendingPost = nil; pendingMorning = nil
        reload()
    }
}
