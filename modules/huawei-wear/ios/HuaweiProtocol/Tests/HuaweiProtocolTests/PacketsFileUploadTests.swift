import XCTest
@testable import HuaweiProtocol

/// Asserts a Swift response parse equals what the real Java parsed (fields) or failed with (same exception class, parse failure or not).
func assertResponse(
    _ c: [String: Any], file: StaticString = #filePath, line: UInt = #line, parse: (HuaweiPacket) throws -> [String: Any]
) throws {
    let name = c.str("name")
    let packet = try PacketsKit.tlvPacket(c.int("service"), c.int("command"), c.str("tlv"))
    do {
        let fields = try parse(packet)
        guard c.bool("ok") else {
            XCTFail("\(name): Java failed with \(c.str("exception")) but Swift parsed", file: file, line: line)
            return
        }
        XCTAssertEqual(PacketsKit.canonical(fields), PacketsKit.canonical(c["fields"] ?? [:]), name, file: file, line: line)
    } catch {
        guard !c.bool("ok") else {
            XCTFail("\(name): Java parsed but Swift failed with \(error)", file: file, line: line)
            return
        }
        let (swiftName, swiftParse) = PacketsKit.exceptionClass(error)
        XCTAssertEqual(swiftParse, c.bool("parseException"), "\(name): Java \(c.str("exception")), Swift \(swiftName)", file: file, line: line)
        if c.bool("parseException") { XCTAssertEqual(swiftName, c.str("exception"), name, file: file, line: line) }
    }
}

/// Asserts a Swift request equals the Java one: ids, flags, TLV and frames; or that both refuse to build it.
func assertRequest(_ c: [String: Any], file: StaticString = #filePath, line: UInt = #line, make: () throws -> HuaweiPacket) throws {
    let name = c.str("name")
    if c["ok"] as? Bool == false {
        XCTAssertThrowsError(try make(), "\(name): Java throws \(c.str("exception"))", file: file, line: line)
        return
    }
    let packet = try make()
    XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name, file: file, line: line)
    XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name, file: file, line: line)
    XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name, file: file, line: line)
    XCTAssertEqual(packet.isSliced, c.bool("sliced"), name, file: file, line: line)
    XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name, file: file, line: line)
    XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name, file: file, line: line)
}

final class PacketsFileUploadTests: XCTestCase {
    let g = try! Golden.load("packetsFileUpload")

    func testRequestsMatchJava() throws {
        let requests = g.list("requests")
        XCTAssertEqual(requests.count, 22)
        var refused = 0
        for c in requests {
            let name = c.str("name")
            if c["ok"] as? Bool == false { refused += 1 }
            switch name {
            case _ where name.hasPrefix("ack"):
                try assertRequest(c) { FileUpload.FileUploadConsultAck.request(noEncryption: UInt8(c.int("noEncryption")), fileId: UInt8(c.int("fileId"))) }
            case _ where name.hasPrefix("result ack"):
                try assertRequest(c) { FileUpload.FileUploadResult.request(fileId: UInt8(c.int("fileId"))) }
            case _ where name.hasPrefix("hash"):
                try assertRequest(c) { FileUpload.FileHashSend.request(hash: c.bytes("hash"), fileId: UInt8(c.int("fileId"))) }
            default:
                try assertRequest(c) {
                    try FileUpload.FileInfoSend.request(
                        fileSize: Int32(truncatingIfNeeded: c.int("fileSize")), fileName: c.str("fileName"), fileType: UInt8(c.int("fileType")),
                        srcPackage: c.opt("src"), dstPackage: c.opt("dst"), srcFingerprint: c.opt("srcFingerprint"), dstFingerprint: c.opt("dstFingerprint")
                    )
                }
            }
        }
        XCTAssertEqual(refused, 3, "the watch face names without a version")
    }

    func testChunkFramingMatchesJava() throws {
        let chunks = g.list("chunks")
        XCTAssertGreaterThanOrEqual(chunks.count, 9)
        for c in chunks {
            let params = ParamsProvider()
            params.transactionsCrypted = false
            params.sliceSize = c.int("sliceSize")
            let frames = try FileUpload.FileNextChunkSend.packet().serializeFileChunk(
                c.bytes("data"), uploadPosition: c.int("position"), unitSize: c.int("unit"), fileId: UInt8(c.int("fileId")), useEncryption: false,
                params: params
            )
            XCTAssertEqual(frames.map { $0.hexLower }, (c["frames"] as? [String]) ?? [], c.str("name"))
        }
    }

    func testChunkFramingRefusesAZeroUnitSize() {
        XCTAssertThrowsError(try FileUpload.FileNextChunkSend.packet().serializeFileChunk(
            [1, 2], uploadPosition: 0, unitSize: 0, fileId: 1, useEncryption: false, params: ParamsProvider()
        ))
    }

    func testEncryptedChunksDecryptToTheSamePlainPackets() throws {
        let params = ParamsProvider()
        params.secretKey = Bytes(repeating: 7, count: 16)
        params.sliceSize = 0xf4
        let data = Bytes((0..<500).map { UInt8(truncatingIfNeeded: $0 &* 3) })
        let frames = try FileUpload.FileNextChunkSend.packet().serializeFileChunk(
            data, uploadPosition: 1000, unitSize: 200, fileId: 5, useEncryption: true, params: params
        )
        var assembler = PacketAssembler()
        var plain = [Bytes]()
        for f in frames {
            let result = try assembler.feed(f, params: params)
            if let packet = result.packet {
                XCTAssertEqual(packet.serviceId, 0x28)
                XCTAssertEqual(packet.commandId, 0x06)
                // The assembler leaves 0x28/0x06 undecrypted: payload is the two ids and the 7C/7D/7E wrapper.
                let wrapper = try HuaweiTLV(parsing: packet.payload!, offset: 2, length: packet.payload!.count - 2)
                plain.append(try wrapper.fileDownloadDecryptRaw(params: params))
            }
        }
        XCTAssertEqual(plain.count, 3)
        var joined = Bytes()
        for (i, p) in plain.enumerated() {
            XCTAssertEqual(p[0], 5)
            XCTAssertEqual(p[1], UInt8(i))
            XCTAssertEqual(p.u32be(2), UInt32(1000 + 200 * i))
            joined += p[6...]
        }
        XCTAssertEqual(joined, data)
    }

    func testResponsesMatchJava() throws {
        let responses = g.list("responses")
        XCTAssertEqual(responses.count, 31)
        for c in responses {
            let name = c.str("name")
            try assertResponse(c) { packet in
                switch name {
                case _ where name.hasPrefix("info"):
                    return ["result": Int(try FileUpload.FileInfoSend.Response(packet: packet).result)]
                case _ where name.hasPrefix("hash"):
                    return ["fileId": Int(Int8(bitPattern: try FileUpload.FileHashSend.Response(packet: packet).fileId))]
                case _ where name.hasPrefix("consult"):
                    let p = try FileUpload.FileUploadConsultAck.Response(packet: packet).fileUploadParams
                    return [
                        "fileId": Int(p.fileId), "protocolVersion": p.protocolVersion, "appWaitTime": Int(p.appWaitTime),
                        "bitmapEnable": Int(p.bitmapEnable), "unitSize": Int(p.unitSize), "maxApplyDataSize": Int(p.maxApplyDataSize),
                        "interval": Int(p.interval), "receivedFileSize": Int(p.receivedFileSize), "noEncrypt": Int(p.noEncrypt),
                    ]
                case _ where name.hasPrefix("next chunk"):
                    let p = try FileUpload.FileNextChunkParams(packet: packet)
                    return ["bytesUploaded": Int(p.bytesUploaded), "nextchunkSize": Int(p.nextchunkSize)]
                case _ where name.hasPrefix("result"):
                    return ["status": Int(try FileUpload.FileUploadResult.Response(packet: packet).status)]
                default:
                    let r = try FileUpload.FileUploadDeviceResponse.Response(packet: packet)
                    return ["fileId": Int(Int8(bitPattern: r.fileId)), "code": Int(r.code)]
                }
            }
        }
    }
}

final class PacketsWatchfaceTests: XCTestCase {
    let g = try! Golden.load("packetsWatchface")

    func testRequestsMatchJava() throws {
        let requests = g.list("requests")
        XCTAssertEqual(requests.count, 31)
        for c in requests {
            let name = c.str("name")
            switch name {
            case "params": try assertRequest(c) { Watchface.WatchfaceParams.request() }
            case "list": try assertRequest(c) { Watchface.DeviceWatchInfo.request() }
            case _ where name.hasPrefix("operation"):
                try assertRequest(c) { try Watchface.WatchfaceOperation.request(fileName: c.str("fileName"), operation: UInt8(c.int("operation"))) }
            case _ where name.hasPrefix("confirm"):
                try assertRequest(c) { try Watchface.WatchfaceConfirm.request(fileName: c.str("fileName")) }
            default:
                let faces = c.list("faces").map {
                    Watchface.InstalledWatchfaceInfo(
                        fileName: $0.str("fileName"), version: $0.str("version"), type: Int8(truncatingIfNeeded: $0.int("type")),
                        expandedType: Int8(truncatingIfNeeded: $0.int("expandedType"))
                    )
                }
                try assertRequest(c) { Watchface.WatchfaceNameInfo.request(watchfaceList: faces) }
            }
        }
    }

    func testResponsesMatchJava() throws {
        let responses = g.list("responses")
        XCTAssertEqual(responses.count, 34)
        for c in responses {
            try assertResponse(c) { packet in
                switch c.int("command") {
                case 1:
                    let p = try Watchface.WatchfaceParams.Response(packet: packet).params
                    return [
                        "maxVersion": p.maxVersion, "width": Int(p.width), "height": Int(p.height), "supportFileType": Int(p.supportFileType),
                        "sort": Int(p.sort), "otherWatchfaceVersions": p.otherWatchfaceVersions, "supportCapability": Int(p.supportCapability),
                        "supportSync": Int(p.supportSync), "mode": Int(p.mode), "status": Int(p.status),
                    ]
                case 2:
                    let list = try Watchface.DeviceWatchInfo.Response(packet: packet).watchfaceInfoList.map { i -> [String: Any] in
                        [
                            "fileName": i.fileName, "version": i.version, "type": Int(i.type), "expandedType": Int(i.expandedType),
                            "isCurrent": i.isCurrent, "isFactory": i.isFactory, "isEditable": i.isEditable, "isVideo": i.isVideo,
                            "isPhoto": i.isPhoto, "isTryout": i.isTryout, "isKaleidoscope": i.isKaleidoscope,
                        ]
                    }
                    return ["list": list]
                case 3:
                    let r = try Watchface.WatchfaceOperation.Response(packet: packet)
                    return [
                        "code": Int(r.code), "needReceive": Int(r.needReceive), "watchfaceId": r.watchfaceId, "watchfaceVersion": r.watchfaceVersion,
                    ]
                case 5:
                    let r = try Watchface.WatchfaceConfirm.Response(packet: packet)
                    return ["reportType": Int(r.reportType), "fileName": r.fileName]
                default:
                    return ["names": try Watchface.WatchfaceNameInfo.Response(packet: packet).watchFaceNames]
                }
            }
        }
    }
}
