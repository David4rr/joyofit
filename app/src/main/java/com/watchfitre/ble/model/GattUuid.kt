package com.watchfitre.ble.model

import java.util.UUID

/** Common well-known GATT UUIDs. Used purely for friendlier UI labels — never assume semantics. */
object GattUuid {
    /** Standard short-UUID base for Bluetooth SIG-assigned numbers. */
    private const val SIG_BASE_TEMPLATE = "0000%04X-0000-1000-8000-00805F9B34FB"

    fun sig(short: Int): UUID = UUID.fromString(SIG_BASE_TEMPLATE.format(short))

    val CCCD: UUID = sig(0x2902) // Client Characteristic Configuration — enable notify/indicate.
    val BATTERY_SERVICE: UUID = sig(0x180F)
    val BATTERY_LEVEL: UUID = sig(0x2A19)
    val DEVICE_INFO_SERVICE: UUID = sig(0x180A)
    val MANUFACTURER_NAME: UUID = sig(0x2A29)
    val MODEL_NUMBER: UUID = sig(0x2A24)
    val FIRMWARE_REVISION: UUID = sig(0x2A26)
    val HARDWARE_REVISION: UUID = sig(0x2A27)
    val SERIAL_NUMBER: UUID = sig(0x2A25)
    val GENERIC_ACCESS_SERVICE: UUID = sig(0x1800)
    val DEVICE_NAME: UUID = sig(0x2A00)

    private val labels: Map<UUID, String> = mapOf(
        BATTERY_SERVICE to "Battery Service",
        BATTERY_LEVEL to "Battery Level",
        DEVICE_INFO_SERVICE to "Device Information",
        MANUFACTURER_NAME to "Manufacturer Name",
        MODEL_NUMBER to "Model Number",
        FIRMWARE_REVISION to "Firmware Revision",
        HARDWARE_REVISION to "Hardware Revision",
        SERIAL_NUMBER to "Serial Number",
        GENERIC_ACCESS_SERVICE to "Generic Access",
        DEVICE_NAME to "Device Name",
        CCCD to "CCCD (Client Characteristic Configuration)",
    )

    fun label(uuid: UUID): String? = labels[uuid]
}
