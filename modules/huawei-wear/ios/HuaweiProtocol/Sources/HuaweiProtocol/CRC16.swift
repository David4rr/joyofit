// Gadgetbridge `CheckSums.getCRC16(seq, crc)`: the CRC-16/XMODEM variant (poly 0x1021, init 0x0000 for packet framing).
public enum CRC16 {
    public static func checksum(_ seq: Bytes, initial: UInt16 = 0x0000) -> UInt16 {
        var crc = UInt32(initial)
        for b in seq {
            crc = ((crc >> 8) | (crc << 8)) & 0xFFFF
            crc ^= UInt32(b)
            crc ^= (crc & 0xFF) >> 4
            crc ^= (crc << 12) & 0xFFFF
            crc ^= ((crc & 0xFF) << 5) & 0xFFFF
        }
        return UInt16(crc & 0xFFFF)
    }

    public static func checksum(_ seq: ArraySlice<UInt8>, initial: UInt16 = 0x0000) -> UInt16 {
        checksum(Array(seq), initial: initial)
    }
}
