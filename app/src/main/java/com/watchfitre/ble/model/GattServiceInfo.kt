package com.watchfitre.ble.model

/** UI-facing view of a GATT descriptor. */
data class GattDescriptorInfo(
    val uuid: String,
)

/** UI-facing view of a GATT characteristic with decoded capability flags. */
data class GattCharacteristicInfo(
    val uuid: String,
    val instanceId: Int,
    val properties: Set<CharProperty>,
    val descriptors: List<GattDescriptorInfo>,
    val canRead: Boolean,
    val canWrite: Boolean,
    val canWriteNoResponse: Boolean,
    val canNotify: Boolean,
    val canIndicate: Boolean,
    /** True while notifications/indications are locally enabled. */
    var subscribed: Boolean = false,
    /** Last read value bytes (kept here for the explorer screen). */
    var lastValue: ByteArray? = null,
)

/** UI-facing view of a GATT service. */
data class GattServiceInfo(
    val uuid: String,
    val instanceId: Int,
    val characteristics: List<GattCharacteristicInfo>,
)

enum class CharProperty { BROADCAST, READ, WRITE_NO_RESPONSE, WRITE, NOTIFY, INDICATE, SIGNED_WRITE, EXTENDED_PROPS }
