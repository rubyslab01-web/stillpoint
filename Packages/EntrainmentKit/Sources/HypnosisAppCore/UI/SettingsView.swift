import SwiftUI
import EntrainmentKit

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var exportURL: URL?
    @State private var confirmDelete = false
    @State private var exportError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Card {
                    Text("Sound").font(.headline)
                    VolumeControl()
                    Toggle("Always use speaker mode (pulsed tones)", isOn: Binding(get: { model.settings.speakerMode }, set: { model.setSpeakerMode($0) }))
                        .font(.subheadline)
                    Text("Binaural beats need headphones. Speaker mode uses pulsing tones instead, and is chosen automatically when no headphones are connected.")
                        .font(.caption).foregroundStyle(Color.appMuted)
                }
                Card {
                    Toggle(isOn: Binding(get: { model.settings.experimentEnabled }, set: { model.settings.experimentEnabled = $0 })) {
                        Text("Self-experiment").font(.headline)
                    }
                    Text("Randomly plays about half of your sessions without beats, without telling you which, then shows whether beats changed your ratings. Turn off to always hear beats.")
                        .font(.caption).foregroundStyle(Color.appMuted).fixedSize(horizontal: false, vertical: true)
                }
                SuggestibilityCard()
                HealthPermissionsCard()
                Card {
                    Text("Your data").font(.headline)
                    Text(model.store.usingCloud
                         ? "Session history and ratings are stored on this device and synced to your private iCloud database. Only you can read it."
                         : "Session history and ratings are stored on this device. Sign in to iCloud to sync them privately across your devices.")
                        .font(.caption).foregroundStyle(Color.appMuted).fixedSize(horizontal: false, vertical: true)
                    if let exportURL {
                        ShareLink(item: exportURL) { Label("Share export file", systemImage: "square.and.arrow.up") }
                    } else {
                        Button { prepareExport() } label: { Label("Export all my data", systemImage: "square.and.arrow.up") }
                    }
                    if let exportError { Text(exportError).font(.caption).foregroundStyle(.red) }
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete all my data", systemImage: "trash") }
                }
                Card {
                    Text("Safety").font(.headline)
                    SafetyList()
                }
                NavigationLink { ResourcesView() } label: {
                    Label("Support and crisis resources", systemImage: "phone.fill").frame(maxWidth: .infinity, alignment: .leading).padding(14)
                        .background(Color.appCard, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
                Button("Run setup again") { model.settings.onboardingDone = false }.font(.subheadline)
                Text("Stillpoint is a wellness app. It is not a medical device and does not diagnose, treat, cure, or prevent any condition. All narration is computer-generated.")
                    .font(.caption).foregroundStyle(Color.appMuted)
            }
            .padding(16)
        }
        .navigationTitle("Settings")
        .confirmationDialog("Delete all your data?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete everything", role: .destructive) { model.deleteAllData(); exportURL = nil }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes your session history, ratings, notes, and stored Health readings from this device and from your iCloud. It can't be undone.")
        }
        .appPage()
    }

    private func prepareExport() {
        do { exportURL = try model.store.writeExportFile(); exportError = nil }
        catch { exportError = error.localizedDescription }
    }
}

struct ResourcesView: View {
    struct Item: Identifiable { let id = UUID(); let title: String; let detail: String; let link: String?; let linkLabel: String? }
    static let crisis = [
        Item(title: "In immediate danger", detail: "Call your local emergency number (911 in the US and Canada, 999 in the UK, 112 in the EU).", link: nil, linkLabel: nil),
        Item(title: "US and Canada: 988 Suicide & Crisis Lifeline", detail: "Call or text 988, any time.", link: "tel:988", linkLabel: "Call 988"),
        Item(title: "UK and Ireland: Samaritans", detail: "Call 116 123, any time.", link: "tel:116123", linkLabel: "Call 116 123"),
        Item(title: "Anywhere else", detail: "Find a helpline in your country.", link: "https://findahelpline.com", linkLabel: "findahelpline.com"),
    ]
    static let quitting = [
        Item(title: "US: 1-800-QUIT-NOW", detail: "Free coaching and, in many states, free nicotine replacement.", link: "tel:18007848669", linkLabel: "Call 1-800-784-8669"),
        Item(title: "Canada: Smokers' Helpline", detail: "Free support by phone, text, and online.", link: "tel:18663663667", linkLabel: "Call 1-866-366-3667"),
        Item(title: "UK: NHS Stop Smoking Services", detail: "Free local support and medication advice.", link: "https://www.nhs.uk/better-health/quit-smoking/", linkLabel: "nhs.uk/better-health/quit-smoking"),
        Item(title: "Your doctor or pharmacist", detail: "Ask about nicotine replacement, varenicline, or bupropion. Combining medication with support roughly doubles the chance of quitting.", link: nil, linkLabel: nil),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("This app is not a substitute for professional care. If you are struggling, please reach out.")
                    .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                section("If you are in distress", Self.crisis)
                section("Ongoing support", [Item(title: "Talk to a professional", detail: "A doctor, therapist, or counsellor can help with low mood, anxiety, sleep problems, and stress that doesn't lift.", link: nil, linkLabel: nil)])
                section("Help with quitting smoking", Self.quitting)
            }
            .padding(16)
        }
        .navigationTitle("Support").inlineTitle()
        .appPage()
    }

    private func section(_ title: String, _ items: [Item]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.title3.bold())
            ForEach(items) { i in
                Card {
                    Text(i.title).font(.headline)
                    Text(i.detail).font(.subheadline).foregroundStyle(Color.appMuted).fixedSize(horizontal: false, vertical: true)
                    if let l = i.link, let label = i.linkLabel, let url = URL(string: l) { Link(label, destination: url).font(.subheadline.bold()) }
                }
            }
        }
    }
}

/// Optional absorption questions (moved out of setup after user testing).
struct SuggestibilityCard: View {
    @Environment(AppModel.self) private var model
    @State private var answers = [Int?](repeating: nil, count: Suggestibility.items.count)
    @State private var open = false
    var body: some View {
        Card {
            DisclosureGroup(isExpanded: $open) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("People who become absorbed easily tend to respond more to hypnosis. A rough guide, not a test.")
                        .font(.caption).foregroundStyle(Color.appMuted)
                    ForEach(Suggestibility.items.indices, id: \.self) { i in
                        Text(Suggestibility.items[i]).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        Picker("Answer", selection: $answers[i]) {
                            Text("Never").tag(Int?.some(0)); Text("Rarely").tag(Int?.some(1)); Text("Sometimes").tag(Int?.some(2))
                            Text("Often").tag(Int?.some(3)); Text("Very often").tag(Int?.some(4))
                        }
                        .pickerStyle(.segmented)
                    }
                    if !answers.contains(nil) {
                        let level = Suggestibility.level(answers: answers.compactMap { $0 })
                        Text(Suggestibility.explanation(level)).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                            .onAppear { model.settings.suggestibility = level.rawValue }
                            .onChange(of: answers) { _, a in
                                if !a.contains(nil) { model.settings.suggestibility = Suggestibility.level(answers: a.compactMap { $0 }).rawValue }
                            }
                    }
                }
                .padding(.top, 8)
            } label: {
                Text(model.settings.suggestibility.isEmpty ? "Optional: how easily do you get absorbed?"
                     : "How easily you get absorbed: \(model.settings.suggestibility)").font(.headline)
            }
        }
    }
}
