// Port of Alarms.java (service 0x08): the five event alarm slots and the single smart alarm. Java `byte` fields stay signed (`Int8`); the
// short `hour << 8 | minute & 0xFF` of the wire is built and split with the same arithmetic as the Java.
import Foundation

public enum Alarms {
    public static let id: UInt8 = 0x08

    /// `(short) ((hour << 8) | (minute & 0xFF))` with Java's sign extension of the byte `hour`.
    static func packTime(hour: Int8, minute: Int8) -> Int16 {
        Int16(truncatingIfNeeded: (Int32(hour) << 8) | (Int32(minute) & 0xFF))
    }

    /// `(byte) ((time >> 8) & 0xFF)`.
    static func hour(of time: Int16) -> Int8 { Int8(truncatingIfNeeded: (Int32(time) >> 8) & 0xFF) }

    /// `(byte) (time & 0xFF)`.
    static func minute(of time: Int16) -> Int8 { Int8(truncatingIfNeeded: Int32(time) & 0xFF) }

    public struct EventAlarm: Equatable, Sendable {
        public var index: Int8
        public var status: Bool = false
        public var startHour: Int8 = -1
        public var startMinute: Int8 = -1
        public var repeatMask: Int8 = 0
        public var name: String = "Alarm"

        public init(index: Int8, status: Bool, startHour: Int8, startMinute: Int8, repeatMask: Int8, name: String) {
            self.index = index
            self.status = status
            self.startHour = startHour
            self.startMinute = startMinute
            self.repeatMask = repeatMask
            self.name = name
        }

        /// `EventAlarm(HuaweiTLV)`: the time is only read for an enabled alarm or one that sends it; an enabled alarm without it is a
        /// MissingTagException, like in Java.
        init(tlv: HuaweiTLV) throws {
            index = try tlv.byte(0x03)
            if tlv.contains(0x04) { status = try tlv.bool(0x04) }
            if status || tlv.contains(0x05) {
                let time = try tlv.short(0x05)
                startHour = Alarms.hour(of: time)
                startMinute = Alarms.minute(of: time)
            }
            if tlv.contains(0x06) { repeatMask = try tlv.byte(0x06) }
            if tlv.contains(0x07) { name = try tlv.string(0x07) }
        }

        func asTlv() -> HuaweiTLV {
            var tlv = HuaweiTLV()
            tlv.put(0x03, byte: UInt8(bitPattern: index))
            tlv.put(0x04, bool: status)
            tlv.put(0x05, short: Alarms.packTime(hour: startHour, minute: startMinute))
            tlv.put(0x06, byte: UInt8(bitPattern: repeatMask))
            tlv.put(0x07, string: name)
            return tlv
        }
    }

    public struct SmartAlarm: Equatable, Sendable {
        public var index: Int8 = 1
        public var status: Bool
        public var startHour: Int8
        public var startMinute: Int8
        public var repeatMask: Int8
        public var aheadTime: Int8

        public init(status: Bool, startHour: Int8, startMinute: Int8, repeatMask: Int8, aheadTime: Int8) {
            self.status = status
            self.startHour = startHour
            self.startMinute = startMinute
            self.repeatMask = repeatMask
            self.aheadTime = aheadTime
        }

        /// `SmartAlarm(HuaweiTLV)`: Java's `get...(tag, default)` only falls back for an absent tag; a present but too short value is a
        /// BufferUnderflowException there, so it is read with the throwing getter here.
        init(tlv: HuaweiTLV) throws {
            index = try tlv.byte(0x03)
            status = tlv.contains(0x04) ? try tlv.bool(0x04) : false
            let time: Int16 = tlv.contains(0x05) ? try tlv.short(0x05) : 0
            startHour = Alarms.hour(of: time)
            startMinute = Alarms.minute(of: time)
            repeatMask = tlv.contains(0x06) ? try tlv.byte(0x06) : 0
            aheadTime = tlv.contains(0x07) ? try tlv.byte(0x07) : 0
        }

        func asTlv() -> HuaweiTLV {
            var tlv = HuaweiTLV()
            tlv.put(0x03, byte: UInt8(bitPattern: index))
            tlv.put(0x04, bool: status)
            tlv.put(0x05, short: Alarms.packTime(hour: startHour, minute: startMinute))
            tlv.put(0x06, byte: UInt8(bitPattern: repeatMask))
            tlv.put(0x07, byte: UInt8(bitPattern: aheadTime))
            return tlv
        }
    }

    // MARK: EventAlarmsRequest (08/01)

    public enum EventAlarmsRequest {
        public static let id: UInt8 = 0x01

        /// The request carries exactly `alarms`; GB's serialize turns an empty list into one bare index-1 entry, which clears them all.
        public static func request(alarms: [EventAlarm]) -> HuaweiPacket {
            var list = HuaweiTLV()
            for alarm in alarms { list.put(0x82, tlv: alarm.asTlv()) }
            if alarms.isEmpty {
                var bare = HuaweiTLV()
                bare.put(0x03, byte: 0x01)
                list.put(0x82, tlv: bare)
            }
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: list)
            return HuaweiPacket(serviceId: Alarms.id, commandId: id, tlv: tlv)
        }
    }

    // MARK: SmartAlarmRequest (08/02)

    public enum SmartAlarmRequest {
        public static let id: UInt8 = 0x02

        public static func request(_ alarm: SmartAlarm) -> HuaweiPacket {
            var inner = HuaweiTLV()
            inner.put(0x82, tlv: alarm.asTlv())
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: inner)
            return HuaweiPacket(serviceId: Alarms.id, commandId: id, tlv: tlv)
        }
    }

    // MARK: EventAlarmsList (08/03)

    public enum EventAlarmsList {
        public static let id: UInt8 = 0x03

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            return HuaweiPacket(serviceId: Alarms.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var eventAlarms: [EventAlarm] = []

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "EventAlarmsList")
                eventAlarms = try PacketsJava.parsing("EventAlarmsList") {
                    try tlv.object(0x81).objects(0x82).map { try EventAlarm(tlv: $0) }
                }
            }
        }
    }

    // MARK: SmartAlarmList (08/04)

    public enum SmartAlarmList {
        public static let id: UInt8 = 0x04

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            return HuaweiPacket(serviceId: Alarms.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var smartAlarm: SmartAlarm?

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "SmartAlarmList")
                smartAlarm = try PacketsJava.parsing("SmartAlarmList") {
                    let inner = try tlv.object(0x81)
                    return inner.contains(0x82) ? try SmartAlarm(tlv: try inner.object(0x82)) : nil
                }
            }
        }
    }
}
