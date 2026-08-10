package com.watchfitre.device

import com.watchfitre.ble.BleConnectionManager
import com.watchfitre.ble.BleGattManager
import javax.inject.Inject
import javax.inject.Singleton

/**
 * High-level device facade: model, firmware, battery, signal (PRD §15, Phase 2).
 *
 * STUB. Standard GATT services (Battery 0x180F, Device Information 0x180A) will be read
 * here once a live connection exists and is OBSERVED. Proprietary fields stay UNKNOWN.
 */
@Singleton
class DeviceManager @Inject constructor(
    private val connection: BleConnectionManager,
    private val gatt: BleGattManager,
) {
    fun isReady(): Boolean = connection.state.value.isConnected()

    // TODO(Phase 2): read 0x2A19 (battery), 0x2A24 (model), 0x2A26 (firmware), 0x2A27 (hardware).
}
