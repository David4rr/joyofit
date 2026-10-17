package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.Collections
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** A frame as the watch sends it: `5A`, length, slice 0, service, command, TLV, CRC16. */
private fun frame(service: Int, command: Int, tlv: HuaweiTLV): ByteArray {
  val inner = byteArrayOf(service.toByte(), command.toByte()) + tlv.serialize()
  val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
  return head + ByteBuffer.allocate(2).putShort(CheckSums.getCRC16(head, 0x0000).toShort()).array()
}

/**
 * The 0x2a app service and the app upload (file type 6) against a scripted watch: GB's upload flow (0x28), then the 0x2a/0x02
 * reports the watch sends while it unpacks the app, the app list (0x2a/0x03), the device parameters (0x2a/0x06) and delete (0x2a/0x01).
 */
class WatchAppTest {
  private class Msg(val service: Int, val command: Int, val tlv: HuaweiTLV?, val payload: ByteArray)

  private class RecordingEvents : WearEvents {
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    val statuses: MutableList<Pair<Int, String>> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add("${direction.wire}: $message")
    }
    override fun appInstallStatus(status: Int, packageName: String) {
      statuses.add(status to packageName)
    }
  }

  private class FakeWatch(private val respond: (Msg) -> List<ByteArray>) : FrameSink {
    lateinit var session: HuaweiSession
    val messages: MutableList<Msg> = Collections.synchronizedList(ArrayList())
    private var pending: ByteArrayOutputStream? = null
    private var pendingService = 0
    private var pendingCommand = 0

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        val body: ByteArray
        when (f[3].toInt()) {
          0 -> {
            pendingService = f[4].toInt() and 0xFF
            pendingCommand = f[5].toInt() and 0xFF
            body = f.copyOfRange(6, f.size - 2)
          }
          1 -> {
            pendingService = f[5].toInt() and 0xFF
            pendingCommand = f[6].toInt() and 0xFF
            pending = ByteArrayOutputStream().also { it.write(f, 7, f.size - 9) }
            continue
          }
          2 -> {
            pending!!.write(f, 5, f.size - 7)
            continue
          }
          else -> {
            pending!!.write(f, 5, f.size - 7)
            body = pending!!.toByteArray()
            pending = null
          }
        }
        deliver(pendingService, pendingCommand, body)
      }
    }

    private fun deliver(service: Int, command: Int, body: ByteArray) {
      val msg = if (service == 0x28 && command == 0x06) {
        Msg(service, command, null, HuaweiTLV().parse(body).decryptRaw(session.params))
      } else {
        val tlv = HuaweiTLV().parse(body, 0, body.size)
        if (tlv.contains(0x7C)) tlv.decrypt(session.params)
        Msg(service, command, tlv, body)
      }
      messages.add(msg)
      for (r in respond(msg)) session.onData(r)
    }

    fun all(service: Int, command: Int) = messages.filter { it.service == service && it.command == command }
  }

  private class App(val packageName: String, val name: String, val version: String, val versionCode: Int)

  /**
   * A watch with the app service: GB's flow for a file upload (it asks for `chunk` bytes at a time), then [installReports] for the
   * uploaded package, and the removal reports [removeReports] for a delete. An app reported installed (102) joins the list, a removal
   * reported (105) takes it out.
   */
  private class AppWatch(
    val file: ByteArray,
    val apps: MutableList<App> = ArrayList(),
    val installReports: List<Int> = listOf(101, 50, 102),
    val removeReports: List<Int> = listOf(104, 105),
    val unit: Int = 64,
    val chunk: Int = 200,
    val fileId: Int = 5,
    /** A report about another package the watch sends before the ones for the uploaded app. */
    val noiseReport: Pair<Int, String>? = null,
  ) {
    val received = ByteArray(file.size)
    var receivedBytes = 0
    var requestedEnd = 0
    var nameSeen = ""
    var listRequests = 0
    var paramsRequests = 0

    private fun nextRequest(): List<ByteArray> {
      val position = requestedEnd
      val size = minOf(chunk, file.size - position)
      requestedEnd = position + size
      return listOf(frame(0x28, 0x05, HuaweiTLV().put(0x02, position).put(0x03, size)))
    }

    private fun report(status: Int, pkg: String) =
      frame(0x2a, 0x02, HuaweiTLV().put(0x01, status.toByte()).put(0x02, pkg))

    private fun appsTlv(): HuaweiTLV {
      val list = HuaweiTLV()
      for (a in apps) {
        list.put(
          0x82,
          HuaweiTLV().put(0x03, a.packageName).put(0x04, a.version).put(0x05, 0).put(0x06, a.name).put(0x07, 0).put(0x09, a.versionCode).put(0x0d, 1.toByte()),
        )
      }
      return HuaweiTLV().put(0x81, list)
    }

    fun respond(m: Msg): List<ByteArray> = when {
      m.service == 0x2a && m.command == 0x06 -> {
        paramsRequests++
        listOf(
          frame(
            0x2a, 0x06,
            HuaweiTLV().put(
              0x81,
              HuaweiTLV().put(
                0x82,
                HuaweiTLV().put(0x03, 38.toByte()).put(0x04, 7).put(0x05, "6.1.0").put(0x06, "rect").put(0x07, 408.toShort()).put(0x08, 480.toShort())
                  .put(0x09, 2).put(0x0a, "debug"),
              ),
            ),
          ),
        )
      }
      m.service == 0x2a && m.command == 0x03 -> {
        listRequests++
        listOf(frame(0x2a, 0x03, appsTlv()))
      }
      m.service == 0x2a && m.command == 0x01 -> {
        val pkg = m.tlv!!.getString(0x02)
        removeReports.map { status ->
          if (status == 105) apps.removeAll { it.packageName == pkg }
          report(status, pkg)
        }
      }
      m.service == 0x28 && m.command == 0x02 -> {
        nameSeen = m.tlv!!.getString(0x01)
        listOf(frame(0x28, 0x02, HuaweiTLV().put(0x7f, 100000)), frame(0x28, 0x03, HuaweiTLV().put(0x01, fileId.toByte())))
      }
      m.service == 0x28 && m.command == 0x03 -> listOf(
        frame(
          0x28, 0x04,
          HuaweiTLV().put(0x01, fileId.toByte()).put(0x02, "1.0").put(0x03, 5000).put(0x04, 0).put(0x05, unit).put(0x06, chunk).put(0x07, 10).put(0x08, 0)
            .put(0x09, 0.toByte()),
        ),
      )
      m.service == 0x28 && m.command == 0x04 -> nextRequest()
      m.service == 0x28 && m.command == 0x06 -> {
        val buffer = ByteBuffer.wrap(m.payload)
        buffer.get()
        buffer.get()
        val position = buffer.getInt()
        val data = ByteArray(buffer.remaining()).also { buffer.get(it) }
        System.arraycopy(data, 0, received, position, data.size)
        receivedBytes += data.size
        when {
          receivedBytes == file.size -> listOf(frame(0x28, 0x07, HuaweiTLV().put(0x02, 1.toByte())))
          receivedBytes == requestedEnd -> nextRequest()
          else -> emptyList()
        }
      }
      m.service == 0x28 && m.command == 0x07 -> {
        // The phone acknowledged the result: the watch unpacks the app and reports.
        val pkg = nameSeen.removeSuffix("_INSTALL")
        (listOfNotNull(noiseReport?.let { report(it.first, it.second) })) + installReports.map { status ->
          if (status == 102) {
            apps.removeAll { it.packageName == pkg }
            apps.add(App(pkg, "Fuel", "1.0.0", 1))
          }
          report(status, pkg)
        }
      }
      else -> emptyList()
    }
  }

  private fun setup(watch: AppWatch): Triple<FakeWatch, HuaweiSession, RecordingEvents> {
    val events = RecordingEvents()
    val fake = FakeWatch { watch.respond(it) }
    val session = HuaweiSession(fake, events).also { it.params.setSecretKey(ByteArray(16)) }
    fake.session = session
    return Triple(fake, session, events)
  }

  private fun allowApps() {
    DeviceCaps.supportedCommands = mapOf(0x2a to byteArrayOf(0x01, 0x02, 0x03, 0x06))
  }

  @After
  fun resetCaps() = DeviceCaps.reset()

  private fun ops(session: HuaweiSession, events: RecordingEvents) =
    WatchAppOps(session, events, uploadStallMs = 3_000, installStallMs = 1_200, removeStallMs = 1_200)

  @Test
  fun installUploadsTheContainerAsFileType6ThenFollowsTheReportsAndRefreshesTheList() = runBlocking {
    allowApps()
    val container = WatchAppPackageTest.container()
    val watch = AppWatch(container)
    val (fake, session, events) = setup(watch)
    val progress = ArrayList<Pair<Int, Int>>()

    val result = ops(session, events).install(WatchAppPackages.parse(container)) { done, total -> progress.add(done to total) }

    // 28/02: type 6 under `<package>_INSTALL`, no watch face tags.
    val info = fake.all(0x28, 0x02).single().tlv!!
    assertEquals("com.joyodigitama.joyofit.fuel_INSTALL", info.getString(0x01))
    assertEquals(container.size, info.getInteger(0x02))
    assertEquals(6, info.getByte(0x03).toInt())
    assertFalse(info.contains(0x05))
    assertFalse(info.contains(0x06))
    assertArrayEquals("every chunk arrived", container, watch.received)
    assertEquals(0 to container.size, progress.first())
    assertEquals(container.size to container.size, progress.last())

    // 101 -> 50 -> 102 ends the wait; the list is read before (to see an existing install) and after.
    assertEquals(listOf(101 to WatchAppPackageTest.BUNDLE, 50 to WatchAppPackageTest.BUNDLE, 102 to WatchAppPackageTest.BUNDLE), events.statuses)
    assertEquals(2, watch.listRequests)
    assertEquals(102, result.reportedStatus)
    assertEquals(1, result.uploadStatus)
    assertTrue(result.listed)
    assertEquals("Installed.", result.message)
    assertTrue(result.signed)
    assertEquals("1.0.0", result.version)
    assertEquals(WatchAppPackageTest.BUNDLE, result.list!!.apps.single().packageName)
    assertEquals(38, result.list!!.params!!.type)
    assertTrue(events.logs.any { it.contains("SupportedCommands 2a/06=true") })
    assertTrue(events.logs.any { it.contains("AppInstallStatus: 102 installed") })
  }

  @Test
  fun aReportOf103IsAFailureThatExplainsTheSigning() = runBlocking {
    allowApps()
    val container = WatchAppPackageTest.container(signed = false)
    val watch = AppWatch(container, installReports = listOf(101, 103))
    val (_, session, events) = setup(watch)

    try {
      ops(session, events).install(WatchAppPackages.parse(container)) { _, _ -> }
      fail("expected a failure")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(103, e.statusCode)
      val message = e.message!!
      assertTrue(message, message.contains("UDID"))
      assertTrue(message, message.contains("AppGallery"))
      assertTrue(message, message.contains("no \"hw signed app\" signature"))
    }
    assertTrue(events.logs.any { it.startsWith("error:") && it.contains("no \"hw signed app\" trailer") })
    assertEquals(listOf(101, 103), events.statuses.map { it.first })
  }

  @Test
  fun aSignedAppThatIsRefusedDoesNotBlameMissingSignature() = runBlocking {
    allowApps()
    val container = WatchAppPackageTest.container(signed = true)
    val (_, session, events) = setup(AppWatch(container, installReports = listOf(103)))
    try {
      ops(session, events).install(WatchAppPackages.parse(container)) { _, _ -> }
      fail("expected a failure")
    } catch (e: WearException) {
      assertTrue(e.message!!.contains("UDID"))
      assertFalse(e.message!!.contains("carries no"))
    }
  }

  @Test
  fun reportsAboutAnotherPackageAreIgnoredAndAnUpdateKeepsTheInstallName() = runBlocking {
    allowApps()
    val container = WatchAppPackageTest.container()
    val watch = AppWatch(
      container,
      apps = mutableListOf(App(WatchAppPackageTest.BUNDLE, "Fuel", "0.9.0", 1)),
      installReports = listOf(101, 102),
      noiseReport = 103 to "com.other.app",
    )
    val (fake, session, events) = setup(watch)
    val result = ops(session, events).install(WatchAppPackages.parse(container)) { _, _ -> }
    assertEquals("com.joyodigitama.joyofit.fuel_INSTALL", fake.all(0x28, 0x02).single().tlv!!.getString(0x01))
    assertEquals("the 103 about another package did not fail the install", 102, result.reportedStatus)
    assertEquals(listOf(101, 102), events.statuses.map { it.first })
    assertEquals("1.0.0", result.list!!.apps.single().version)
    assertTrue(events.logs.any { it.contains("is on the watch already (version 0.9.0)") && it.contains("_INSTALL") })
    assertTrue(events.logs.any { it.contains("about com.other.app") })
  }

  @Test
  fun noReportButTheAppInTheListIsReportedAsSuch() = runBlocking {
    allowApps()
    val container = WatchAppPackageTest.container()
    val watch = AppWatch(container, installReports = emptyList())
    // The watch lists the app without having reported anything.
    watch.apps.add(App(WatchAppPackageTest.BUNDLE, "Fuel", "1.0.0", 1))
    val (_, session, events) = setup(watch)
    val result = ops(session, events).install(WatchAppPackages.parse(container)) { _, _ -> }
    assertNull(result.reportedStatus)
    assertTrue(result.listed)
    assertTrue(result.message, result.message.contains("no install report"))
  }

  @Test
  fun noReportAndNoAppIsATimeoutWithTheSigningHint() = runBlocking {
    allowApps()
    val container = WatchAppPackageTest.container()
    val (_, session, events) = setup(AppWatch(container, installReports = emptyList()))
    try {
      ops(session, events).install(WatchAppPackages.parse(container)) { _, _ -> }
      fail("expected a timeout")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.TIMEOUT, e.errorCode)
      assertTrue(e.message!!.contains("UDID"))
    }
  }

  @Test
  fun listReadsTheDeviceParametersAndEveryApp() = runBlocking {
    allowApps()
    val watch = AppWatch(
      ByteArray(0),
      apps = mutableListOf(App("com.a.one", "One", "1.2.3", 12), App("com.b.two", "Two", "0.1", 3)),
    )
    val (_, session, events) = setup(watch)
    val list = ops(session, events).list()
    val p = list.params!!
    assertEquals(38, p.type)
    assertEquals("liteWearable", p.typeName)
    assertEquals(7, p.osApiLevel)
    assertEquals("6.1.0", p.osVersion)
    assertEquals("rect", p.screenShape)
    assertEquals(408, p.width)
    assertEquals(480, p.height)
    assertEquals(2, p.buildLevel)
    assertEquals("debug", p.buildType)
    assertEquals(listOf("com.a.one", "com.b.two"), list.apps.map { it.packageName })
    assertEquals(listOf("One", "Two"), list.apps.map { it.name })
    assertEquals(listOf("1.2.3", "0.1"), list.apps.map { it.version })
    assertEquals(listOf(12, 3), list.apps.map { it.versionCode })
    val js = list.toJs()
    assertEquals(2, (js["apps"] as List<*>).size)
    assertEquals("liteWearable", (js["params"] as Map<*, *>)["typeName"])
  }

  @Test
  fun anEmptyListIsRead() = runBlocking {
    allowApps()
    val (_, session, events) = setup(AppWatch(ByteArray(0)))
    val list = ops(session, events).list()
    assertTrue(list.apps.isEmpty())
  }

  @Test
  fun deleteSendsTheRemovalAndWaitsFor105ThenReadsTheListAgain() = runBlocking {
    allowApps()
    val watch = AppWatch(ByteArray(0), apps = mutableListOf(App("com.a.one", "One", "1", 1), App("com.b.two", "Two", "1", 1)))
    val (fake, session, events) = setup(watch)
    val after = ops(session, events).delete("com.a.one")
    val request = fake.all(0x2a, 0x01).single().tlv!!
    assertEquals(1, request.getByte(0x01).toInt())
    assertEquals("com.a.one", request.getString(0x02))
    assertEquals(listOf("com.b.two"), after.apps.map { it.packageName })
    assertEquals(listOf(104 to "com.a.one", 105 to "com.a.one"), events.statuses)
    assertEquals("one list before to find the app, one after", 2, watch.listRequests)
  }

  @Test
  fun aReportOf106IsAFailure() = runBlocking {
    allowApps()
    val watch = AppWatch(ByteArray(0), apps = mutableListOf(App("com.a.one", "One", "1", 1)), removeReports = listOf(104, 106))
    val (_, session, events) = setup(watch)
    try {
      ops(session, events).delete("com.a.one")
      fail("expected a failure")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(106, e.statusCode)
      assertTrue(e.message!!.contains("could not remove"))
    }
  }

  @Test
  fun deletingAnAppTheWatchDoesNotHaveIsRefusedBeforeAnythingIsSent() = runBlocking {
    allowApps()
    val (fake, session, events) = setup(AppWatch(ByteArray(0)))
    try {
      ops(session, events).delete("com.not.there")
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
    }
    assertTrue(fake.all(0x2a, 0x01).isEmpty())
  }

  @Test
  fun withoutTheCommandInTheSupportedListEverythingFailsClearlyAndNothingIsSent() = runBlocking {
    // SupportedCommands lists service 0x2a without 0x06: GB's supportsAppParams is false.
    DeviceCaps.supportedCommands = mapOf(0x2a to byteArrayOf(0x01, 0x02, 0x03), 0x28 to byteArrayOf(0x02))
    val container = WatchAppPackageTest.container()
    val (fake, session, events) = setup(AppWatch(container))
    val ops = ops(session, events)
    for (call in listOf<suspend () -> Any?>(
      { ops.list() },
      { ops.delete("com.a.one") },
      { ops.install(WatchAppPackages.parse(container)) { _, _ -> } },
    )) {
      try {
        call()
        fail("expected a refusal")
      } catch (e: WearException) {
        assertEquals(ErrorCodes.UNSUPPORTED, e.errorCode)
        assertTrue(e.message!!, e.message!!.contains("0x2a/0x06"))
      }
    }
    assertTrue(fake.messages.isEmpty())
    assertTrue(events.logs.any { it.contains("SupportedCommands 2a/06=false") })
  }

  @Test
  fun aWatchWithNoSupportedCommandsAtAllIsRefusedToo() = runBlocking {
    val (fake, session, events) = setup(AppWatch(ByteArray(0)))
    try {
      ops(session, events).list()
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UNSUPPORTED, e.errorCode)
    }
    assertTrue(fake.messages.isEmpty())
  }
}
