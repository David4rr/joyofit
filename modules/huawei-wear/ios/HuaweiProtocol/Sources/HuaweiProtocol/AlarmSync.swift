// Port of AlarmSync.kt (GB GetEventAlarmList, GetSmartAlarmList, AlarmsRequest and HuaweiSupportProvider.onSetAlarms): reads and writes the
// watch's alarms with the Alarms packets (service 0x08). The JSON form is what the settings store keeps between launches.
import Foundation

/// Alarms on the watch are Mon = 1 ... Sun = 64 (GB `Alarm.ALARM_MON` ... `ALARM_SUN`).
public let alarmRepeatMax = 127

/// The band has five event alarm slots, indexed 1 to 5 on the wire (GB getAlarmSlotCount: "always five event alarms").
public let eventAlarmSlots = 5

/// Name length accepted by `AlarmSync.validate`; GB has no limit but the packet must stay small.
public let alarmNameMax = 64

/// One event alarm. `slot` is the watch's index 1 to 5.
public struct WatchAlarm: Equatable, Sendable {
    public var slot: Int
    public var enabled: Bool
    public var hour: Int
    public var minute: Int
    /// Weekday bitmask, Mon = 1 ... Sun = 64; 0 = once.
    public var repeatMask: Int
    public var name: String

    public init(slot: Int, enabled: Bool, hour: Int, minute: Int, repeatMask: Int, name: String) {
        self.slot = slot
        self.enabled = enabled
        self.hour = hour
        self.minute = minute
        self.repeatMask = repeatMask
        self.name = name
    }
}

/// The watch's single smart alarm (service 08 command 02), which wakes within `aheadMinutes` before `hour`:`minute`.
public struct WatchSmartAlarm: Equatable, Sendable {
    public var enabled: Bool
    public var hour: Int
    public var minute: Int
    public var repeatMask: Int
    public var aheadMinutes: Int

    public init(enabled: Bool, hour: Int, minute: Int, repeatMask: Int, aheadMinutes: Int) {
        self.enabled = enabled
        self.hour = hour
        self.minute = minute
        self.repeatMask = repeatMask
        self.aheadMinutes = aheadMinutes
    }
}

/// What `HuaweiWear.types.ts` calls `WatchAlarms`: the alarms last read from or pushed to the watch.
public struct WatchAlarms: Equatable, Sendable {
    public var event: [WatchAlarm]
    public var smart: WatchSmartAlarm?
    /// Unix milliseconds of the last exchange with the watch; nil before the first.
    public var updatedAtMs: Int64?

    public init(event: [WatchAlarm], smart: WatchSmartAlarm?, updatedAtMs: Int64?) {
        self.event = event
        self.smart = smart
        self.updatedAtMs = updatedAtMs
    }

    public static let empty = WatchAlarms(event: [], smart: nil, updatedAtMs: nil)

    /// `WatchAlarms` of the JS contract; `supported` and `smartSupported` are the capabilities of the connected watch (false while none is).
    public func toJS(supported: Bool, smartSupported: Bool) -> [String: Any] {
        var smartJS: Any = NSNull()
        if let smart {
            smartJS = [
                "enabled": smart.enabled, "hour": smart.hour, "minute": smart.minute, "repeat": smart.repeatMask,
                "aheadMinutes": smart.aheadMinutes,
            ] as [String: Any]
        }
        return [
            "event": event.map {
                ["slot": $0.slot, "enabled": $0.enabled, "hour": $0.hour, "minute": $0.minute, "repeat": $0.repeatMask, "name": $0.name]
                    as [String: Any]
            },
            "smart": smartJS,
            "updatedAt": updatedAtMs.map { $0 as Any } ?? NSNull(),
            "supported": supported,
            "smartSupported": smartSupported,
        ]
    }

    public func toJson() -> String {
        var root: [String: Any] = [
            "event": event.map {
                ["slot": $0.slot, "enabled": $0.enabled, "hour": $0.hour, "minute": $0.minute, "repeat": $0.repeatMask, "name": $0.name]
                    as [String: Any]
            }
        ]
        root["smart"] =
            smart.map {
                ["enabled": $0.enabled, "hour": $0.hour, "minute": $0.minute, "repeat": $0.repeatMask, "aheadMinutes": $0.aheadMinutes]
                    as [String: Any]
            } ?? NSNull()
        root["updatedAt"] = updatedAtMs.map { $0 as Any } ?? NSNull()
        let data = try! JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }

    /// Anything unreadable (null, not JSON, a missing field) is `empty`, like the Kotlin `JSONException` branch.
    public static func fromJson(_ json: String?) -> WatchAlarms {
        guard let json, let data = json.data(using: .utf8),
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let array = root["event"] as? [[String: Any]]
        else { return .empty }
        var event: [WatchAlarm] = []
        for o in array {
            guard let slot = o["slot"] as? Int, let enabled = o["enabled"] as? Bool, let hour = o["hour"] as? Int,
                let minute = o["minute"] as? Int, let rep = o["repeat"] as? Int, let name = o["name"] as? String
            else { return .empty }
            event.append(WatchAlarm(slot: slot, enabled: enabled, hour: hour, minute: minute, repeatMask: rep, name: name))
        }
        var smart: WatchSmartAlarm?
        if let o = root["smart"] as? [String: Any] {
            guard let enabled = o["enabled"] as? Bool, let hour = o["hour"] as? Int, let minute = o["minute"] as? Int,
                let rep = o["repeat"] as? Int, let ahead = o["aheadMinutes"] as? Int
            else { return .empty }
            smart = WatchSmartAlarm(enabled: enabled, hour: hour, minute: minute, repeatMask: rep, aheadMinutes: ahead)
        }
        let updated = (root["updatedAt"] as? NSNumber).map { $0.int64Value }
        return WatchAlarms(event: event, smart: smart, updatedAtMs: updated)
    }
}

/// Reads and writes the watch's alarms with GB's Alarms packets (service 0x08).
public enum AlarmSync {
    /// HuaweiState.supportsChangingAlarm: Alarms (08) command 03.
    public static func supported(_ caps: DeviceCaps) -> Bool { caps.supports(Int(Alarms.id), Int(Alarms.EventAlarmsList.id)) }

    /// HuaweiState.supportsSmartAlarm (without GB's force option): Alarms (08) command 02.
    public static func smartSupported(_ caps: DeviceCaps) -> Bool {
        supported(caps) && caps.supports(Int(Alarms.id), Int(Alarms.SmartAlarmRequest.id))
    }

    private static let unsupportedMessage = "The watch does not report alarm support (service 08 command 03)"

    public static func validate(_ alarms: WatchAlarms) throws {
        func bad(_ what: String) -> WearError { WearError(.invalidArgument, what) }
        if alarms.event.count > eventAlarmSlots {
            throw bad("The watch has \(eventAlarmSlots) alarm slots, got \(alarms.event.count) alarms")
        }
        var seen = Set<Int>()
        for alarm in alarms.event {
            if !(1...eventAlarmSlots).contains(alarm.slot) { throw bad("Alarm slot must be 1 to \(eventAlarmSlots), got \(alarm.slot)") }
            if !seen.insert(alarm.slot).inserted { throw bad("Alarm slot \(alarm.slot) is used twice") }
            if !(0...23).contains(alarm.hour) { throw bad("Alarm hour must be 0 to 23, got \(alarm.hour)") }
            if !(0...59).contains(alarm.minute) { throw bad("Alarm minute must be 0 to 59, got \(alarm.minute)") }
            if !(0...alarmRepeatMax).contains(alarm.repeatMask) {
                throw bad("Alarm repeat must be a weekday bitmask 0 to \(alarmRepeatMax), got \(alarm.repeatMask)")
            }
            // Kotlin `String.length` counts UTF-16 units.
            if alarm.name.utf16.count > alarmNameMax { throw bad("Alarm name is longer than \(alarmNameMax) characters") }
        }
        if let smart = alarms.smart {
            if !(0...23).contains(smart.hour) { throw bad("Smart alarm hour must be 0 to 23, got \(smart.hour)") }
            if !(0...59).contains(smart.minute) { throw bad("Smart alarm minute must be 0 to 59, got \(smart.minute)") }
            if !(0...alarmRepeatMax).contains(smart.repeatMask) {
                throw bad("Smart alarm repeat must be a weekday bitmask 0 to \(alarmRepeatMax), got \(smart.repeatMask)")
            }
            if !(0...127).contains(smart.aheadMinutes) { throw bad("Smart alarm window must be 0 to 127 minutes, got \(smart.aheadMinutes)") }
        }
    }

    /// GB `EventAlarm.toString`, for the log.
    private static func describe(_ a: Alarms.EventAlarm) -> String {
        "EventAlarm{index=\(a.index), status=\(a.status), startHour=\(a.startHour), startMinute=\(a.startMinute), repeat=\(a.repeatMask), name='\(a.name)'}"
    }

    private static func hhmm(_ hour: Int, _ minute: Int) -> String { String(format: "%02d:%02d", hour, minute) }

    /// GetEventAlarmList (08/03), then GetSmartAlarmList (08/04) when the watch has a smart alarm.
    public static func read(
        session: HuaweiSession, caps: DeviceCaps, log: LogSink, queryMs: Int = Timeouts.queryMs, now: Date = Date()
    ) async throws -> WatchAlarms {
        guard supported(caps) else { throw WearError(.unsupported, unsupportedMessage) }
        let list = try await session.request(
            Alarms.EventAlarmsList.request(), as: Alarms.EventAlarmsList.Response.self, timeoutMs: queryMs, label: "EventAlarmList"
        )
        var event: [WatchAlarm] = []
        for alarm in list.eventAlarms {
            let slot = Int(UInt8(bitPattern: alarm.index))
            // A slot without a time is an empty slot (GB marks every index not in the reply as unused).
            if alarm.startHour < 0 || !(1...eventAlarmSlots).contains(slot) {
                log(LogEntry(.info, "EventAlarmList: skipped \(describe(alarm))"))
                continue
            }
            event.append(
                WatchAlarm(
                    slot: slot, enabled: alarm.status, hour: Int(alarm.startHour), minute: Int(UInt8(bitPattern: alarm.startMinute)),
                    repeatMask: Int(UInt8(bitPattern: alarm.repeatMask)), name: alarm.name
                )
            )
        }
        event.sort { $0.slot < $1.slot }
        log(LogEntry(.info, "EventAlarmList: \(event.count) alarm(s) " + event.map { "#\($0.slot) \(hhmm($0.hour, $0.minute))" }.joined(separator: ", ")))

        var smart: WatchSmartAlarm?
        if smartSupported(caps) {
            let response = try await session.request(
                Alarms.SmartAlarmList.request(), as: Alarms.SmartAlarmList.Response.self, timeoutMs: queryMs, label: "SmartAlarmList"
            )
            if let s = response.smartAlarm {
                smart = WatchSmartAlarm(
                    enabled: s.status, hour: Int(s.startHour), minute: Int(UInt8(bitPattern: s.startMinute)),
                    repeatMask: Int(UInt8(bitPattern: s.repeatMask)), aheadMinutes: Int(UInt8(bitPattern: s.aheadTime))
                )
            }
            log(LogEntry(.info, "SmartAlarmList: " + (smart.map { "\(hhmm($0.hour, $0.minute)) enabled=\($0.enabled)" } ?? "none")))
        }
        return WatchAlarms(event: event, smart: smart, updatedAtMs: Int64(now.timeIntervalSince1970 * 1000))
    }

    /// HuaweiSupportProvider.onSetAlarms: the smart alarm (08/02) first, then the event alarms (08/01). The event request carries exactly the
    /// alarms to keep; GB's serialize turns an empty list into a single bare index-1 entry, which clears all of them.
    public static func write(session: HuaweiSession, caps: DeviceCaps, log: LogSink, alarms: WatchAlarms, queryMs: Int = Timeouts.queryMs) async throws {
        guard supported(caps) else { throw WearError(.unsupported, unsupportedMessage) }
        try validate(alarms)
        let smart = alarms.smart
        if let smart {
            guard smartSupported(caps) else { throw WearError(.unsupported, "The watch does not support a smart alarm") }
            let packet = Alarms.SmartAlarmRequest.request(
                Alarms.SmartAlarm(
                    status: smart.enabled, startHour: Int8(smart.hour), startMinute: Int8(smart.minute),
                    repeatMask: Int8(smart.repeatMask), aheadTime: Int8(smart.aheadMinutes)
                )
            )
            try await sendAcked(session: session, log: log, label: "SmartAlarm", packet: packet, queryMs: queryMs)
        }
        let eventPacket = Alarms.EventAlarmsRequest.request(
            alarms: alarms.event.map {
                Alarms.EventAlarm(
                    index: Int8($0.slot), status: $0.enabled, startHour: Int8($0.hour), startMinute: Int8($0.minute),
                    repeatMask: Int8($0.repeatMask), name: $0.name
                )
            }
        )
        try await sendAcked(session: session, log: log, label: "EventAlarms", packet: eventPacket, queryMs: queryMs)
        log(LogEntry(.info, "Alarms pushed: \(alarms.event.count) event alarm(s)" + (smart != nil ? ", smart alarm" : "")))
    }

    /// GB's AlarmsRequest only logs the reply ("handle Alarm"). A missing reply is logged, not failed: the caller reads the list back,
    /// which shows what the watch really holds.
    private static func sendAcked(session: HuaweiSession, log: LogSink, label: String, packet: HuaweiPacket, queryMs: Int) async throws {
        do {
            _ = try await session.request(packet, timeoutMs: queryMs, label: label)
        } catch let e as WearError {
            if e.code != .timeout { throw e }
            log(LogEntry(.error, "\(label): no acknowledgment from the watch; reading the list back to check"))
        }
    }
}

extension WatchAlarms {
    /// The writable part of `WatchAlarms` as JS sends it (the Kotlin `WatchAlarmsRecord`): missing fields take the record's defaults, a
    /// mistyped one is an invalid argument.
    public static func fromJS(_ raw: [String: Any]) throws -> WatchAlarms {
        func int(_ dict: [String: Any], _ key: String, _ fallback: Int) throws -> Int {
            guard let value = dict[key] else { return fallback }
            if let n = value as? NSNumber, !(value is Bool), n.doubleValue == n.doubleValue.rounded() { return n.intValue }
            throw WearError(.invalidArgument, "Alarm field '\(key)' must be an integer")
        }
        func bool(_ dict: [String: Any], _ key: String) throws -> Bool {
            guard let value = dict[key] else { return false }
            if let b = value as? Bool { return b }
            throw WearError(.invalidArgument, "Alarm field '\(key)' must be a boolean")
        }
        var event: [WatchAlarm] = []
        if let list = raw["event"] {
            guard let items = list as? [[String: Any]] else { throw WearError(.invalidArgument, "Alarm field 'event' must be a list of alarms") }
            for o in items {
                let name: String
                if let value = o["name"] {
                    guard let s = value as? String else { throw WearError(.invalidArgument, "Alarm field 'name' must be a string") }
                    name = s
                } else {
                    name = ""
                }
                event.append(
                    WatchAlarm(
                        slot: try int(o, "slot", 1), enabled: try bool(o, "enabled"), hour: try int(o, "hour", 0), minute: try int(o, "minute", 0),
                        repeatMask: try int(o, "repeat", 0), name: name
                    )
                )
            }
        }
        var smart: WatchSmartAlarm?
        if let value = raw["smart"], !(value is NSNull) {
            guard let o = value as? [String: Any] else { throw WearError(.invalidArgument, "Alarm field 'smart' must be an object") }
            smart = WatchSmartAlarm(
                enabled: try bool(o, "enabled"), hour: try int(o, "hour", 0), minute: try int(o, "minute", 0), repeatMask: try int(o, "repeat", 0),
                aheadMinutes: try int(o, "aheadMinutes", 5)
            )
        }
        return WatchAlarms(event: event, smart: smart, updatedAtMs: nil)
    }
}
