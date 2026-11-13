import Foundation
import EntrainmentKit

/// Module metadata, loaded from Sessions/modules.json — adding a module is a data change.
public struct ModuleInfo: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var tagline: String
    public var icon: String
    public var colorHex: String
    public var awake: Bool
    public var primaryRating: String
    public var showCrisisResources: Bool
    public var showCessationSupport: Bool
    public var about: String
    public var honesty: String
    public var cautions: [String]
}

struct ModulesFile: Codable { var modules: [ModuleInfo] }

/// Everything bundled with the app: modules, sessions, narration manifest.
public struct ContentLibrary: Sendable {
    public var modules: [ModuleInfo]
    public var sessions: [SessionDefinition]
    public var manifest: NarrationManifest
    public var narrationDirectory: URL
    public var problems: [String] = []

    public var durations: [String: Double] { manifest.segments.mapValues(\.duration) }
    public func sessions(in moduleID: String) -> [SessionDefinition] {
        sessions.filter { $0.module == moduleID }.sorted { $0.sortOrder < $1.sortOrder }
    }
    public func module(_ id: String) -> ModuleInfo? { modules.first { $0.id == id } }
    public func session(_ id: String) -> SessionDefinition? { sessions.first { $0.id == id } }
    public func duration(of s: SessionDefinition) -> Double {
        (try? ResolvedTimeline(session: s, durations: durations).sessionDuration) ?? 0
    }

    public static let empty = ContentLibrary(modules: [], sessions: [], manifest: .init(segments: [:]),
                                             narrationDirectory: URL(fileURLWithPath: "/"))

    /// Looks for `Sessions/` and `Narration/` folders in the app bundle. During development on
    /// the Mac (`swift run`), falls back to the repository folders.
    public static func load(bundle: Bundle = .main) -> ContentLibrary {
        var sessionsDir = bundle.resourceURL?.appendingPathComponent("Sessions")
        var narrationDir = bundle.resourceURL?.appendingPathComponent("Narration")
        let fm = FileManager.default
        if sessionsDir == nil || !fm.fileExists(atPath: sessionsDir!.path) {
            let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            sessionsDir = root.appendingPathComponent("Sessions")
            narrationDir = root.appendingPathComponent("App/Resources/Narration")
        }
        guard let sessionsDir, let narrationDir else { return .empty }
        var lib = ContentLibrary.empty
        lib.narrationDirectory = narrationDir
        do {
            lib.modules = try JSONDecoder().decode(ModulesFile.self, from: Data(contentsOf: sessionsDir.appendingPathComponent("modules.json"))).modules
            lib.manifest = try NarrationManifest.load(from: narrationDir.appendingPathComponent("manifest.json"))
            lib.sessions = try SessionLibrary.loadSessions(in: sessionsDir)
            let d = lib.durations
            for s in lib.sessions {
                lib.problems += SessionValidator.problems(in: s, durations: d).map { "\(s.id): \($0)" }
            }
        } catch {
            lib.problems.append(error.localizedDescription)
        }
        return lib
    }
}
