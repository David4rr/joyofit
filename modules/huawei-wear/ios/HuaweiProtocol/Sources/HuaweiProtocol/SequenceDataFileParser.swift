// Port of HuaweiSequenceDataFileParser.java: the container of a `sequence_data` file (dictionary sync, service 0x2C file type 0x16).
// Layout, big-endian: 32-byte file header (size int, dict id int, file type short, version short, 20 extra bytes), then records of a
// 32-byte header (start int, end int, data version byte, summary type byte, summary length short, detail length int, 16 extra bytes)
// followed by the summary and the details.
import Foundation

public enum SequenceDataFileParser {
    public struct SequenceData: Equatable, CustomStringConvertible {
        public var startTime: Int32 = 0
        public var endTime: Int32 = 0
        /// A signed Java byte widened to int.
        public var dataVersion = 0
        public var summaryType = 0
        public var extraData = Bytes()
        public var summary: Bytes?
        public var details: Bytes?

        public init() {}

        public var description: String {
            "SequenceData{startTime=\(startTime), endTime=\(endTime), version=\(dataVersion), summaryType=\(summaryType), "
                + "summary=\(SequenceDataFileParser.javaArrayString(summary)), details=\(SequenceDataFileParser.javaArrayString(details)), "
                + "extraData=\(SequenceDataFileParser.javaArrayString(extraData))}"
        }
    }

    public struct SequenceFileData: Equatable, CustomStringConvertible {
        public var dataSize: Int64 = 0
        public var dictId: Int32 = 0
        /// A signed Java short widened to int.
        public var fileType = 0
        public var fileVersion = 0
        public var extraData = Bytes()
        public var sequenceDataList: [SequenceData] = []

        public init() {}

        public var description: String {
            "SequenceFileData{dataSize=\(dataSize), fileType=\(fileType), dictId=\(dictId), fileVersion=\(fileVersion), "
                + "sequenceDataList=[\(sequenceDataList.map { $0.description }.joined(separator: ", "))], "
                + "extraData=\(SequenceDataFileParser.javaArrayString(extraData))}"
        }
    }

    /// `Arrays.toString(byte[])`: signed values, `null` for nil.
    static func javaArrayString(_ b: Bytes?) -> String {
        guard let b else { return "null" }
        return "[" + b.map { String(Int8(bitPattern: $0)) }.joined(separator: ", ") + "]"
    }

    /// GB's cap on a details block ("I suppose 20 Mb will be enough for now"); the factor 1025 is GB's.
    static let maxDetailLength = 20 * 1025 * 1024

    private static func parseSequenceData(_ buffer: inout SleepFilesByteBuffer, into fileData: inout SequenceFileData) throws {
        while buffer.remaining >= 32 {
            var data = SequenceData()
            data.startTime = try buffer.getInt()
            data.endTime = try buffer.getInt()
            data.dataVersion = Int(try buffer.get())
            data.summaryType = Int(try buffer.get())
            let summaryDataLen = Int(try buffer.getShort())
            let detailLen = Int(try buffer.getInt())
            data.extraData = try buffer.get(count: 16)

            // parseSummary: a summary longer than the rest is only logged by GB (and not taken); a negative length throws.
            if data.dataVersion == 1 {
                if buffer.remaining < summaryDataLen {
                    // LOG.error("summaryDataLen exceeds remaining")
                } else {
                    data.summary = try buffer.get(count: summaryDataLen)
                }
            }
            // parse details: an invalid length is only logged; a length beyond the rest is logged and then the read throws.
            if detailLen <= 0 || detailLen > maxDetailLength {
                // LOG.error("detailLen is invalid")
            } else {
                data.details = try buffer.get(count: detailLen)
            }
            fileData.sequenceDataList.append(data)
        }
    }

    /// `parseSequenceFileData`: nil for a file shorter than the 32-byte header. Throws where Java throws (a record whose summary
    /// length is negative, or whose details run past the end of the file).
    public static func parseSequenceFileData(_ data: Bytes) throws -> SequenceFileData? {
        if data.count < 32 { return nil }
        var buffer = SleepFilesByteBuffer(data)
        var fileData = SequenceFileData()
        fileData.dataSize = Int64(try buffer.getInt())
        fileData.dictId = try buffer.getInt()
        fileData.fileType = Int(try buffer.getShort())
        fileData.fileVersion = Int(try buffer.getShort())
        fileData.extraData = try buffer.get(count: 20)
        try parseSequenceData(&buffer, into: &fileData)
        return fileData
    }
}
