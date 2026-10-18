// DataSync (service 0x37) framework: the four "sample" commands Huawei Health uses for everything under `hw.unitedevice.*` / `hw.sport.*`
// (editable watch faces, calorie intake, activity-ring goals, find my watch ...). Port of DataSyncService.kt.
//
// Outbound: `sendConfig` (37/01), `sendEvent` (37/02), `sendSamplePoint` (37/03), `sendDictionary` (37/04), each gated on the ExpandCapability
// bit Huawei checks (83, 84, 85, 173), each logging the decision and the outcome.
//
// Inbound: watch-initiated 37/01..05 packets are routed by package name and id to handlers registered with `onConfig`, `onEvent`,
// `onDictionary`, `onPoint`. The watch writes its own package in `src` and the phone's in `wear`; a handler is matched on either orientation.
// Handlers are async, run on their own tasks (never on the session's read path) and may send. The session allows one subscriber per service
// and command, so this class is the only one for 0x37.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// A feature built on `DataSyncService`. Registered once with `DataSyncService.register`; `register(service:)` is called at once so it can add
/// its inbound handlers, `onConnected` after every new watch connection.
public protocol DataSyncFeature: AnyObject, Sendable {
    var name: String { get }
    /// Add inbound handlers here with `service.onEvent / onConfig / onDictionary / onPoint`.
    func register(service: DataSyncService)
    /// Runs once per connection, about a second after the link is up. Throwing is logged and does not stop other features.
    func onConnected() async throws
}

extension DataSyncFeature {
    public func onConnected() async throws {}
}

/// Removes a registered handler.
public final class DataSyncRegistration: @unchecked Sendable {
    private let lock = NSLock()
    private var remove: (@Sendable () -> Void)?

    fileprivate init(_ remove: @escaping @Sendable () -> Void) { self.remove = remove }

    public func cancel() {
        let r = lock.locked { () -> (@Sendable () -> Void)? in
            defer { remove = nil }
            return remove
        }
        r?()
    }
}

public final class DataSyncService: LinkObserver, @unchecked Sendable {
    private final class Registration<T>: @unchecked Sendable {
        let phonePkg: String?
        let watchPkg: String?
        let id: Int?
        let handler: @Sendable (T) async -> Void

        init(phonePkg: String?, watchPkg: String?, id: Int?, handler: @escaping @Sendable (T) async -> Void) {
            self.phonePkg = phonePkg
            self.watchPkg = watchPkg
            self.id = id
            self.handler = handler
        }
    }

    private let link: LinkHandleSource
    private let events: WearEvents
    private let connectDelayMs: Int
    private let lock = NSLock()
    private var eventHandlers: [Registration<SampleEvent>] = []
    private var configHandlers: [Registration<SampleConfigIn>] = []
    private var dictHandlers: [Registration<DictQuery>] = []
    private var pointHandlers: [Registration<SamplePointIn>] = []
    private var features: [DataSyncFeature] = []
    private var attached: HuaweiSession?

    public init(link: LinkHandleSource, events: WearEvents, connectDelayMs: Int = 1_000) {
        self.link = link
        self.events = events
        self.connectDelayMs = connectDelayMs
    }

    private func log(_ message: String) { events.log(LogEntry(.info, message)) }

    private func error(_ message: String) { events.log(LogEntry(.error, message)) }

    // MARK: features

    public func register(_ feature: DataSyncFeature) {
        lock.locked { features.append(feature) }
        feature.register(service: self)
        log("DataSync: feature '\(feature.name)' registered")
    }

    // MARK: capability gates

    /// ExpandCapability bit; false until the watch has reported its bitmap or while no watch is connected.
    public func supports(_ bit: Int) -> Bool { link.handle()?.caps.expandCapability(bit) ?? false }

    public func connected() -> Bool { link.handle() != nil }

    // MARK: inbound registration. `phonePkg` / `watchPkg` may each be nil (wildcard) but not both; `id` nil matches every id.

    /// A watch 37/02 event. The handler receives the event with `phonePkg` / `watchPkg` set to the sides it was matched on.
    @discardableResult
    public func onEvent(phonePkg: String?, watchPkg: String?, eventId: Int?, handler: @escaping @Sendable (SampleEvent) async -> Void) -> DataSyncRegistration {
        add(\.eventHandlers, phonePkg, watchPkg, eventId, handler)
    }

    /// A watch 37/01 config; the handler runs once per config item that matches `configId` (nil: all). The item is `items[0]`.
    @discardableResult
    public func onConfig(phonePkg: String?, watchPkg: String?, configId: Int?, handler: @escaping @Sendable (SampleConfigIn) async -> Void) -> DataSyncRegistration {
        add(\.configHandlers, phonePkg, watchPkg, configId, handler)
    }

    /// A watch 37/04 dictionary request (or push) for `dictId` (nil: all).
    @discardableResult
    public func onDictionary(phonePkg: String?, watchPkg: String?, dictId: Int?, handler: @escaping @Sendable (DictQuery) async -> Void) -> DataSyncRegistration {
        add(\.dictHandlers, phonePkg, watchPkg, dictId, handler)
    }

    /// A watch 37/03 sample point for `dictId` (nil: all).
    @discardableResult
    public func onPoint(phonePkg: String?, watchPkg: String?, dictId: Int?, handler: @escaping @Sendable (SamplePointIn) async -> Void) -> DataSyncRegistration {
        add(\.pointHandlers, phonePkg, watchPkg, dictId, handler)
    }

    private func add<T>(
        _ list: ReferenceWritableKeyPath<DataSyncService, [Registration<T>]>, _ phonePkg: String?, _ watchPkg: String?, _ id: Int?,
        _ handler: @escaping @Sendable (T) async -> Void
    ) -> DataSyncRegistration {
        precondition(phonePkg != nil || watchPkg != nil, "A DataSync handler needs a phone or a watch package")
        let registration = Registration(phonePkg: phonePkg, watchPkg: watchPkg, id: id, handler: handler)
        lock.locked { self[keyPath: list].append(registration) }
        return DataSyncRegistration { [weak self] in
            guard let self else { return }
            self.lock.locked { self[keyPath: list].removeAll { $0 === registration } }
        }
    }

    // MARK: outbound. Each returns true when the packet went out; false (with the reason in the log) when the watch is not connected, the
    // capability bit is not set or the write failed. `phonePkg` is `src`, `watchPkg` is `wear`.

    public func sendConfig(
        phonePkg: String, watchPkg: String, configId: Int, data: Bytes?, action: Int = 1,
        modifyMs: Int64? = Int64(Date().timeIntervalSince1970 * 1000), what: String? = nil
    ) async throws -> Bool {
        try await sendConfigs(phonePkg: phonePkg, watchPkg: watchPkg, items: [ConfigItem(configId: configId, action: action, data: data, modifyMs: modifyMs)], what: what ?? "config \(configId)")
    }

    public func sendConfigs(phonePkg: String, watchPkg: String, items: [ConfigItem], what: String) async throws -> Bool {
        try await send(DataSyncWire.cmdConfig, what, "\(phonePkg) -> \(watchPkg) ids=\(items.map { String($0.configId) }.joined(separator: ", "))") {
            DataSyncWire.config(srcPkg: phonePkg, wearPkg: watchPkg, items: items)
        }
    }

    public func sendEvent(phonePkg: String, watchPkg: String, eventId: Int, data: Bytes?, level: Int = 0, what: String? = nil) async throws -> Bool {
        try await send(
            DataSyncWire.cmdEvent, what ?? "event \(eventId)",
            "\(phonePkg) -> \(watchPkg) id=\(eventId) level=\(level) data=\(DataSyncWire.describe(data))"
        ) { DataSyncWire.event(srcPkg: phonePkg, wearPkg: watchPkg, eventId: eventId, level: level, data: data) }
    }

    public func sendSamplePoint(
        phonePkg: String, watchPkg: String, dictType: Int, values: [PointValue], startMs: Int64? = nil, endMs: Int64? = nil, metadata: Bytes? = nil,
        what: String? = nil
    ) async throws -> Bool {
        try await send(
            DataSyncWire.cmdPoint, what ?? "point \(dictType)",
            "\(phonePkg) -> \(watchPkg) dict=\(dictType) values=\(values.count) start=\(startMs.map(String.init) ?? "nil") end=\(endMs.map(String.init) ?? "nil")"
        ) { DataSyncWire.samplePoint(srcPkg: phonePkg, wearPkg: watchPkg, dictType: dictType, values: values, startMs: startMs, endMs: endMs, metadata: metadata) }
    }

    public func sendDictionary(phonePkg: String, watchPkg: String, dictType: Int, rows: [DictRow], what: String? = nil) async throws -> Bool {
        try await send(DataSyncWire.cmdDict, what ?? "dictionary \(dictType)", "\(phonePkg) -> \(watchPkg) dict=\(dictType) rows=\(rows.count)") {
            DataSyncWire.dictionary(srcPkg: phonePkg, wearPkg: watchPkg, dictType: dictType, rows: rows)
        }
    }

    private func send(_ command: Int, _ what: String, _ detail: String, _ build: () -> HuaweiPacket) async throws -> Bool {
        guard let handle = link.handle() else {
            log("DataSync \(what): not sent, no connected watch")
            return false
        }
        if let bit = DataSyncWire.capabilityFor(command) {
            let ok = handle.caps.expandCapability(bit)
            log("DataSync \(what): \(DataSyncWire.commandName(command)) needs ExpandCapability \(bit): \(ok ? "set" : "NOT set")")
            if !ok { return false }
        }
        do {
            log("DataSync \(what): send \(detail)")
            try await handle.session.send(build(), label: "DataSync \(what)")
            return true
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            self.error("DataSync \(what): not sent: \(error)")
            return false
        }
    }

    // MARK: link lifetime

    public func linkConnected(_ handle: LinkHandle) async {
        let snapshot: [DataSyncFeature]? = lock.locked {
            if let attached, attached === handle.session { return nil }
            attached = handle.session
            return features
        }
        guard let snapshot else { return }
        for command in [DataSyncWire.cmdConfig, DataSyncWire.cmdEvent, DataSyncWire.cmdPoint, DataSyncWire.cmdDict, DataSyncWire.cmdCompact] {
            _ = await handle.session.subscribe(service: DataSyncWire.service, command: UInt8(command), label: "datasync \(DataSyncWire.commandName(command))") { [weak self] packet in
                self?.onPacket(command, packet)
            }
        }
        // Let the connect sync's first requests go first; the watch is still settling right after init.
        try? await Task.sleep(nanoseconds: UInt64(connectDelayMs) * 1_000_000)
        for feature in snapshot {
            if lock.locked({ attached }) !== handle.session { return }
            do {
                try await feature.onConnected()
            } catch is CancellationError {
                return
            } catch {
                self.error("DataSync feature '\(feature.name)': onConnected failed: \(error)")
            }
        }
    }

    public func linkDisconnected() { lock.locked { attached = nil } }

    // MARK: dispatch. Runs on the session's executor: parse, then hand off.

    private func onPacket(_ command: Int, _ packet: HuaweiPacket) {
        guard let tlv = packet.tlv else {
            error("DataSync \(DataSyncWire.commandName(command)): watch packet has no readable TLV (decrypt failed?)")
            return
        }
        do {
            switch command {
            case DataSyncWire.cmdEvent:
                let event = DataSyncWire.parseEvent(tlv)
                log("DataSync event from watch: src=\(event.srcPkg) wear=\(event.wearPkg) id=\(event.eventId) level=\(event.level) code=\(event.errorCode.map(String.init) ?? "-") data=\(DataSyncWire.describe(event.data))")
                dispatch(lock.locked { eventHandlers }, event.srcPkg, event.wearPkg, event.eventId, event.errorCode, "event") { registration, phone, watch in
                    var matched = event
                    matched.phonePkg = phone
                    matched.watchPkg = watch
                    await registration.handler(matched)
                }
            case DataSyncWire.cmdConfig:
                let config = try DataSyncWire.parseConfig(tlv)
                let items = config.items.map { "id=\($0.configId) action=\($0.action) data=\(DataSyncWire.describe($0.data))" }.joined(separator: ", ")
                // A reply with a code other than OK is a failure of what we sent: an error in the log.
                events.log(LogEntry(
                    (config.errorCode ?? Int(DataSync.replyOK)) == Int(DataSync.replyOK) ? .info : .error,
                    "DataSync config from watch: src=\(config.srcPkg) wear=\(config.wearPkg) code=\(config.errorCode.map(String.init) ?? "-") \(items.isEmpty ? "none" : items)"
                ))
                let handlers = lock.locked { configHandlers }
                if config.items.isEmpty {
                    dispatch(handlers, config.srcPkg, config.wearPkg, nil, config.errorCode, "config") { registration, phone, watch in
                        var matched = config
                        matched.phonePkg = phone
                        matched.watchPkg = watch
                        await registration.handler(matched)
                    }
                } else {
                    for item in config.items {
                        let single = SampleConfigIn(srcPkg: config.srcPkg, wearPkg: config.wearPkg, items: [item], errorCode: config.errorCode)
                        dispatch(handlers, config.srcPkg, config.wearPkg, item.configId, config.errorCode, "config") { registration, phone, watch in
                            var matched = single
                            matched.phonePkg = phone
                            matched.watchPkg = watch
                            await registration.handler(matched)
                        }
                    }
                }
            case DataSyncWire.cmdDict:
                let query = try DataSyncWire.parseDictionary(tlv)
                log("DataSync dictionary from watch: src=\(query.srcPkg) wear=\(query.wearPkg) dict=\(query.dictId) start=\(query.startMs.map(String.init) ?? "nil") end=\(query.endMs.map(String.init) ?? "nil") modify=\(query.modifyMs.map(String.init) ?? "nil") rows=\(query.rows.count) code=\(query.errorCode.map(String.init) ?? "-")")
                dispatch(lock.locked { dictHandlers }, query.srcPkg, query.wearPkg, query.dictId, query.errorCode, "dictionary") { registration, phone, watch in
                    var matched = query
                    matched.phonePkg = phone
                    matched.watchPkg = watch
                    await registration.handler(matched)
                }
            case DataSyncWire.cmdPoint:
                let point = try DataSyncWire.parsePoint(tlv)
                log("DataSync point from watch: src=\(point.srcPkg) wear=\(point.wearPkg) dict=\(point.dictId) values=\(point.values.count) code=\(point.errorCode.map(String.init) ?? "-")")
                dispatch(lock.locked { pointHandlers }, point.srcPkg, point.wearPkg, point.dictId, point.errorCode, "point") { registration, phone, watch in
                    var matched = point
                    matched.phonePkg = phone
                    matched.watchPkg = watch
                    await registration.handler(matched)
                }
            default:
                log("DataSync \(DataSyncWire.commandName(command)) from watch: \(tlv)")
            }
        } catch {
            self.error("DataSync \(DataSyncWire.commandName(command)): could not parse the watch's packet: \(error)")
        }
    }

    /// Finds the handlers whose packages match `src` / `wear` in either orientation and runs each on its own task. A packet with an error
    /// code (tag 7F) is the watch's answer to something we sent, not a request: it is logged and not dispatched.
    private func dispatch<T>(
        _ list: [Registration<T>], _ src: String, _ wear: String, _ id: Int?, _ errorCode: Int?, _ kind: String,
        _ run: @escaping @Sendable (Registration<T>, String, String) async -> Void
    ) {
        if let errorCode {
            if errorCode == Int(DataSync.replyOK) {
                log("DataSync \(kind): watch answer with code \(errorCode) (100000 is OK), not dispatched")
            } else {
                error("DataSync \(kind): watch answer with code \(errorCode) (100000 is OK), not dispatched")
            }
            return
        }
        var matched = 0
        for registration in list {
            if let wanted = registration.id, wanted != id { continue }
            guard let (phone, watch) = DataSyncWire.matchPackages(registration.phonePkg, registration.watchPkg, src: src, wear: wear) else { continue }
            matched += 1
            Task { await run(registration, phone, watch) }
        }
        if matched == 0 { log("DataSync \(kind): no handler for src=\(src) wear=\(wear) id=\(id.map(String.init) ?? "nil")") }
    }
}

#endif
