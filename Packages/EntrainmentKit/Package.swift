// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "EntrainmentKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "EntrainmentKit", targets: ["EntrainmentKit"]),
        .library(name: "HypnosisAppCore", targets: ["HypnosisAppCore"]),
    ],
    targets: [
        // Real-time audio: DSP, session format, timeline, renderer, AVAudioEngine host.
        .target(
            name: "EntrainmentKit",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // App layer: SwiftUI screens, persistence (SwiftData + CloudKit), HealthKit, experiment logic.
        .target(
            name: "HypnosisAppCore",
            dependencies: ["EntrainmentKit"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .executableTarget(
            name: "sessionrender",
            dependencies: ["EntrainmentKit"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .executableTarget(
            name: "StillpointMac",
            dependencies: ["HypnosisAppCore"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "EntrainmentKitTests",
            dependencies: ["EntrainmentKit", "HypnosisAppCore"],
            resources: [.copy("Fixtures")],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
