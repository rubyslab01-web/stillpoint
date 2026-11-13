import SwiftUI
import EntrainmentKit

struct PlayerView: View {
    @Environment(AppModel.self) private var model
    @State private var confirmStop = false

    var body: some View {
        let player = model.player
        let session = model.active?.session
        let module = session.flatMap { model.library.module($0.module) }
        let tint = module?.color ?? .accentColor
        let inBed = player.currentTime >= player.sessionDuration && player.duration > player.sessionDuration
        let shown = inBed ? player.duration : player.sessionDuration
        let progress = shown > 0 ? min(1, player.currentTime / shown) : 0

        VStack(spacing: 22) {
            HStack {
                Label(player.beatMode == .binaural ? "Headphones" : "Speaker mode", systemImage: player.beatMode == .binaural ? "headphones" : "speaker.wave.2.fill")
                    .font(.footnote).foregroundStyle(Color.appMuted)
                Spacer()
                if let module { Label(module.title, systemImage: module.icon).font(.footnote).foregroundStyle(tint) }
            }

            Spacer(minLength: 0)

            ZStack {
                Circle().stroke(Color.white.opacity(0.08), lineWidth: 10)
                Circle().trim(from: 0, to: progress)
                    .stroke(tint, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 0.3), value: progress)
                VStack(spacing: 6) {
                    Text(player.phaseName).font(.title3.weight(.medium)).multilineTextAlignment(.center)
                    Text(clock(max(0, shown - player.currentTime))).font(.system(size: 40, weight: .light).monospacedDigit())
                    Text(inBed ? "of noise remaining" : "remaining").font(.footnote).foregroundStyle(Color.appMuted)
                }
                .padding(24)
            }
            .frame(maxWidth: 300, maxHeight: 300)
            .accessibilityElement(children: .combine)

            Text(session?.title ?? player.title).font(.title2.bold())

            if player.pausedForRouteLoss {
                Label("Headphones disconnected, so the session was paused. Reconnect them, or press play to continue with pulsed tones on the speaker.",
                      systemImage: "headphones").font(.footnote).foregroundStyle(.yellow).multilineTextAlignment(.center)
            } else if player.state == .interrupted {
                Label("Paused by another app or a call. It will resume from the same place.", systemImage: "pause.circle")
                    .font(.footnote).foregroundStyle(Color.appMuted).multilineTextAlignment(.center)
            } else if player.beatMode == .binaural && player.route.spatialAudioActive {
                Label("Spatial Audio is on and weakens the beats. Turn it off in Control Center (touch and hold the volume slider).",
                      systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(.yellow).multilineTextAlignment(.center)
            }

            // Rescue sessions start instantly; the "before" rating is offered while playing.
            if let session, session.kind == "rescue", let p = session.ratings.first(where: \.before), model.beforeRating(p.id) == nil,
               player.currentTime < 45 {
                RatingInput(prompt: p, value: Binding(get: { model.beforeRating(p.id) }, set: { if let v = $0 { model.setBeforeRating(p.id, v) } }),
                            tint: tint, compact: true)
                    .padding(12)
                    .background(Color.appCard, in: RoundedRectangle(cornerRadius: 14))
            }

            Spacer(minLength: 0)

            HStack(spacing: 44) {
                Button { confirmStop = true } label: {
                    Image(systemName: "stop.fill").font(.title2).frame(width: 60, height: 60)
                        .background(Color.white.opacity(0.1), in: Circle())
                }
                .accessibilityLabel("End session")
                Button { player.togglePlayPause() } label: {
                    Image(systemName: player.state == .playing ? "pause.fill" : "play.fill").font(.largeTitle).frame(width: 84, height: 84)
                        .background(tint, in: Circle())
                }
                .accessibilityLabel(player.state == .playing ? "Pause" : "Play")
                Color.clear.frame(width: 60, height: 60)
            }
            .buttonStyle(.plain).foregroundStyle(.white)

            VolumeControl()

            if let e = player.lastError {
                Text(e).font(.caption).foregroundStyle(.red)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(colors: [tint.opacity(0.28), Color.appBackground], startPoint: .top, endPoint: .center).ignoresSafeArea()
        )
        .background(Color.appBackground.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .confirmationDialog("End this session?", isPresented: $confirmStop, titleVisibility: .visible) {
            Button("End session", role: .destructive) { player.stopWithFade() }
            Button("Keep listening", role: .cancel) {}
        } message: {
            Text("The sound will fade out gently.")
        }
    }
}

/// After-session ratings and an optional note.
struct PostSessionView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let active: AppModel.ActiveSession
    @State private var ratings: [String: Int] = [:]
    @State private var note = ""

    var body: some View {
        let module = model.library.module(active.session.module)
        let tint = module?.color ?? .accentColor
        let prompts = active.session.ratings.filter { $0.after && $0.timing == nil }
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Welcome back. Take a moment before you move on.").font(.subheadline).foregroundStyle(Color.appMuted)
                    ForEach(prompts) { p in
                        Card { RatingInput(prompt: p, value: Binding(get: { ratings[p.id] }, set: { ratings[p.id] = $0 }), tint: tint) }
                    }
                    Card {
                        Text(active.session.module == "gratitude" ? "One thing you noticed (optional)" : "A note for yourself (optional)").font(.headline)
                        TextField("Write a line…", text: $note, axis: .vertical).lineLimit(2...5).textFieldStyle(.roundedBorder)
                    }
                    if module?.showCessationSupport == true {
                        Text("Now do one small thing: drink some water, move for a minute, or message someone.")
                            .font(.footnote).foregroundStyle(Color.appMuted)
                    }
                    Button("Save") {
                        model.saveAfterRatings(logID: active.logID, ratings: ratings, note: note.trimmingCharacters(in: .whitespacesAndNewlines))
                        dismiss()
                    }
                    .buttonStyle(PrimaryButtonStyle(color: tint))
                    if module?.showCrisisResources == true {
                        NavigationLink("Feeling low or struggling? Find support") { ResourcesView() }.font(.footnote)
                    }
                }
                .padding(16)
            }
            .navigationTitle("How do you feel?").inlineTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Skip") { dismiss() } } }
            .appPage()
        }
    }
}

/// Next-morning ratings for a sleep session.
struct MorningCheckInView: View {
    @Environment(AppModel.self) private var model
    let record: SessionRecord
    @State private var ratings: [String: Int] = [:]

    var body: some View {
        let session = model.library.session(record.sessionID)
        let prompts = session?.ratings.filter { $0.timing == "nextMorning" } ?? []
        let tint = model.library.module(record.moduleID)?.color ?? .accentColor
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("About your night after \(record.sessionTitle) on \(record.startedAt.formatted(date: .abbreviated, time: .shortened)).")
                        .font(.subheadline).foregroundStyle(Color.appMuted)
                    ForEach(prompts) { p in
                        Card { RatingInput(prompt: p, value: Binding(get: { ratings[p.id] }, set: { ratings[p.id] = $0 }), tint: tint) }
                    }
                    Button("Save") {
                        model.saveAfterRatings(logID: record.id, ratings: ratings, note: "")
                        model.pendingMorning = nil
                    }
                    .buttonStyle(PrimaryButtonStyle(color: tint))
                    .disabled(ratings.isEmpty)
                }
                .padding(16)
            }
            .navigationTitle("Good morning").inlineTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Skip") { model.dismissMorning(logID: record.id) } } }
            .appPage()
        }
        .interactiveDismissDisabled()
    }
}
