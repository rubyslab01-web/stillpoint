import SwiftUI
import EntrainmentKit

public struct RootView: View {
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    public init(model: AppModel? = nil) { _model = State(initialValue: model ?? AppModel()) }

    public var body: some View {
        Group {
            if model.settings.onboardingDone { MainTabs() } else { OnboardingView() }
        }
        .environment(model)
        .tint(Color(hex: "#7C8CF8"))
        .preferredColorScheme(.dark)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.player.refreshRoute(); model.checkMorning() }
        }
        .onAppear { model.checkMorning() }
    }
}

struct MainTabs: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView {
            NavigationStack { HomeView() }
                .tabItem { Label("Sessions", systemImage: "waveform") }
            NavigationStack { ProgressOverviewView() }
                .tabItem { Label("Progress", systemImage: "chart.line.uptrend.xyaxis") }
            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .cover(isPresented: Binding(get: { model.player.isActive }, set: { _ in })) {
            PlayerView().environment(model)
        }
        .sheet(item: $model.pendingPost) { a in
            PostSessionView(active: a).environment(model)
        }
        .sheet(item: $model.pendingMorning) { r in
            MorningCheckInView(record: r).environment(model)
        }
    }
}

extension AppModel.ActiveSession: Identifiable { public var id: UUID { logID } }

struct HomeView: View {
    @Environment(AppModel.self) private var model

    var rescue: SessionDefinition? { model.library.sessions.first { $0.kind == "rescue" } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !model.library.problems.isEmpty {
                    Card {
                        Label("Some session files have problems", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
                        ForEach(model.library.problems, id: \.self) { Text($0).font(.caption) }
                    }
                }
                if let rescue, let m = model.library.module(rescue.module) {
                    Button {
                        model.start(rescue)
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "lifepreserver.fill").font(.title)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Craving now?").font(.headline)
                                Text("Start a \(formatDuration(model.library.duration(of: rescue))) rescue session").font(.subheadline).opacity(0.85)
                            }
                            Spacer()
                            Image(systemName: "play.fill")
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity)
                        .background(m.color.gradient, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Starts the shortest quit-smoking rescue session immediately")
                }
                ForEach(model.library.modules) { m in
                    NavigationLink(value: m.id) { ModuleRow(module: m) }.buttonStyle(.plain)
                }
                Text("Wellness, not treatment. Don't use while driving.")
                    .font(.footnote).foregroundStyle(Color.appMuted).frame(maxWidth: .infinity).padding(.top, 6)
            }
            .padding(16)
        }
        .navigationTitle("Stillpoint")
        .navigationDestination(for: String.self) { id in
            if let m = model.library.module(id) { ModuleDetailView(module: m) }
        }
        .appPage()
    }
}

struct ModuleRow: View {
    @Environment(AppModel.self) private var model
    let module: ModuleInfo
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: module.icon)
                .font(.title2).frame(width: 52, height: 52)
                .background(module.color.opacity(0.22), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .foregroundStyle(module.color)
            VStack(alignment: .leading, spacing: 3) {
                Text(module.title).font(.headline)
                Text(module.tagline).font(.subheadline).foregroundStyle(Color.appMuted)
            }
            Spacer()
            let n = model.records(in: module.id).count
            if n > 0 { Text("\(n)").font(.caption.monospacedDigit()).foregroundStyle(Color.appMuted) }
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Color.appMuted)
        }
        .padding(14)
        .background(Color.appCard, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .contentShape(Rectangle())
    }
}
