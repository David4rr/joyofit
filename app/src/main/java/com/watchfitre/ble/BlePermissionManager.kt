package com.watchfitre.ble

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * Resolves the runtime-permission set required to scan + connect for the running OS.
 *
 * - API 31+: BLUETOOTH_SCAN + BLUETOOTH_CONNECT (runtime).
 * - API 29/30: ACCESS_FINE_LOCATION (runtime, needed for scan).
 */
object BlePermissionManager {

    val required: List<String>
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    fun areAllGranted(context: Context): Boolean =
        required.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
}
