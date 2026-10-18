package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Collections
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** [HuaweiWeatherSender] against a scripted watch: what each kind of watch gets, and what the forecast step reports. */
class WeatherSendTest {
  private val zone: ZoneId = ZoneId.of("Asia/Jakarta")
  private val now: Long = ZonedDateTime.of(2026, 10, 14, 10, 30, 0, 0, zone).toEpochSecond()
  private fun day(offset: Long): Long = ZonedDateTime.of(2026, 10, 14, 0, 0, 0, 0, zone).plusDays(offset).toEpochSecond()

  private class RecordingEvents : WearEvents {
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add("${direction.wire}: $message")
    }
  }

  /** Answers by (service, command) read from the first frame of each request; null means the watch stays silent. */
  private class Watch(private val reply: (Int, Int) -> HuaweiTLV?) : FrameSink {
    lateinit var session: HuaweiSession
    val seen: MutableList<Pair<Int, Int>> = Collections.synchronizedList(ArrayList())
    /** Every frame the phone wrote, in order, for decoding what the watch actually received. */
    val written: MutableList<ByteArray> = Collections.synchronizedList(ArrayList())

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        written.add(f)
        // Unsliced: 5A len2 00 svc cmd. Sliced: 5A len2 01 flag svc cmd; the next slices carry no command.
        val (service, command) = when (f[3].toInt()) {
          0 -> (f[4].toInt() and 0xFF) to (f[5].toInt() and 0xFF)
          1 -> (f[5].toInt() and 0xFF) to (f[6].toInt() and 0xFF)
          else -> continue
        }
        seen.add(service to command)
        reply(service, command)?.let { session.onData(frame(service, command, it.serialize())) }
      }
    }
  }

  private companion object {
    const val OK = 0x000186A0

    fun frame(service: Int, command: Int, body: ByteArray): ByteArray {
      val inner = byteArrayOf(service.toByte(), command.toByte()) + body
      val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
      val crc = CheckSums.getCRC16(head, 0x0000)
      return head + ByteBuffer.allocate(2).putShort(crc.toShort()).array()
    }

    fun code(value: Int = OK) = HuaweiTLV().put(0x7f, value)
  }

  /** What a watch of the Fit 4 class answers: every support query, all bits set. */
  private fun fullAnswers(
    service: Int,
    command: Int,
    forecastCode: Int? = OK,
    current: Boolean = true,
    gps: Boolean = true,
    supportBitmap: Int = 0xFF,
  ): HuaweiTLV? = when (service to command) {
    0x0f to 0x09, 0x0f to 0x05 -> code()
    0x0f to 0x02 -> HuaweiTLV().put(0x01, supportBitmap.toByte())
    0x0f to 0x06 -> HuaweiTLV().put(0x01, 0x0007.toShort())
    0x0f to 0x0a -> HuaweiTLV().put(0x01, 3)
    0x0f to 0x01 -> if (current) code() else null
    0x18 to 0x07 -> if (gps) code() else null
    0x0f to 0x08 -> forecastCode?.let { code(it) }
    else -> null
  }

  private fun caps(vararg weather: Int, gps: Boolean = true) {
    DeviceCaps.supportedCommands = buildMap {
      put(0x0f, weather.map { it.toByte() }.toByteArray())
      if (gps) put(0x18, byteArrayOf(0x06))
    }
  }

  private fun sampleReport(days: Int = 8): WeatherReport {
    val hours = (0 until 48).map { i ->
      WeatherHour(timestamp = (day(0) + 3600L * i).toInt(), code = 2, tempC = 24.0 + i, precipProbability = 40, uvIndex = 3.4)
    }
    val daily = (0 until days).map { i ->
      WeatherDay(
        timestamp = day(i.toLong()).toInt(),
        code = 61,
        maxC = 31.4,
        minC = 22.6,
        sunrise = (day(i.toLong()) + 5 * 3600 + 40 * 60).toInt(),
        sunset = (day(i.toLong()) + 17 * 3600 + 50 * 60).toInt(),
      )
    }
    return WeatherReport(
      fetchedAtSec = now,
      observedAtSec = now.toInt(),
      place = WeatherPlace("Bandung", -6.91, 107.61),
      code = 2,
      tempC = 27.6,
      feelsLikeC = 30.2,
      humidity = 78,
      windSpeedKmh = 14.0,
      windDirection = 90,
      uvIndex = 5.2,
      hourly = hours,
      daily = daily,
    )
  }

  private class Rig(val watch: Watch, val session: HuaweiSession, val events: RecordingEvents)

  private fun newRig(reply: (Int, Int) -> HuaweiTLV?): Rig {
    val events = RecordingEvents()
    val watch = Watch(reply)
    val session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    return Rig(watch, session, events)
  }

  private fun send(rig: Rig, report: WeatherReport = sampleReport()): ForecastOutcome = runBlocking {
    HuaweiWeatherSender(rig.session, rig.events, answerTimeoutMs = 60).send(report, TemperatureUnit.CELSIUS, now, zone, "test")
  }

  /** The packets the watch received, put back together from the frames the phone wrote and decrypted: what is on the wire, not what was meant. */
  private fun received(rig: Rig): List<HuaweiPacket> {
    val packets = ArrayList<HuaweiPacket>()
    var pending: HuaweiPacket? = null
    for (frame in rig.watch.written.toList()) {
      val packet = (pending ?: HuaweiPacket(rig.session.params)).parseOutgoing(frame)
      if (!packet.complete) {
        pending = packet
        continue
      }
      pending = null
      packet.attemptDecrypt()
      packets.add(packet)
    }
    return packets
  }

  private fun HuaweiPacket.command(): Pair<Int, Int> = (serviceId.toInt() and 0xFF) to (commandId.toInt() and 0xFF)

  private fun HuaweiTLV.tags(): List<Int> = get().map { it.tag.toInt() and 0xFF }

  @Before
  fun clean() {
    DeviceCaps.reset()
    WeatherDiagnostics.last = null
  }

  @After
  fun resetCaps() = DeviceCaps.reset()

  @Test
  fun aWatchThatListsEverythingGetsTheFullSequenceAndTheForecastIsReportedSent() {
    caps(0x01, 0x05, 0x06, 0x08, 0x0a)
    val rig = newRig { s, c -> fullAnswers(s, c) }
    val outcome = send(rig)

    assertEquals(ForecastState.SENT, outcome.state)
    assertEquals(24, outcome.hours)
    assertEquals(8, outcome.days)
    assertEquals(OK, outcome.replyCode)
    val order = listOf(0x0f to 0x09, 0x0f to 0x05, 0x0f to 0x02, 0x0f to 0x06, 0x0f to 0x0a, 0x0f to 0x01, 0x18 to 0x07, 0x0f to 0x08)
    assertEquals(order, rig.watch.seen)
    assertTrue(rig.events.logs.any { it.startsWith("info: Weather gates: current(0f/01)=yes unit(0f/05)=yes extended(0f/06)=yes forecast(0f/08)=yes") })
    assertTrue(rig.events.logs.any { it == "info: Weather forecast: 24 hours (tags 03 04 05), 8 days (tags 12 13 14 15 16 17 1e), first hour ${java.time.Instant.ofEpochSecond(day(0) + 11 * 3600)}" })
    assertFalse(rig.events.logs.any { it.startsWith("error:") })
  }

  @Test
  fun aSilentCurrentAndPositionDoNotKeepTheForecastFromBeingSent() {
    caps(0x01, 0x05, 0x06, 0x08, 0x0a)
    val rig = newRig { s, c -> fullAnswers(s, c, current = false, gps = false) }
    val outcome = send(rig)

    assertEquals(ForecastState.SENT, outcome.state)
    assertTrue(rig.watch.seen.contains(0x0f to 0x08))
    assertTrue(rig.events.logs.any { it == "error: Weather step WeatherCurrent: no answer within 60 ms" })
    assertTrue(rig.events.logs.any { it == "error: Weather step WeatherGps: no answer within 60 ms" })
  }

  @Test
  fun aWatchWithoutTheForecastCommandGetsCurrentWeatherOnlyAndSaysSo() {
    caps(0x01, gps = false)
    val rig = newRig { s, c -> fullAnswers(s, c) }
    val outcome = send(rig)

    assertEquals(ForecastState.UNSUPPORTED, outcome.state)
    assertEquals(0, outcome.hours)
    assertEquals(0, outcome.days)
    assertNull(outcome.replyCode)
    assertFalse(rig.watch.seen.contains(0x0f to 0x08))
    assertTrue(rig.events.logs.any { it.contains("Weather forecast skipped: the watch does not list 0f/08") })
    assertEquals(ForecastState.UNSUPPORTED, WeatherDiagnostics.last!!.forecast!!.state)
  }

  @Test
  fun aForecastAnsweredWithAnotherCodeIsRejected() {
    caps(0x01, 0x08)
    val rig = newRig { s, c -> fullAnswers(s, c, forecastCode = 0x000186A4) }
    val outcome = send(rig)

    assertEquals(ForecastState.REJECTED, outcome.state)
    assertEquals(0x000186A4, outcome.replyCode)
    assertEquals(24, outcome.hours)
    assertTrue(rig.events.logs.any { it == "error: Weather forecast not taken: the watch answered 0x000186a4" })
  }

  @Test
  fun theOtherSuccessCodeCountsAsSent() {
    caps(0x01, 0x08)
    val outcome = send(newRig { s, c -> fullAnswers(s, c, forecastCode = 0x000186A3) })
    assertEquals(ForecastState.SENT, outcome.state)
  }

  @Test
  fun aSilentForecastIsUnacknowledged() {
    caps(0x01, 0x08)
    val rig = newRig { s, c -> fullAnswers(s, c, forecastCode = null) }
    val outcome = send(rig)

    assertEquals(ForecastState.UNACKNOWLEDGED, outcome.state)
    assertNull(outcome.replyCode)
    assertEquals(24, outcome.hours)
    assertEquals(8, outcome.days)
    assertTrue(rig.events.logs.any { it == "error: Weather forecast sent but never acknowledged" })
  }

  @Test
  fun aWatchThatNeverAnswersStartEndsThePushWithATimeout() {
    caps(0x01, 0x08)
    val rig = newRig { _, _ -> null }
    val failure = runCatching { send(rig) }.exceptionOrNull()

    assertTrue(failure is WearException)
    assertEquals(ErrorCodes.TIMEOUT, (failure as WearException).errorCode)
    assertEquals(listOf(0x0f to 0x09), rig.watch.seen)
    assertNotNull(WeatherDiagnostics.last!!.failure)
    assertNull(WeatherDiagnostics.last!!.forecast)
  }

  @Test
  fun incompleteListsAreSentAndWarnedAbout() {
    caps(0x01, 0x08)
    val rig = newRig { s, c -> fullAnswers(s, c) }
    val outcome = send(rig, sampleReport(days = 6))

    assertEquals(ForecastState.SENT, outcome.state)
    assertEquals(6, outcome.days)
    assertTrue(rig.events.logs.any { it.startsWith("error: Weather forecast has 24 hours and 6 days, not 24 and 8") })
  }

  @Test
  fun aWatchWithoutExtendedSupportTakesTheIconFlagFromTheBasicSupportBitmap() {
    // A Fit 2 class answer: no 0f/06 and no 0f/0a listed, so no sun times and no moon phase; bit 0 of the support bitmap is the icon.
    caps(0x01, 0x08, gps = false)
    val rig = newRig { s, c -> fullAnswers(s, c) }
    send(rig)

    assertEquals("24 hours (tags 03 04 05), 8 days (tags 12 13 14 15)", WeatherDiagnostics.last!!.shape)
    assertEquals(listOf("support 0xff"), WeatherDiagnostics.last!!.bitmaps)
    assertTrue(rig.events.logs.any { it == "info: Weather: the watch lists no 0f/06, so the icon flag follows bit 0 of the support bitmap (true)" })
    assertTrue(rig.events.logs.any { it.contains("Weather flags the packets will follow: icon=true") })
  }

  @Test
  fun aWatchWithoutExtendedSupportAndWithoutBitZeroGetsNoIcons() {
    caps(0x01, 0x08, gps = false)
    send(newRig { s, c -> fullAnswers(s, c, supportBitmap = 0xFE) })

    assertEquals("24 hours (tags 03 05), 8 days (tags 12 14 15)", WeatherDiagnostics.last!!.shape)
  }

  @Test
  fun aWatchThatListsExtendedSupportKeepsGbsIconFlag() {
    // Extended support answers bit 2 clear: GB's icon flag stays off whatever bit 0 of the basic bitmap says.
    caps(0x01, 0x06, 0x08, gps = false)
    val rig = newRig { s, c -> if (s == 0x0f && c == 0x06) HuaweiTLV().put(0x01, 0x0003.toShort()) else fullAnswers(s, c) }
    send(rig)

    assertEquals("24 hours (tags 03 05), 8 days (tags 12 14 15)", WeatherDiagnostics.last!!.shape)
    assertFalse(rig.events.logs.any { it.contains("lists no 0f/06") })
  }

  /**
   * What the reports of a Watch Fit 2 say, as far as they go: it lists current weather, unit and forecast (0f/01, 05, 08) and the
   * position service, but not 0f/06 or 0f/0a, and it takes the current weather and the position without a receipt. Its support bitmap
   * is not known; 0x7b is a plausible one (icon, wind, temperature range, place, current temperature, unit; no pm2.5, no air quality).
   */
  private fun fit2Answers(service: Int, command: Int, forecastCode: Int?): HuaweiTLV? = when (service to command) {
    0x0f to 0x02 -> HuaweiTLV().put(0x01, 0x7b.toByte())
    0x0f to 0x01, 0x18 to 0x07 -> null
    else -> fullAnswers(service, command, forecastCode = forecastCode)
  }

  private fun assertFit2ForecastOnTheWire(forecastCode: Int?, sliceSize: Int) {
    caps(0x01, 0x05, 0x08)
    val rig = newRig { s, c -> fit2Answers(s, c, forecastCode) }
    rig.session.params.setSliceSize(sliceSize)
    val outcome = send(rig)

    assertEquals(if (forecastCode == null) ForecastState.UNACKNOWLEDGED else ForecastState.SENT, outcome.state)
    assertEquals(24, outcome.hours)
    assertEquals(8, outcome.days)
    assertTrue(rig.events.logs.any { it == "error: Weather step WeatherCurrent: no answer within 60 ms" })
    assertTrue(rig.events.logs.any { it == "error: Weather step WeatherGps: no answer within 60 ms" })
    assertTrue(rig.events.logs.any { it == "info: Weather: the watch lists no 0f/06, so the icon flag follows bit 0 of the support bitmap (true)" })

    val packets = received(rig)
    assertEquals(
      listOf(0x0f to 0x09, 0x0f to 0x05, 0x0f to 0x02, 0x0f to 0x01, 0x18 to 0x07, 0x0f to 0x08),
      packets.map { it.command() },
    )
    // The forecast is the only packet longer than a slice, and it still arrives whole.
    assertTrue("the forecast went out in slices", rig.watch.written.count { it[3].toInt() in 1..3 } >= 2)

    // Current weather: the condition from bit 0 of the support bitmap, wind, today's range, place, temperature and unit; nothing the watch did not announce.
    val current = packets.first { it.command() == 0x0f to 0x01 }.tlv
    val head = current.getObject(0x81)
    assertEquals(listOf(0x02, 0x03), head.tags())
    assertEquals(0x01.toByte(), head.getByte(0x02))
    assertEquals(0x0203.toShort(), head.getShort(0x03))
    assertEquals(23.toByte(), current.getObject(0x85).getByte(0x06))
    assertEquals(31.toByte(), current.getObject(0x85).getByte(0x07))
    assertEquals("Bandung", current.getString(0x08))
    assertEquals(28.toByte(), current.getByte(0x09))
    assertEquals(0.toByte(), current.getByte(0x0a))
    for (tag in listOf(0x04, 0x0b, 0x0c, 0x0e, 0x0f, 0x10, 0x11, 0x12)) assertFalse("tag %02x".format(tag), current.contains(tag))

    // Forecast: the 24 next hours and 8 days, today first, each row with the tags the watch announced and no others.
    val forecast = packets.first { it.command() == 0x0f to 0x08 }.tlv
    val hours = forecast.getObject(0x81).getObjects(0x82)
    val days = forecast.getObject(0x90).getObjects(0x91)
    assertEquals(24, hours.size)
    assertEquals(8, days.size)
    assertTrue(hours.all { it.tags() == listOf(0x03, 0x04, 0x05) })
    assertTrue(days.all { it.tags() == listOf(0x12, 0x13, 0x14, 0x15) })

    val hourStamps = hours.map { it.getInteger(0x03).toLong() }
    assertEquals(day(0) + 11 * 3600, hourStamps.first())
    assertTrue(hourStamps.first() > now)
    assertTrue(hourStamps.zipWithNext().all { (a, b) -> b - a == 3600L })
    assertEquals((35..58).map { it.toByte() }, hours.map { it.getByte(0x05) })
    assertTrue(hours.all { it.getByte(0x04) == 0x01.toByte() })

    // Today carries the observation time and the current icon, the next days a whole day more each, with the day's own icon (light rain).
    assertEquals((0 until 8).map { now + 86400L * it }, days.map { it.getInteger(0x12).toLong() })
    assertEquals(listOf<Byte>(0x01) + List(7) { 0x07.toByte() }, days.map { it.getByte(0x13) })
    assertTrue(days.all { it.getByte(0x14) == 31.toByte() && it.getByte(0x15) == 23.toByte() })
  }

  @Test
  fun aFit2ClassWatchThatTakesCurrentWeatherAndPositionWithoutReceiptGetsTheWholeForecastOnTheWire() {
    assertFit2ForecastOnTheWire(forecastCode = OK, sliceSize = 0xF4)
  }

  @Test
  fun theSameForecastArrivesWholeInSmallSlicesAndWhenTheWatchNeverAcknowledgesIt() {
    assertFit2ForecastOnTheWire(forecastCode = null, sliceSize = 0x64)
  }

  @Test
  fun theSupportReportLinesNameTheGatesAndTheLastPush() {
    caps(0x01, 0x05, 0x06, 0x08, 0x0a)
    send(newRig { s, c -> fullAnswers(s, c) })
    val lines = WeatherDiagnostics.summary(enabled = true, nowSec = now + 120)

    assertTrue(lines[0].startsWith("Weather: switch on; gates (last connect) current(0f/01)=yes"))
    assertEquals("Weather last push: test, 2 min ago; support 0xff, extended 0x0007, sunMoon 0x03", lines[1])
    assertTrue(lines[2].startsWith("  steps: WeatherStart answered 0x000186a0 in "))
    assertTrue(lines.last().startsWith("  forecast: sent reply 0x000186a0, 24 hours (tags 03 04 05), 8 days (tags 12 13 14 15 16 17 1e)"))
  }

  @Test
  fun theSupportReportSaysWhenNothingWasPushed() {
    val lines = WeatherDiagnostics.summary(enabled = false, nowSec = now)
    assertTrue(lines[0].startsWith("Weather: switch off; gates"))
    assertEquals("Weather last push: none in this process", lines[1])
  }
}
