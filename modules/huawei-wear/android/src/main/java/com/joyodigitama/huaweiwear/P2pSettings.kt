package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences

/** What [HealthModelService] keeps between requests; [P2pSettings] stores it, tests use memory. */
internal interface HealthLivingState {
  var healthLivingEnabled: Boolean
  var healthLivingMsgVer: Float
  var healthLivingPackageSize: Int
  var healthLivingLastRequestMs: Long
  var healthLivingLastReportMs: Long
  var healthLivingLastSummary: String?
}

/**
 * Switches and bookkeeping of the P2P (service 0x34) features: Healthy Living replies, the experimental
 * running-course push and the JoyoFit Fuel link. Own SharedPreferences file so the background service reads it without JS.
 */
internal class P2pSettings(context: Context) : HealthLivingState, FuelState {
  private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  /** Answer the watch's Healthy Living requests and push the day when data changes. On by default: the watch only asks when the user opens the app. */
  override var healthLivingEnabled: Boolean
    get() = prefs.getBoolean(KEY_HEALTH_LIVING, true)
    set(value) = prefs.edit().putBoolean(KEY_HEALTH_LIVING, value).apply()

  /** The watch asked at least once, with this `msgVer` (0 = never); Huawei Health only pushes unasked after a request. */
  override var healthLivingMsgVer: Float
    get() = prefs.getFloat(KEY_HL_VER, 0f)
    set(value) = prefs.edit().putFloat(KEY_HL_VER, value).apply()

  override var healthLivingPackageSize: Int
    get() = prefs.getInt(KEY_HL_PACKAGE, 0)
    set(value) = prefs.edit().putInt(KEY_HL_PACKAGE, value).apply()

  override var healthLivingLastRequestMs: Long
    get() = prefs.getLong(KEY_HL_REQUEST, 0L)
    set(value) = prefs.edit().putLong(KEY_HL_REQUEST, value).apply()

  override var healthLivingLastReportMs: Long
    get() = prefs.getLong(KEY_HL_REPORT, 0L)
    set(value) = prefs.edit().putLong(KEY_HL_REPORT, value).apply()

  override var healthLivingLastSummary: String?
    get() = prefs.getString(KEY_HL_SUMMARY, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_HL_SUMMARY) else putString(KEY_HL_SUMMARY, value) }.apply()

  /** The running-course editor and push (service `fitness`). Off: the static analysis behind it is not complete, see protocol/README.md. */
  var experimentalCourses: Boolean
    get() = prefs.getBoolean(KEY_COURSES, false)
    set(value) = prefs.edit().putBoolean(KEY_COURSES, value).apply()

  override var fuelWatchFingerprint: String
    get() = prefs.getString(KEY_FUEL_FINGERPRINT, "") ?: ""
    set(value) = prefs.edit().putString(KEY_FUEL_FINGERPRINT, value.trim()).apply()

  override var fuelLastHelloAtMs: Long
    get() = prefs.getLong(KEY_FUEL_HELLO_AT, 0L)
    set(value) = prefs.edit().putLong(KEY_FUEL_HELLO_AT, value).apply()

  override var fuelLastHelloVersion: String?
    get() = prefs.getString(KEY_FUEL_HELLO_VER, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_FUEL_HELLO_VER) else putString(KEY_FUEL_HELLO_VER, value) }.apply()

  override var fuelLastHelloProfileAtMs: Long
    get() = prefs.getLong(KEY_FUEL_HELLO_PROFILE, 0L)
    set(value) = prefs.edit().putLong(KEY_FUEL_HELLO_PROFILE, value).apply()

  override var fuelLastProfileSentAtMs: Long
    get() = prefs.getLong(KEY_FUEL_SENT_AT, 0L)
    set(value) = prefs.edit().putLong(KEY_FUEL_SENT_AT, value).apply()

  override var fuelLastAckAtMs: Long
    get() = prefs.getLong(KEY_FUEL_ACK_AT, 0L)
    set(value) = prefs.edit().putLong(KEY_FUEL_ACK_AT, value).apply()

  override var fuelLastAckProfileAtMs: Long
    get() = prefs.getLong(KEY_FUEL_ACK_PROFILE, 0L)
    set(value) = prefs.edit().putLong(KEY_FUEL_ACK_PROFILE, value).apply()

  override var fuelSentKey: String?
    get() = prefs.getString(KEY_FUEL_SENT_KEY, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_FUEL_SENT_KEY) else putString(KEY_FUEL_SENT_KEY, value) }.apply()

  override var fuelStampedAtMs: Long
    get() = prefs.getLong(KEY_FUEL_STAMPED_AT, 0L)
    set(value) = prefs.edit().putLong(KEY_FUEL_STAMPED_AT, value).apply()

  private companion object {
    const val PREFS_NAME = "joyofit_p2p"
    const val KEY_HEALTH_LIVING = "health_living"
    const val KEY_HL_VER = "hl_ver"
    const val KEY_HL_PACKAGE = "hl_package"
    const val KEY_HL_REQUEST = "hl_request_ms"
    const val KEY_HL_REPORT = "hl_report_ms"
    const val KEY_HL_SUMMARY = "hl_summary"
    const val KEY_COURSES = "courses_experimental"
    const val KEY_FUEL_FINGERPRINT = "fuel_watch_fingerprint"
    const val KEY_FUEL_HELLO_AT = "fuel_hello_at_ms"
    const val KEY_FUEL_HELLO_VER = "fuel_hello_ver"
    const val KEY_FUEL_HELLO_PROFILE = "fuel_hello_profile_at_ms"
    const val KEY_FUEL_SENT_AT = "fuel_sent_at_ms"
    const val KEY_FUEL_ACK_AT = "fuel_ack_at_ms"
    const val KEY_FUEL_ACK_PROFILE = "fuel_ack_profile_at_ms"
    const val KEY_FUEL_SENT_KEY = "fuel_sent_key"
    const val KEY_FUEL_STAMPED_AT = "fuel_stamped_at_ms"
  }
}
