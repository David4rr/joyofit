package com.joyodigitama.huaweiwear

import java.time.LocalDate
import java.util.Collections
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.P2P
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The JoyoFit Fuel link: the P2P service of the watch app, the messages both ways and the profile it is sent. */
class FuelLinkTest {
  private class Sent(val cmd: Int, val seq: Int, val src: String?, val dst: String?, val srcFp: String?, val dstFp: String?, val data: ByteArray?, val code: Int)

  private class FakeTransport : HuaweiP2PManager.Transport {
    val sent: MutableList<Sent> = Collections.synchronizedList(ArrayList())
    val logs = ArrayList<String>()

    override fun sendP2P(cmdId: Byte, sequence: Short, srcPackage: String?, dstPackage: String?, srcFingerprint: String?, dstFingerprint: String?, sendData: ByteArray?, sendCode: Int) {
      sent.add(Sent(cmdId.toInt(), sequence.toInt(), srcPackage, dstPackage, srcFingerprint, dstFingerprint, sendData, sendCode))
    }

    override fun supportsExpandCapability(which: Int) = false

    override fun log(message: String) {
      logs.add(message)
    }
  }

  private class MemoryState : FuelState {
    override var fuelWatchFingerprint = ""
    override var fuelLastHelloAtMs = 0L
    override var fuelLastHelloVersion: String? = null
    override var fuelLastHelloProfileAtMs = 0L
    override var fuelLastProfileSentAtMs = 0L
    override var fuelLastAckAtMs = 0L
    override var fuelLastAckProfileAtMs = 0L
    override var fuelSentKey: String? = null
    override var fuelStampedAtMs = 0L
  }

  private class RecordingEvents : WearEvents {
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add("${direction.wire}: $message")
    }
  }

  private val phoneFingerprint = "AB".repeat(32)
  private val profile = FuelProfiles.build(UserProfileData(172, 72.5, 1990, "male", 8000), 1_700_000_000_000L, 58, LocalDate.of(2024, 6, 1))

  private class Fixture(val transport: FakeTransport, val state: MemoryState, val events: RecordingEvents, val manager: HuaweiP2PManager, val service: FuelService)

  private fun fixture(fingerprint: String? = "AB".repeat(32), watchFingerprint: String = "", now: () -> Long = { 5_000L }, profile: FuelProfile = this.profile): Fixture {
    val transport = FakeTransport()
    val state = MemoryState().also { it.fuelWatchFingerprint = watchFingerprint }
    val events = RecordingEvents()
    val manager = HuaweiP2PManager(transport)
    val service = FuelService(manager, state, events, { profile }, { fingerprint }, now)
    return Fixture(transport, state, events, manager, service)
  }

  private fun params() = HuaweiPacket.ParamsProvider().also { it.setSecretKey(ByteArray(16)) }

  /** What the watch app sends: cmd 1 (ping), 2 (data) or 3 (answer). */
  private fun watchPacket(cmd: Int, seq: Int, data: ByteArray? = null, code: Int = 0, src: String = FuelContract.WATCH_PACKAGE, dst: String = FuelContract.PHONE_PACKAGE): P2P.P2PCommand.Response {
    val r = P2P.P2PCommand.Response(params())
    r.cmdId = cmd.toByte()
    r.sequenceId = seq.toShort()
    r.srcPackage = src
    r.dstPackage = dst
    r.respData = data
    r.respCode = code
    return r
  }

  private fun Fixture.answerPing(code: Int) {
    val ping = transport.sent.last { it.cmd == 1 }
    manager.handlePacket(watchPacket(3, ping.seq, null, code))
  }

  // --- the profile ---

  @Test
  fun theProfileIsTheContractJsonWithMaxHeartRateOf220MinusAge() {
    // Born 1990, on 2024-06-01 the age is 34 (year difference, as ProfileSender.age does): 220 - 34 = 186.
    assertEquals(
      """{"v":1,"t":"profile","weightKg":72.5,"age":34,"sex":"male","maxHr":186,"restHr":58,"at":1700000000000}""",
      profile.toJson(),
    )
  }

  @Test
  fun missingValuesFallBackLikeTheLiveWorkoutAndAreStillSent() {
    val none = FuelProfiles.build(null, 123L, null, LocalDate.of(2024, 6, 1))
    assertEquals(
      """{"v":1,"t":"profile","weightKg":70.0,"age":35,"sex":"unknown","maxHr":185,"restHr":null,"at":0}""",
      none.toJson(),
    )
    assertEquals(LiveWorkout.DEFAULT_AGE, none.age)
    assertEquals(LiveWorkout.DEFAULT_WEIGHT_KG, none.weightKg, 0.0)
    // A saved profile with no birth year or weight uses the defaults for those, keeps the sex.
    val partial = FuelProfiles.build(UserProfileData(170, 0.0, 0, "female", 8000), 42L, 0, LocalDate.of(2024, 6, 1))
    assertEquals("""{"v":1,"t":"profile","weightKg":70.0,"age":35,"sex":"female","maxHr":185,"restHr":null,"at":42}""", partial.toJson())
  }

  @Test
  fun sha256HexIsUppercaseWithoutSeparators() {
    assertEquals("BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD", SigningFingerprint.sha256Hex("abc".toByteArray()))
  }

  // --- the link ---

  @Test
  fun registeringPingsTheWatchAppAndA0xcaAnswerSendsTheProfile() {
    val f = fixture(watchFingerprint = "com.joyodigitama.joyofit.fuel_BASE64KEY=")
    f.service.register()
    val ping = f.transport.sent.single()
    assertEquals(1, ping.cmd)
    assertEquals(FuelContract.PHONE_PACKAGE, ping.src)
    assertEquals(FuelContract.WATCH_PACKAGE, ping.dst)
    assertNull(f.service.reachable)

    f.answerPing(0xCA)

    assertEquals(0xCA, f.service.pingCode)
    assertEquals(true, f.service.reachable)
    val data = f.transport.sent.last()
    assertEquals(2, data.cmd)
    assertEquals(FuelContract.PHONE_PACKAGE, data.src)
    assertEquals(FuelContract.WATCH_PACKAGE, data.dst)
    assertEquals(phoneFingerprint, data.srcFp)
    assertEquals("com.joyodigitama.joyofit.fuel_BASE64KEY=", data.dstFp)
    assertEquals(profile.toJson(), String(data.data!!, Charsets.UTF_8))
    assertEquals(5_000L, f.state.fuelLastProfileSentAtMs)
  }

  @Test
  fun aPingNotAnsweredWith0xcaSendsNothing() {
    val f = fixture()
    f.service.register()
    f.answerPing(0xCB)
    assertEquals(false, f.service.reachable)
    assertEquals(listOf(1), f.transport.sent.map { it.cmd })
    assertEquals(0L, f.state.fuelLastProfileSentAtMs)
  }

  @Test
  fun anEmptyWatchFingerprintSendsTheBundleNameAndSaysSo() {
    val f = fixture()
    f.service.register()
    f.answerPing(0xCA)
    assertEquals(FuelContract.WATCH_PACKAGE, f.transport.sent.last().dstFp)
    assertTrue(f.events.logs.any { it.contains("no watch app fingerprint is set") && it.contains(FuelContract.WATCH_PACKAGE) })
  }

  @Test
  fun aHelloIsAckedAtP2pLevelRecordedAndAnsweredWithTheProfile() {
    val f = fixture(now = { 9_000L })
    f.service.register()
    f.transport.sent.clear()

    val hello = """{"v":1,"t":"hello","ver":"1.0.2","profileAt":777}""".toByteArray()
    f.manager.handlePacket(watchPacket(2, 40, hello))

    // The data packet is answered with 0xcf like every data packet, then the profile goes out.
    val ack = f.transport.sent[0]
    assertEquals(3, ack.cmd)
    assertEquals(40, ack.seq)
    assertEquals(FuelContract.PHONE_PACKAGE, ack.src)
    assertEquals(FuelContract.WATCH_PACKAGE, ack.dst)
    assertEquals(0xCF, ack.code)
    val reply = f.transport.sent[1]
    assertEquals(2, reply.cmd)
    assertEquals(profile.toJson(), String(reply.data!!, Charsets.UTF_8))
    assertEquals(phoneFingerprint, reply.srcFp)
    assertEquals(2, f.transport.sent.size)
    assertEquals(9_000L, f.state.fuelLastHelloAtMs)
    assertEquals("1.0.2", f.state.fuelLastHelloVersion)
    assertEquals(777L, f.state.fuelLastHelloProfileAtMs)
    assertEquals(9_000L, f.state.fuelLastProfileSentAtMs)
  }

  @Test
  fun aLeadingByteBeforeTheJsonIsTolerated() {
    val f = fixture()
    f.service.register()
    f.transport.sent.clear()
    val payload = byteArrayOf(0x07) + """{"v":1,"t":"hello","ver":"1.0.0","profileAt":0}""".toByteArray()
    f.manager.handlePacket(watchPacket(2, 41, payload))
    assertEquals("1.0.0", f.state.fuelLastHelloVersion)
    assertEquals(listOf(3, 2), f.transport.sent.map { it.cmd })
  }

  @Test
  fun anAckRecordsTheProfileTheWatchStored() {
    val f = fixture(now = { 12_000L })
    f.service.register()
    f.transport.sent.clear()
    f.manager.handlePacket(watchPacket(2, 42, """{"v":1,"t":"ack","at":1700000000000}""".toByteArray()))
    assertEquals(12_000L, f.state.fuelLastAckAtMs)
    assertEquals(1_700_000_000_000L, f.state.fuelLastAckProfileAtMs)
    assertEquals("only the P2P-level 0xcf, no new profile", listOf(3), f.transport.sent.map { it.cmd })
  }

  @Test
  fun garbageIsLoggedWithItsHexAndNeverThrown() {
    val garbage = listOf(
      byteArrayOf(0xFF.toByte(), 0xFE.toByte(), 0x00, 0x01),
      "not json at all".toByteArray(),
      "{broken".toByteArray(),
      "{\"v\":1,\"t\":\"hello\"".toByteArray(),
      """{"v":2,"t":"hello","ver":"9"}""".toByteArray(),
      """{"v":1}""".toByteArray(),
      """{"v":1,"t":"ack"}""".toByteArray(),
      ByteArray(0),
    )
    for ((index, payload) in garbage.withIndex()) {
      val f = fixture()
      f.service.register()
      f.transport.sent.clear()
      f.manager.handlePacket(watchPacket(2, 50 + index, payload))
      // Still answered at P2P level, nothing recorded, no profile sent, one error line with the payload.
      assertEquals("payload $index", listOf(3), f.transport.sent.map { it.cmd })
      assertEquals(0L, f.state.fuelLastHelloAtMs)
      assertEquals(0L, f.state.fuelLastAckAtMs)
      val line = f.events.logs.singleOrNull { it.startsWith("error:") && it.contains("not understood") }
      assertNotNull("payload $index", line)
      assertTrue(line!!, line.contains("${payload.size} bytes: ${payload.toHex()}"))
    }
  }

  @Test
  fun anUnknownMessageTypeIsIgnoredWithALogLine() {
    val f = fixture()
    f.service.register()
    f.transport.sent.clear()
    f.manager.handlePacket(watchPacket(2, 60, """{"v":1,"t":"future"}""".toByteArray()))
    assertEquals(listOf(3), f.transport.sent.map { it.cmd })
    assertTrue(f.events.logs.any { it.contains("ignored a 'future' message") })
  }

  @Test
  fun withoutTheSigningCertificateNothingIsSentAndAnErrorIsLogged() {
    val f = fixture(fingerprint = null)
    f.service.register()
    f.answerPing(0xCA)
    assertFalse(f.service.sendProfile("test"))
    assertEquals(listOf(1), f.transport.sent.map { it.cmd })
    assertTrue(f.events.logs.any { it.startsWith("error:") && it.contains("signing certificate") })
  }

  @Test
  fun sendProfileNowWorksOnDemandAndAnswersFromAnotherPackageAreNotRouted() {
    val f = fixture(now = { 20_000L })
    f.service.register()
    f.transport.sent.clear()
    assertTrue(f.service.sendProfile("send profile now"))
    assertEquals(2, f.transport.sent.single().cmd)
    // A data packet from some other package never reaches the service.
    f.transport.sent.clear()
    f.manager.handlePacket(watchPacket(2, 70, """{"v":1,"t":"hello","ver":"1","profileAt":0}""".toByteArray(), src = "com.someone.else"))
    assertTrue(f.transport.sent.isEmpty())
    assertEquals(0L, f.state.fuelLastHelloAtMs)
  }

  private fun atOfLastProfile(f: Fixture): Long =
    org.json.JSONObject(String(f.transport.sent.last { it.cmd == 2 }.data!!, Charsets.UTF_8)).getLong("at")

  @Test
  fun atMovesWhenRestingHeartRateOrAgeChangesAndStaysForAnIdenticalResend() {
    var rest: Int? = 58
    var today = LocalDate.of(2024, 6, 1)
    var clock = 1_800_000_000_000L
    val user = UserProfileData(172, 72.5, 1990, "male", 8000)
    val changedAt = 1_700_000_000_000L
    val transport = FakeTransport()
    val state = MemoryState()
    val events = RecordingEvents()
    val manager = HuaweiP2PManager(transport)
    val service = FuelService(manager, state, events, { FuelProfiles.build(user, changedAt, rest, today) }, { phoneFingerprint }, { clock })
    val f = Fixture(transport, state, events, manager, service)
    service.register()
    f.answerPing(0xCA)
    val first = atOfLastProfile(f)
    assertEquals("a new tuple is stamped with the time it is sent", 1_800_000_000_000L, first)

    // The same numbers sent again later (hello, Send profile now) keep their at, so the watch's newer-than check treats them as one profile.
    clock = 1_850_000_000_000L
    assertTrue(service.sendProfile("again"))
    assertEquals(first, atOfLastProfile(f))

    // A new resting heart rate is a new profile: at moves, and it is remembered.
    rest = 60
    clock = 1_900_000_000_000L
    service.sendProfile("rest hr changed")
    val second = atOfLastProfile(f)
    assertEquals(1_900_000_000_000L, second)
    clock = 1_950_000_000_000L
    service.sendProfile("again")
    assertEquals(second, atOfLastProfile(f))

    // The year changes: age and maxHr change with it.
    today = LocalDate.of(2025, 1, 1)
    clock = 2_000_000_000_000L
    service.sendProfile("new year")
    assertEquals(2_000_000_000_000L, atOfLastProfile(f))
    assertEquals(2_000_000_000_000L, state.fuelStampedAtMs)
  }

  @Test
  fun aProfileNeverSavedKeepsAtZeroWhateverChanges() {
    var rest: Int? = null
    val transport = FakeTransport()
    val state = MemoryState()
    val manager = HuaweiP2PManager(transport)
    val service = FuelService(manager, state, RecordingEvents(), { FuelProfiles.build(null, 0L, rest, LocalDate.of(2024, 6, 1)) }, { phoneFingerprint }, { 9_000_000_000_000L })
    val f = Fixture(transport, state, RecordingEvents(), manager, service)
    service.register()
    f.answerPing(0xCA)
    assertEquals(0L, atOfLastProfile(f))
    rest = 61
    service.sendProfile("rest hr changed")
    assertEquals(0L, atOfLastProfile(f))
  }
}
