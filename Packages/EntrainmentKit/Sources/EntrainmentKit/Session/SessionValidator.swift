import Foundation

/// Rules every session file must satisfy. Run by unit tests over the real `Sessions/` folder
/// and by `sessionrender --validate`, so a bad edit is caught before it reaches a device.
public enum SessionValidator {
    public static let alertBeatHz = 12.0

    public static func problems(in s: SessionDefinition, durations: [String: Double]) -> [String] {
        var out: [String] = []
        if s.phases.isEmpty { out.append("no phases") }
        if !(100...500).contains(s.carrierHz) { out.append("carrier \(s.carrierHz) Hz outside 100–500 Hz") }
        var seen = Set<String>()
        for p in s.phases {
            if !(0.5...40).contains(p.beatHz) { out.append("\(p.id): beat \(p.beatHz) Hz outside 0.5–40 Hz") }
            if p.levels.beats > -90 && p.levels.noise > -90 {
                let under = p.levels.noise - p.levels.beats
                if !(15...20).contains(under) { out.append("\(p.id): beats are \(under) dB under noise (must be 15–20)") }
            }
            for l in [p.levels.noise, p.levels.ambient, p.levels.pacer, p.levels.beats] where l > -6 {
                out.append("\(p.id): a background layer at \(l) dB would compete with the voice (max -6)")
            }
            for seg in p.segments {
                if durations[seg.id] == nil { out.append("\(p.id): narration '\(seg.id)' missing from manifest") }
                if !seen.insert(seg.id).inserted { out.append("\(p.id): narration '\(seg.id)' used twice") }
                if seg.pauseAfter < 0 { out.append("\(p.id): negative pause") }
            }
            if let pc = p.pacer, !(3...12).contains(pc.breathsPerMinute) { out.append("\(p.id): pacer \(pc.breathsPerMinute) breaths/min outside 3–12") }
        }
        if s.awake {
            // Safety requirement: every awake session ends in an alert state.
            if let last = s.phases.last, last.beatHz < alertBeatHz {
                out.append("awake session must end at ≥ \(alertBeatHz) Hz (ends at \(last.beatHz))")
            }
            if s.noiseBed != nil { out.append("awake session must not have a noise bed") }
        }
        if s.fadeInSeconds <= 0 || s.fadeOutSeconds <= 0 { out.append("fade in/out must be > 0") }
        for r in s.ratings where !(r.before || r.after) { out.append("rating \(r.id) is never asked") }
        if out.isEmpty, let tl = try? ResolvedTimeline(session: s, durations: durations) {
            if tl.sessionDuration < 30 { out.append("session shorter than 30 s") }
            if tl.fadeIn + tl.fadeOut > tl.sessionDuration { out.append("fades longer than session") }
        }
        return out
    }
}

/// Loads every `*.json` session in a folder (ignoring modules.json).
public enum SessionLibrary {
    public static func loadSessions(in directory: URL) throws -> [SessionDefinition] {
        let urls = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" && $0.lastPathComponent != "modules.json" }
        return try urls.map { url in
            do { return try SessionDefinition.load(from: url) }
            catch { throw NSError(domain: "SessionLibrary", code: 1, userInfo: [NSLocalizedDescriptionKey: "\(url.lastPathComponent): \(error)"]) }
        }.sorted { ($0.module, $0.sortOrder) < ($1.module, $1.sortOrder) }
    }
}
