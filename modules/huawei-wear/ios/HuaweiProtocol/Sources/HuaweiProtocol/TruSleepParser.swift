// Port of HuaweiTruSleepParser.java (without GB's analyze/SleepFileDownloadCallback, which watch-fit replaced by SleepSync):
// `sleep_state.bin` (parseState) and `sleep_data.bin` (parseData: ACC and PPG samples), both little-endian.
import Foundation

public enum TruSleepParser {
    public static let tagAcc = 1
    public static let tagPpg = 2

    /// A span of TruSleep state, seconds since the epoch.
    public struct TruSleepStatus: Equatable, CustomStringConvertible {
        public let startTime: Int32
        public let endTime: Int32

        public init(startTime: Int32, endTime: Int32) {
            self.startTime = startTime
            self.endTime = endTime
        }

        public var description: String { "TruSleepStatus{endTime=\(endTime), startTime=\(startTime)}" }
    }

    /// Accelerometer: sampled every 60 seconds on three axes (a byte each, 0x00 no activity, 0xff high); the third is ignored.
    public struct TruSleepDataAcc: Equatable, CustomStringConvertible {
        public let startTime: Int32
        public let flags: Int16

        public init(startTime: Int32, flags: Int16) {
            self.startTime = startTime
            self.flags = flags
        }

        public var description: String { "TruSleepDataAcc{startTime=\(startTime), flags=\(flags)}" }
    }

    /// Photoplethysmogram: every sample has a millisecond timestamp.
    public struct TruSleepDataPpg: Equatable, CustomStringConvertible {
        public let startTime: Int64
        public let flags: Int16

        public init(startTime: Int64, flags: Int16) {
            self.startTime = startTime
            self.flags = flags
        }

        public var description: String { "TruSleepDataPpg{startTime=\(startTime), flags=\(flags)}" }
    }

    public struct TruSleepData: Equatable {
        public var dataACCs: [TruSleepDataAcc] = []
        public var dataPPGs: [TruSleepDataPpg] = []

        public init() {}

        private static let compressionRaw: Int8 = Int8(bitPattern: 0xaa)
        private static let compressionComp: Int8 = Int8(bitPattern: 0xbb)
        private static let compressionRestart: Int8 = Int8(bitPattern: 0xff)

        /// `decodeAcc`: timestamp (4 bytes) and flags (3 bytes, of which the first 2 are read).
        mutating func decodeAcc(_ data: Bytes) throws {
            var buffer = SleepFilesByteBuffer(data, littleEndian: true)
            if buffer.remaining < 4 { throw SleepFilesParseError.illegalArgument("Timestamp is missing") }
            let startTime = try buffer.getInt()
            if buffer.remaining < 2 { throw SleepFilesParseError.illegalArgument("Flags are missing") }
            let flags = try buffer.getShort()
            dataACCs.append(TruSleepDataAcc(startTime: startTime, flags: flags))
        }

        /// `decodePpg`: timestamp (4 bytes), number of UINT16 (1 byte), then the peak and the amplitude arrays, each with a
        /// compression tag. Nothing is added unless both arrays decode to exactly that number.
        mutating func decodePpg(_ data: Bytes) throws {
            var buffer = SleepFilesByteBuffer(data, littleEndian: true)
            if buffer.remaining < 4 { throw SleepFilesParseError.illegalArgument("Timestamp is missing") }
            let startTime = try buffer.getInt()
            if buffer.remaining < 1 { throw SleepFilesParseError.illegalArgument("Count of short is missing") }
            let countShort = try buffer.get() // a signed byte, as in Java

            let peak = try Self.decodePeak(countShort, &buffer)
            let amp = try Self.decodeAmp(countShort, &buffer)

            // Sanity check
            if peak.count != Int(countShort) || amp.count != Int(countShort) {
                throw SleepFilesParseError.illegalArgument("Decoded arrays have different length")
            }
            for i in 0..<Int(countShort) {
                dataPPGs.append(TruSleepDataPpg(startTime: Int64(startTime) * 1000 + Int64(Int32(peak[i]) * 10), flags: amp[i]))
            }
        }

        private static func decodePeak(_ countShortIn: Int8, _ buffer: inout SleepFilesByteBuffer) throws -> [Int16] {
            var countShort = countShortIn
            if countShort == 0 { throw SleepFilesParseError.illegalArgument("Number of short to generate is invalid") }
            if buffer.remaining < 1 { throw SleepFilesParseError.illegalArgument("Compression tag is missing") }
            let tag = try buffer.get()

            var al = [Int16]()
            if tag == compressionRaw {
                if buffer.remaining < Int(countShort) * 2 { throw SleepFilesParseError.illegalArgument("Not enough elements in buffer") }
                while countShort > 0 {
                    al.append(try buffer.getShort())
                    countShort -= 1
                }
            } else if tag == compressionComp {
                var working = try buffer.getShort()
                al.append(working)
                countShort &-= 1 // a Java byte decrement wraps

                while countShort > 0 {
                    let c = try buffer.get()
                    if c == compressionRestart {
                        if buffer.remaining < 2 { throw SleepFilesParseError.illegalArgument("Not enough elements in buffer") }
                        working = try buffer.getShort()
                    } else {
                        working = working &+ Int16(c)
                    }
                    al.append(working)
                    countShort &-= 1
                }
            } else {
                throw SleepFilesParseError.illegalArgument("Compression " + hex2(tag) + " is unsupported")
            }
            return al
        }

        static func decodeAmp(_ countShortIn: Int8, _ buffer: inout SleepFilesByteBuffer) throws -> [Int16] {
            var countShort = countShortIn
            if countShort == 0 { throw SleepFilesParseError.illegalArgument("Number of short to generate is invalid") }
            if buffer.remaining < 1 { throw SleepFilesParseError.illegalArgument("Compression tag is missing") }
            let tag = try buffer.get()

            var al = [Int16]()
            if tag == compressionRaw {
                if buffer.remaining < Int(countShort) * 2 { throw SleepFilesParseError.illegalArgument("Not enough elements in buffer") }
                while countShort > 0 {
                    al.append(try buffer.getShort())
                    countShort -= 1
                }
            } else if tag == compressionComp {
                if buffer.remaining < 2 { throw SleepFilesParseError.illegalArgument("Offset buffer is missing") }
                let offset = try buffer.getShort()
                var working: Int16 = 0
                while buffer.remaining > 0 {
                    let c = try buffer.get()
                    if c == compressionRestart {
                        if buffer.remaining < 2 { throw SleepFilesParseError.illegalArgument("Raw buffer is missing") }
                        working = offset &+ (try buffer.getShort())
                    } else {
                        working = offset &+ Int16(c)
                    }
                    al.append(working)
                }
            } else {
                throw SleepFilesParseError.illegalArgument("Compression " + hex2(tag) + " is unsupported")
            }
            return al
        }

        private static func hex2(_ b: Int8) -> String {
            let u = UInt8(bitPattern: b)
            return (u < 16 ? "0" : "") + String(u, radix: 16)
        }

        /// `parsePpgData`: a failure is only logged by GB; the sample is dropped.
        mutating func parsePpgData(_ data: Bytes) {
            do { try decodePpg(data) } catch { /* "Failed to parse TrueSleep PPG data" */ }
        }

        /// `parseAccData`: a failure is only logged by GB; the sample is dropped.
        mutating func parseAccData(_ data: Bytes) {
            do { try decodeAcc(data) } catch { /* "Failed to parse TrueSleep ACC data" */ }
        }
    }

    /// `parseData`: zero padding, ACC packets (tag 1, 1-byte length) interleaved with PPG packets (tag 2, 2-byte length, compressed).
    /// A length that runs past the end stops the parse; a length that is negative as a Java byte (ACC) or short (PPG) throws, as GB's
    /// `new byte[length]` does.
    public static func parseData(_ data: Bytes) throws -> TruSleepData {
        var sleepData = TruSleepData()
        var buffer = SleepFilesByteBuffer(data, littleEndian: true)
        while buffer.remaining > 0 {
            let c = Int(try buffer.get())

            // Skip over padding
            if c != tagAcc && c != tagPpg { continue }

            if c == tagAcc {
                if buffer.remaining < 1 { break }
                let length = Int(try buffer.get()) // ACC has a 1 byte length
                if buffer.remaining < length { break }
                sleepData.parseAccData(try buffer.get(count: length))
            } else {
                if buffer.remaining < 2 { break }
                let length = Int(try buffer.getShort()) // PPG has a 2 byte length
                if buffer.remaining < length { break }
                sleepData.parsePpgData(try buffer.get(count: length))
            }
        }
        return sleepData
    }

    /// `parseState`: records of start time (int), end time (int), 8 bytes not understood; trailing bytes short of a record are ignored.
    public static func parseState(_ stateData: Bytes) -> [TruSleepStatus] {
        var buffer = SleepFilesByteBuffer(stateData, littleEndian: true)
        var result = [TruSleepStatus]()
        result.reserveCapacity(stateData.count / 0x10)
        while stateData.count - buffer.position >= 0x10 {
            // The reads cannot fail: 16 bytes are left.
            let startTime = (try? buffer.getInt()) ?? 0
            let endTime = (try? buffer.getInt()) ?? 0
            _ = try? buffer.get(count: 8)
            result.append(TruSleepStatus(startTime: startTime, endTime: endTime))
        }
        return result
    }
}
