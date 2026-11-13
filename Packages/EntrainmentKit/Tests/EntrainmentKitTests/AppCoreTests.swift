import Testing
import Foundation
@testable import EntrainmentKit
@testable import HypnosisAppCore

struct SeededRNG: RandomNumberGenerator {
    var s: UInt64
    mutating func next() -> UInt64 { s = s &* 6364136223846793005 &+ 1442695040888963407; return s }
}

@Suite struct ExperimentTests {
    @Test func assignmentStaysBalancedAndIsNotPredictable() {
        var rng = SeededRNG(s: 42)
        var on = 0, off = 0, sequence: [Bool] = []
        for _ in 0..<200 {
            let b = Experiment.assignBeats(withBeats: on, withoutBeats: off, using: &rng)
            sequence.append(b); if b { on += 1 } else { off += 1 }
            #expect(abs(on - off) <= 2)
        }
        #expect(on > 80 && off > 80)
        // Not a simple alternation: there are runs of two.
        let hasRun = zip(sequence, sequence.dropFirst()).contains { $0 == $1 }
        #expect(hasRun)
    }

    @Test func forcedArmWhenUnbalanced() {
        var rng = SeededRNG(s: 1)
        #expect(Experiment.assignBeats(withBeats: 5, withoutBeats: 3, using: &rng) == false)
        #expect(Experiment.assignBeats(withBeats: 1, withoutBeats: 3, using: &rng) == true)
    }

    let craving = SessionDefinition.RatingPrompt(id: "craving", question: "", minLabel: "", maxLabel: "", range: 0...10,
                                                 before: true, after: true, higherIsBetter: false, timing: nil)
    let quality = SessionDefinition.RatingPrompt(id: "quality", question: "", minLabel: "", maxLabel: "", range: 0...10,
                                                 before: false, after: true, higherIsBetter: true, timing: "nextMorning")

    @Test func scoreIsSignedSoPositiveMeansBetter() {
        let r = SessionRecord(moduleID: "quit-smoking", beatsEnabled: true, ratingsBefore: ["craving": 8], ratingsAfter: ["craving": 3])
        #expect(Experiment.score(r, prompt: craving) == 5)   // craving dropped 5 → improvement of 5
        let s = SessionRecord(moduleID: "sleep", beatsEnabled: true, ratingsAfter: ["quality": 7])
        #expect(Experiment.score(s, prompt: quality) == 7)
        #expect(Experiment.score(SessionRecord(moduleID: "x", beatsEnabled: true, ratingsAfter: ["craving": 3]), prompt: craving) == nil)
    }

    @Test func resultsStayHiddenUntilEnoughSessionsInEachArm() {
        let r = Experiment.compare(metric: "m", unit: "", beats: [1, 2, 3, 4, 5, 6], noBeats: [1, 2, 3])
        #expect(r.verdict == .collecting(needed: 2))
        #expect(!r.revealed)
    }

    @Test func verdicts() {
        #expect(Experiment.compare(metric: "m", unit: "", beats: [5, 6, 5, 6, 5], noBeats: [2, 3, 2, 3, 2]).verdict == .beatsHelp)
        #expect(Experiment.compare(metric: "m", unit: "", beats: [2, 3, 2, 3, 2], noBeats: [5, 6, 5, 6, 5]).verdict == .beatsHurt)
        #expect(Experiment.compare(metric: "m", unit: "", beats: [1, 5, 3, 4, 2], noBeats: [2, 4, 3, 5, 1]).verdict == .noClearDifference)
        let same = Experiment.compare(metric: "m", unit: "", beats: [3, 3, 3, 3, 3], noBeats: [3, 3, 3, 3, 3])
        #expect(same.verdict == .noClearDifference && same.effect == 0)
    }

    @Test func moduleResultsUseOnlyExperimentSessionsOfThatModule() {
        var h: [SessionRecord] = []
        for i in 0..<5 {
            h.append(SessionRecord(moduleID: "quit-smoking", beatsEnabled: true, ratingsBefore: ["craving": 8], ratingsAfter: ["craving": 2 + i % 2]))
            h.append(SessionRecord(moduleID: "quit-smoking", beatsEnabled: false, ratingsBefore: ["craving": 8], ratingsAfter: ["craving": 6 + i % 2]))
            h.append(SessionRecord(moduleID: "sleep", beatsEnabled: true, ratingsAfter: ["quality": 1]))
            h.append(SessionRecord(moduleID: "quit-smoking", beatsEnabled: false, inExperiment: false, ratingsBefore: ["craving": 8], ratingsAfter: ["craving": 0]))
        }
        let res = Experiment.results(history: h, moduleID: "quit-smoking", prompts: [craving], primary: "craving")
        #expect(res.count == 1)
        #expect(res[0].withBeats.n == 5 && res[0].withoutBeats.n == 5)
        #expect(res[0].verdict == .beatsHelp)
        #expect(abs(res[0].withBeats.mean - 5.6) < 1e-9)
    }
}

@Suite struct OnboardingLogicTests {
    @Test func suggestibilityLevels() {
        #expect(Suggestibility.level(answers: [0, 1, 1, 0, 1]) == .lower)
        #expect(Suggestibility.level(answers: [2, 2, 2, 2, 2]) == .medium)
        #expect(Suggestibility.level(answers: [4, 3, 4, 3, 3]) == .higher)
        #expect(Suggestibility.items.count == 5)
    }

    @Test func volumeIsCapped() {
        #expect(VolumePolicy.clamp(1.0) == VolumePolicy.maxGain)
        #expect(VolumePolicy.clamp(-1) == 0.05)
        #expect(VolumePolicy.maxGain < 1)
        // At the cap, a full-scale voice peak (-1.5 dBFS after normalisation) stays below the soft-clip knee.
        #expect(VolumePolicy.maxGain * pow(10, -1.5 / 20) < 0.8)
    }
}

@Suite struct SleepMathTests {
    @Test func summarisesStagesAndOnset() {
        let t0 = Date(timeIntervalSince1970: 1_000_000)
        func iv(_ s: SleepInterval.Stage, _ a: Double, _ b: Double) -> SleepInterval {
            SleepInterval(stage: s, start: t0.addingTimeInterval(a * 60), end: t0.addingTimeInterval(b * 60))
        }
        let s = SleepMath.summarise([iv(.inBed, 0, 480), iv(.awake, 0, 18), iv(.core, 18, 60), iv(.deep, 60, 110),
                                     iv(.rem, 110, 130), iv(.awake, 130, 135), iv(.core, 135, 400)], sessionStart: t0)
        #expect(s?.onsetMinutes == 18)
        #expect(s?.deepMinutes == 50)
        #expect(s?.remMinutes == 20)
        #expect(s?.totalAsleepMinutes == 377.0)
        #expect(SleepMath.summarise([iv(.inBed, 0, 100)], sessionStart: t0) == nil)
    }
}

@MainActor
@Suite struct DataStoreTests {
    @Test func saveExportAndDeleteAll() throws {
        let store = DataStore(inMemory: true)
        #expect(store.loadError == nil)
        #expect(!store.usingCloud)
        let log = store.newLog(sessionID: "qs-rescue-2", moduleID: "quit-smoking", sessionTitle: "Breathe Through",
                               plannedSeconds: 110, beatsEnabled: false, inExperiment: true, beatMode: "isochronic")
        log.ratingsBefore = ["craving": 8]
        log.ratingsAfter = ["craving": 3]
        log.note = "walked instead"
        log.sleepDeepMinutes = 42
        store.save()
        #expect(store.allLogs().count == 1)
        let rec = store.allLogs()[0].record
        #expect(rec.ratingsBefore == ["craving": 8] && rec.ratingsAfter == ["craving": 3])
        #expect(rec.beatsEnabled == false && rec.sleepDeepMinutes == 42 && rec.avgHeartRate == nil)

        let dec = JSONDecoder(); dec.dateDecodingStrategy = .iso8601
        let export = try dec.decode(DataExport.self, from: store.exportJSON())
        #expect(export.sessions.count == 1)
        #expect(export.sessions[0].note == "walked instead")

        store.deleteAll()
        #expect(store.allLogs().isEmpty)
    }

    @Test func libraryLoadsAllFiveModulesWithoutProblems() {
        let lib = ContentLibrary.load()
        #expect(lib.problems.isEmpty, "\(lib.problems)")
        #expect(lib.modules.map(\.id) == ["sleep", "quit-smoking", "gratitude", "inner-coherence", "loving-compassion"])
        for m in lib.modules {
            let sessions = lib.sessions(in: m.id)
            #expect(!sessions.isEmpty)
            let hasPrimary = sessions.flatMap(\.ratings).contains { $0.id == m.primaryRating }
            #expect(hasPrimary, "\(m.id) primary rating missing")
            let awakeMatches = sessions.allSatisfy { $0.awake == m.awake }
            #expect(awakeMatches)
        }
        #expect(lib.sessions(in: "quit-smoking").filter { $0.kind == "rescue" }.count == 3)
        #expect(lib.module("quit-smoking")?.showCessationSupport == true)
        let moodModulesHaveResources = lib.modules.filter { $0.id != "sleep" }.allSatisfy { $0.showCrisisResources }
        #expect(moodModulesHaveResources)
    }

    @Test func modelRecordsMorningRatingsAndDeletesEverything() {
        let defaults = UserDefaults(suiteName: "test-\(UUID().uuidString)")!
        let store = DataStore(inMemory: true)
        let model = AppModel(library: .load(), store: store, settings: AppSettings(defaults: defaults))
        let log = store.newLog(sessionID: "sleep-deep", moduleID: "sleep", sessionTitle: "Deep Sleep", plannedSeconds: 5400,
                               beatsEnabled: true, inExperiment: true, beatMode: "binaural", startedAt: Date().addingTimeInterval(-8 * 3600))
        log.awaitingMorningRatings = true
        store.save(); model.reload()
        model.checkMorning()
        #expect(model.pendingMorning?.id == log.id)
        model.saveAfterRatings(logID: log.id!, ratings: ["quality": 7, "onset": 6], note: "")
        model.reload()
        #expect(model.records[0].ratingsAfter == ["quality": 7, "onset": 6])
        #expect(model.records[0].awaitingMorningRatings == false)
        #expect(model.isRevealed(model.library.module("sleep")!) == false)   // blinded until enough data
        model.settings.onboardingDone = true
        model.deleteAllData()
        #expect(model.records.isEmpty && model.settings.onboardingDone == false)
    }
}
