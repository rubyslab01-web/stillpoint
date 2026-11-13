import SwiftUI
import Charts
import EntrainmentKit

struct ProgressOverviewView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if model.records.isEmpty {
                    Card {
                        Text("No sessions yet").font(.headline)
                        Text("Your history and what works for you will appear here after your first session.")
                            .font(.subheadline).foregroundStyle(Color.appMuted)
                    }
                }
                ForEach(model.library.modules) { m in
                    NavigationLink { ModuleProgressView(module: m) } label: {
                        let rs = model.records(in: m.id)
                        HStack(spacing: 14) {
                            Image(systemName: m.icon).frame(width: 40, height: 40)
                                .background(m.color.opacity(0.22), in: RoundedRectangle(cornerRadius: 10)).foregroundStyle(m.color)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(m.title).font(.headline)
                                Text(rs.isEmpty ? "Not started" : "\(rs.count) session\(rs.count == 1 ? "" : "s") · \(formatDuration(rs.reduce(0) { $0 + $1.completedSeconds })) listened")
                                    .font(.subheadline).foregroundStyle(Color.appMuted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Color.appMuted)
                        }
                        .padding(14)
                        .background(Color.appCard, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .navigationTitle("Progress")
        .appPage()
    }
}

struct ModuleProgressView: View {
    @Environment(AppModel.self) private var model
    let module: ModuleInfo

    struct Point: Identifiable {
        let id = UUID(); let date: Date; let value: Double; let series: String
    }

    var body: some View {
        let records = model.records(in: module.id)
        let prompts = model.library.sessions(in: module.id).flatMap(\.ratings)
        let primary = prompts.first { $0.id == module.primaryRating }
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    stat("\(records.count)", "sessions")
                    stat("\(records.filter(\.finished).count)", "completed")
                    stat(formatDuration(records.reduce(0) { $0 + $1.completedSeconds }), "listened")
                }
                if let primary { chartCard(primary, records) }
                if model.settings.experimentEnabled || records.contains(where: \.inExperiment) { experimentCard }
                Text("History").font(.title3.bold()).padding(.top, 6)
                if records.isEmpty { Text("No sessions yet.").foregroundStyle(Color.appMuted) }
                ForEach(records) { r in historyRow(r, prompts) }
            }
            .padding(16)
        }
        .navigationTitle(module.title).inlineTitle()
        .appPage()
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.title2.bold().monospacedDigit())
            Text(label).font(.caption).foregroundStyle(Color.appMuted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 12)
        .background(Color.appCard, in: RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder private func chartCard(_ p: SessionDefinition.RatingPrompt, _ records: [SessionRecord]) -> some View {
        let both = p.before && p.after
        let pts: [Point] = records.flatMap { r -> [Point] in
            var out: [Point] = []
            if both, let b = r.ratingsBefore[p.id] { out.append(Point(date: r.startedAt, value: Double(b), series: "Before")) }
            if let a = r.ratingsAfter[p.id] { out.append(Point(date: r.startedAt, value: Double(a), series: both ? "After" : "Rating")) }
            return out
        }
        Card {
            Text(p.question).font(.headline).fixedSize(horizontal: false, vertical: true)
            if pts.isEmpty {
                Text("Rate a session to see your trend here.").font(.subheadline).foregroundStyle(Color.appMuted)
            } else {
                // Before = grey, after = module colour; identity is also carried by the legend and symbol shape.
                Chart(pts) { pt in
                    LineMark(x: .value("Date", pt.date), y: .value("Rating", pt.value))
                        .foregroundStyle(by: .value("When", pt.series)).interpolationMethod(.monotone)
                    PointMark(x: .value("Date", pt.date), y: .value("Rating", pt.value))
                        .foregroundStyle(by: .value("When", pt.series)).symbol(by: .value("When", pt.series))
                }
                .chartForegroundStyleScale(domain: both ? ["Before", "After"] : ["Rating"], range: both ? [Color.gray, module.color] : [module.color])
                .chartSymbolScale(domain: both ? ["Before", "After"] : ["Rating"],
                                  range: both ? [BasicChartSymbolShape.circle, .cross] : [BasicChartSymbolShape.circle])
                .chartYScale(domain: Double(p.range.lowerBound)...Double(p.range.upperBound))
                .chartLegend(both ? .visible : .hidden)
                .frame(height: 180)
                Text("\(p.range.lowerBound) = \(p.minLabel) · \(p.range.upperBound) = \(p.maxLabel)").font(.caption).foregroundStyle(Color.appMuted)
                if both {
                    let deltas = records.compactMap { Experiment.score($0, prompt: p) }
                    if !deltas.isEmpty {
                        let avg = deltas.reduce(0, +) / Double(deltas.count)
                        Text(String(format: "Average change per session: %+.1f points %@", avg, avg >= 0 ? "better" : "worse").replacingOccurrences(of: "-", with: "−"))
                            .font(.subheadline)
                    }
                }
            }
        }
    }

    @ViewBuilder private var experimentCard: some View {
        let results = model.experimentResults(for: module)
        Card {
            Label("Do the beats help you?", systemImage: "dice.fill").font(.headline)
            if let first = results.first {
                switch first.verdict {
                case .collecting(let needed):
                    Text("Still collecting. Sessions are randomly played with or without beats, and you aren't told which, so your ratings stay unbiased.")
                        .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    ProgressView(value: Double(min(first.withBeats.n, Experiment.revealThreshold) + min(first.withoutBeats.n, Experiment.revealThreshold)),
                                 total: Double(Experiment.revealThreshold * 2))
                    Text("About \(needed) more rated session\(needed == 1 ? "" : "s") until results are revealed.").font(.footnote).foregroundStyle(Color.appMuted)
                default:
                    ForEach(results.filter(\.revealed), id: \.metric) { r in resultRow(r) }
                    Text("This is your own small experiment, not proof. Differences can be chance, especially with few sessions.")
                        .font(.caption).foregroundStyle(Color.appMuted).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func resultRow(_ r: Experiment.Result) -> some View {
        let title: String = {
            switch r.verdict {
            case .beatsHelp: return "Beats seem to help"
            case .beatsHurt: return "You do better without beats"
            default: return "No clear difference"
            }
        }()
        return VStack(alignment: .leading, spacing: 4) {
            Text("\(r.metric.capitalized): \(title)").font(.subheadline.bold())
            Text(String(format: "With beats: %.1f %@ (%d sessions)\nWithout beats: %.1f %@ (%d sessions)",
                        r.withBeats.mean, r.unit, r.withBeats.n, r.withoutBeats.mean, r.unit, r.withoutBeats.n))
                .font(.footnote.monospacedDigit()).foregroundStyle(Color.appMuted)
        }
        .padding(.vertical, 2)
    }

    private func historyRow(_ r: SessionRecord, _ prompts: [SessionDefinition.RatingPrompt]) -> some View {
        Card {
            HStack {
                Text(r.sessionTitle).font(.subheadline.bold())
                Spacer()
                Text(r.startedAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(Color.appMuted)
            }
            HStack(spacing: 10) {
                Label(r.finished ? "Completed" : "Stopped at \(clock(r.completedSeconds))", systemImage: r.finished ? "checkmark.circle" : "stop.circle")
                if model.isRevealed(module) {
                    Label(r.beatsEnabled ? "Beats on" : "Beats off", systemImage: "waveform")
                }
            }
            .font(.caption).foregroundStyle(Color.appMuted)
            let lines: [String] = prompts.reduce(into: [String]()) { acc, p in
                guard !acc.contains(where: { $0.hasPrefix(p.id.capitalized) }) else { return }
                let b = r.ratingsBefore[p.id], a = r.ratingsAfter[p.id]
                if let b, let a { acc.append("\(p.id.capitalized) \(b) → \(a)") }
                else if let a { acc.append("\(p.id.capitalized) \(a)") }
                else if let b { acc.append("\(p.id.capitalized) \(b) before") }
            }
            if !lines.isEmpty { Text(lines.joined(separator: "   ")).font(.footnote.monospacedDigit()) }
            if let d = r.sleepDeepMinutes {
                Text(String(format: "Deep sleep %.0f min%@", d, r.sleepOnsetMinutes.map { String(format: " · asleep in %.0f min", $0) } ?? ""))
                    .font(.footnote.monospacedDigit())
            }
            if let hr = r.avgHeartRate { Text(String(format: "Heart rate %.0f bpm%@", hr, r.hrvSDNN.map { String(format: " · HRV %.0f ms", $0) } ?? "")).font(.footnote.monospacedDigit()) }
            if !r.note.isEmpty { Text("“\(r.note)”").font(.footnote.italic()) }
        }
    }
}
