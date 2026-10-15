// Port of HuaweiPacket.java: framing (slicing, CRC16), reassembly, optional TLV encryption. Typed requests and responses live in
// Packets/*.swift as constructors and `Response` structs over this type.
import Foundation

public let huaweiMagic: UInt8 = 0x5A

/// Reasons an inbound frame cannot become a packet or a response cannot be read (GB `HuaweiPacket.ParseException` family).
public enum PacketError: Error, Equatable, CustomStringConvertible {
    case lengthMismatch(String)
    case magicMismatch(String)
    case checksumIncorrect(String)
    case missingTag(UInt8)
    case crypto(String)
    case json(String)
    case supportedCommandsList(String)
    case tlv(String)
    case serialize(String)

    public var description: String {
        switch self {
        case .lengthMismatch(let m), .magicMismatch(let m), .checksumIncorrect(let m), .crypto(let m), .json(let m),
             .supportedCommandsList(let m), .tlv(let m), .serialize(let m):
            return m
        case .missingTag(let tag): return "Missing tag: " + String(tag, radix: 16)
        }
    }
}

/// `HuaweiPacket.ParamsProvider`: the link parameters every packet shares. A class because LinkParams and the auth steps change it
/// while requests are in flight.
public final class ParamsProvider {
    public var authVersion: UInt8 = 0
    public var deviceSupportType: UInt8 = 0
    public var secretKey: Bytes?
    public var sliceSize: Int = 0xf4
    public var transactionsCrypted = true
    public var mtu: Int = 65535
    public var encryptionCounter: UInt32 = 0
    public var pinCode: Bytes?
    public var interval: UInt8 = 0
    public var authAlgo: UInt8 = 0
    public var encryptMethod: UInt8 = 0
    public var firstKey: Bytes?
    public var authMode: UInt8 = 0
    public var isAW = false

    public init() {}

    /// 16-byte IV for the next encrypted TLV. `deviceSupportType == 4` uses a fresh random IV; every other type a random prefix with a
    /// counter in the last four bytes, which advances.
    public func nextIV() -> Bytes {
        if deviceSupportType == 0x04 { return HuaweiCrypto.generateNonce() }
        let result = HuaweiCrypto.initializationVector(counter: encryptionCounter)
        encryptionCounter = result.counter
        return result.iv
    }

    /// GCM for `encryptMethod == 1` and for `deviceSupportType == 4`, CBC otherwise.
    public var useGCM: Bool { encryptMethod == 0x01 || deviceSupportType == 0x04 }
}

extension HuaweiTLV {
    /// `HuaweiTLV.encryptRaw`: `{124: 1, 125: iv, 126: cipher}`.
    public static func encryptRaw(params: ParamsProvider, data: Bytes) throws -> HuaweiTLV {
        let iv = params.nextIV()
        guard let key = params.secretKey else { throw PacketError.crypto("Encrypt exception: no secret key") }
        let cipher: Bytes
        do {
            cipher = try HuaweiCrypto.encrypt(useGCM: params.useGCM, message: data, key: key, iv: iv)
        } catch {
            throw PacketError.crypto("Encrypt exception: \(error)")
        }
        var tlv = HuaweiTLV()
        tlv.put(HuaweiTLV.tagEncryption, byte: 0x01)
        tlv.put(HuaweiTLV.tagInitVector, bytes: iv)
        tlv.put(HuaweiTLV.tagCipherText, bytes: cipher)
        return tlv
    }

    public func encrypted(params: ParamsProvider) throws -> HuaweiTLV {
        try HuaweiTLV.encryptRaw(params: params, data: serialize())
    }

    /// Decrypts the `{124,125,126}` wrapper into the TLV it holds.
    public func decrypted(params: ParamsProvider) throws -> HuaweiTLV {
        guard let key = params.secretKey else { throw PacketError.crypto("Decrypt exception: no secret key") }
        let plain: Bytes
        do {
            plain = try HuaweiCrypto.decrypt(
                useGCM: params.useGCM,
                message: try bytes(HuaweiTLV.tagCipherText),
                key: key,
                iv: try bytes(HuaweiTLV.tagInitVector)
            )
        } catch let e as TLVError {
            if case .missingTag(let tag) = e { throw PacketError.missingTag(tag) }
            throw PacketError.tlv("\(e)")
        } catch {
            throw PacketError.crypto("Decrypt exception: \(error)")
        }
        do {
            return try HuaweiTLV(parsing: plain)
        } catch {
            throw PacketError.tlv("\(error)")
        }
    }
}

public struct HuaweiPacket {
    public var serviceId: UInt8
    public var commandId: UInt8
    public var tlv: HuaweiTLV?
    /// Raw body for the services that do not carry TLV (file data blocks 0A/05, 2C/05, 28/06, 1C/05); includes the two id bytes, as GB's `payload`.
    public var payload: Bytes?
    /// Outgoing: encrypt the TLV when the link says transactions are crypted (GB default true). Incoming: the TLV was decrypted.
    public var isEncrypted: Bool
    public var isSliced: Bool
    public var complete: Bool

    public init(serviceId: UInt8, commandId: UInt8, tlv: HuaweiTLV? = nil, isEncrypted: Bool = true, isSliced: Bool = true, complete: Bool = true) {
        self.serviceId = serviceId
        self.commandId = commandId
        self.tlv = tlv
        self.isEncrypted = isEncrypted
        self.isSliced = isSliced
        self.complete = complete
    }

    // MARK: serialize

    public func serialize(params: ParamsProvider) throws -> [Bytes] {
        let body = tlv ?? HuaweiTLV()
        let serializable = (isEncrypted && params.transactionsCrypted) ? try body.encrypted(params: params) : body
        let serialized = serializable.serialize()
        return isSliced ? serializeSliced(serialized, sliceSize: params.sliceSize) : serializeUnsliced(serialized)
    }

    func serializeSliced(_ serializedTLV: Bytes, sliceSize: Int) -> [Bytes] {
        let headerLength = 5 // magic + (short)(bodyLength + 1) + slice + flag
        let bodyHeaderLength = 2 // sID + cID
        let footerLength = 2 // CRC16
        let maxBodySize = sliceSize - headerLength - footerLength
        guard maxBodySize > 0 else { return serializeUnsliced(serializedTLV) }
        let packetCount = (serializedTLV.count + bodyHeaderLength + maxBodySize - 1) / maxBodySize
        if packetCount == 1 { return serializeUnsliced(serializedTLV) }

        var out = [Bytes]()
        var position = 0
        var slice: UInt8 = 0x01
        var flag: UInt8 = 0x00
        for i in 0..<packetCount {
            let remaining = serializedTLV.count - position
            let packetSize = min(sliceSize, remaining + headerLength + footerLength)
            var contentSize = packetSize - headerLength - footerLength

            var packet = Bytes()
            packet.reserveCapacity(packetSize)
            packet.append(huaweiMagic)
            packet.appendBE(UInt16(truncatingIfNeeded: packetSize - headerLength))
            if i == packetCount - 1 { slice = 0x03 }
            packet.append(slice)
            packet.append(flag)
            flag &+= 1
            if slice == 0x01 {
                packet.append(serviceId)
                packet.append(commandId)
                slice = 0x02
                contentSize -= 2 // to prevent taking too much data
            }
            let take = max(0, min(contentSize, remaining))
            packet += serializedTLV[position..<position + take]
            position += take
            packet.appendBE(CRC16.checksum(packet))
            out.append(packet)
        }
        return out
    }

    func serializeUnsliced(_ serializedTLV: Bytes) -> [Bytes] {
        let bodyLength = 2 + serializedTLV.count
        var buffer = Bytes()
        buffer.reserveCapacity(4 + bodyLength + 2)
        buffer.append(huaweiMagic)
        buffer.appendBE(UInt16(truncatingIfNeeded: bodyLength + 1))
        buffer.append(0x00)
        buffer.append(serviceId)
        buffer.append(commandId)
        buffer += serializedTLV
        buffer.appendBE(CRC16.checksum(buffer))
        return [buffer]
    }
}

/// Inbound reassembly of one packet, the state GB keeps inside a `HuaweiPacket` between `parse` calls (`partialPacket`, `payload`).
public struct PacketAssembler {
    public struct Result {
        public var packet: HuaweiPacket?
        /// Bytes of the fed chunk that belong to the next frame.
        public var left: Int
    }

    private var partialPacket: Bytes?
    private var payload: Bytes?

    public init() {}

    /// Feeds bytes. Returns the completed packet (TLV decrypted when it carries the `0x7C` flag and `params` has a key), or nil while
    /// more bytes or slices are needed. `left` is the count of trailing bytes that start another frame.
    public mutating func feed(_ chunk: Bytes, params: ParamsProvider) throws -> Result {
        var data = chunk
        if let partial = partialPacket { data = partial + data }
        guard !data.isEmpty else { throw PacketError.lengthMismatch("Packet length mismatch : 0 < 1") }
        guard data[0] == huaweiMagic else {
            throw PacketError.magicMismatch("Magic mismatch : " + String(Int8(bitPattern: data[0]), radix: 16) + " != 0x5A")
        }
        if data.count < 3 {
            partialPacket = data
            return Result(packet: nil, left: 0)
        }
        let expectedSize = Int(Int16(bitPattern: data.u16be(1)))
        if expectedSize < 0 { throw PacketError.lengthMismatch("Expected length mismatch : \(expectedSize)") }
        // 3 bytes (magic, length) are consumed; the frame still needs expectedSize + 2 (CRC16).
        if expectedSize + 2 > data.count - 3 {
            partialPacket = data
            return Result(packet: nil, left: 0)
        }
        partialPacket = nil

        var position = 3
        var addLen = 1
        let sliceType = Int(Int8(bitPattern: data[position]))
        position += 1
        let isSlicePart = sliceType == 1 || sliceType == 2 || sliceType == 3
        if isSlicePart {
            position += 1 // slice flag, thrown away
            addLen += 1
        }
        let bodyLength = expectedSize - addLen
        guard bodyLength >= 0 else { throw PacketError.lengthMismatch("Slice of \(expectedSize) bytes has no body") }
        var newPayload = Array(data[position..<position + bodyLength])
        position += bodyLength
        let expectedChecksum = data.u16be(position)
        position += 2
        let left = data.count - position

        let actual = CRC16.checksum(data[0..<expectedSize + 3])
        guard actual == expectedChecksum else {
            throw PacketError.checksumIncorrect("Checksum mismatch : \(Int16(bitPattern: actual)) != \(Int16(bitPattern: expectedChecksum))")
        }

        if isSlicePart {
            if let previous = payload { newPayload = previous + newPayload }
            if sliceType != 3 {
                payload = newPayload // sliced packet isn't complete yet
                return Result(packet: nil, left: left)
            }
        }
        payload = nil
        guard newPayload.count >= 2 else { throw PacketError.lengthMismatch("Packet body of \(newPayload.count) bytes has no service and command") }

        var packet = HuaweiPacket(serviceId: newPayload[0], commandId: newPayload[1], tlv: nil, isEncrypted: false, isSliced: true, complete: true)
        if (packet.serviceId == 0x0a && packet.commandId == 0x05)
            || (packet.serviceId == 0x28 && packet.commandId == 0x06)
            || (packet.serviceId == 0x2c && packet.commandId == 0x05)
            || (packet.serviceId == 0x1c && packet.commandId == 0x05) {
            packet.payload = newPayload
            return Result(packet: packet, left: left)
        }
        do {
            packet.tlv = try HuaweiTLV(parsing: newPayload, offset: 2, length: newPayload.count - 2)
        } catch {
            throw PacketError.tlv("\(error)")
        }
        try packet.attemptDecrypt(params: params)
        return Result(packet: packet, left: left)
    }

    /// Forgets partial frames and slices (a poisoned buffer after a parse failure, or a closed link).
    public mutating func reset() {
        partialPacket = nil
        payload = nil
    }
}

extension HuaweiPacket {
    /// `attemptDecrypt()`: only when the link has a key and the TLV carries `{0x7C: 1}`.
    mutating func attemptDecrypt(params: ParamsProvider) throws {
        guard params.secretKey != nil, let tlv else { return }
        if tlv.contains(0x7C), (try? tlv.bool(0x7C)) == true {
            self.tlv = try tlv.decrypted(params: params)
            isEncrypted = true
        }
    }
}
