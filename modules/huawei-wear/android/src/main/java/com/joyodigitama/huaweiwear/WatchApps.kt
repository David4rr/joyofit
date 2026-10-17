// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiAppManager (handleInstallStatus,
// requestAppList, deleteApp), HuaweiFwHelper.parseAsApp (the upload is named `<package>_INSTALL`, file type 6) and
// requests/{GetAppInfoParams,GetAppNames,SendAppDelete}.
//
// Nothing here has run on a Watch Fit 4 Pro; every step is logged so the first attempt shows what the watch says.
package com.joyodigitama.huaweiwear

import android.content.Context
import android.net.Uri
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.App
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileUpload

/** GB `FileUpload.Filetype.app`. */
internal const val FILE_TYPE_APP: Byte = FileUpload.Filetype.app

/** What the watch reports in 0x2a/0x06 (GB `App.AppDeviceParams`). */
internal class AppDeviceParams(
  /** 38 = liteWearable (GB's comment). */
  val type: Int,
  val osApiLevel: Int,
  val osVersion: String,
  val screenShape: String,
  val width: Int,
  val height: Int,
  val buildLevel: Int,
  val buildType: String,
) {
  val typeName: String? get() = if (type == TYPE_LITE_WEARABLE) "liteWearable" else null

  fun toJs(): Map<String, Any?> = mapOf(
    "type" to type,
    "typeName" to typeName,
    "osApiLevel" to osApiLevel,
    "osVersion" to osVersion,
    "screenShape" to screenShape,
    "width" to width,
    "height" to height,
    "buildLevel" to buildLevel,
    "buildType" to buildType,
  )

  companion object {
    const val TYPE_LITE_WEARABLE = 38
  }
}

/** One entry of the watch's app list (GB `App.InstalledAppInfo`). */
internal class InstalledApp(
  val packageName: String,
  val name: String,
  val version: String,
  val versionCode: Int,
  val size: Int,
  val packageType: Int,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "packageName" to packageName,
    "name" to name,
    "version" to version,
    "versionCode" to versionCode,
    "size" to size,
    "packageType" to packageType,
  )
}

/** `WatchAppList` in `HuaweiWearWatchApps.types.ts`. */
internal class WatchAppList(val params: AppDeviceParams?, val apps: List<InstalledApp>, val updatedAtMs: Long) {
  fun toJs(): Map<String, Any?> = mapOf(
    "params" to params?.toJs(),
    "apps" to apps.map { it.toJs() },
    "updatedAt" to updatedAtMs,
  )
}

/** `WatchAppInstallResult` in `HuaweiWearWatchApps.types.ts`. */
internal class AppInstallResult(
  val fileName: String,
  val packageName: String,
  val name: String,
  val version: String?,
  val bytes: Int,
  val signed: Boolean,
  /** Tag 0x02 of the watch's 0x28/0x07 packet; null when it sent none. */
  val uploadStatus: Int?,
  /** The last 0x2a/0x02 state the watch reported for the package (102 installed, 103 failed); null when it reported none. */
  val reportedStatus: Int?,
  /** The package is in the watch's app list afterwards. */
  val listed: Boolean,
  val message: String,
  val list: WatchAppList?,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "fileName" to fileName,
    "packageName" to packageName,
    "name" to name,
    "version" to version,
    "bytes" to bytes,
    "signed" to signed,
    "uploadStatus" to uploadStatus,
    "reportedStatus" to reportedStatus,
    "listed" to listed,
    "message" to message,
    "list" to list?.toJs(),
  )
}

/** A parsed 0x2a/0x02 report: [status] is a percentage up to 100 or one of 101 to 106 (GB `AppInstallStatus`). */
internal class AppStatusReport(val status: Int, val packageName: String)

/** `phase` of `onAppInstallStatus` for a 0x2a/0x02 status. */
internal fun appStatusPhase(status: Int): String = when (status) {
  in 0..App.AppInstallStatus.PROGRESS_MAX -> "progress"
  App.AppInstallStatus.STATE_INSTALL_STARTED -> "installStarted"
  App.AppInstallStatus.STATE_INSTALLED -> "installed"
  App.AppInstallStatus.STATE_INSTALL_FAILED -> "installFailed"
  App.AppInstallStatus.STATE_UNINSTALL_STARTED -> "removeStarted"
  App.AppInstallStatus.STATE_UNINSTALLED -> "removed"
  App.AppInstallStatus.STATE_UNINSTALL_FAILED -> "removeFailed"
  else -> "unknown"
}

/**
 * Why a watch may refuse an app: Huawei's firmware checks the app's signature (Gadgetbridge issue #4175: a debug build signed with a
 * profile that lists the watch's UDID, or an AppGallery release). The codes of 0x2a/0x02 are not documented; 103 is GB's "failed".
 */
internal fun signingExplanation(signed: Boolean): String = buildString {
  append(
    "A Huawei watch only runs apps that Huawei signed: a debug build whose signing profile (AppGallery Connect) lists this watch's " +
      "UDID, or a release from AppGallery. ",
  )
  if (!signed) append("This file carries no \"hw signed app\" signature, so the watch is expected to refuse it. ")
  append("Rebuild the app with such a profile; watchapp/fuel/README.md describes the steps.")
}

internal fun describeInstallFailure(signed: Boolean): String =
  "The watch refused to install the app (it reported 103, install failed). " + signingExplanation(signed)

/**
 * The 0x2a app service on a connected [session]: device parameters (06), app list (03), install status reports (02) and delete (01).
 * The callers serialize these with the link's operation lock.
 */
internal class WatchAppOps(
  private val session: HuaweiSession,
  private val events: WearEvents,
  private val uploadStallMs: Long = FileUploader.STALL_MS,
  /** How long the watch may stay silent between two install reports after the upload (it unpacks and verifies the app). */
  private val installStallMs: Long = INSTALL_STALL_MS,
  private val removeStallMs: Long = REMOVE_STALL_MS,
  private val queryMs: Long = Timeouts.QUERY_MS,
) {
  private val params get() = session.params

  /** GB `HuaweiState.supportsAppParams`: SupportedCommands lists 0x2a/0x06. The decision is logged. */
  private fun requireService() {
    val listed = DeviceCaps.supports(App.id.toInt(), App.AppInfoParams.id.toInt())
    log("SupportedCommands 2a/06=$listed (GB supportsAppParams gates app management on it)")
    if (!listed) {
      throw WearException(
        ErrorCodes.UNSUPPORTED,
        "The watch does not list the app command 0x2a/0x06 in its supported commands, so JoyoFit does not use its app service " +
          "(Gadgetbridge gates apps on the same entry).",
      )
    }
  }

  /** GB GetAppInfoParams (0x2a/0x06). Null when the watch did not answer. */
  suspend fun readParams(): AppDeviceParams? {
    val response = try {
      session
        .request(App.AppInfoParams.Request(params), queryMs, "AppInfoParams")
        .expect<App.AppInfoParams.Response>("AppInfoParams")
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      log("AppInfoParams failed: ${e.message}", error = true)
      return null
    }
    val p = response.params
    val result = AppDeviceParams(p.type.toInt() and 0xFF, p.osApiLevel, p.osVersion, p.screenShape, p.width, p.height, p.buildLevel, p.buildType)
    log(
      "AppInfoParams: type=${result.type}${result.typeName?.let { " ($it)" } ?: ""} osApiLevel=${result.osApiLevel} osVersion=${result.osVersion} " +
        "screenShape=${result.screenShape} ${result.width}x${result.height} buildLevel=${result.buildLevel} buildType=${result.buildType}",
    )
    return result
  }

  /** GB GetAppNames (0x2a/0x03) after the device parameters. */
  suspend fun list(): WatchAppList {
    requireService()
    val deviceParams = readParams()
    val response = session
      .request(App.AppNames.Request(params), queryMs, "AppNames")
      .expect<App.AppNames.Response>("AppNames")
    val apps = (response.appInfoList ?: emptyList()).map {
      InstalledApp(it.packageName, it.appName.ifBlank { it.packageName }, it.version, it.versionCode, it.size, it.packageType.toInt() and 0xFF)
    }
    for (app in apps) {
      log("AppList: ${app.packageName} \"${app.name}\" version=${app.version} versionCode=${app.versionCode} size=${app.size} packageType=${app.packageType}")
    }
    log("AppList: ${apps.size} app(s)")
    return WatchAppList(deviceParams, apps, System.currentTimeMillis())
  }

  /**
   * GB `HuaweiAppManager.deleteApp` sends 0x2a/0x01 (tag 1 = 1, tag 2 = package) and does not wait; the watch then reports 104 (removal
   * started) and 105 (removed) or 106 (failed) in 0x2a/0x02 (GB `handleInstallStatus`). This waits for 105 or 106, then reads the list.
   */
  suspend fun delete(packageName: String): WatchAppList {
    val before = list()
    val app = before.apps.firstOrNull { it.packageName == packageName }
      ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "The watch has no app with package '$packageName'")
    val reports = StatusReports(packageName)
    var outcome: Int? = null
    try {
      log("AppDelete ${app.packageName} \"${app.name}\"")
      session.send(App.AppDelete.Request(params, packageName), "AppDelete $packageName")
      while (outcome == null) {
        val report = reports.next(removeStallMs) ?: break
        when (report.status) {
          App.AppInstallStatus.STATE_UNINSTALL_STARTED -> log("the watch started removing $packageName")
          App.AppInstallStatus.STATE_UNINSTALLED, App.AppInstallStatus.STATE_UNINSTALL_FAILED -> outcome = report.status
          else -> log("unexpected report ${report.status} while removing $packageName")
        }
      }
    } finally {
      reports.close()
    }
    if (outcome == App.AppInstallStatus.STATE_UNINSTALL_FAILED) {
      throw WearException(
        ErrorCodes.UPLOAD_REJECTED,
        "The watch could not remove \"${app.name}\" (it reported 106, uninstall failed).",
        statusCode = outcome,
      )
    }
    val after = list()
    val stillThere = after.apps.any { it.packageName == packageName }
    if (outcome == null && stillThere) {
      throw WearException(
        ErrorCodes.TIMEOUT,
        "The watch sent no removal report for \"${app.name}\" within ${removeStallMs / 1000} s and still lists it.",
      )
    }
    if (stillThere) {
      throw WearException(
        ErrorCodes.UPLOAD_REJECTED,
        "The watch reported \"${app.name}\" removed (105) but still lists it.",
        statusCode = outcome,
      )
    }
    if (outcome == null) log("no removal report arrived, but $packageName is gone from the watch's list")
    return after
  }

  /**
   * GB `HuaweiFwHelper.parseAsApp` + `HuaweiInstallHandler`: the container is uploaded unchanged as file type 6 under
   * `<package>_INSTALL`. GB uses that suffix for first installs and updates alike (its code carries "TODO: INSTALL or UPDATE suffix"),
   * so an app already on the watch is sent under the same name. The watch then reports 101 (started), a percentage, and 102
   * (installed) or 103 (failed) in 0x2a/0x02; GB handles them in `HuaweiAppManager.handleInstallStatus`.
   */
  suspend fun install(pkg: WatchAppPackage, progress: (bytes: Int, total: Int) -> Unit): AppInstallResult {
    requireService()
    val fileName = pkg.packageName + INSTALL_SUFFIX
    log(
      "Install \"${pkg.name}\" ${pkg.config.version ?: "(no version)"} by ${pkg.config.vendor ?: "(no vendor)"}: package ${pkg.packageName}, " +
        "${pkg.binary.size} bytes, signed=${pkg.signed}" + (pkg.unwrappedFrom?.let { ", unwrapped from zip entry $it" } ?: "") +
        ", entries ${pkg.entryNames.joinToString()}",
    )
    if (!pkg.signed) {
      log("the container has no \"hw signed app\" trailer; the watch will refuse it unless it is signed some other way (103 expected)", error = true)
    }
    val installed = list()
    val deviceParams = installed.params
    if (deviceParams != null && deviceParams.type != AppDeviceParams.TYPE_LITE_WEARABLE) {
      log("the watch reports app type ${deviceParams.type}, not 38 (liteWearable); sending anyway", error = true)
    }
    val existing = installed.apps.firstOrNull { it.packageName == pkg.packageName }
    if (existing != null) {
      log(
        "${pkg.packageName} is on the watch already (version ${existing.version}); GB uses the same ${INSTALL_SUFFIX} name for an update " +
          "(its TODO for an UPDATE suffix is not done), so the upload is named $fileName as well",
      )
    }

    val reports = StatusReports(pkg.packageName)
    val outcome: UploadOutcome
    var reported: Int? = null
    try {
      outcome = FileUploader(session, events, progress, uploadStallMs)
        .upload(UploadFile(fileName, FILE_TYPE_APP, pkg.binary))
      while (reported == null) {
        val report = reports.next(installStallMs) ?: break
        when (report.status) {
          in 0..App.AppInstallStatus.PROGRESS_MAX -> Unit
          App.AppInstallStatus.STATE_INSTALL_STARTED -> log("the watch started installing ${pkg.packageName}")
          App.AppInstallStatus.STATE_INSTALLED, App.AppInstallStatus.STATE_INSTALL_FAILED -> reported = report.status
          else -> log("unexpected report ${report.status} while installing ${pkg.packageName}")
        }
      }
    } finally {
      reports.close()
    }
    if (reported == App.AppInstallStatus.STATE_INSTALL_FAILED) {
      throw WearException(ErrorCodes.UPLOAD_REJECTED, describeInstallFailure(pkg.signed), statusCode = reported)
    }
    if (reported == null) log("no 102 or 103 arrived within ${installStallMs / 1000} s of the last report", error = true)

    val after = try {
      list()
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      log("the list after the install could not be read: ${e.message}", error = true)
      null
    }
    val entry = after?.apps?.firstOrNull { it.packageName == pkg.packageName }
    val message = when {
      reported == App.AppInstallStatus.STATE_INSTALLED && entry != null -> "Installed."
      reported == App.AppInstallStatus.STATE_INSTALLED && after == null -> "The watch reported the app installed, but did not answer when asked for its apps."
      reported == App.AppInstallStatus.STATE_INSTALLED -> "The watch reported the app installed (102) but does not list it."
      entry != null -> "The watch sent no install report, but the app is in its list now."
      after == null -> "Uploaded, but the watch reported no result and did not answer when asked for its apps."
      else -> throw WearException(
        ErrorCodes.TIMEOUT,
        "The upload finished (watch status ${outcome.resultStatus ?: "none"}), then the watch sent no install report within " +
          "${installStallMs / 1000} s and does not list the app. " + signingExplanation(pkg.signed),
      )
    }
    log("Install result: $message")
    return AppInstallResult(
      fileName = fileName,
      packageName = pkg.packageName,
      name = pkg.name,
      version = pkg.config.version,
      bytes = pkg.binary.size,
      signed = pkg.signed,
      uploadStatus = outcome.resultStatus,
      reportedStatus = reported,
      listed = entry != null,
      message = message,
      list = after,
    )
  }

  /** The 0x2a/0x02 (and the unrequested 0x2a/0x01 answer) the watch pushes, queued in order and parsed on the caller's side. */
  private inner class StatusReports(private val packageName: String) : AutoCloseable {
    private val incoming = Channel<HuaweiPacket>(Channel.UNLIMITED)
    private val subscriptions = listOf(
      session.subscribe(App.id, App.AppInstallStatus.id, "app status $packageName") { incoming.trySend(it) },
      session.subscribe(App.id, App.AppDelete.id, "app delete answer $packageName") { incoming.trySend(it) },
    )

    /** The next report for [packageName] (or naming no package), or null after [limitMs] without one. */
    suspend fun next(limitMs: Long): AppStatusReport? {
      var waited = 0L
      while (waited < limitMs) {
        session.closeCause?.let { throw it }
        val slice = minOf(POLL_MS, limitMs - waited)
        val packet = withTimeoutOrNull(slice) { incoming.receive() }
        if (packet == null) {
          waited += slice
          continue
        }
        val report = parse(packet) ?: continue
        if (report.packageName.isNotEmpty() && report.packageName != packageName) {
          log("report ${report.status} is about ${report.packageName}, not $packageName; ignored")
          continue
        }
        events.appInstallStatus(report.status, report.packageName)
        return report
      }
      session.closeCause?.let { throw it }
      return null
    }

    private fun parse(packet: HuaweiPacket): AppStatusReport? {
      if (packet.commandId == App.AppDelete.id) {
        log("AppDelete answer from the watch: ${describeTlv(packet.getTlv())}")
        return null
      }
      return try {
        packet.parseTlv()
        val response = packet as? App.AppInstallStatus.Response
          ?: throw WearException(ErrorCodes.PROTOCOL, "AppInstallStatus: response type mismatch")
        log("AppInstallStatus: ${describe(response.status)} package=${response.packageName.ifEmpty { "(none)" }}")
        AppStatusReport(response.status, response.packageName)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        log("AppInstallStatus could not be read: ${e.message}", error = true)
        null
      }
    }

    override fun close() {
      for (s in subscriptions) s.close()
      incoming.close()
    }
  }

  private fun describe(status: Int): String = when {
    status <= App.AppInstallStatus.PROGRESS_MAX -> "$status %"
    status == App.AppInstallStatus.STATE_INSTALL_STARTED -> "101 install started"
    status == App.AppInstallStatus.STATE_INSTALLED -> "102 installed"
    status == App.AppInstallStatus.STATE_INSTALL_FAILED -> "103 install failed"
    status == App.AppInstallStatus.STATE_UNINSTALL_STARTED -> "104 removal started"
    status == App.AppInstallStatus.STATE_UNINSTALLED -> "105 removed"
    status == App.AppInstallStatus.STATE_UNINSTALL_FAILED -> "106 removal failed"
    else -> "$status (unknown state)"
  }

  private fun log(message: String, error: Boolean = false) =
    events.log(if (error) LogDirection.ERROR else LogDirection.INFO, null, null, null, "App: $message")

  companion object {
    /** GB names every app upload `<package>_INSTALL`. */
    const val INSTALL_SUFFIX = "_INSTALL"

    /** The watch unpacks and verifies the app after the last chunk; the longest gap between two reports seen anywhere is not known. */
    const val INSTALL_STALL_MS = 60_000L
    const val REMOVE_STALL_MS = 30_000L
    private const val POLL_MS = 500L
  }
}

/**
 * The watch app part of the module: serializes every operation with the link's operation lock, reads the picked file's URI and turns
 * progress and outcome into `onUploadProgress` / `onAppInstallStatus` / `onUploadResult` events.
 */
internal class WatchAppController(
  private val context: Context,
  private val link: WearLink,
  private val events: WearEvents,
) {
  suspend fun list(): Map<String, Any?> = withWatch { ops -> ops.list().toJs() }

  suspend fun delete(packageName: String): Map<String, Any?> = withWatch { ops -> ops.delete(packageName).toJs() }

  /** Reads the picked file and says what it is, without touching the watch. Rejects with ERR_INVALID_ARGUMENT for a file that is no app. */
  suspend fun inspect(uri: String): Map<String, Any?> {
    val pkg = parse(uri)
    return pkg.toJs()
  }

  /**
   * Uploads the picked app. An app without the signature trailer is refused unless [allowUnsigned]: the watch deletes or refuses it (103),
   * so the app asks the user first.
   */
  suspend fun install(uri: String, allowUnsigned: Boolean): Map<String, Any?> {
    link.handle() ?: throw notConnected()
    val pkg = parse(uri)
    val fileName = pkg.packageName + WatchAppOps.INSTALL_SUFFIX
    if (!pkg.signed && !allowUnsigned) {
      throw WearException(
        ErrorCodes.INVALID_ARGUMENT,
        "\"${pkg.name}\" is not signed (no \"hw signed app\" trailer). A watch only installs apps Huawei signed; confirm to send it anyway.",
      )
    }
    var lastEmit = 0L
    val progress = { done: Int, total: Int ->
      val now = System.nanoTime() / 1_000_000
      if (done >= total || done == 0 || now - lastEmit >= PROGRESS_INTERVAL_MS) {
        lastEmit = now
        events.uploadProgress(done, total)
      }
    }
    return withWatch { ops ->
      try {
        val result = ops.install(pkg, progress)
        events.uploadResult(result.listed, result.fileName, result.uploadStatus, result.message)
        result.toJs()
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        events.uploadResult(false, fileName, e.statusCode, e.message ?: e.errorCode)
        throw e
      }
    }
  }

  private suspend fun parse(uri: String): WatchAppPackage {
    val bytes = withContext(Dispatchers.IO) { readUri(uri) }
    return WatchAppPackages.parse(bytes) { events.log(LogDirection.INFO, null, null, null, "App: $it") }
  }

  private suspend fun <T> withWatch(block: suspend (WatchAppOps) -> T): T {
    val handle = link.handle() ?: throw notConnected()
    return handle.operationLock.withLock {
      // The link may have dropped while this waited for a sync to end.
      val current = link.handle()
      if (current == null || current.session !== handle.session) throw notConnected()
      block(WatchAppOps(handle.session, events))
    }
  }

  private fun notConnected() = WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")

  private fun readUri(uri: String): ByteArray {
    val parsed = Uri.parse(uri)
    try {
      val stream = context.contentResolver.openInputStream(parsed)
        ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "Could not open $uri")
      return stream.use {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(16384)
        while (true) {
          val n = it.read(buffer)
          if (n < 0) break
          out.write(buffer, 0, n)
          if (out.size() > WatchAppPackages.MAX_PACKAGE_BYTES) {
            throw WearException(ErrorCodes.INVALID_ARGUMENT, "That file is larger than ${WatchAppPackages.MAX_PACKAGE_BYTES / 1024 / 1024} MiB, too big for a watch app")
          }
        }
        out.toByteArray()
      }
    } catch (e: WearException) {
      throw e
    } catch (e: IOException) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "Could not read the file: ${e.message}", e)
    } catch (e: SecurityException) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "No permission to read the file: ${e.message}", e)
    }
  }

  private companion object {
    const val PROGRESS_INTERVAL_MS = 200L
  }
}
