import XCTest
@testable import HuaweiProtocol

/// The service 0x37 builders against the reference byte examples of the Kotlin DataSyncCodecTest (nothing here was seen on a watch), and the
/// editable-face TLVs against the hand-computed layouts of the Kotlin FaceCustomCodecTest.
final class DataSyncWireTests: XCTestCase {
    /// The Fit 4's slice size (observed LinkParams: 1022), so the 451-byte example is one frame.
    func plain() -> ParamsProvider {
        let p = ParamsProvider()
        p.transactionsCrypted = false
        p.sliceSize = 1022
        return p
    }

    func hex(_ s: String) -> Bytes { Bytes(hex: s.replacingOccurrences(of: " ", with: ""))! }

    /// `5A | len | 00 | service | command | TLV | CRC16` for an unsliced, unencrypted packet.
    func frame(_ command: Int, _ tlv: Bytes) -> Bytes {
        let body = Bytes([0x00, 0x37, UInt8(command)]) + tlv
        var head = Bytes([0x5A, UInt8(body.count >> 8), UInt8(body.count & 0xFF)]) + body
        head.appendBE(CRC16.checksum(head))
        return head
    }

    func serialize(_ packet: HuaweiPacket) throws -> Bytes {
        let out = try packet.serialize(params: plain())
        XCTAssertEqual(out.count, 1)
        return out[0]
    }

    /// Independent of HuaweiTLV: tag, varint length, value.
    func tlv(_ tag: Int, _ value: Bytes) -> Bytes {
        let n = value.count
        let length: Bytes = n < 128 ? [UInt8(n)] : [UInt8((n >> 7) | 0x80), UInt8(n & 0x7F)]
        return [UInt8(tag)] + length + value
    }

    let dietPhone = "hw.unitedevice.weightMgr"
    let dietWatch = "hw.sport.dietcal"

    let mealsExample = Bytes(hex: "5b7b2265617454696d65223a313736303430303030302c22686173466f6f64223a747275652c226b696c6f43616c6f726965223a3335302e302c2273756752616e6765223a5b3438302c3732305d2c2277686963684d65616c223a31307d2c7b2265617454696d65223a313736303430303030302c22686173466f6f64223a66616c73652c226b696c6f43616c6f726965223a302e302c2273756752616e6765223a5b3630302c3830305d2c2277686963684d65616c223a32307d2c7b2265617454696d65223a313736303430303030302c22686173466f6f64223a66616c73652c226b696c6f43616c6f726965223a302e302c2273756752616e6765223a5b3438302c3732305d2c2277686963684d65616c223a33307d2c7b2265617454696d65223a313736303430303030302c22686173466f6f64223a66616c73652c226b696c6f43616c6f726965223a302e302c2273756752616e6765223a5b302c3130305d2c2277686963684d65616c223a34307d5d")!

    func testSamplePointMatchesTheDietExample() throws {
        let packet = DataSyncWire.samplePoint(
            srcPkg: dietPhone, wearPkg: dietWatch, dictType: 0x927c2, values: [PointValue(key: 0x927c2, value: mealsExample)], startMs: 0, endMs: 0, metadata: nil
        )
        // Reference example: 451 bytes of `37 03 ...`; the first two bytes are service and command.
        let expected = hex("3703011868772e756e6974656465766963652e7765696768744d6772021068772e73706f72742e6469657463616c0304000927c204040000000005040000000086830087827d0804000927c2098274") + mealsExample
        XCTAssertEqual(expected.count, 451)
        XCTAssertEqual(try serialize(packet), frame(DataSyncWire.cmdPoint, Array(expected[2...])))
    }

    func testConfigMatchesTheDietExample() throws {
        let json = "{\"onePointFull\":{\"breakfast\":600,\"lunch\":800,\"dinner\":600},\"caloricDeficitGoal\":500,\"weightInit\":70.0,\"activityCalGoal\":300,\"weightManagerType\":1}"
        let packet = DataSyncWire.config(srcPkg: dietPhone, wearPkg: dietWatch, items: [ConfigItem(configId: 0x35a97cf7, action: 1, data: Bytes(json.utf8), modifyMs: 1_760_400_000_000)])
        let expected = hex("3701011868772e756e6974656465766963652e7765696768744d6772021068772e73706f72742e6469657463616c83812b848128050435a97cf70601010781127b226f6e65506f696e7446756c6c223a7b22627265616b66617374223a3630302c226c756e6368223a3830302c2264696e6e6572223a3630307d2c2263616c6f72696344656669636974476f616c223a3530302c22776569676874496e6974223a37302e302c22616374697669747943616c476f616c223a3330302c227765696768744d616e6167657254797065223a317d080800000199e0044400")
        XCTAssertEqual(expected.count, 220)
        XCTAssertEqual(try serialize(packet), frame(DataSyncWire.cmdConfig, Array(expected[2...])))
    }

    func testEventMatchesTheQuickLogReplyExample() throws {
        let reply = Bytes("{\"punchResult\":0,\"event\":6}".utf8)
        let packet = DataSyncWire.event(srcPkg: dietPhone, wearPkg: dietWatch, eventId: 0x4c52933, level: 0, data: reply)
        let expected = hex("3702011868772e756e6974656465766963652e7765696768744d6772021068772e73706f72742e6469657463616c030404c52933040100051b7b2270756e6368526573756c74223a302c226576656e74223a367d")
        XCTAssertEqual(expected.count, 84)
        // The level is one byte, as Huawei Health writes it.
        XCTAssertEqual(try serialize(packet), frame(DataSyncWire.cmdEvent, Array(expected[2...])))
    }

    func testDictionaryRowIsBuiltLikeYoqB() throws {
        let row = DictRow(startMs: 1_760_400_000_000, endMs: 1_760_403_600_000, modifyMs: 1_760_403_600_000, values: [DictValue(key: 500_018_055, value: [0, 0, 6, 0x72])])
        let packet = DataSyncWire.dictionary(srcPkg: dietPhone, wearPkg: dietWatch, dictType: 500_018, rows: [row])
        // Layout: 84{85{06 start i64, 07 end i64, 08 modify i64, 89{8A{0B key i32, 0C value}}, 0D empty}} after 01 / 02 / 03.
        let expected = hex("011868772e756e6974656465766963652e7765696768744d6772021068772e73706f72742e6469657463616c03040007a13284328530060800000199e0044400070800000199e03b3280080800000199e03b3280890e8a0c0b041dcdab870c04000006720d00")
        XCTAssertEqual(try serialize(packet), frame(DataSyncWire.cmdDict, expected))
    }

    func testDictionaryParserReadsBothLayouts() throws {
        let nested = DataSyncWire.dictionary(
            srcPkg: "p", wearPkg: "w", dictType: 500_018,
            rows: [DictRow(startMs: 1000, endMs: 2000, modifyMs: 3000, values: [DictValue(key: 500_018_055, value: [0, 0, 6, 0x72])]), DictRow(startMs: 4000, endMs: 5000)]
        )
        let query = try DataSyncWire.parseDictionary(nested.tlv!)
        XCTAssertEqual(query.dictId, 500_018)
        XCTAssertEqual(query.rows.count, 2)
        XCTAssertEqual(query.startMs, 1000)
        XCTAssertEqual(query.endMs, 2000)
        XCTAssertEqual(query.modifyMs, 3000)
        XCTAssertEqual(query.rows[0].values[0].key, 500_018_055)
        XCTAssertEqual(query.rows[0].values[0].value, [0, 0, 6, 0x72])
        XCTAssertNil(query.rows[1].modifyMs)

        // Flat 06 / 07 / 08 at the top.
        var flat = HuaweiTLV()
        flat.put(0x01, string: "src")
        flat.put(0x02, string: "wear")
        flat.put(0x03, int: 500_018)
        flat.put(0x06, long: 10)
        flat.put(0x07, long: 20)
        flat.put(0x08, long: 30)
        let flatQuery = try DataSyncWire.parseDictionary(flat)
        XCTAssertEqual(flatQuery.rows.count, 0)
        XCTAssertEqual(flatQuery.startMs, 10)
        XCTAssertEqual(flatQuery.endMs, 20)
        XCTAssertEqual(flatQuery.modifyMs, 30)
    }

    func testInboundEventConfigAndPointAreParsed() throws {
        let eventTlv = try HuaweiTLV(parsing:
            tlv(1, Bytes("in.huawei.motion".utf8)) + tlv(2, Bytes("hw.sport.config".utf8)) + tlv(3, [0x04, 0xC5, 0x29, 0x33]) + tlv(4, [0]) + tlv(5, Bytes("{\"event\":1}".utf8)))
        let event = DataSyncWire.parseEvent(eventTlv)
        XCTAssertEqual(event.srcPkg, "in.huawei.motion")
        XCTAssertEqual(event.wearPkg, "hw.sport.config")
        XCTAssertEqual(event.eventId, 80_030_003)
        XCTAssertEqual(event.level, 0)
        XCTAssertEqual(event.data, Bytes("{\"event\":1}".utf8))
        XCTAssertNil(event.errorCode)

        var ackTlv = HuaweiTLV()
        ackTlv.put(0x01, string: "a")
        ackTlv.put(0x02, string: "b")
        ackTlv.put(0x7F, int: 100_000)
        XCTAssertEqual(DataSyncWire.parseEvent(ackTlv).errorCode, 100_000)

        let config = try DataSyncWire.parseConfig(DataSyncWire.config(srcPkg: "a", wearPkg: "b", items: [ConfigItem(configId: 900_200_006, action: 1, data: [1, 2], modifyMs: 5), ConfigItem(configId: 900_200_007, action: 2)]).tlv!)
        XCTAssertEqual(config.items.count, 2)
        XCTAssertEqual(config.items[0].configId, 900_200_006)
        XCTAssertEqual(config.items[0].action, 1)
        XCTAssertEqual(config.items[0].data, [1, 2])
        XCTAssertEqual(config.items[0].modifyMs, 5)
        XCTAssertEqual(config.items[1].action, 2)
        XCTAssertNil(config.items[1].data)

        let point = try DataSyncWire.parsePoint(DataSyncWire.samplePoint(srcPkg: "a", wearPkg: "b", dictType: 600_002, values: [PointValue(key: 600_002, value: [0x5B, 0x5D])], startMs: 1, endMs: 2, metadata: [9]).tlv!)
        XCTAssertEqual(point.dictId, 600_002)
        XCTAssertEqual(point.values[0].key, 600_002)
        XCTAssertEqual(point.values[0].value, [0x5B, 0x5D])
        XCTAssertEqual(point.metadata, [9])
    }

    func testAnEmptyPacketParsesToEmptyFieldsAndABrokenListThrows() throws {
        let event = DataSyncWire.parseEvent(HuaweiTLV())
        XCTAssertEqual(event.srcPkg, "")
        XCTAssertEqual(event.eventId, 0)
        XCTAssertNil(event.data)
        XCTAssertTrue(try DataSyncWire.parseConfig(HuaweiTLV()).items.isEmpty)
        var broken = HuaweiTLV()
        broken.put(0x83, bytes: [0x84, 0x09])
        XCTAssertThrowsError(try DataSyncWire.parseConfig(broken))
    }

    func testPackagesMatchInEitherOrientation() {
        // The watch writes its package in src and the phone's in wear (GB registers by the watch package, Huawei by the phone's).
        XCTAssertTrue(DataSyncWire.matchPackages("hw.unitedevice.weightMgr", nil, src: "hw.sport.dietcal", wear: "hw.unitedevice.weightMgr")! == ("hw.unitedevice.weightMgr", "hw.sport.dietcal"))
        // The packet written the other way round.
        XCTAssertTrue(DataSyncWire.matchPackages("hw.unitedevice.weightMgr", "hw.sport.dietcal", src: "hw.unitedevice.weightMgr", wear: "hw.sport.dietcal")! == ("hw.unitedevice.weightMgr", "hw.sport.dietcal"))
        // GB's registration by the watch package only.
        XCTAssertTrue(DataSyncWire.matchPackages(nil, "in.huawei.motion", src: "in.huawei.motion", wear: "hw.sport.config")! == ("hw.sport.config", "in.huawei.motion"))
        XCTAssertNil(DataSyncWire.matchPackages("hw.unitedevice.weightMgr", nil, src: "a", wear: "b"))
        XCTAssertNil(DataSyncWire.matchPackages(nil, "in.huawei.motion", src: "other", wear: "hw.sport.config"))
    }

    func testCapabilityBitsAreTheOnesHuaweiChecks() {
        XCTAssertEqual(DataSyncWire.capabilityFor(DataSyncWire.cmdConfig), 83)
        XCTAssertEqual(DataSyncWire.capabilityFor(DataSyncWire.cmdEvent), 84)
        XCTAssertEqual(DataSyncWire.capabilityFor(DataSyncWire.cmdPoint), 85)
        XCTAssertEqual(DataSyncWire.capabilityFor(DataSyncWire.cmdDict), 173)
        XCTAssertNil(DataSyncWire.capabilityFor(DataSyncWire.cmdCompact))
        XCTAssertEqual(DataSyncWire.commandName(0x0a), "command 0a")
    }

    func testTheWatchesBitmapSetsTheBitsTheDocumentSays() {
        // The Watch Fit 4 Pro ExpandCapability from the task: bits 83, 84, 85, 173, 215 and 182 set; 307 and 266 not.
        let caps = DeviceCaps()
        caps.expandCapabilities = hex("FF7F01EA2EC37452E8BEBC72226F8E4B07AEA90D7EFFCC9ACF579945DF4DAD82DBC2041003480404")
        for bit in [83, 84, 85, 173, 215, 182] { XCTAssertTrue(caps.expandCapability(bit), "bit \(bit)") }
        for bit in [307, 266] { XCTAssertFalse(caps.expandCapability(bit), "bit \(bit)") }
    }

    func testDescribeShowsTextWhenPrintableAndHexOtherwise() {
        XCTAssertEqual(DataSyncWire.describe(nil), "-")
        XCTAssertEqual(DataSyncWire.describe([]), "(empty)")
        XCTAssertEqual(DataSyncWire.describe(Bytes("{\"a\":1}".utf8)), "{\"a\":1}")
        XCTAssertEqual(DataSyncWire.describe([0x00, 0x01]), "0001")
        XCTAssertEqual(DataSyncWire.describe([0x41]), "41")
    }
}

final class FaceCustomCodecTests: XCTestCase {
    func hex(_ s: String) -> Bytes { Bytes(hex: s.replacingOccurrences(of: " ", with: ""))! }

    func testQueryIsTheMarketIdAsUtf8() {
        XCTAssertEqual(FaceCustomWire.encodeQuery("123"), hex("01 03 31 32 33"))
    }

    func testFullConfigurationMatchesTheCqeLayout() throws {
        let config = FaceCustomization(
            marketId: "123", styles: [FaceStyleChoice(mode: FaceEditMode.style, index: 2), FaceStyleChoice(mode: FaceEditMode.background, index: 3)],
            colourIndex: 5, customColour: "#FF0000", widgets: [1, 0]
        )
        let expected = hex(
            "01 03 31 32 33" + "82 10 83 06 04 01 00 05 01 02 83 06 04 01 01 05 01 03" + "06 01 05" + "07 07 23 46 46 30 30 30 30"
                + "88 10 89 06 0A 01 00 0B 01 01 89 06 0A 01 01 0B 01 00"
        )
        XCTAssertEqual(try FaceCustomWire.encodeConfig(config), expected)
    }

    func testOptionalPartsAreLeftOutAndAnEmptyCustomColourToo() throws {
        XCTAssertEqual(try FaceCustomWire.encodeConfig(FaceCustomization(marketId: "9", colourIndex: 0, customColour: "")), hex("01 01 39 06 01 00"))
        XCTAssertEqual(try FaceCustomWire.encodeConfig(FaceCustomization(marketId: "9")), hex("01 01 39"))
    }

    func testColourIndexIsMinimalBigEndianButStyleIndexesAreOneByte() throws {
        XCTAssertEqual(FaceCustomWire.minimalBigEndian(0), hex("00"))
        XCTAssertEqual(FaceCustomWire.minimalBigEndian(255), hex("FF"))
        XCTAssertEqual(FaceCustomWire.minimalBigEndian(300), hex("01 2C"))
        XCTAssertEqual(FaceCustomWire.minimalBigEndian(1 << 24), hex("01 00 00 00"))
        XCTAssertEqual(try FaceCustomWire.encodeConfig(FaceCustomization(marketId: "123", colourIndex: 300)), hex("01 03 31 32 33 06 02 01 2C"))
    }

    func testListLengthUsesTheSevenBitVarint() throws {
        // 20 slots x 8 bytes = 160 bytes: length 0x81 0x20.
        let widgets = (0..<20).map { $0 % 3 }
        let encoded = try FaceCustomWire.encodeConfig(FaceCustomization(marketId: "1", widgets: widgets))
        XCTAssertEqual(Array(encoded[3..<6]), hex("88 81 20"))
        XCTAssertEqual(encoded.count, 3 + 3 + 160)
        XCTAssertEqual(FaceCustomWire.decode(encoded)?.widgets, widgets)
    }

    func testAnIndexThatDoesNotFitAByteIsRefused() {
        XCTAssertThrowsError(try FaceCustomWire.encodeConfig(FaceCustomization(marketId: "1", styles: [FaceStyleChoice(mode: FaceEditMode.background, index: 256)])))
        XCTAssertThrowsError(try FaceCustomWire.encodeConfig(FaceCustomization(marketId: "1", widgets: [-1])))
        XCTAssertThrowsError(try FaceCustomWire.encodeConfig(FaceCustomization(marketId: "")))
    }

    func testDecodeRoundTripsEveryMode() throws {
        let config = FaceCustomization(
            marketId: "400001", styles: FaceEditMode.all.map { FaceStyleChoice(mode: $0, index: $0 + 1) }, colourIndex: 12, customColour: "#0A1B2C", widgets: [3, 1, 4, 1]
        )
        XCTAssertEqual(FaceCustomWire.decode(try FaceCustomWire.encodeConfig(config)), config)
    }

    func testDecodeReadsMultiByteInts() {
        // marketId "AB", one style whose index is two bytes (0x0100), a colour of 0x0102.
        let config = FaceCustomWire.decode(hex("01 02 41 42  82 09 83 07 04 01 05 05 02 01 00  06 02 01 02"))
        XCTAssertEqual(config, FaceCustomization(marketId: "AB", styles: [FaceStyleChoice(mode: FaceEditMode.typeface, index: 256)], colourIndex: 0x0102))
    }

    func testDecodeSkipsWhatHuaweiHealthSkips() throws {
        // A style without an index, then a good one; widgets whose slot is outside the list; an empty custom colour.
        let data = hex(
            "01 01 58" + "82 0D 83 03 04 01 02  83 06 04 01 03 05 01 07 " + "07 00 " + "88 10 89 06 0A 01 05 0B 01 09 89 06 0A 01 01 0B 01 02"
        )
        let config = try XCTUnwrap(FaceCustomWire.decode(data))
        XCTAssertEqual(config.styles, [FaceStyleChoice(mode: FaceEditMode.scale, index: 7)])
        XCTAssertNil(config.customColour)
        XCTAssertEqual(config.widgets, [2])
    }

    func testDecodeRejectsWhatIsNotAConfiguration() {
        XCTAssertNil(FaceCustomWire.decode([]))
        XCTAssertNil(FaceCustomWire.decode(hex("06 01 05")))
        XCTAssertNil(FaceCustomWire.decode(hex("01 05 41")))
        XCTAssertNil(FaceCustomWire.decode(hex("00 01 41")))
    }

    func testTheEventPacketCarriesTheQueryInTag05() throws {
        let packet = DataSyncWire.event(srcPkg: FaceCustomWire.phonePkg, wearPkg: FaceCustomWire.watchPkg, eventId: FaceCustomWire.eventQuery, level: 0, data: FaceCustomWire.encodeQuery("123"))
        // 01 src, 02 wear, 03 event id (int32), 04 level, 05 data.
        let tlv = hex("01 17") + Bytes(FaceCustomWire.phonePkg.utf8) + hex("02 19") + Bytes(FaceCustomWire.watchPkg.utf8) + hex("03 04 2FB08EA8 04 01 00 05 05 01 03 31 32 33")
        let body = Bytes([0x00, 0x37, 0x02]) + tlv
        var expected = Bytes([0x5A, UInt8(body.count >> 8), UInt8(body.count & 0xFF)]) + body
        expected.appendBE(CRC16.checksum(expected))
        let params = ParamsProvider()
        params.transactionsCrypted = false
        params.sliceSize = 1022
        XCTAssertEqual(try packet.serialize(params: params), [expected])
        XCTAssertEqual(FaceCustomWire.eventQuery, 0x2FB08EA8)
    }

    func testDifferencesNamesWhatDidNotStick() {
        let wanted = FaceCustomization(
            marketId: "1", styles: [FaceStyleChoice(mode: FaceEditMode.background, index: 2), FaceStyleChoice(mode: FaceEditMode.hand, index: 1)],
            colourIndex: 4, customColour: "#112233", widgets: [1, 2]
        )
        var same = wanted
        same.widgets = [1, 2, 9]
        XCTAssertEqual(FaceCustomWire.differences(wanted: wanted, actual: same), [])
        let actual = FaceCustomization(marketId: "1", styles: [FaceStyleChoice(mode: FaceEditMode.background, index: 3)], colourIndex: 4, widgets: [1])
        XCTAssertEqual(
            FaceCustomWire.differences(wanted: wanted, actual: actual),
            ["background is 3, wanted 2", "hand is not reported, wanted 1", "custom colour is not reported, wanted #112233", "widget 1 is not reported, wanted 2"]
        )
    }

    func testPartsThatWereNotRequestedAreNotCompared() {
        let actual = FaceCustomization(marketId: "1", styles: [FaceStyleChoice(mode: FaceEditMode.style, index: 1)], colourIndex: 3, widgets: [5])
        XCTAssertEqual(FaceCustomWire.differences(wanted: FaceCustomization(marketId: "1"), actual: actual), [])
    }

    func testTheJSShapeRoundTrips() throws {
        let config = FaceCustomization(marketId: "7", styles: [FaceStyleChoice(mode: 1, index: 2)], colourIndex: nil, customColour: "#FFF", widgets: [1, 2])
        let js = config.toJS()
        XCTAssertEqual(js["marketId"] as? String, "7")
        XCTAssertTrue(js["colourIndex"] is NSNull)
        XCTAssertEqual(FaceCustomization(js: js), config)
        XCTAssertEqual(FaceCustomization(js: ["marketId": "1", "styles": [["mode": 2.0, "index": 3]], "colourIndex": 4.0, "widgets": [5]])?.styles, [FaceStyleChoice(mode: 2, index: 3)])
        XCTAssertNil(FaceCustomization(js: ["styles": []]), "no marketId")
        XCTAssertNil(FaceCustomization(js: ["marketId": "1", "styles": [["mode": "x", "index": 1]]]))
        XCTAssertEqual(config.describe(), "face 7 styles=background=2 customColour=#FFF widgets=[1, 2]")
    }
}
