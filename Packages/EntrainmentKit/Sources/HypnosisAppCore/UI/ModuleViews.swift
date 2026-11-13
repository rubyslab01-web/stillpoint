import SwiftUI
import EntrainmentKit

struct ModuleDetailView: View {
    @Environment(AppModel.self) private var model
    let module: ModuleInfo
    @State private var preparing: SessionDefinition?

    var body: some View {
        let sessions = model.library.sessions(in: module.id)
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(module.about).font(.body).fixedSize(horizontal: false, vertical: true)

                ForEach(["main", "rescue"], id: \.self) { kind in
                    let group = sessions.filter { $0.kind == kind }
                    if !group.isEmpty {
                        if kind == "rescue" {
                            Text("Rescue sessions").font(.title3.bold()).padding(.top, 6)
                            Text("Open one the moment a craving hits. They start straight away and you can keep your eyes open.")
                                .font(.subheadline).foregroundStyle(Color.appMuted)
                        }
                        ForEach(group) { s in
                            Button {
                                if s.kind == "rescue" { model.start(s) } else { preparing = s }
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "play.circle.fill").font(.system(size: 38)).foregroundStyle(module.color)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(s.title).font(.headline)
                                        Text(s.subtitle).font(.subheadline).foregroundStyle(Color.appMuted).multilineTextAlignment(.leading)
                                    }
                                    Spacer()
                                    Text(formatDuration(model.library.duration(of: s))).font(.subheadline.monospacedDigit()).foregroundStyle(Color.appMuted)
                                }
                                .padding(14)
                                .background(Color.appCard, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                if module.showCessationSupport {
                    Card {
                        Label("Use this with proven quitting methods", systemImage: "cross.case.fill").font(.headline)
                        Text("You are far more likely to quit for good if you combine support like this with nicotine replacement or prescription medication, and advice from a doctor, pharmacist, or quit line. This app adds to those. It does not replace them.")
                            .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        NavigationLink("Quit lines and support") { ResourcesView() }.font(.subheadline.bold())
                    }
                }

                Card {
                    Label("What the research says", systemImage: "book.closed.fill").font(.headline)
                    Text(module.honesty).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }

                if !module.cautions.isEmpty {
                    Card {
                        Label("Good to know", systemImage: "info.circle.fill").font(.headline)
                        ForEach(module.cautions, id: \.self) { c in
                            Text("• " + c).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                NavigationLink { ModuleProgressView(module: module) } label: {
                    Label("History and progress", systemImage: "chart.line.uptrend.xyaxis")
                        .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                        .background(Color.appCard, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)

                if module.showCrisisResources {
                    NavigationLink { ResourcesView() } label: {
                        Label("Need to talk to someone? Support and crisis lines", systemImage: "phone.fill")
                            .font(.footnote).foregroundStyle(Color.appMuted)
                    }
                    .padding(.top, 4)
                }
            }
            .padding(16)
        }
        .navigationTitle(module.title)
        .sheet(item: $preparing) { s in
            SessionPrepView(module: module, session: s).environment(model)
        }
        .appPage()
    }
}

/// Before a main session: output check, pre-ratings, options, then Start.
struct SessionPrepView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let module: ModuleInfo
    let session: SessionDefinition
    @State private var ratings: [String: Int] = [:]
    @State private var bedMinutes = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    OutputStatusCard()

                    ForEach(session.ratings.filter(\.before)) { p in
                        Card {
                            RatingInput(prompt: p, value: Binding(get: { ratings[p.id] }, set: { ratings[p.id] = $0 }), tint: module.color)
                        }
                    }

                    if let bed = session.noiseBed {
                        Card {
                            Text("Noise through the night").font(.headline)
                            Text("After the session ends, keep quiet noise playing. The beats still fade out by 90 minutes.")
                                .font(.subheadline).foregroundStyle(Color.appMuted)
                            Picker("Noise bed", selection: $bedMinutes) {
                                ForEach(bed.optionsMinutes, id: \.self) { m in
                                    Text(m == 0 ? "Off" : "\(m / 60) h").tag(m)
                                }
                            }
                            .pickerStyle(.segmented).labelsHidden()
                        }
                    }

                    Card {
                        Text("Volume").font(.headline)
                        VolumeControl()
                    }

                    if model.settings.experimentEnabled {
                        Label("Self-experiment is on: this session may or may not include beats. You won't be told which.", systemImage: "dice.fill")
                            .font(.footnote).foregroundStyle(Color.appMuted)
                    }
                    Label(session.awake ? "Sit or lie somewhere safe. Never use while driving." : "Use in bed, ready to sleep. Never use while driving.",
                          systemImage: "exclamationmark.shield.fill")
                        .font(.footnote).foregroundStyle(Color.appMuted)

                    Button("Start \(session.title)") {
                        model.start(session, ratingsBefore: ratings, noiseBedMinutes: bedMinutes)
                        dismiss()
                    }
                    .buttonStyle(PrimaryButtonStyle(color: module.color))
                }
                .padding(16)
            }
            .navigationTitle(session.title).inlineTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear { bedMinutes = session.noiseBed?.defaultMinutes ?? 0; model.player.refreshRoute() }
            .appPage()
        }
    }
}

/// Shows where sound is going and what that means for the beats.
struct OutputStatusCard: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let route = model.player.route
        let binaural = route.preferredMode(speakerModeForced: model.settings.speakerMode) == .binaural
        Card {
            Label(binaural ? "Headphones connected: binaural beats" : (route.headphonesConnected ? "Speaker mode: pulsed tones" : "No headphones: pulsed tones"),
                  systemImage: binaural ? "headphones" : "speaker.wave.2.fill").font(.headline)
            Text(binaural ? "Each ear gets a slightly different tone. Wear both earbuds, left in left."
                 : "Binaural beats need headphones. Without them the app uses gently pulsing (isochronic) tones that work on a speaker.")
                .font(.subheadline).foregroundStyle(Color.appMuted).fixedSize(horizontal: false, vertical: true)
            if route.headphonesConnected {
                Toggle("Use speaker mode anyway", isOn: Binding(get: { model.settings.speakerMode }, set: { model.setSpeakerMode($0) }))
                    .font(.subheadline)
            }
            if binaural && route.spatialAudioActive {
                Label("Spatial Audio is on. It blends the left and right channels and weakens the beats. Open Control Center, touch and hold the volume slider, and set Spatial Audio to Off (and Head Tracking off).",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote).foregroundStyle(.yellow).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
