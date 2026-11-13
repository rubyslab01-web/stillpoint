// Development-only Mac build of the app UI (`swift run StillpointMac`). The shipping target is
// the iOS app in App/; this exists so screens and audio can be exercised without the Simulator.
//   swift run StillpointMac                      # run the app in a window
//   swift run StillpointMac --snapshots <folder> # render key screens to PNG files (iPhone-sized)
import SwiftUI
import AppKit
import HypnosisAppCore

struct StillpointMacApp: App {
    var body: some Scene {
        WindowGroup("Stillpoint") {
            RootView().frame(minWidth: 400, idealWidth: 430, minHeight: 760, idealHeight: 860)
        }
    }
}

let args = CommandLine.arguments
if let i = args.firstIndex(of: "--snapshots"), i + 1 < args.count {
    let dir = URL(fileURLWithPath: args[i + 1])
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    MainActor.assumeIsolated {
        let size = NSSize(width: 393, height: 852) // iPhone 16 points
        for (name, view) in SnapshotGallery.screens() {
            let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height))
            let window = NSWindow(contentRect: NSRect(origin: NSPoint(x: -5000, y: -5000), size: size),
                                  styleMask: [.borderless], backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: .darkAqua)
            window.contentView = host
            window.orderBack(nil)
            host.layoutSubtreeIfNeeded()
            RunLoop.main.run(until: Date().addingTimeInterval(1.2))
            if let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                host.cacheDisplay(in: host.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("\(name).png"))
                print("wrote \(name).png")
            }
            window.close()
        }
    }
    exit(0)
}

NSApplication.shared.setActivationPolicy(.regular)
StillpointMacApp.main()
