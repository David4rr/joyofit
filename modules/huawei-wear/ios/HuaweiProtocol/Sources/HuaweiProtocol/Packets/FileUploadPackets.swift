// Port of FileUpload.java (Gadgetbridge, AGPL-3.0-or-later): the packets of service 0x28, where the watch drives and the phone answers:
// file info (0x02), hash (0x03), parameters / ack (0x04), next chunk (0x05, watch), chunk data (0x06, phone), result (0x07) and the
// watch's error report (0x08).
//
// Java mapping: every `Request` class becomes a `static func request(...) -> HuaweiPacket` with the same service/command, TLV, `isEncrypted`
// and `isSliced` as the Java constructor; every `Response` class a `struct Response: PacketResponse` over `packet.tlv`. The chunk data is
// not a TLV packet: `HuaweiPacket.serializeFileChunk` (Packet+FileChunk.swift) frames it.
import Foundation

/// `String.split(regex)` for a one-character separator, as Java does it: a string without the separator is returned whole (also ""),
/// otherwise trailing empty strings are dropped (so "_" gives no parts at all) and a leading one is kept.
func javaSplit(_ s: String, separator: Character) -> [String] {
    if !s.contains(separator) { return [s] }
    var parts = s.split(separator: separator, omittingEmptySubsequences: false).map(String.init)
    while let last = parts.last, last.isEmpty { parts.removeLast() }
    return parts
}

public enum FileUpload {
    public static let id: UInt8 = 0x28

    /// `FileUpload.FileUploadParams`: what the watch agreed to in 0x28/0x04.
    public struct FileUploadParams: Equatable, Sendable {
        public var fileId: Int8 = 0
        public var protocolVersion = ""
        public var appWaitTime: Int32 = 0
        public var bitmapEnable: Int32 = 0
        public var unitSize: Int32 = 0
        public var maxApplyDataSize: Int32 = 0
        public var interval: Int32 = 0
        public var receivedFileSize: Int32 = 0
        public var noEncrypt: Int8 = 0

        public init() {}
    }

    /// `FileUpload.Filetype`.
    public enum Filetype {
        public static let watchface: UInt8 = 1
        public static let music: UInt8 = 2
        public static let backgroundImage: UInt8 = 3
        public static let app: UInt8 = 6
        public static let firmware: UInt8 = 7
    }

    /// Phone to watch: name, size, type. A watch face adds its id and version (the two halves of `<id>_<version>`); a P2P file the
    /// package names and fingerprints (tags 0x08 to 0x0c).
    public enum FileInfoSend {
        public static let id: UInt8 = 0x02

        /// Throws `PacketError.serialize` where the Java constructor throws ArrayIndexOutOfBounds: a watch face name without a version.
        public static func request(
            fileSize: Int32, fileName: String, fileType: UInt8,
            srcPackage: String? = nil, dstPackage: String? = nil, srcFingerprint: String? = nil, dstFingerprint: String? = nil
        ) throws -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, string: fileName)
            tlv.put(0x02, int: fileSize)
            tlv.put(0x03, byte: fileType)
            if fileType == Filetype.watchface {
                let parts = javaSplit(fileName, separator: "_")
                guard parts.count >= 2 else {
                    throw PacketError.serialize("FileInfoSend: '\(fileName)' is not <id>_<version> (ArrayIndexOutOfBoundsException in GB)")
                }
                tlv.put(0x05, string: parts[0])
                tlv.put(0x06, string: parts[1])
            }
            if srcPackage != nil && dstPackage != nil {
                tlv.put(0x08, string: srcPackage)
                tlv.put(0x09, string: dstPackage)
                tlv.put(0x0a)
                tlv.put(0x0b, string: srcFingerprint)
                tlv.put(0x0c, string: dstFingerprint)
            }
            return HuaweiPacket(serviceId: FileUpload.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let result: Int32

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "FileInfoSend")
                result = try PacketsJava.parsing("FileInfoSend") { try tlv.int(0x7f) }
            }
        }
    }

    /// Phone to watch: the SHA-256 of the file, for the file id the watch assigned.
    public enum FileHashSend {
        public static let id: UInt8 = 0x03

        public static func request(hash: Bytes, fileId: UInt8) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, byte: fileId)
            tlv.put(0x03, bytes: hash)
            return HuaweiPacket(serviceId: FileUpload.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let fileId: UInt8

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "FileHashSend")
                fileId = try PacketsJava.parsing("FileHashSend") { UInt8(bitPattern: try tlv.byte(0x01)) }
            }
        }
    }

    /// The watch's transfer parameters, and the phone's "go ahead".
    public enum FileUploadConsultAck {
        public static let id: UInt8 = 0x04

        public static func request(noEncryption: UInt8, fileId: UInt8) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x7f, int: 0x0001_86A0) // ok
            tlv.put(0x01, byte: fileId)
            if noEncryption == 1 {
                tlv.put(0x09, byte: 0x01) // needed on devices that encrypt in general, but not the files
            }
            return HuaweiPacket(serviceId: FileUpload.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            public let fileUploadParams: FileUploadParams

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "FileUploadConsultAck")
                fileUploadParams = try PacketsJava.parsing("FileUploadConsultAck") {
                    var p = FileUploadParams()
                    p.fileId = try tlv.byte(0x01)
                    p.protocolVersion = try tlv.string(0x02)
                    p.appWaitTime = try tlv.asInteger(0x03)
                    p.bitmapEnable = try tlv.asInteger(0x04)
                    p.unitSize = try tlv.asInteger(0x05)
                    p.maxApplyDataSize = try tlv.asInteger(0x06)
                    p.interval = try tlv.asInteger(0x07)
                    p.receivedFileSize = try tlv.int(0x08)
                    if tlv.contains(0x09) { p.noEncrypt = try tlv.byte(0x09) } // optional for older devices
                    return p
                }
            }
        }
    }

    /// Watch to phone: where it wants the next chunk from, and how long. (GB `FileNextChunkParams`; the Java class is the response itself.)
    public struct FileNextChunkParams: PacketResponse {
        public static let id: UInt8 = 0x05

        public let bytesUploaded: Int32
        public let nextchunkSize: Int32

        public init(packet: HuaweiPacket) throws {
            let tlv = try PacketsJava.tlv(of: packet, "FileNextChunkParams")
            (bytesUploaded, nextchunkSize) = try PacketsJava.parsing("FileNextChunkParams") { (try tlv.int(0x02), try tlv.int(0x03)) }
        }
    }

    /// Phone to watch, the chunk itself: 0x28/0x06, framed by `HuaweiPacket.serializeFileChunk`, never as a TLV.
    public enum FileNextChunkSend {
        public static let id: UInt8 = 0x06

        /// The carrier packet `serializeFileChunk` frames data for.
        public static func packet() -> HuaweiPacket {
            HuaweiPacket(serviceId: FileUpload.id, commandId: id, tlv: nil)
        }
    }

    public enum FileUploadResult {
        public static let id: UInt8 = 0x07

        public static func request(fileId: UInt8) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x7f, int: 0x0001_86A0) // ok
            tlv.put(0x01, byte: fileId)
            return HuaweiPacket(serviceId: FileUpload.id, commandId: id, tlv: tlv)
        }

        public struct Response: PacketResponse {
            /// Tag 0x02, Huawei Health's `validity_result` (1 = the watch accepted the file); -1 when the tag is absent.
            public let status: Int32

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "FileUploadResult")
                status = tlv.asInteger(0x02, default: -1)
            }
        }
    }

    /// Watch to phone: the watch's error report for a file id.
    public enum FileUploadDeviceResponse {
        public static let id: UInt8 = 0x08

        public struct Response: PacketResponse {
            public let fileId: UInt8
            public let code: Int32

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "FileUploadDeviceResponse")
                fileId = UInt8(bitPattern: tlv.byte(0x01, default: 0))
                code = tlv.asInteger(0x7f, default: 0)
            }
        }
    }
}
