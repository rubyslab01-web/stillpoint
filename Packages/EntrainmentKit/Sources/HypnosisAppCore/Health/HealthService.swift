import Foundation
#if os(iOS)
import HealthKit
#endif

/// The three Health data types the app can read. Each is requested separately, only when the
/// user switches it on, with its own plain-language explanation.
public enum HealthDataKind: String, CaseIterable, Identifiable, Sendable {
    case sleep, heartRate, hrv
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .sleep: return "Sleep stages"
        case .heartRate: return "Heart rate"
        case .hrv: return "Heart rate variability"
        }
    }
    public var explanation: String {
        switch self {
        case .sleep: return "Lets the app see how long you took to fall asleep and how much deep sleep you got after a Sleep session, so it can compare nights with and without beats. Needs an Apple Watch or another sleep tracker."
        case .heartRate: return "Lets the app see your average heart rate during a session, as a sign of how much you settled."
        case .hrv: return "Lets the app see heart rate variability readings taken around a session. Higher values usually go with a calmer body."
        }
    }
    public var settingsKey: String { "health.\(rawValue)" }
}

public struct SleepSummary: Equatable, Sendable {
    public var onsetMinutes: Double?
    public var deepMinutes: Double
    public var remMinutes: Double
    public var totalAsleepMinutes: Double
}

/// A sleep-stage interval, abstracted from HealthKit so the maths can be unit-tested.
public struct SleepInterval: Equatable, Sendable {
    public enum Stage: Sendable { case awake, core, deep, rem, unspecifiedAsleep, inBed }
    public var stage: Stage
    public var start: Date
    public var end: Date
    public init(stage: Stage, start: Date, end: Date) { self.stage = stage; self.start = start; self.end = end }
}

public enum SleepMath {
    public static func summarise(_ intervals: [SleepInterval], sessionStart: Date) -> SleepSummary? {
        let asleep = intervals.filter { [.core, .deep, .rem, .unspecifiedAsleep].contains($0.stage) }.sorted { $0.start < $1.start }
        guard let first = asleep.first else { return nil }
        func mins(_ s: SleepInterval.Stage) -> Double {
            intervals.filter { $0.stage == s }.reduce(0) { $0 + $1.end.timeIntervalSince($1.start) } / 60
        }
        let total = asleep.reduce(0) { $0 + $1.end.timeIntervalSince($1.start) } / 60
        let onset = first.start.timeIntervalSince(sessionStart) / 60
        return SleepSummary(onsetMinutes: onset >= 0 ? onset : 0, deepMinutes: mins(.deep), remMinutes: mins(.rem), totalAsleepMinutes: total)
    }
}

@MainActor
public final class HealthService {
    public init() {}

    #if os(iOS)
    private let store = HKHealthStore()
    public var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    private func type(for kind: HealthDataKind) -> HKObjectType {
        switch kind {
        case .sleep: return HKCategoryType(.sleepAnalysis)
        case .heartRate: return HKQuantityType(.heartRate)
        case .hrv: return HKQuantityType(.heartRateVariabilitySDNN)
        }
    }

    /// Requests read access for exactly one data type.
    public func requestAccess(_ kind: HealthDataKind) async -> Bool {
        guard isAvailable else { return false }
        do { try await store.requestAuthorization(toShare: [], read: [type(for: kind)]); return true }
        catch { return false }
    }

    public func sleepSummary(after sessionStart: Date) async -> SleepSummary? {
        guard isAvailable else { return nil }
        let end = min(Date(), sessionStart.addingTimeInterval(14 * 3600))
        let pred = HKQuery.predicateForSamples(withStart: sessionStart, end: end)
        let descriptor = HKSampleQueryDescriptor(predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: pred)],
                                                 sortDescriptors: [SortDescriptor(\.startDate)])
        guard let samples = try? await descriptor.result(for: store) else { return nil }
        let intervals: [SleepInterval] = samples.compactMap { s in
            guard let v = HKCategoryValueSleepAnalysis(rawValue: s.value) else { return nil }
            let stage: SleepInterval.Stage
            switch v {
            case .awake: stage = .awake
            case .asleepCore: stage = .core
            case .asleepDeep: stage = .deep
            case .asleepREM: stage = .rem
            case .asleepUnspecified: stage = .unspecifiedAsleep
            case .inBed: stage = .inBed
            @unknown default: return nil
            }
            return SleepInterval(stage: stage, start: s.startDate, end: s.endDate)
        }
        return SleepMath.summarise(intervals, sessionStart: sessionStart)
    }

    private func average(_ id: HKQuantityTypeIdentifier, unit: HKUnit, from: Date, to: Date) async -> Double? {
        let pred = HKQuery.predicateForSamples(withStart: from, end: to)
        let descriptor = HKSampleQueryDescriptor(predicates: [.quantitySample(type: HKQuantityType(id), predicate: pred)], sortDescriptors: [])
        guard let samples = try? await descriptor.result(for: store), !samples.isEmpty else { return nil }
        return samples.reduce(0) { $0 + $1.quantity.doubleValue(for: unit) } / Double(samples.count)
    }

    public func averageHeartRate(from: Date, to: Date) async -> Double? {
        await average(.heartRate, unit: HKUnit.count().unitDivided(by: .minute()), from: from, to: to)
    }

    /// HRV samples are sparse, so look from the session start to 30 minutes after it ends.
    public func hrv(from: Date, to: Date) async -> Double? {
        await average(.heartRateVariabilitySDNN, unit: .secondUnit(with: .milli), from: from, to: to.addingTimeInterval(1800))
    }
    #else
    public var isAvailable: Bool { false }
    public func requestAccess(_ kind: HealthDataKind) async -> Bool { false }
    public func sleepSummary(after sessionStart: Date) async -> SleepSummary? { nil }
    public func averageHeartRate(from: Date, to: Date) async -> Double? { nil }
    public func hrv(from: Date, to: Date) async -> Double? { nil }
    #endif
}
