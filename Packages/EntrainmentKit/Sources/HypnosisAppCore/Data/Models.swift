import Foundation
import CoreData
import CloudKit

/// One played session. This is the only personal data the app stores. Every attribute is
/// optional or has a default and there are no unique constraints, as CloudKit sync requires.
@objc(SessionLog)
public final class SessionLog: NSManagedObject {
    @NSManaged public var id: UUID?
    @NSManaged public var sessionID: String
    @NSManaged public var moduleID: String
    @NSManaged public var sessionTitle: String
    @NSManaged public var startedAt: Date?
    @NSManaged public var plannedSeconds: Double
    @NSManaged public var completedSeconds: Double
    @NSManaged public var finished: Bool
    /// Whether the beat layer actually played (the blinded self-experiment condition).
    @NSManaged public var beatsEnabled: Bool
    /// True when the condition was randomly assigned (self-experiment on).
    @NSManaged public var inExperiment: Bool
    @NSManaged public var beatMode: String
    @NSManaged public var noiseBedMinutes: Int64
    @NSManaged public var ratingsBeforeData: Data?
    @NSManaged public var ratingsAfterData: Data?
    /// Sleep sessions: "after" ratings are collected the next morning.
    @NSManaged public var awaitingMorningRatings: Bool
    @NSManaged public var note: String
    // Apple Health readings (only filled when the user granted that data type).
    @NSManaged public var avgHeartRate: NSNumber?
    @NSManaged public var hrvSDNN: NSNumber?
    @NSManaged public var sleepOnsetMinutes: NSNumber?
    @NSManaged public var sleepDeepMinutes: NSNumber?
    @NSManaged public var sleepRemMinutes: NSNumber?
    @NSManaged public var sleepTotalMinutes: NSNumber?

    public var ratingsBefore: [String: Int] {
        get { Self.decode(ratingsBeforeData) }
        set { ratingsBeforeData = try? JSONEncoder().encode(newValue) }
    }
    public var ratingsAfter: [String: Int] {
        get { Self.decode(ratingsAfterData) }
        set { ratingsAfterData = try? JSONEncoder().encode(newValue) }
    }
    static func decode(_ d: Data?) -> [String: Int] {
        guard let d else { return [:] }
        return (try? JSONDecoder().decode([String: Int].self, from: d)) ?? [:]
    }

    /// Plain value snapshot for the UI, analysis and export.
    public var record: SessionRecord {
        SessionRecord(id: id ?? UUID(), sessionID: sessionID, moduleID: moduleID, sessionTitle: sessionTitle,
                      startedAt: startedAt ?? .distantPast, plannedSeconds: plannedSeconds, completedSeconds: completedSeconds,
                      finished: finished, beatsEnabled: beatsEnabled, inExperiment: inExperiment, beatMode: beatMode,
                      noiseBedMinutes: Int(noiseBedMinutes), ratingsBefore: ratingsBefore, ratingsAfter: ratingsAfter, note: note,
                      avgHeartRate: avgHeartRate?.doubleValue, hrvSDNN: hrvSDNN?.doubleValue,
                      sleepOnsetMinutes: sleepOnsetMinutes?.doubleValue, sleepDeepMinutes: sleepDeepMinutes?.doubleValue,
                      sleepRemMinutes: sleepRemMinutes?.doubleValue, sleepTotalMinutes: sleepTotalMinutes?.doubleValue,
                      awaitingMorningRatings: awaitingMorningRatings)
    }

    /// The model is defined in code (no .xcdatamodeld), so the package builds anywhere.
    static let model: NSManagedObjectModel = {
        let e = NSEntityDescription()
        e.name = "SessionLog"
        e.managedObjectClassName = "SessionLog"
        func attr(_ name: String, _ type: NSAttributeType, _ def: Any? = nil, optional: Bool = false) -> NSAttributeDescription {
            let a = NSAttributeDescription()
            a.name = name; a.attributeType = type; a.isOptional = optional || def == nil; a.defaultValue = def
            return a
        }
        e.properties = [
            attr("id", .UUIDAttributeType), attr("sessionID", .stringAttributeType, ""), attr("moduleID", .stringAttributeType, ""),
            attr("sessionTitle", .stringAttributeType, ""), attr("startedAt", .dateAttributeType),
            attr("plannedSeconds", .doubleAttributeType, 0.0), attr("completedSeconds", .doubleAttributeType, 0.0),
            attr("finished", .booleanAttributeType, false), attr("beatsEnabled", .booleanAttributeType, true),
            attr("inExperiment", .booleanAttributeType, false), attr("beatMode", .stringAttributeType, "binaural"),
            attr("noiseBedMinutes", .integer64AttributeType, 0), attr("ratingsBeforeData", .binaryDataAttributeType),
            attr("ratingsAfterData", .binaryDataAttributeType), attr("awaitingMorningRatings", .booleanAttributeType, false),
            attr("note", .stringAttributeType, ""), attr("avgHeartRate", .doubleAttributeType), attr("hrvSDNN", .doubleAttributeType),
            attr("sleepOnsetMinutes", .doubleAttributeType), attr("sleepDeepMinutes", .doubleAttributeType),
            attr("sleepRemMinutes", .doubleAttributeType), attr("sleepTotalMinutes", .doubleAttributeType),
        ]
        let m = NSManagedObjectModel()
        m.entities = [e]
        return m
    }()
}

public struct SessionRecord: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var sessionID: String
    public var moduleID: String
    public var sessionTitle: String
    public var startedAt: Date
    public var plannedSeconds: Double
    public var completedSeconds: Double
    public var finished: Bool
    public var beatsEnabled: Bool
    public var inExperiment: Bool
    public var beatMode: String
    public var noiseBedMinutes: Int
    public var ratingsBefore: [String: Int]
    public var ratingsAfter: [String: Int]
    public var note: String
    public var avgHeartRate: Double?
    public var hrvSDNN: Double?
    public var sleepOnsetMinutes: Double?
    public var sleepDeepMinutes: Double?
    public var sleepRemMinutes: Double?
    public var sleepTotalMinutes: Double?
    public var awaitingMorningRatings: Bool = false

    public init(id: UUID = UUID(), sessionID: String = "", moduleID: String, sessionTitle: String = "", startedAt: Date = Date(),
                plannedSeconds: Double = 0, completedSeconds: Double = 0, finished: Bool = true, beatsEnabled: Bool,
                inExperiment: Bool = true, beatMode: String = "binaural", noiseBedMinutes: Int = 0,
                ratingsBefore: [String: Int] = [:], ratingsAfter: [String: Int] = [:], note: String = "",
                avgHeartRate: Double? = nil, hrvSDNN: Double? = nil, sleepOnsetMinutes: Double? = nil,
                sleepDeepMinutes: Double? = nil, sleepRemMinutes: Double? = nil, sleepTotalMinutes: Double? = nil, awaitingMorningRatings: Bool = false) {
        self.id = id; self.sessionID = sessionID; self.moduleID = moduleID; self.sessionTitle = sessionTitle
        self.startedAt = startedAt; self.plannedSeconds = plannedSeconds; self.completedSeconds = completedSeconds
        self.finished = finished; self.beatsEnabled = beatsEnabled; self.inExperiment = inExperiment
        self.beatMode = beatMode; self.noiseBedMinutes = noiseBedMinutes; self.ratingsBefore = ratingsBefore
        self.ratingsAfter = ratingsAfter; self.note = note; self.avgHeartRate = avgHeartRate; self.hrvSDNN = hrvSDNN
        self.sleepOnsetMinutes = sleepOnsetMinutes; self.sleepDeepMinutes = sleepDeepMinutes
        self.sleepRemMinutes = sleepRemMinutes; self.sleepTotalMinutes = sleepTotalMinutes
        self.awaitingMorningRatings = awaitingMorningRatings
    }
}

public struct DataExport: Codable {
    public var exportedAt: Date
    public var app: String
    public var note: String
    public var sessions: [SessionRecord]
}

/// Core Data store mirrored to the user's private CloudKit database. The local store is the
/// source of truth, so everything works offline and syncs when a connection is available.
@MainActor
public final class DataStore {
    public static let cloudContainerID = "iCloud.com.stillpoint.hypnosis"
    public let container: NSPersistentCloudKitContainer
    public private(set) var usingCloud = false
    public private(set) var loadError: String?
    public var context: NSManagedObjectContext { container.viewContext }

    /// CloudKit traps at launch if the binary lacks the iCloud entitlement, so sync is only
    /// switched on when the app's Info.plist says the build is provisioned for it
    /// (`StillpointCloudSync` = YES, set in App/Info.plist). Unsigned/dev builds stay local.
    public static var cloudSyncConfigured: Bool {
        Bundle.main.object(forInfoDictionaryKey: "StillpointCloudSync") as? Bool ?? false
    }

    public init(inMemory: Bool = false) {
        container = NSPersistentCloudKitContainer(name: "Stillpoint", managedObjectModel: SessionLog.model)
        let desc = container.persistentStoreDescriptions.first ?? NSPersistentStoreDescription()
        if inMemory {
            desc.url = URL(fileURLWithPath: "/dev/null")
            desc.cloudKitContainerOptions = nil
        } else if Self.cloudSyncConfigured, FileManager.default.ubiquityIdentityToken != nil {
            // Signed in to iCloud: sync with the private database only.
            let opts = NSPersistentCloudKitContainerOptions(containerIdentifier: Self.cloudContainerID)
            opts.databaseScope = .private
            desc.cloudKitContainerOptions = opts
            usingCloud = true
        } else {
            desc.cloudKitContainerOptions = nil
        }
        desc.setOption(true as NSNumber, forKey: NSPersistentHistoryTrackingKey)
        desc.setOption(true as NSNumber, forKey: NSPersistentStoreRemoteChangeNotificationPostOptionKey)
        #if os(iOS)
        desc.setOption(FileProtectionType.completeUntilFirstUserAuthentication as NSObject, forKey: NSPersistentStoreFileProtectionKey)
        #endif
        container.persistentStoreDescriptions = [desc]
        var err: Error?
        container.loadPersistentStores { _, e in err = e }
        if let err { loadError = err.localizedDescription; usingCloud = false }
        container.viewContext.automaticallyMergesChangesFromParent = true
        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
    }

    public func allLogs() -> [SessionLog] {
        let req = NSFetchRequest<SessionLog>(entityName: "SessionLog")
        req.sortDescriptors = [NSSortDescriptor(key: "startedAt", ascending: false)]
        return (try? context.fetch(req)) ?? []
    }

    public func log(id: UUID) -> SessionLog? { allLogs().first { $0.id == id } }

    @discardableResult
    public func newLog(sessionID: String, moduleID: String, sessionTitle: String, plannedSeconds: Double,
                       beatsEnabled: Bool, inExperiment: Bool, beatMode: String, noiseBedMinutes: Int = 0,
                       startedAt: Date = Date()) -> SessionLog {
        let l = SessionLog(entity: SessionLog.model.entitiesByName["SessionLog"]!, insertInto: context)
        l.id = UUID(); l.sessionID = sessionID; l.moduleID = moduleID; l.sessionTitle = sessionTitle
        l.plannedSeconds = plannedSeconds; l.beatsEnabled = beatsEnabled; l.inExperiment = inExperiment
        l.beatMode = beatMode; l.noiseBedMinutes = Int64(noiseBedMinutes); l.startedAt = startedAt
        return l
    }

    public func save() { if context.hasChanges { try? context.save() } }

    public func exportJSON() throws -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        enc.dateEncodingStrategy = .iso8601
        return try enc.encode(DataExport(exportedAt: Date(), app: "Stillpoint",
            note: "All personal data stored by the app. Ratings are 0-10 self-ratings. Health values were read from Apple Health with your permission.",
            sessions: allLogs().map(\.record)))
    }

    public func writeExportFile() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("stillpoint-export.json")
        try exportJSON().write(to: url, options: .atomic)
        return url
    }

    /// Deletes every record. Objects are deleted one by one (not a batch delete) so the
    /// deletions are recorded in history and propagate to the private iCloud database.
    public func deleteAll() {
        for l in allLogs() { context.delete(l) }
        save()
    }
}
