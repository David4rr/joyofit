// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiFwHelper.parseAsApp,
// HuaweiAppManager.AppConfig and devices/huawei/HuaweiBinAppParser (ported in the GB package of this module).
package com.joyodigitama.huaweiwear

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.Base64
import java.util.zip.ZipException
import java.util.zip.ZipInputStream
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiBinAppParser
import org.json.JSONException
import org.json.JSONObject

/** `config.json` of a Lite Wearable app: GB `HuaweiAppManager.AppConfig` (`app.bundleName`, `app.vendor`, `app.version.name`). */
internal class AppConfig(val bundleName: String?, val vendor: String?, val version: String?) {
  companion object {
    fun parse(json: String): AppConfig? = try {
      val app = JSONObject(json).getJSONObject("app")
      AppConfig(
        bundleName = app.optString("bundleName").takeIf { it.isNotEmpty() },
        vendor = app.optString("vendor").takeIf { it.isNotEmpty() },
        version = app.optJSONObject("version")?.optString("name")?.takeIf { it.isNotEmpty() },
      )
    } catch (e: JSONException) {
      null
    }
  }
}

/** A Lite Wearable app container the watch can be sent: what the picker's file holds, read like GB's `HuaweiFwHelper.parseAsApp`. */
internal class WatchAppPackage(
  /** The package name inside the container (the name the watch installs it under and the upload is named after). */
  val packageName: String,
  val config: AppConfig,
  /** The container ends with the `hw signed app   ` + `1000` signature header. */
  val signed: Boolean,
  /** `icon_small.png` of the container, if it has one. */
  val icon: ByteArray?,
  /** The bytes that go over the 0x28 upload: the container itself, unwrapped from a zip when the file was one. */
  val binary: ByteArray,
  /** Name of the zip entry the container was taken from; null when the file was the container. */
  val unwrappedFrom: String?,
  /** Names of the files inside the container, for the log. */
  val entryNames: List<String>,
) {
  val name: String get() = config.bundleName ?: packageName

  fun toJs(): Map<String, Any?> = mapOf(
    "packageName" to packageName,
    "bundleName" to config.bundleName,
    "vendor" to config.vendor,
    "version" to config.version,
    "signed" to signed,
    "bytes" to binary.size,
    "unwrappedFrom" to unwrappedFrom,
    "iconBase64" to icon?.takeIf { it.size <= MAX_ICON_BYTES }?.let { Base64.getEncoder().encodeToString(it) },
  )

  private companion object {
    const val MAX_ICON_BYTES = 128 * 1024
  }
}

internal object WatchAppPackages {
  /** An app container of a Lite Wearable is a few hundred kilobytes; 16 MiB is far above anything the watch would take. */
  const val MAX_PACKAGE_BYTES = 16 * 1024 * 1024

  private const val CONFIG = "config.json"
  private const val ICON = "icon_small.png"

  /**
   * What DevEco Studio 3.1.1 writes for a Lite Wearable build is `entry-bin-debug-lite-signed.hap` (community guides copy it to the phone
   * for Huawei DevEco Assistant; Gadgetbridge's installer takes the same app as a `.bin`). Whether that file is the bare container
   * (magic 0xBE) or a zip around it has not been observed here, so both are read: a container is taken as it is, a zip is searched for an
   * entry that is one. Anything else (for example a zip of `config.json` and a JS bundle, the layout of a phone HAP) is refused.
   */
  fun parse(bytes: ByteArray, log: (String) -> Unit = {}): WatchAppPackage {
    if (bytes.isEmpty()) throw invalid("The file is empty.")
    if (bytes[0] == HuaweiBinAppParser.BIN_APP_MAGIC) {
      return fromContainer(bytes, null)
    }
    if (isZip(bytes)) {
      val inner = findContainerInZip(bytes, log)
      if (inner != null) {
        log("the file is a zip; using its entry ${inner.first} as the app container")
        return fromContainer(inner.second, inner.first)
      }
      throw invalid(
        "This zip has no Lite Wearable app container inside (no entry starts with the 0xBE magic byte of Huawei's app binary). " +
          "JoyoFit installs the signed Lite Wearable build DevEco Studio writes (entry-bin-debug-lite-signed.hap) or the .bin Gadgetbridge installs.",
      )
    }
    throw invalid(
      "This file is not a Lite Wearable app: it does not start with the 0xBE magic byte of Huawei's app binary and is not a zip. " +
        "JoyoFit installs the signed Lite Wearable build DevEco Studio writes (entry-bin-debug-lite-signed.hap) or the .bin Gadgetbridge installs.",
    )
  }

  private fun fromContainer(container: ByteArray, from: String?): WatchAppPackage {
    val parser = HuaweiBinAppParser()
    try {
      parser.parseData(container)
    } catch (e: HuaweiBinAppParser.HuaweiBinAppParseError) {
      throw invalid("The app container could not be read: ${e.message}.")
    }
    val configBytes = parser.getEntryContent(CONFIG)
      ?: throw invalid("The app container has no $CONFIG, so its name and version are unknown.")
    val config = AppConfig.parse(String(configBytes, Charsets.UTF_8))
      ?: throw invalid("The $CONFIG in the app container is not valid JSON with an \"app\" object.")
    val packageName = parser.packageName
    if (packageName.isNullOrBlank()) throw invalid("The app container names no package.")
    return WatchAppPackage(
      packageName = packageName,
      config = config,
      signed = parser.isSigned,
      icon = parser.getEntryContent(ICON),
      binary = container,
      unwrappedFrom = from,
      entryNames = parser.entries.map { it.filename },
    )
  }

  private fun isZip(bytes: ByteArray) =
    bytes.size >= 4 && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte() && bytes[2].toInt() == 3 && bytes[3].toInt() == 4

  /** The first zip entry that parses as an app container: its name and bytes. */
  private fun findContainerInZip(bytes: ByteArray, log: (String) -> Unit): Pair<String, ByteArray>? {
    try {
      ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
        var entry = zip.nextEntry
        while (entry != null) {
          if (!entry.isDirectory) {
            val content = readEntry(zip)
            if (content.isNotEmpty() && content[0] == HuaweiBinAppParser.BIN_APP_MAGIC) {
              try {
                HuaweiBinAppParser().parseData(content)
                return entry.name to content
              } catch (e: HuaweiBinAppParser.HuaweiBinAppParseError) {
                log("zip entry ${entry.name} starts with 0xBE but is not an app container: ${e.message}")
              }
            }
          }
          entry = zip.nextEntry
        }
      }
    } catch (e: ZipException) {
      throw invalid("The file looks like a zip but could not be read: ${e.message}.")
    } catch (e: IOException) {
      throw invalid("The file looks like a zip but could not be read: ${e.message}.")
    }
    return null
  }

  private fun readEntry(zip: ZipInputStream): ByteArray {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(16384)
    while (true) {
      val n = zip.read(buffer)
      if (n < 0) break
      out.write(buffer, 0, n)
      if (out.size() > MAX_PACKAGE_BYTES) throw invalid("An entry of the zip is larger than ${MAX_PACKAGE_BYTES / 1024 / 1024} MiB.")
    }
    return out.toByteArray()
  }

  private fun invalid(message: String) = WearException(ErrorCodes.INVALID_ARGUMENT, message)
}
