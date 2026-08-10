package com.watchfitre.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * DataStore-backed settings. Single source of truth for app + device preferences.
 *
 * No secrets live here — only user-facing configuration and a remembered last-device MAC.
 */
data class AppSettings(
    val debugEnabled: Boolean = false,
    val autoReconnect: Boolean = true,
    val lastDeviceMac: String? = null,
    val lastDeviceName: String? = null,
    val lastSyncEpochMs: Long = 0L,
)

@Singleton
class SettingsRepository @Inject constructor(
    private val store: DataStore<Preferences>,
) {
    private object Keys {
        val DEBUG_ENABLED = booleanPreferencesKey("debug_enabled")
        val AUTO_RECONNECT = booleanPreferencesKey("auto_reconnect")
        val LAST_DEVICE_MAC = stringPreferencesKey("last_device_mac")
        val LAST_DEVICE_NAME = stringPreferencesKey("last_device_name")
        val LAST_SYNC_EPOCH = longPreferencesKey("last_sync_epoch")
    }

    val settings: Flow<AppSettings> = store.data.map { p ->
        AppSettings(
            debugEnabled = p[Keys.DEBUG_ENABLED] ?: false,
            autoReconnect = p[Keys.AUTO_RECONNECT] ?: true,
            lastDeviceMac = p[Keys.LAST_DEVICE_MAC],
            lastDeviceName = p[Keys.LAST_DEVICE_NAME],
            lastSyncEpochMs = p[Keys.LAST_SYNC_EPOCH] ?: 0L,
        )
    }

    suspend fun setDebugEnabled(enabled: Boolean) {
        store.edit { it[Keys.DEBUG_ENABLED] = enabled }
    }

    suspend fun setAutoReconnect(enabled: Boolean) {
        store.edit { it[Keys.AUTO_RECONNECT] = enabled }
    }

    suspend fun setLastDevice(mac: String?, name: String?) {
        store.edit { p ->
            if (mac == null) p.remove(Keys.LAST_DEVICE_MAC) else p[Keys.LAST_DEVICE_MAC] = mac
            if (name == null) p.remove(Keys.LAST_DEVICE_NAME) else p[Keys.LAST_DEVICE_NAME] = name
        }
    }

    suspend fun setLastSyncNow(epochMs: Long) {
        store.edit { it[Keys.LAST_SYNC_EPOCH] = epochMs }
    }
}
