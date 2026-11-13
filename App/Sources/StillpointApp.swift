import SwiftUI
import HypnosisAppCore

/// The iOS app is a thin shell: all screens, audio and data live in the EntrainmentKit package
/// (targets `EntrainmentKit` and `HypnosisAppCore`), which is also unit-tested on the Mac.
@main
struct StillpointApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
