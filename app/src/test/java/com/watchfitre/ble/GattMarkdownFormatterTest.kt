package com.watchfitre.ble

import com.watchfitre.ble.model.CharProperty
import com.watchfitre.ble.model.GattCharacteristicInfo
import com.watchfitre.ble.model.GattDescriptorInfo
import com.watchfitre.ble.model.GattServiceInfo
import org.junit.Assert.assertTrue
import org.junit.Test

class GattMarkdownFormatterTest {

    private val batteryService = GattServiceInfo(
        uuid = "0000180f-0000-1000-8000-00805f9b34fb",
        instanceId = 1,
        characteristics = listOf(
            GattCharacteristicInfo(
                uuid = "00002a19-0000-1000-8000-00805f9b34fb",
                instanceId = 1,
                properties = setOf(CharProperty.READ, CharProperty.NOTIFY),
                descriptors = listOf(GattDescriptorInfo("00002902-0000-1000-8000-00805f9b34fb")),
                canRead = true,
                canWrite = false,
                canWriteNoResponse = false,
                canNotify = true,
                canIndicate = false,
                lastValue = byteArrayOf(82),
            ),
        ),
    )

    private val proprietary = GattServiceInfo(
        uuid = "12345678-1234-5678-1234-567812345678",
        instanceId = 2,
        characteristics = listOf(
            GattCharacteristicInfo(
                uuid = "abcdefab-1234-5678-1234-567812345678",
                instanceId = 2,
                properties = setOf(CharProperty.WRITE_NO_RESPONSE, CharProperty.NOTIFY),
                descriptors = listOf(GattDescriptorInfo("00002902-0000-1000-8000-00805f9b34fb")),
                canRead = false,
                canWrite = false,
                canWriteNoResponse = true,
                canNotify = true,
                canIndicate = false,
            ),
        ),
    )

    @Test fun rendersHeaderAndConfidenceDisclaimer() {
        val md = GattMarkdownFormatter.format(listOf(batteryService), "Watch Fit 4 Pro", 1_700_000_000_000L)
        assertTrue(md.startsWith("# GATT — Watch Fit 4 Pro"))
        assertTrue(md.contains("Captured:"))
        assertTrue(md.contains("Field meaning = UNKNOWN"))
    }

    @Test fun rendersServiceSummaryTable() {
        val md = GattMarkdownFormatter.format(listOf(batteryService, proprietary), null, 0L)
        assertTrue(md.contains("| Service UUID | Label | Chars |"))
        assertTrue(md.contains("0000180f-0000-1000-8000-00805f9b34fb"))
        assertTrue(md.contains("Battery Service"))
    }

    @Test fun rendersCharacteristicWithLabelPropsAndValue() {
        val md = GattMarkdownFormatter.format(listOf(batteryService), null, 0L)
        assertTrue(md.contains("Battery Level"))
        assertTrue(md.contains("READ"))       // capability summary
        assertTrue(md.contains("NOTIFY"))
        assertTrue(md.contains("Descriptors: `2902`"))
        assertTrue(md.contains("Last value (hex): `52`"))
    }

    @Test fun unknownServiceLabeledUnknown() {
        val md = GattMarkdownFormatter.format(listOf(proprietary), null, 0L)
        // proprietary service has no known label
        assertTrue(md.contains("Unknown"))
        assertTrue(md.contains("WRITE_NR"))
    }
}
