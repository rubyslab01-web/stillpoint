import SwiftUI
import EntrainmentKit

/// Key screens with seeded demo data, for offscreen rendering during development
/// (`swift run StillpointMac --snapshots <folder>`). Uses an in-memory store only.
@MainActor
public enum SnapshotGallery {
    public static func demoModel() -> AppModel {
        let defaults = UserDefaults(suiteName: "snapshots-\(UUID().uuidString)")!
        let store = DataStore(inMemory: true)
        var rng = SystemRandomNumberGenerator()
        for i in 0..<14 {
            let beats = i % 2 == 0
            let l = store.newLog(sessionID: i % 3 == 0 ? "qs-breathe-free" : "qs-rescue-5", moduleID: "quit-smoking",
                                 sessionTitle: i % 3 == 0 ? "Breathe Free" : "Ride the Wave", plannedSeconds: i % 3 == 0 ? 846 : 270,
                                 beatsEnabled: beats, inExperiment: true, beatMode: "binaural",
                                 startedAt: Date().addingTimeInterval(Double(i - 14) * 86_400 * 1.3))
            let before = Int.random(in: 6...9, using: &rng)
            l.ratingsBefore = ["craving": before, "calm": 3]
            l.ratingsAfter = ["craving": max(0, before - Int.random(in: 2...5, using: &rng)), "calm": 7]
            l.completedSeconds = l.plannedSeconds; l.finished = true
            if i == 13 { l.note = "Walked round the block instead." }
        }
        store.save()
        let m = AppModel(library: .load(), store: store, settings: AppSettings(defaults: defaults))
        m.settings.onboardingDone = true
        return m
    }

    public static func screens() -> [(name: String, view: AnyView)] {
        let model = demoModel()
        let fresh = AppModel(library: model.library, store: DataStore(inMemory: true),
                             settings: AppSettings(defaults: UserDefaults(suiteName: "snapshots-\(UUID().uuidString)")!))
        let qs = model.library.module("quit-smoking")!, sleep = model.library.module("sleep")!
        func wrap<V: View>(_ v: V, _ m: AppModel) -> AnyView {
            AnyView(v.environment(m).tint(Color(hex: "#7C8CF8")).preferredColorScheme(.dark))
        }
        return [
            ("01-onboarding", wrap(OnboardingView(), fresh)),
            ("02-home", wrap(NavigationStack { HomeView() }, model)),
            ("03-quit-smoking", wrap(NavigationStack { ModuleDetailView(module: qs) }, model)),
            ("04-sleep-prep", wrap(SessionPrepView(module: sleep, session: model.library.session("sleep-deep")!), model)),
            ("05-player", wrap(PlayerView(), model)),
            ("06-progress", wrap(NavigationStack { ModuleProgressView(module: qs) }, model)),
            ("07-settings", wrap(NavigationStack { SettingsView() }, model)),
            ("08-support", wrap(NavigationStack { ResourcesView() }, model)),
        ]
    }
}
