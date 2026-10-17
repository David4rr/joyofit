package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** The Lite Wearable app container (GB `HuaweiBinAppParser`) and what [WatchAppPackages] makes of the files the picker can return. */
class WatchAppPackageTest {
  companion object {
    const val BUNDLE = "com.joyodigitama.joyofit.fuel"
    const val CONFIG_JSON = """{"app":{"bundleName":"com.joyodigitama.joyofit.fuel","vendor":"JoyoDigitama","version":{"code":1,"name":"1.0.0"}},"module":{"deviceType":["liteWearable"]}}"""
    val ICON = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3)

    private fun ByteArrayOutputStream.int(v: Int) = write(ByteBuffer.allocate(4).putInt(v).array())

    private fun ByteArrayOutputStream.string(s: String) {
      val b = s.toByteArray(Charsets.UTF_8)
      int(b.size)
      write(b)
    }

    /**
     * GB's layout: 0xBE, package (int length + UTF-8), then per entry file name, path (may be empty) and content (long length), and for a
     * signed app a signature block whose last 32 bytes are `hw signed app   ` + `1000` + the block's length (header included) + 8 reserved.
     */
    fun container(
      pkg: String = BUNDLE,
      entries: List<Triple<String, String, ByteArray>> = listOf(
        Triple("config.json", "", CONFIG_JSON.toByteArray()),
        Triple("icon_small.png", "res/", ICON),
        Triple("app.bin", "", ByteArray(300) { (it * 5 + 1).toByte() }),
      ),
      signed: Boolean = true,
    ): ByteArray {
      val out = ByteArrayOutputStream()
      out.write(0xBE)
      out.string(pkg)
      for ((name, path, content) in entries) {
        out.string(name)
        out.int(path.length)
        out.write(path.toByteArray())
        out.write(ByteBuffer.allocate(8).putLong(content.size.toLong()).array())
        out.write(content)
      }
      if (signed) {
        val signature = ByteArray(96) { (0x40 + it).toByte() }
        out.write(signature)
        out.write("hw signed app   ".toByteArray(Charsets.US_ASCII))
        out.write("1000".toByteArray(Charsets.US_ASCII))
        out.int(signature.size + 32)
        out.write(ByteArray(8))
      }
      return out.toByteArray()
    }

    fun zip(vararg files: Pair<String, ByteArray>): ByteArray {
      val out = ByteArrayOutputStream()
      ZipOutputStream(out).use { z ->
        for ((name, content) in files) {
          z.putNextEntry(ZipEntry(name))
          z.write(content)
          z.closeEntry()
        }
      }
      return out.toByteArray()
    }
  }

  @Test
  fun aSignedContainerGivesPackageConfigIconAndTheSignedFlag() {
    val bytes = container()
    val pkg = WatchAppPackages.parse(bytes)
    assertEquals(BUNDLE, pkg.packageName)
    assertEquals(BUNDLE, pkg.config.bundleName)
    assertEquals("JoyoDigitama", pkg.config.vendor)
    assertEquals("1.0.0", pkg.config.version)
    assertTrue(pkg.signed)
    assertArrayEquals(ICON, pkg.icon)
    assertArrayEquals("the container goes to the watch unchanged", bytes, pkg.binary)
    assertNull(pkg.unwrappedFrom)
    assertEquals(listOf("config.json", "icon_small.png", "app.bin"), pkg.entryNames)
    val js = pkg.toJs()
    assertEquals(true, js["signed"])
    assertEquals(bytes.size, js["bytes"])
    assertTrue((js["iconBase64"] as String).startsWith("iVBORw0KGgo"))
  }

  @Test
  fun aContainerWithoutTheTrailerIsUnsignedAndStillParsedToTheEnd() {
    val pkg = WatchAppPackages.parse(container(signed = false))
    assertFalse(pkg.signed)
    assertEquals(3, pkg.entryNames.size)
    assertEquals("1.0.0", pkg.config.version)
  }

  @Test
  fun aContainerWithoutAnIconHasNone() {
    val pkg = WatchAppPackages.parse(
      container(entries = listOf(Triple("config.json", "", CONFIG_JSON.toByteArray()), Triple("app.bin", "", ByteArray(8) { 1 }))),
    )
    assertNull(pkg.icon)
    assertNull(pkg.toJs()["iconBase64"])
  }

  @Test
  fun aZipThatWrapsTheContainerIsUnwrapped() {
    val inner = container()
    val pkg = WatchAppPackages.parse(zip("readme.txt" to "hi".toByteArray(), "entry-bin-debug-lite-signed.bin" to inner))
    assertEquals("entry-bin-debug-lite-signed.bin", pkg.unwrappedFrom)
    assertArrayEquals(inner, pkg.binary)
    assertTrue(pkg.signed)
    assertEquals(BUNDLE, pkg.packageName)
  }

  @Test
  fun aZipOfConfigAndScriptIsRefusedWithAClearMessage() {
    try {
      WatchAppPackages.parse(zip("config.json" to CONFIG_JSON.toByteArray(), "js/app.js" to "var a = 1;".toByteArray()))
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
      assertTrue(e.message!!, e.message!!.contains("no Lite Wearable app container"))
    }
  }

  @Test
  fun somethingThatIsNeitherAContainerNorAZipIsRefused() {
    for (bytes in listOf(ByteArray(0), "just text".toByteArray(), ByteArray(40) { 7 })) {
      try {
        WatchAppPackages.parse(bytes)
        fail("expected a refusal")
      } catch (e: WearException) {
        assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
      }
    }
  }

  @Test
  fun aTruncatedContainerIsAnErrorNotACrash() {
    val full = container(signed = false)
    for (cut in listOf(1, 3, 20, full.size - 100, full.size - 1)) {
      try {
        WatchAppPackages.parse(full.copyOf(cut))
        fail("a container cut to $cut bytes must not parse")
      } catch (e: WearException) {
        assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
      }
    }
  }

  @Test
  fun aContainerWithoutConfigJsonIsRefused() {
    try {
      WatchAppPackages.parse(container(entries = listOf(Triple("app.bin", "", ByteArray(8) { 1 }))))
      fail("expected a refusal")
    } catch (e: WearException) {
      assertTrue(e.message!!, e.message!!.contains("config.json"))
    }
  }

  @Test
  fun aConfigThatIsNotJsonIsRefused() {
    try {
      WatchAppPackages.parse(container(entries = listOf(Triple("config.json", "", "not json".toByteArray()))))
      fail("expected a refusal")
    } catch (e: WearException) {
      assertTrue(e.message!!, e.message!!.contains("not valid JSON"))
    }
  }
}
