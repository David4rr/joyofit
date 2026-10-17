package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.pm.PackageManager
import java.security.MessageDigest
import java.time.LocalDate
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiBaseP2PService
import org.json.JSONException
import org.json.JSONObject

/**
 * The JoyoFit Fuel link: the watch app `com.joyodigitama.joyofit.fuel` (Huawei Lite Wearable, `watchapp/fuel/`) and this app talk
 * over the P2P service 0x34/0x01 (the same stack as Healthy Living, see [P2pStack]). The contract both sides follow is
 * `watchapp/fuel/README.md`; the wire form is in `protocol/README.md`. Nothing of it has run on a watch: every step is logged.
 */
internal object FuelContract {
  /** The phone side of the P2P pair: JoyoFit's application id, used as the source package of everything sent. */
  const val PHONE_PACKAGE = "com.joyodigitama.joyofit"

  /** The watch app's bundleName (also the app's package in the 0x2a app list). */
  const val WATCH_PACKAGE = "com.joyodigitama.joyofit.fuel"

  /** Field `v` of every message. */
  const val VERSION = 1

  /** The answer to a ping that says the watch app is there. */
  const val PING_PRESENT = 0xCA
}

/** What the phone sends the watch app (`t` = `profile`): the numbers its energy math needs. */
internal class FuelProfile(
  val weightKg: Double,
  val age: Int,
  /** `male`, `female` or `unknown`. */
  val sex: String,
  val maxHr: Int,
  /** The newest resting heart rate JoyoFit has stored, or null. */
  val restHr: Int?,
  /** Unix milliseconds when weight, age (birth year) or sex last changed; 0 when the user never saved a profile. */
  val atMs: Long,
) {
  /** The UTF-8 JSON payload, fields in a fixed order. */
  fun toJson(): String = buildString {
    append("{\"v\":").append(FuelContract.VERSION)
    append(",\"t\":\"profile\"")
    append(",\"weightKg\":").append(weightKg)
    append(",\"age\":").append(age)
    append(",\"sex\":\"").append(sex).append('"')
    append(",\"maxHr\":").append(maxHr)
    append(",\"restHr\":").append(restHr?.toString() ?: "null")
    append(",\"at\":").append(atMs)
    append('}')
  }

  fun toJs(): Map<String, Any?> = mapOf(
    "weightKg" to weightKg,
    "age" to age,
    "sex" to sex,
    "maxHr" to maxHr,
    "restHr" to restHr,
    "at" to atMs,
  )

  /** Everything the watch app computes with except `at`; two profiles with the same key carry the same `at`. */
  val key: String get() = "$weightKg|$age|$sex|$maxHr|${restHr ?: "-"}"

  fun withAt(at: Long) = FuelProfile(weightKg, age, sex, maxHr, restHr, at)
}

internal object FuelProfiles {
  /**
   * The saved profile, or the same defaults the live workout estimate uses (`LiveWorkout.DEFAULT_AGE`, `DEFAULT_WEIGHT_KG`) when a value
   * is missing; they are sent all the same. `maxHr` is Huawei's 220 - age ([SubstrateEstimator.maxHeartRate]).
   */
  fun build(profile: UserProfileData?, changedAtMs: Long, restingHeartRate: Int?, today: LocalDate): FuelProfile {
    val age = profile?.birthYear?.takeIf { it > 0 }?.let { ProfileSender.age(it, today) } ?: LiveWorkout.DEFAULT_AGE
    val weight = profile?.weightKg?.takeIf { it > 0 } ?: LiveWorkout.DEFAULT_WEIGHT_KG
    val sex = profile?.sex?.takeIf { it == "male" || it == "female" } ?: "unknown"
    return FuelProfile(weight, age, sex, SubstrateEstimator.maxHeartRate(age), restingHeartRate?.takeIf { it > 0 }, if (profile == null) 0L else changedAtMs)
  }

  /**
   * The watch app drops a profile whose `at` is not newer than the one it stores, so `at` has to move whenever any value in the payload
   * does, not only when weight, birth year or sex changed: the resting heart rate and the age (a new year) change on their own. A profile
   * whose [FuelProfile.key] differs from the last one sent gets `max(changedAt, now)`; the same key keeps the `at` it had. A profile that
   * was never saved (`at` 0, defaults) stays at 0, so it never overrides anything on the watch. [commit] stores the decision.
   */
  fun stamp(base: FuelProfile, state: FuelState, nowMs: Long, commit: Boolean): FuelProfile {
    if (base.atMs == 0L) return base
    val key = base.key
    if (key == state.fuelSentKey && state.fuelStampedAtMs >= base.atMs) return base.withAt(state.fuelStampedAtMs)
    val at = maxOf(base.atMs, nowMs)
    if (commit) {
      state.fuelSentKey = key
      state.fuelStampedAtMs = at
    }
    return base.withAt(at)
  }
}

/** A message from the watch app. */
internal sealed class FuelMessage {
  class Hello(val version: String, val profileAtMs: Long) : FuelMessage()

  class Ack(val atMs: Long) : FuelMessage()

  /** Valid JSON of version 1 with a type this app does not know. */
  class Other(val type: String) : FuelMessage()

  /** Not a message: [reason] says why. */
  class Invalid(val reason: String) : FuelMessage()

  companion object {
    /** UTF-8 JSON, tolerating bytes before the first `{` and after the last `}`. Never throws. */
    fun parse(data: ByteArray): FuelMessage {
      val text = String(data, Charsets.UTF_8)
      val start = text.indexOf('{')
      val end = text.lastIndexOf('}')
      if (start < 0 || end < start) return Invalid("no JSON object in the payload")
      val json = try {
        JSONObject(text.substring(start, end + 1))
      } catch (e: JSONException) {
        return Invalid("not valid JSON: ${e.message}")
      }
      val v = json.optInt("v", -1)
      if (v != FuelContract.VERSION) return Invalid("unsupported message version $v (this app speaks ${FuelContract.VERSION})")
      return when (val type = json.optString("t")) {
        "hello" -> Hello(json.optString("ver"), json.optLong("profileAt", 0L))
        "ack" -> if (json.has("at")) Ack(json.optLong("at")) else Invalid("ack without an \"at\" field")
        "" -> Invalid("no \"t\" field")
        else -> Other(type)
      }
    }
  }
}

/** What [FuelService] keeps between messages; [P2pSettings] stores it, tests use memory. */
internal interface FuelState {
  /** Free text the watch app registers under (see protocol/README.md); empty means the bundle name is sent in its place. */
  var fuelWatchFingerprint: String
  var fuelLastHelloAtMs: Long
  var fuelLastHelloVersion: String?
  var fuelLastHelloProfileAtMs: Long
  var fuelLastProfileSentAtMs: Long
  var fuelLastAckAtMs: Long
  var fuelLastAckProfileAtMs: Long

  /** [FuelProfile.key] of the last profile sent and the `at` it went out with (see [FuelProfiles.stamp]). */
  var fuelSentKey: String?
  var fuelStampedAtMs: Long
}

/**
 * P2P service of the JoyoFit Fuel watch app. Module (the source package of what the phone sends) is the phone's application id,
 * package the watch app's bundle name, local fingerprint the SHA-256 of JoyoFit's signing certificate, remote fingerprint the one the
 * user typed (UNVERIFIED whether the watch checks either). Flow: on registration a ping; when the watch app answers 0xca the profile
 * goes out; a `hello` from the watch app is answered with the profile; an `ack` is recorded.
 */
internal class FuelService(
  manager: HuaweiP2PManager,
  private val state: FuelState,
  private val events: WearEvents,
  private val profile: () -> FuelProfile,
  /** Uppercase hex SHA-256 of the APK signing certificate; null when it cannot be read. */
  private val phoneFingerprint: () -> String?,
  private val now: () -> Long = System::currentTimeMillis,
) : HuaweiBaseP2PService(manager) {
  @Volatile
  var pingCode: Int? = null
    private set

  /** Whether the last ping was answered with 0xca. Null before an answer. */
  val reachable: Boolean? get() = pingCode?.let { (it and 0xFF) == FuelContract.PING_PRESENT }

  override fun getModule() = FuelContract.PHONE_PACKAGE

  override fun getPackage() = FuelContract.WATCH_PACKAGE

  override fun getFingerprint(): String = state.fuelWatchFingerprint.trim().ifEmpty { FuelContract.WATCH_PACKAGE }

  override fun getLocalFingerprint(): String = phoneFingerprint() ?: ""

  override fun getPingPackage() = FuelContract.PHONE_PACKAGE

  override fun registered() {
    ping("link connected")
  }

  override fun unregister() {
    clearPending()
  }

  /** Pings the watch app; a 0xca answer sends the profile unless [sendOnAnswer] is false. */
  fun ping(reason: String, sendOnAnswer: Boolean = true) {
    sendPing { code, _ ->
      pingCode = code
      log("Fuel: ping of ${FuelContract.WATCH_PACKAGE} ($reason) answered 0x%02x (0xca = the watch app is there)".format(code and 0xFF))
      if (sendOnAnswer && (code and 0xFF) == FuelContract.PING_PRESENT) sendProfile("ping answered")
    }
  }

  /**
   * Sends the profile as a P2P data packet. False when it cannot be sent (JoyoFit's certificate is unreadable); the watch's 0xcf
   * answer arrives later and is logged.
   */
  fun sendProfile(reason: String): Boolean {
    val fingerprint = phoneFingerprint()
    if (fingerprint.isNullOrEmpty()) {
      log("Fuel: profile not sent ($reason): the signing certificate of this app could not be read", error = true)
      return false
    }
    val current = FuelProfiles.stamp(profile(), state, now(), commit = true)
    val json = current.toJson()
    if (state.fuelWatchFingerprint.isBlank()) {
      log("Fuel: no watch app fingerprint is set; the bundle name ${FuelContract.WATCH_PACKAGE} goes out as the destination fingerprint (UNVERIFIED whether the watch checks it)")
    }
    val bytes = json.toByteArray(Charsets.UTF_8)
    log("Fuel: sending the profile ($reason), ${bytes.size} bytes: $json")
    sendCommand(bytes) { code, _ ->
      log("Fuel: the watch acknowledged the profile with 0x%02x (0xcf = received)".format(code and 0xFF))
    }
    state.fuelLastProfileSentAtMs = now()
    return true
  }

  override fun handleData(data: ByteArray) {
    when (val message = FuelMessage.parse(data)) {
      is FuelMessage.Invalid -> log("Fuel: a watch message was not understood (${message.reason}); payload ${data.size} bytes: ${data.toHex()}", error = true)
      is FuelMessage.Hello -> {
        state.fuelLastHelloAtMs = now()
        state.fuelLastHelloVersion = message.version
        state.fuelLastHelloProfileAtMs = message.profileAtMs
        log("Fuel: hello from the watch app, version ${message.version.ifEmpty { "(none)" }}, it holds a profile from ${message.profileAtMs}")
        sendProfile("reply to hello")
      }
      is FuelMessage.Ack -> {
        state.fuelLastAckAtMs = now()
        state.fuelLastAckProfileAtMs = message.atMs
        log("Fuel: the watch app stored the profile of ${message.atMs}")
      }
      is FuelMessage.Other -> log("Fuel: ignored a '${message.type}' message from the watch app")
    }
  }

  private fun log(message: String, error: Boolean = false) =
    events.log(if (error) LogDirection.ERROR else LogDirection.INFO, 0x34, 0x01, null, message)
}

/** JoyoFit's own signing certificate as the watch app is told about it. */
internal object SigningFingerprint {
  /** SHA-256 of [certificate] as uppercase hex without separators (64 characters). */
  fun sha256Hex(certificate: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(certificate).toHex()

  /** The current APK signing certificate of this app; null when `PackageManager` returns none. */
  fun of(context: Context): String? = try {
    val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    // apkContentsSigners is the current signing certificate; the history only matters after a key rotation.
    info.signingInfo?.apkContentsSigners?.firstOrNull()?.toByteArray()?.let(::sha256Hex)
  } catch (e: PackageManager.NameNotFoundException) {
    null
  }
}
