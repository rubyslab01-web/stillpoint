import SwiftUI
import EntrainmentKit

extension Color {
    init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&v)
        self.init(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
    static let appBackground = Color(hex: "#0E1220")
    static let appCard = Color(hex: "#1A2033")
    static let appMuted = Color.white.opacity(0.62)
}

extension ModuleInfo { var color: Color { Color(hex: colorHex) } }

struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.appCard, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var color: Color = .accentColor
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(color.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .foregroundStyle(.white)
    }
}

extension View {
    /// Dark page background used by every screen.
    func appPage() -> some View {
        self.scrollContentBackground(.hidden)
            .background(Color.appBackground.ignoresSafeArea())
            .preferredColorScheme(.dark)
    }

    @ViewBuilder func inlineTitle() -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    /// Full-screen on iPhone; a sheet on the Mac development build.
    @ViewBuilder func cover<Item: Identifiable, C: View>(item: Binding<Item?>, @ViewBuilder content: @escaping (Item) -> C) -> some View {
        #if os(iOS)
        self.fullScreenCover(item: item, content: content)
        #else
        self.sheet(item: item) { content($0).frame(minWidth: 420, minHeight: 700) }
        #endif
    }

    @ViewBuilder func cover<C: View>(isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> C) -> some View {
        #if os(iOS)
        self.fullScreenCover(isPresented: isPresented, content: content)
        #else
        self.sheet(isPresented: isPresented) { content().frame(minWidth: 420, minHeight: 700) }
        #endif
    }
}

func formatDuration(_ seconds: Double) -> String {
    let m = Int((seconds / 60).rounded())
    if m >= 60 { return "\(m / 60) h \(m % 60) min".replacingOccurrences(of: " 0 min", with: "") }
    return "\(max(m, 1)) min"
}

func clock(_ seconds: Double) -> String {
    let s = Int(max(0, seconds))
    return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
}

/// 0–10 self-rating with labelled ends. Large tap targets; works one-handed.
struct RatingInput: View {
    let prompt: SessionDefinition.RatingPrompt
    @Binding var value: Int?
    var tint: Color = .accentColor
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(prompt.question).font(compact ? .subheadline : .headline).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 4) {
                ForEach(Array(prompt.range), id: \.self) { n in
                    Button {
                        value = n
                    } label: {
                        Text("\(n)")
                            .font(.callout.monospacedDigit())
                            .frame(maxWidth: .infinity, minHeight: compact ? 36 : 44)
                            .background(value == n ? tint : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(n)")
                    .accessibilityAddTraits(value == n ? .isSelected : [])
                }
            }
            HStack {
                Text(prompt.minLabel); Spacer(); Text(prompt.maxLabel)
            }
            .font(.caption).foregroundStyle(Color.appMuted)
        }
    }
}

/// Volume slider capped at the enforced maximum.
struct VolumeControl: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                Image(systemName: "speaker.fill").foregroundStyle(Color.appMuted)
                Slider(value: Binding(get: { model.settings.volume }, set: { model.setVolume($0) }),
                       in: 0.05...VolumePolicy.maxGain)
                    .accessibilityLabel("Session volume")
                Image(systemName: "speaker.wave.2.fill").foregroundStyle(Color.appMuted)
            }
            if model.player.route.headphonesConnected && model.player.route.systemVolume > VolumePolicy.highSystemVolume {
                Label("Your phone volume is high. Turn it down for comfortable, safe listening.", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(.yellow)
            }
        }
    }
}

struct SafetyList: View {
    static let warnings: [(String, String)] = [
        ("car.fill", "Never listen while driving, operating machinery, or doing anything that needs your full attention."),
        ("bolt.heart.fill", "If you have epilepsy or a seizure disorder, talk to your doctor first. Pulsing tones can be a trigger for some people."),
        ("ear.fill", "Keep the volume low. The beats work quietly, and the app limits its own maximum volume."),
        ("cross.case.fill", "This is a wellness app, not medical treatment. It does not diagnose, treat, or cure anything."),
        ("brain.head.profile", "If you have a history of psychosis, dissociation, or severe trauma, check with a clinician before using hypnosis."),
    ]
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Self.warnings, id: \.1) { icon, text in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: icon).frame(width: 26).foregroundStyle(.orange)
                    Text(text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
