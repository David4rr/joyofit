package com.joyodigitama.huaweiwear

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The route file against Gadgetbridge's own `HuaweiConvertTrack`: `route.json` is written by `GoldenGen/run.sh` (GoldenRoute.java) from the vendored Java,
 * and the Swift port reads the same file, so the two ports and the reference agree to the byte.
 */
class RouteFileTest {
  private val fixture: JSONObject by lazy {
    // Gradle runs unit tests with the Android project (modules/huawei-wear/android) as the working directory.
    val file = File("../ios/HuaweiProtocol/Tests/HuaweiProtocolTests/Fixtures/route.json")
    JSONObject(file.readText())
  }

  private fun hex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

  private fun trackOf(case: JSONObject): RouteTrack {
    val points = case.getJSONArray("points")
    val fixes = List(points.length()) {
      val p = points.getJSONArray(it)
      RouteFix(p.getDouble(0), p.getDouble(1), p.getDouble(2))
    }
    return RouteTrack(case.getString("id"), case.getString("name"), fixes, case.getBoolean("hasAltitude"), case.getLong("totalTime"), case.getInt("version"))
  }

  @Test
  fun convertedFilesMatchGadgetbridgeByteForByte() {
    val cases = fixture.getJSONArray("cases")
    assertTrue(cases.length() >= 9)
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val actual = RouteFile.convert(trackOf(case), case.getInt("maxPoints"))
      assertArrayEquals(case.getString("name"), hex(case.getString("file")), actual)
    }
  }

  @Test
  fun pointCountReadsTheHeader() {
    val cases = fixture.getJSONArray("cases")
    val plain = cases.getJSONObject(0)
    assertEquals(2, RouteFile.pointCount(hex(plain.getString("file")), 1))
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val file = hex(case.getString("file"))
      val version = case.getInt("version")
      val count = RouteFile.pointCount(file, version)
      val expected = if (version == 1) 12 + 40 * count else 0x108 + 0x38 * count + if (case.getBoolean("hasAltitude")) 0xd38 else 0
      assertEquals(case.getString("name"), expected, file.size)
      assertTrue(count <= case.getInt("maxPoints"))
    }
  }

  @Test
  fun handshakeBodyIsTagFiveWithAVarintLength() {
    val handshakes = fixture.getJSONArray("handshakes")
    for (i in 0 until handshakes.length()) {
      val h = handshakes.getJSONObject(i)
      assertArrayEquals(h.getString("name"), hex(h.getString("body")), RouteFile.handshakeBody(h.getString("name")))
    }
  }

  @Test
  fun fileMessageIsHeaderPlusBody() {
    val m = fixture.getJSONObject("message")
    assertArrayEquals(hex(m.getString("bytes")), RouteFile.message(m.getInt("type"), m.getInt("messageId"), hex(m.getString("body"))))
  }

  @Test
  fun answersAreLittleEndianCodeAndPointLimit() {
    val answer = RouteFile.parseAnswer(hex("01000000" + "c8000000"))
    assertNotNull(answer)
    assertEquals(1, answer!!.code)
    assertEquals(200, answer.maxPoints)
    assertEquals(200, RouteFile.pointLimit(answer))
    assertEquals(500, RouteFile.pointLimit(RouteFile.parseAnswer(hex("01000000f4010000"))))
    // A limit under 200 is raised to 200 (what Huawei Health and Gadgetbridge do), no limit at all gives 200.
    assertEquals(200, RouteFile.pointLimit(RouteFile.parseAnswer(hex("0100000064000000"))))
    val noLimit = RouteFile.parseAnswer(hex("03000000"))
    assertEquals(3, noLimit!!.code)
    assertNull(noLimit.maxPoints)
    assertEquals(200, RouteFile.pointLimit(noLimit))
    assertNull(RouteFile.parseAnswer(hex("0100")))
    assertEquals(200, RouteFile.pointLimit(null))
  }

  @Test
  fun validationRejectsWhatTheWatchCannotTake() {
    fun fixes(n: Int) = List(n) { RouteFix(-7.98 + it * 0.001, 112.63, 0.0) }
    fun rejects(track: RouteTrack): Boolean = try {
      RouteFile.validate(track)
      false
    } catch (e: WearException) {
      e.errorCode == ErrorCodes.INVALID_ARGUMENT
    }
    RouteFile.validate(RouteTrack("id", "Lari", fixes(2), false, 0))
    assertTrue(rejects(RouteTrack("id", " ", fixes(2), false, 0)))
    assertTrue(rejects(RouteTrack("id", "x".repeat(101), fixes(2), false, 0)))
    assertTrue(rejects(RouteTrack("id", "Lari", fixes(1), false, 0)))
    assertTrue(rejects(RouteTrack("id", "Lari", listOf(RouteFix(0.0, 112.0, 0.0), RouteFix(1.0, 112.0, 0.0)), false, 0)))
    assertTrue(rejects(RouteTrack("id", "Lari", listOf(RouteFix(-7.0, 181.0, 0.0), RouteFix(-7.1, 112.0, 0.0)), false, 0)))
    assertTrue(rejects(RouteTrack("id", "Lari", listOf(RouteFix(Double.NaN, 112.0, 0.0), RouteFix(-7.1, 112.0, 0.0)), false, 0)))
    assertTrue(rejects(RouteTrack("id", "Lari", fixes(2), true, 0, 1)))
    assertTrue(rejects(RouteTrack("id", "Lari", fixes(2), false, 0, 3)))
    assertTrue(rejects(RouteTrack("x".repeat(37), "Lari", fixes(2), false, 0)))
  }

  @Test
  fun anUnconvertibleRouteGivesAnEmptyFile() {
    val one = RouteTrack("id", "Lari", listOf(RouteFix(-7.0, 112.0, 0.0)), false, 0)
    assertEquals(0, RouteFile.convert(one, 200).size)
    val equator = RouteTrack("id", "Lari", listOf(RouteFix(0.0, 112.0, 0.0), RouteFix(1.0, 112.0, 0.0)), false, 0)
    assertEquals(0, RouteFile.convert(equator, 200).size)
  }
}
