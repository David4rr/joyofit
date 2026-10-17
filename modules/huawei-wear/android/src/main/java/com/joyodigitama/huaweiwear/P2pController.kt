package com.joyodigitama.huaweiwear

import android.content.Context
import android.database.sqlite.SQLiteException
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.utils.HuaweiP2PSubMsg

/**
 * Owner of the P2P features across connections (the way [PhoneFeatures] owns its subscriptions): builds a
 * [P2pStack] on every new session when the link reaches CONNECTED, registers the services Huawei gates by
 * ExpandCapability, runs the health dictionary sync as an extension of the activity sync, and answers the watch's
 * Healthy Living requests.
 */
internal class P2pController(
  context: Context,
  val settings: P2pSettings,
  private val link: WearLink,
  private val wearSettings: WearSettings,
  private val syncStore: SyncStore,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val appContext = context.applicationContext
  private val metrics = HealthMetricsStore(syncStore)

  @Volatile
  private var stack: P2pStack? = null
  private var attached: HuaweiSession? = null

  init {
    // The dictionary sync runs inside the activity sync, under its operation lock, after the workouts.
    link.syncExtensions.add { _ -> syncHealthMetrics() }
  }

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  /** The live stack, or null when the watch is not connected or has no P2P service. */
  fun stack(): P2pStack? = stack

  @Synchronized
  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val handle = link.handle() ?: return
        if (handle.session === attached) return
        detach()
        attached = handle.session
        val created = P2pStack(
          handle.session, events, settings,
          { manager -> HealthModelService(manager, settings, events, scope, ::loadDay, ::goals) },
          { HeartRateZonesSync.age(wearSettings.profile) },
          { manager -> FuelService(manager, settings, events, ::fuelProfile, ::phoneFingerprint) },
        )
        stack = created
        created.start()
        created.registerServices()
        scope.launch(Dispatchers.IO) { recordGates(created) }
      }
      LinkState.DISCONNECTED -> detach()
      else -> Unit
    }
  }

  private fun detach() {
    stack?.close()
    stack = null
    attached = null
  }

  private fun recordGates(created: P2pStack) {
    val dictionary = created.dictionary ?: return
    try {
      HealthMetricsSync(created, metrics, events).recordGates(dictionary)
    } catch (e: SQLiteException) {
      error("Health metric gates not stored: ${e.message}")
    }
  }

  /** Called from the activity sync under the operation lock; never throws except for a lost link or cancellation. */
  private suspend fun syncHealthMetrics() {
    val current = stack ?: run {
      log("Health metrics: no P2P stack (the watch lists no 34/01); skipped")
      return
    }
    try {
      val result = HealthMetricsSync(current, metrics, events).sync() ?: return
      log("Health metrics: ${result.total} rows stored" + if (result.failed.isNotEmpty()) ", failed: ${result.failed.joinToString()}" else "")
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      error("Health metrics sync failed: ${e.message}")
    } catch (e: Exception) {
      error("Health metrics sync failed: ${e.message ?: e.javaClass.simpleName}")
    }
    // The day may have changed with the sync: tell the watch's Healthy Living, as Huawei Health does after data changes.
    current.healthModel?.push("activity sync")
  }

  // Healthy Living

  private fun loadDay(requestedDay: Int): HealthDay =
    HealthModelData.load(syncStore.db(), requestedDay, wearSettings.profile?.dailyStepGoal ?: 0, System.currentTimeMillis())

  private fun goals() = HealthGoals()

  fun healthLivingStatus(): Map<String, Any?> {
    val current = stack
    val service = current?.healthModel
    return mapOf(
      "supported" to (current != null && DeviceCaps.expandCapability(37)),
      "gate" to "ExpandCapability 37",
      "gateSet" to DeviceCaps.expandCapability(37),
      "enabled" to settings.healthLivingEnabled,
      "registered" to (service != null),
      "pingCode" to service?.pingCode,
      "msgVer" to settings.healthLivingMsgVer.takeIf { it > 0f }?.toDouble(),
      "packageSize" to settings.healthLivingPackageSize,
      "lastRequestAt" to settings.healthLivingLastRequestMs.takeIf { it > 0 },
      "lastReportAt" to settings.healthLivingLastReportMs.takeIf { it > 0 },
      "lastReport" to settings.healthLivingLastSummary,
    )
  }

  fun setHealthLivingEnabled(enabled: Boolean) {
    settings.healthLivingEnabled = enabled
    // Registration happens on connect; the change applies from the next connection (or now when switching off).
    if (!enabled) stack?.healthModel?.unregister()
  }

  /** Sends today's report now, as a push; false when the watch has not asked before (its msgVer is unknown). */
  suspend fun pushHealthLiving(): Boolean {
    val service = stack?.healthModel ?: throw WearException(ErrorCodes.UNSUPPORTED, "Healthy Living is not available: the watch is not connected, does not set ExpandCapability 37, or the feature is off")
    if (settings.healthLivingMsgVer <= 0f) return false
    withContext(Dispatchers.IO) { service.push("manual") }
    return true
  }

  // JoyoFit Fuel (watch app `com.joyodigitama.joyofit.fuel`, see FuelLink.kt)

  private val phoneFingerprintValue: String? by lazy {
    SigningFingerprint.of(appContext).also {
      if (it == null) error("Fuel: the signing certificate of this app could not be read; no phone fingerprint")
    }
  }

  private fun phoneFingerprint(): String? = phoneFingerprintValue

  /** The newest resting heart rate in the activity samples the sync stored; null when there is none or the database cannot be read. */
  private fun restingHeartRate(): Int? = try {
    syncStore.db().rawQuery(
      "SELECT resting_heart_rate FROM step_samples WHERE resting_heart_rate IS NOT NULL AND resting_heart_rate > 0 ORDER BY timestamp DESC LIMIT 1",
      null,
    ).use { if (it.moveToFirst()) it.getInt(0) else null }
  } catch (e: SQLiteException) {
    error("Fuel: the resting heart rate could not be read: ${e.message}")
    null
  }

  /** What the Fuel watch app is sent now: the saved profile, the newest resting heart rate. */
  private fun fuelProfile(): FuelProfile =
    FuelProfiles.build(wearSettings.profile, wearSettings.profileChangedAtMs, restingHeartRate(), LocalDate.now())

  /** [fuelProfile] with the `at` it goes out with, without storing the decision: what the next send would carry. */
  private fun fuelProfilePreview(): FuelProfile = FuelProfiles.stamp(fuelProfile(), settings, System.currentTimeMillis(), commit = false)

  fun fuelStatus(): Map<String, Any?> {
    val current = stack
    val service = current?.fuel
    val helloAt = settings.fuelLastHelloAtMs
    return mapOf(
      "available" to (current != null),
      "registered" to (service != null),
      "pingCode" to service?.pingCode,
      "reachable" to service?.reachable,
      "phonePackage" to FuelContract.PHONE_PACKAGE,
      "watchPackage" to FuelContract.WATCH_PACKAGE,
      "phoneFingerprint" to phoneFingerprint(),
      "watchFingerprint" to settings.fuelWatchFingerprint,
      "lastHelloAt" to helloAt.takeIf { it > 0 },
      "lastHelloVersion" to settings.fuelLastHelloVersion,
      "lastHelloProfileAt" to if (helloAt > 0) settings.fuelLastHelloProfileAtMs else null,
      "lastProfileSentAt" to settings.fuelLastProfileSentAtMs.takeIf { it > 0 },
      "lastAckAt" to settings.fuelLastAckAtMs.takeIf { it > 0 },
      "lastAckProfileAt" to if (settings.fuelLastAckAtMs > 0) settings.fuelLastAckProfileAtMs else null,
      "profile" to fuelProfilePreview().toJs(),
    )
  }

  fun setFuelWatchFingerprint(value: String) {
    settings.fuelWatchFingerprint = value
    log("Fuel: the watch app fingerprint is now " + value.trim().ifEmpty { "empty (the bundle name is sent in its place)" })
  }

  /** "Send profile now": pings the watch app again and sends the profile whatever the answer is. */
  suspend fun sendFuelProfile(): Map<String, Any?> = withContext(Dispatchers.IO) {
    val service = stack?.fuel
      ?: throw WearException(ErrorCodes.UNSUPPORTED, "The JoyoFit Fuel link needs a connected watch that lists the P2P service (0x34/0x01)")
    service.ping("send profile now", sendOnAnswer = false)
    val sent = service.sendProfile("send profile now")
    mapOf("sent" to sent, "profile" to fuelProfilePreview().toJs())
  }

  /** The user changed the profile: the Fuel watch app gets the new numbers when it is there ([previous] is what was stored before). */
  fun onProfileChanged(previous: UserProfileData?, current: UserProfileData) {
    if (previous != null && previous.weightKg == current.weightKg && previous.birthYear == current.birthYear && previous.sex == current.sex) return
    val service = stack?.fuel ?: return
    if (service.reachable == false) {
      log("Fuel: profile changed, not sent: the watch app did not answer the ping with 0xca")
      return
    }
    scope.launch(Dispatchers.IO) { service.sendProfile("profile changed") }
  }

  // Running courses (experimental, off by default)

  fun coursesStatus(): Map<String, Any?> = mapOf(
    "enabled" to settings.experimentalCourses,
    // Huawei Health gates on ExpandCapability 41 (intelligent run plan) or 169 (AI fitness plan).
    "gate41" to DeviceCaps.expandCapability(41),
    "gate169" to DeviceCaps.expandCapability(169),
    "gate295" to DeviceCaps.expandCapability(295),
    "p2p" to (stack != null),
  )

  /**
   * Pushes [course] to the watch's `in.huawei.fitness` app as `<messageId>courseInfo.bin` (see [CourseProtobuf]). The flow follows
   * Huawei Health's behaviour; nothing of it has been seen on a watch, so every step is logged and the result reports what the
   * watch said, including the body of its answer message.
   */
  suspend fun pushCourse(course: RunningCourse): Map<String, Any?> {
    if (!settings.experimentalCourses) {
      throw WearException(ErrorCodes.UNSUPPORTED, "Running courses are an experimental feature; switch them on in the app first")
    }
    CourseProtobuf.validate(course)
    val handle = link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")
    val current = stack ?: throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not list the P2P service (34/01)")
    val gate41 = DeviceCaps.expandCapability(41)
    val gate169 = DeviceCaps.expandCapability(169)
    log("Courses: gates ExpandCapability 41=$gate41 169=$gate169 295=${DeviceCaps.expandCapability(295)} (Huawei Health: 41 or 169)")
    if (!gate41 && !gate169) {
      throw WearException(ErrorCodes.UNSUPPORTED, "The watch sets neither ExpandCapability 41 nor 169, the bits Huawei Health requires before it pushes a course")
    }
    var service = current.manager.getRegisteredService(FitnessCourseService.MODULE) as? FitnessCourseService
    if (service == null) {
      service = FitnessCourseService(current.manager, events)
      service.register()
    }
    val registered = service
    val ready = withTimeoutOrNull(PING_WAIT_MS) {
      while (registered.pingCode == null) delay(100)
      true
    }
    log("Courses: ping of ${FitnessCourseService.PACKAGE} -> ${registered.pingCode?.let { "0x%02x".format(it and 0xFF) } ?: "no answer in ${PING_WAIT_MS} ms"}; sending anyway")
    if (ready != true) log("Courses: the fitness app did not answer the ping; the upload may be refused")

    val messageId = HuaweiP2PSubMsg.getNext()
    val updateTime = (System.currentTimeMillis() / 1000).toInt()
    val payload = CourseProtobuf.encode(course, updateTime)
    val file = CourseProtobuf.message(CourseProtobuf.BUSINESS_CUSTOM_COURSE, messageId, payload)
    val fileName = CourseProtobuf.fileName(messageId)
    log("Courses: ${course.name}: ${course.actionCount} steps, CourseStorageInfo ${payload.size} bytes, $fileName ${file.size} bytes: ${file.toHex()}")

    val answer = registered.expectAnswer(messageId)
    try {
      val outcome = handle.operationLock.withLock {
        val route = P2pRoute(FitnessCourseService.MODULE, FitnessCourseService.PACKAGE, registered.localFingerprint, FitnessCourseService.FINGERPRINT)
        FileUploader(handle.session, events, { bytes, total -> events.uploadProgress(bytes, total) })
          .upload(UploadFile(fileName, FILE_TYPE_P2P, file, route))
      }
      val reply = withTimeoutOrNull(ANSWER_WAIT_MS) { answer.await() }
      log(
        "Courses: upload finished, watch result status=${outcome.resultStatus ?: "none"}; answer message " +
          (reply?.let { "body ${it.toHex().ifEmpty { "(empty)" }}" } ?: "none within ${ANSWER_WAIT_MS / 1000} s"),
      )
      return mapOf(
        "messageId" to messageId,
        "fileName" to fileName,
        "bytes" to file.size,
        "uploadStatus" to outcome.resultStatus,
        "answered" to (reply != null),
        "answerHex" to reply?.toHex(),
      )
    } finally {
      registered.forget(messageId)
    }
  }

  private companion object {
    const val PING_WAIT_MS = 4_000L
    const val ANSWER_WAIT_MS = 10_000L

    /** GB uses file type 7 for every P2P file (`HuaweiP2PFitnessData`, `HuaweiP2PContactsService`, ...). */
    const val FILE_TYPE_P2P: Byte = 7
  }
}
