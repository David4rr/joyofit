// Port of the FitnessData.java packets (service 0x07) that profile send and the activity sync use. Java `byte` parameters are `UInt8`
// bit patterns; the signed reads and the bitmap walk in `StepResponse.parseData` follow Java exactly.
import Foundation

public enum FitnessData {
    public static let id: UInt8 = 0x07

    // MARK: MotionGoal

    public enum MotionGoal {
        public static let id: UInt8 = 0x01

        /// Java quirks kept. `Type.data` is the constant 0x01, so only bit 0x01 (the step goal, tag 0x05) of the data mask is set: `calorieGoal`
        /// and `durationGoal` are read but always replaced by "unset" (-1), and for frame type 1 the unset calorie goal becomes
        /// `stepGoal / 30` under tag 0x06 and the unset distance goal repeats `stepGoal`, also under tag 0x06.
        public static func request(goalType: UInt8, frameType: UInt8, stepGoal: Int32, calorieGoal: Int32, durationGoal: Int16) -> HuaweiPacket {
            let frame: UInt8 = frameType == 0x01 ? 0x01 : 0x00 // Type.motion
            var sub = HuaweiTLV()
            sub.put(0x03, byte: goalType)
            sub.put(0x04, byte: frame)
            if stepGoal != -1 { sub.put(0x05, int: stepGoal) }
            if frame == 0x01 {
                sub.put(0x06, int: stepGoal / 0x1e)
                sub.put(0x06, int: stepGoal)
            }
            var container = HuaweiTLV()
            container.put(0x82, tlv: sub)
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: container)
            return HuaweiPacket(serviceId: FitnessData.id, commandId: id, tlv: tlv)
        }
    }

    // MARK: UserInfo

    public enum UserInfo {
        public static let id: UInt8 = 0x02

        public struct UserInfoData {
            public static let genderMale = 1
            public static let genderFemale = 2
            public static let genderUnknown = 3
            static let runCF: Float = 0.83
            static let walkCF: Float = 0.42
            public static let defaultHeight = 175
            public static let defaultWeight: Float = 65

            public var height: Int32
            public var weight: Float
            public var age: Int32
            public var birthday: Int32
            /// A Java `byte`.
            public var gender: UInt8
            public var unknownGenderSupported: Bool
            public var vo2Supported: Bool
            public var vo2Max: Int32
            public var vo2Time: Int32
            public var precisionWeightSupported: Bool

            public init(
                height: Int32, weight: Float, age: Int32, birthday: Int32, gender: UInt8, unknownGenderSupported: Bool,
                vo2Supported: Bool, vo2Max: Int32, vo2Time: Int32, precisionWeightSupported: Bool
            ) {
                self.height = height
                self.weight = weight
                self.age = age
                self.birthday = birthday
                self.gender = gender
                self.unknownGenderSupported = unknownGenderSupported
                self.vo2Supported = vo2Supported
                self.vo2Max = vo2Max
                self.vo2Time = vo2Time
                self.precisionWeightSupported = precisionWeightSupported
            }

            var effectiveHeight: Int32 { height > 0 ? height : Int32(UserInfoData.defaultHeight) }
            var effectiveWeight: Float { weight > 0 ? weight : UserInfoData.defaultWeight }
            var isGenderValid: Bool { Int(gender) == UserInfoData.genderMale || Int(gender) == UserInfoData.genderFemale || Int(gender) == UserInfoData.genderUnknown }
            var isBirthdayValid: Bool { birthday > 0 }
        }

        public static func request(info: UserInfoData) -> HuaweiPacket {
            let height = info.effectiveHeight
            let weight = info.effectiveWeight
            let bmiWalk = UInt8(truncatingIfNeeded: PacketsJava.round(UserInfoData.walkCF * Float(height)))
            let bmiRun = UInt8(truncatingIfNeeded: PacketsJava.round(UserInfoData.runCF * Float(height)))

            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: UInt8(truncatingIfNeeded: height))
            tlv.put(0x02, byte: UInt8(truncatingIfNeeded: PacketsJava.floatToInt(weight)))
            tlv.put(0x03, byte: UInt8(truncatingIfNeeded: info.age))
            if info.isBirthdayValid { tlv.put(0x04, int: info.birthday) }
            if info.isGenderValid {
                if info.unknownGenderSupported || Int(info.gender) != UserInfoData.genderUnknown { tlv.put(0x05, byte: info.gender) }
            }
            tlv.put(0x06, byte: bmiWalk)
            tlv.put(0x07, byte: bmiRun)
            if info.vo2Supported {
                tlv.put(0x08, int: info.vo2Max)
                tlv.put(0x09, int: info.vo2Time)
            }
            if info.precisionWeightSupported {
                tlv.put(0x0b, int: PacketsJava.round(weight * 100))
            }
            return HuaweiPacket(serviceId: FitnessData.id, commandId: id, tlv: tlv)
        }
    }

    // MARK: MessageCount

    public enum MessageCount {
        public static let sleepId: UInt8 = 0x0C
        public static let stepId: UInt8 = 0x0A

        public static func request(commandId: UInt8, start: Int32, end: Int32) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x81)
            tlv.put(0x03, int: start)
            tlv.put(0x04, int: end)
            return HuaweiPacket(serviceId: FitnessData.id, commandId: commandId, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var count: Int16

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "MessageCount")
                count = try PacketsJava.parsing("MessageCount") { try tlv.object(0x81).short(0x02) }
            }
        }
    }

    // MARK: MessageData

    public enum MessageData {
        public static let sleepId: UInt8 = 0x0D
        public static let stepId: UInt8 = 0x0B

        public static func request(commandId: UInt8, count: Int16) -> HuaweiPacket {
            var inner = HuaweiTLV()
            inner.put(0x02, short: count)
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: inner)
            return HuaweiPacket(serviceId: FitnessData.id, commandId: commandId, tlv: tlv)
        }

        public struct SleepResponse: PacketResponse {
            public struct SubContainer: Equatable {
                /// A Java `byte`.
                public var type: Int8
                public var timestamp: Bytes
            }

            public var number: Int16
            public var containers: [SubContainer] = []

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "SleepData")
                number = 0
                try PacketsJava.parsing("SleepData") {
                    let container = try tlv.object(0x81)
                    let subContainers = try container.objects(0x83)
                    number = try container.short(0x02)
                    for sub in subContainers {
                        containers.append(SubContainer(type: try sub.byte(0x04), timestamp: try sub.bytes(0x05)))
                    }
                }
            }
        }

        public struct StepResponse: PacketResponse {
            public struct SubContainer {
                public struct TV: Equatable {
                    public var bitmap: Int8
                    public var tag: Int8
                    public var value: Int16
                }

                /// Data directly from the packet.
                public var timestampOffset: Int8 = 0
                public var data: Bytes = []

                /// Inferred data; Java ints that stay -1 when the watch sent no such feature.
                public var timestamp: Int32 = 0
                public var parsedData: [TV]?
                public var parsedDataError = ""
                public var steps: Int32 = -1
                public var calories: Int32 = -1
                public var distance: Int32 = -1
                public var heartrate: Int32 = -1
                public var spo: Int32 = -1
                public var restingHeartRate: Int32 = -1
                public var unknownTVs: [TV]?
            }

            public var number: Int16
            public var timestamp: Int32
            public var containers: [SubContainer] = []

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "StepData")
                number = 0
                timestamp = 0
                try PacketsJava.parsing("StepData") {
                    let container = try tlv.object(0x81)
                    let subContainers = try container.objects(0x84)
                    number = try container.short(0x02)
                    timestamp = try container.int(0x03)
                    for sub in subContainers {
                        var subContainer = SubContainer()
                        subContainer.timestampOffset = try sub.byte(0x05)
                        subContainer.timestamp = timestamp &+ 60 &* Int32(subContainer.timestampOffset)
                        subContainer.data = try sub.bytes(0x06)
                        StepResponse.parseData(&subContainer, subContainer.data)
                        containers.append(subContainer)
                    }
                }
            }

            /// The feature bitmaps: bitmap 1 (bits 0x01...0x40; bit 0x80 announces bitmap 2) then bitmap 2 (bits 0x01...0x80), each set bit
            /// followed by its value; 0x20 and 0x40 of bitmap 1 and every bitmap 2 value are one signed byte, the rest two bytes.
            static func parseData(_ result: inout SubContainer, _ data: Bytes) {
                var i = 0
                if data.isEmpty {
                    result.parsedData = nil
                    result.parsedDataError = "Data is missing feature bitmap."
                    return
                }
                let featureBitmap1 = data[i]
                i += 1

                var featureBitmap2: UInt8 = 0
                if featureBitmap1 & 128 != 0 {
                    if data.count <= i {
                        result.parsedData = nil
                        result.parsedDataError = "Data is missing second feature bitmap."
                        return
                    }
                    featureBitmap2 = data[i]
                    i += 1
                }

                result.parsedData = []
                result.unknownTVs = []

                // Java is always signed, so the byte loop only walks 7 bits
                for bitToCheck: UInt8 in [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40] where featureBitmap1 & bitToCheck != 0 {
                    let value: Int16
                    if bitToCheck == 0x20 || bitToCheck == 0x40 {
                        if data.count - 1 < i {
                            result.parsedData = nil
                            result.parsedDataError = "Data is too short for selected features."
                            return
                        }
                        value = Int16(Int8(bitPattern: data[i]))
                        i += 1
                    } else {
                        if data.count - 2 < i {
                            result.parsedData = nil
                            result.parsedDataError = "Data is too short for selected features."
                            return
                        }
                        value = Int16(bitPattern: UInt16(data[i]) << 8 | UInt16(data[i + 1]))
                        i += 2
                    }

                    // The bit is used as tag, which may not be optimal, but works
                    let tv = SubContainer.TV(bitmap: 1, tag: Int8(bitPattern: bitToCheck), value: value)
                    result.parsedData?.append(tv)

                    switch bitToCheck {
                    case 0x02: result.steps = Int32(value)
                    case 0x04: result.calories = Int32(value)
                    case 0x08: result.distance = Int32(value)
                    case 0x40: result.heartrate = Int32(value)
                    default: result.unknownTVs?.append(tv)
                    }
                }

                if featureBitmap2 != 0 {
                    for bitToCheck: UInt8 in [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80] where featureBitmap2 & bitToCheck != 0 {
                        if data.count - 1 < i {
                            result.parsedData = nil
                            result.parsedDataError = "Data is too short for selected features."
                            return
                        }
                        let value = Int8(bitPattern: data[i])
                        i += 1

                        let tv = SubContainer.TV(bitmap: 2, tag: Int8(bitPattern: bitToCheck), value: Int16(value))
                        result.parsedData?.append(tv)

                        switch bitToCheck {
                        case 0x01: result.spo = Int32(value)
                        case 0x02: result.restingHeartRate = Int32(value)
                        default: result.unknownTVs?.append(tv)
                        }
                    }
                }
            }
        }
    }

    // MARK: FitnessTotals

    public enum FitnessTotals {
        public static let id: UInt8 = 0x03

        public static func request() -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01)
            return HuaweiPacket(serviceId: FitnessData.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public var totalSteps: Int32 = 0
            public var totalCalories: Int32 = 0
            public var totalDistance: Int32 = 0

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "FitnessTotals")
                try PacketsJava.parsing("FitnessTotals") {
                    let container = try tlv.object(0x81)
                    for sub in try container.objects(0x83) {
                        if sub.contains(0x05) { totalSteps = totalSteps &+ (try sub.int(0x05)) }
                        if sub.contains(0x06) { totalCalories = totalCalories &+ Int32(try sub.short(0x06)) }
                        if sub.contains(0x07) { totalDistance = totalDistance &+ (try sub.int(0x07)) }
                    }
                }
            }
        }
    }
}
