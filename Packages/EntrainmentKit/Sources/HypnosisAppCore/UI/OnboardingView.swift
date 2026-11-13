import SwiftUI
import EntrainmentKit

/// Two pages (simplified after user testing: "too many setup questions"): welcome with safety,
/// then a sound check (headphones and volume). The absorption questions are optional in Settings;
/// the self-experiment is on by default and explained in Settings, as are the Health switches.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var step = 0
    @State private var acknowledged = false
    @State private var heardLeft: Bool?
    @State private var heardRight: Bool?
    @State private var playingCalibration = false
    private let lastStep = 1

    var body: some View {
        VStack(spacing: 0) {
            ProgressView(value: Double(step), total: Double(lastStep)).padding(.horizontal, 20).padding(.top, 12)
                .accessibilityLabel("Setup progress")
            ScrollView {
                VStack(alignment: .leading, spacing: 18) { page }.padding(20).frame(maxWidth: 600, alignment: .leading)
            }
            HStack {
                if step > 0 { Button("Back") { go(step - 1) }.padding(.horizontal, 8) }
                Button(step == lastStep ? "Get started" : "Continue") {
                    if step == lastStep { finish() } else { go(step + 1) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canContinue)
                .opacity(canContinue ? 1 : 0.4)
            }
            .padding(20)
        }
        .appPage()
        .onDisappear { model.tones.stop() }
    }

    private var canContinue: Bool { step == 0 ? acknowledged : true }

    private func go(_ s: Int) {
        model.tones.stop(); playingCalibration = false
        step = s
        if s == 1 { model.player.refreshRoute() }
    }

    private func finish() {
        model.tones.stop()
        model.settings.onboardingDone = true
    }

    @ViewBuilder private var page: some View {
        switch step {
        case 0:
            Image(systemName: "waveform.circle.fill").font(.system(size: 64)).foregroundStyle(.tint)
            Text("Welcome to Stillpoint").font(.largeTitle.bold())
            Text("Guided hypnosis and breathing over gentle nature sounds and quiet beat tones, for sleep, quitting smoking, gratitude, inner coherence, and loving compassion.")
            Card { SafetyList() }
            Toggle(isOn: $acknowledged) { Text("I understand").font(.headline) }
        default:
            Text("Sound check").font(.title.bold())
            OutputStatusCard()
            Card {
                Text("Put on your headphones and play each tone. You should hear it in one ear only.").font(.subheadline)
                earRow("Left ear", .leftOnly, $heardLeft)
                earRow("Right ear", .rightOnly, $heardRight)
                if heardLeft == false || heardRight == false {
                    Label("If a tone was in the wrong ear, swap your earbuds. If you heard it in both ears, turn off Spatial Audio and Mono Audio.",
                          systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(.yellow).fixedSize(horizontal: false, vertical: true)
                }
            }
            Card {
                Button {
                    playingCalibration.toggle()
                    if playingCalibration { model.tones.play(.calibration, userGain: model.settings.volume) } else { model.tones.stop() }
                } label: {
                    Label(playingCalibration ? "Stop sample" : "Play a sample", systemImage: playingCalibration ? "stop.fill" : "play.fill").font(.headline)
                }
                VolumeControl()
                Text("Set it so the background is soft and easy to ignore. You can change this later in Settings.").font(.caption).foregroundStyle(Color.appMuted)
            }
        }
    }

    private func earRow(_ label: String, _ signal: TestTonePlayer.Signal, _ heard: Binding<Bool?>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button {
                    model.tones.play(signal, userGain: model.settings.volume)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { model.tones.stop() }
                } label: { Label("Play \(label.lowercased())", systemImage: "play.circle.fill").font(.headline) }
                Spacer()
            }
            HStack {
                Text("Heard only in my \(label.lowercased())?").font(.footnote).foregroundStyle(Color.appMuted)
                Spacer()
                Button("Yes") { heard.wrappedValue = true }.buttonStyle(.bordered).tint(heard.wrappedValue == true ? .green : .gray)
                Button("No") { heard.wrappedValue = false }.buttonStyle(.bordered).tint(heard.wrappedValue == false ? .orange : .gray)
            }
        }
    }
}

/// One switch per Health data type, each with its own explanation and its own permission request.
struct HealthPermissionsCard: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        Card {
            Label("Apple Health (optional)", systemImage: "heart.text.square.fill").font(.headline)
            if model.health.isAvailable {
                Text("Each switch asks for read-only access to one kind of data. The app never writes to Health.")
                    .font(.footnote).foregroundStyle(Color.appMuted)
                ForEach(HealthDataKind.allCases) { kind in
                    Toggle(isOn: Binding(get: { model.settings.isHealthOn(kind) },
                                         set: { on in Task { await model.setHealth(kind, on: on) } })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(kind.title).font(.subheadline.bold())
                            Text(kind.explanation).font(.caption).foregroundStyle(Color.appMuted).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                Text("If you later change your mind, you can also remove access in the Health app under Sharing › Apps.")
                    .font(.caption).foregroundStyle(Color.appMuted)
            } else {
                Text("Health data isn't available on this device.").font(.subheadline).foregroundStyle(Color.appMuted)
            }
        }
    }
}
