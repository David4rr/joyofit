package com.joyodigitama.huaweiwear

import java.io.StringReader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class HuaweiExportJsonTest {
  private class Scan {
    val records = ArrayList<String>()
    val unterminated = ArrayList<String>()
    var oversized = 0
  }

  private fun scan(text: String, maxChars: Int = HuaweiExportJson.MAX_RECORD_CHARS): Scan {
    val out = Scan()
    HuaweiExportJson.forEachRecord(StringReader(text), { out.records.add(it) }, { out.unterminated.add(it) }, { out.oversized++ }, maxChars)
    return out
  }

  @Test
  fun splitsTopLevelArrayIntoRecords() {
    val out = scan("\uFEFF[ {\"a\":1}, {\"b\":[1,2,{\"c\":3}]} ,\n{\"d\":\"x\"} ]")
    assertEquals(listOf("{\"a\":1}", "{\"b\":[1,2,{\"c\":3}]}", "{\"d\":\"x\"}"), out.records)
    assertEquals(0, out.unterminated.size)
  }

  @Test
  fun singleObjectFileIsOneRecord() {
    val out = scan("{\"sportType\":4,\"attribute\":\"x\"}")
    assertEquals(1, out.records.size)
  }

  @Test
  fun bracesAndQuotesInsideStringsDoNotEndARecord() {
    val record = """{"v":"a } b \" } c { d","w":2}"""
    val out = scan("[$record,$record]")
    assertEquals(listOf(record, record), out.records)
  }

  @Test
  fun recordOpenAtTheEndIsReportedWithItsText() {
    val out = scan("""[{"a":1},{"b":"never closed""")
    assertEquals(listOf("{\"a\":1}"), out.records)
    assertEquals(listOf("""{"b":"never closed"""), out.unterminated)
  }

  @Test
  fun oversizedRecordIsSkippedAndTheNextOneStillRead() {
    val big = "{\"x\":\"" + "a".repeat(100) + "\"}"
    val out = scan("[$big,{\"y\":1}]", maxChars = 50)
    assertEquals(1, out.oversized)
    assertEquals(listOf("{\"y\":1}"), out.records)
  }

  @Test
  fun parseObjectRepairsBareNumericKeys() {
    val obj = HuaweiExportJson.parseObject("""{"partTimeMap":{1.0:439.0,2.0:451.0},"n":3}""")
    assertNotNull(obj)
    assertEquals(3, obj!!.getInt("n"))
    assertEquals(439.0, obj.getJSONObject("partTimeMap").getDouble("1.0"), 0.0)
  }

  @Test
  fun parseObjectReturnsNullForGarbage() {
    assertNull(HuaweiExportJson.parseObject("{\"a\": }"))
    assertNull(HuaweiExportJson.parseObject("not json"))
  }

  @Test
  fun numbersMayBeStrings() {
    assertEquals(82.0, HuaweiExportJson.number("82.0")!!, 0.0)
    assertEquals(7.0, HuaweiExportJson.number(7)!!, 0.0)
    assertNull(HuaweiExportJson.number("abc"))
    assertNull(HuaweiExportJson.number(null))
    assertNull(HuaweiExportJson.number("NaN"))
  }

  @Test
  fun embeddedObjectReadsAJsonStringValue() {
    val obj = HuaweiExportJson.embeddedObject("""{"avgSaturation":97}""")
    assertEquals(97, obj!!.getInt("avgSaturation"))
    assertNull(HuaweiExportJson.embeddedObject("82.0"))
  }

  @Test
  fun epochTimesAreMillisecondsWithASecondsFallbackAndASanityRange() {
    assertEquals(1_750_000_000_000L, HuaweiExportJson.epochMs(1_750_000_000_000L))
    assertEquals(1_750_000_000_000L, HuaweiExportJson.epochMs("1750000000"))
    assertNull(HuaweiExportJson.epochMs(0))
    assertNull(HuaweiExportJson.epochMs(5_000_000_000_000_000L))
    assertNull(HuaweiExportJson.epochMs("x"))
  }
}
