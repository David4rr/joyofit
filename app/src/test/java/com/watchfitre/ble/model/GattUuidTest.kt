package com.watchfitre.ble.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.UUID

class GattUuidTest {

    @Test fun sig_buildsCanonicalBluetoothSigUuid() {
        // Short 0x180F -> 0000180F-0000-1000-8000-00805F9B34FB
        val expected = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
        assertEquals(expected, GattUuid.sig(0x180F))
    }

    @Test fun sig_zeroShort() {
        val expected = UUID.fromString("00000000-0000-1000-8000-00805f9b34fb")
        assertEquals(expected, GattUuid.sig(0x0000))
    }

    @Test fun sig_maxShort() {
        val expected = UUID.fromString("0000ffff-0000-1000-8000-00805f9b34fb")
        assertEquals(expected, GattUuid.sig(0xFFFF))
    }

    @Test fun label_resolvesKnownCharacteristics() {
        assertEquals("Battery Level", GattUuid.label(GattUuid.BATTERY_LEVEL))
        assertEquals("Firmware Revision", GattUuid.label(GattUuid.FIRMWARE_REVISION))
        assertEquals("Device Name", GattUuid.label(GattUuid.DEVICE_NAME))
        assertEquals("CCCD (Client Characteristic Configuration)", GattUuid.label(GattUuid.CCCD))
    }

    @Test fun label_resolvesKnownServices() {
        assertEquals("Battery Service", GattUuid.label(GattUuid.BATTERY_SERVICE))
        assertEquals("Device Information", GattUuid.label(GattUuid.DEVICE_INFO_SERVICE))
        assertEquals("Generic Access", GattUuid.label(GattUuid.GENERIC_ACCESS_SERVICE))
    }

    @Test fun label_unknownReturnsNull() {
        assertNull(GattUuid.label(UUID.fromString("12345678-1234-5678-1234-567812345678")))
    }
}
