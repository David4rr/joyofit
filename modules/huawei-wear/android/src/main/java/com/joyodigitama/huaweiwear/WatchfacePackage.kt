// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiFwHelper.parseAsWatchFace,
// HuaweiWatchfaceManager.{Resolution,WatchfaceDescription,getRandomName} and devices/huawei/HuaweiInstallHandler
// (the watch face branch of validateInstallation).
package com.joyodigitama.huaweiwear

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.StringReader
import java.util.Locale
import java.util.Random
import java.util.zip.ZipException
import java.util.zip.ZipInputStream
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Document
import org.xml.sax.InputSource

/** GB `HuaweiWatchfaceManager.WatchfaceDescription`, from the package's `description.xml`. */
internal class WatchfaceDescription(
  val title: String,
  val titleCn: String,
  val author: String,
  val designer: String,
  /** The theme version code, for example `HWHD13`; see [WatchfaceResolutions]. */
  val screen: String,
  val version: String,
  val font: String,
  val fontCn: String,
  /** Root element `HnTheme` (Honor) instead of `HwTheme` (Huawei). */
  val isHonor: Boolean,
  val briefinfo: String = "",
)

/** A validated `.hwt` package: the description and the `watchface.bin` the watch is sent. */
internal class WatchfacePackage(
  val description: WatchfaceDescription,
  val binary: ByteArray,
  /** `preview/cover.jpg` when the package has one. */
  val preview: ByteArray?,
)

/** GB `HuaweiWatchfaceManager.Resolution`: theme version code to `height*width`. */
internal object WatchfaceResolutions {
  private val byThemeVersion = mapOf(
    // Huawei sizes "height*width"
    "HWHD01" to "390*390",
    "HWHD02" to "454*454",
    "HWHD03" to "240*120",
    "HWHD04" to "160*80",
    "HWHD05" to "460*188",
    "HWHD06" to "456*280",
    "HWHD07" to "368*194",
    "HWHD08" to "320*320",
    "HWHD09" to "466*466",
    "HWHD10" to "360*320",
    "HWHD11" to "480*336",
    "HWHD12" to "240*240",
    "HWHD13" to "480*408",
    "HWHD14" to "482*286",
    // Honor sizes
    "HNHD01" to "466*466",
    "HNHD02" to "368*194",
    "HNHD03" to "450*390",
    "HNHD04" to "454*454",
    "HNHD05" to "402*256",
    "QXHD01" to "402*256",
    "QXHD02" to "502*410",
  )

  /**
   * The Watch Fit 4 and Fit 4 Pro: a 1.82 inch AMOLED of 480 x 408 pixels (Huawei's spec sheet), theme
   * version `HWHD13` ("height*width" = 480*408). Huawei's Theme Studio Pro names it "408 x 480".
   */
  const val FIT4_THEME_VERSION = "HWHD13"
  const val FIT4_SCREEN = "480*408"

  fun isKnown(themeVersion: String): Boolean = themeVersion in byThemeVersion

  /** GB `isValid`: false for an unknown theme version. */
  fun isValid(themeVersion: String, screenResolution: String): Boolean = byThemeVersion[themeVersion] == screenResolution

  /** GB `screenByThemeVersion`. */
  fun screenByThemeVersion(themeVersion: String): String = byThemeVersion[themeVersion] ?: "0x0"
}

internal object WatchfacePackages {
  /** A package is read into memory; this is far above any real watch face. */
  const val MAX_PACKAGE_BYTES = 64 * 1024 * 1024

  private const val HUAWEI_ENTRY = "com.huawei.watchface"
  private const val HONOR_ENTRY = "com.honor.watchface"

  /**
   * GB `HuaweiFwHelper.parseAsWatchFace`: the package is a zip with `description.xml`, an optional
   * `preview/cover.jpg` and an entry `com.huawei.watchface` (`com.honor.watchface` for Honor), which is
   * itself a zip holding `watchface.bin`; older packages hold the binary directly.
   * Throws [WearException] ERR_INVALID_ARGUMENT with a message for the user when the file is no watch face.
   */
  fun parse(bytes: ByteArray): WatchfacePackage {
    val descriptionBytes = entry(bytes, "description.xml")
      ?: bad("This is not a watch face package: there is no description.xml in it. Export it as a .hwt file from Huawei Theme Studio Pro.")
    val description = parseDescription(descriptionBytes)
    val entryName = if (description.isHonor) HONOR_ENTRY else HUAWEI_ENTRY
    val outer = entry(bytes, entryName)
      ?: bad("This watch face package has no $entryName entry.")
    // GB: a nested zip with watchface.bin, else the entry itself is the binary.
    val binary = entry(outer, "watchface.bin") ?: outer
    if (binary.isEmpty()) bad("The watch face package contains an empty watch face.")
    val preview = entry(bytes, "preview/cover.jpg")
      ?: entry(bytes, "preview/cover.png")
      ?: entry(bytes, "preview/icon_small.jpg")
      ?: entry(bytes, "cover.jpg")
      ?: entry(bytes, "cover.png")
    return WatchfacePackage(description, binary, preview)
  }

  fun parseDescription(raw: ByteArray): WatchfaceDescription {
    // GB strips a UTF-8 byte order mark before parsing.
    val offset = if (raw.size >= 3 && raw[0] == 0xEF.toByte() && raw[1] == 0xBB.toByte() && raw[2] == 0xBF.toByte()) 3 else 0
    val text = String(raw, offset, raw.size - offset, Charsets.UTF_8)
    val document: Document = try {
      val factory = DocumentBuilderFactory.newInstance()
      // No entity expansion from a file the user picked; not every XML parser supports the feature.
      try {
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
      } catch (e: Exception) {
        // Not every XML parser supports the feature; the parse below still runs.
      }
      factory.newDocumentBuilder().parse(InputSource(StringReader(text)))
    } catch (e: Exception) {
      bad("description.xml in this package is not valid XML: ${e.message}")
    }
    fun element(tag: String): String {
      val nodes = document.getElementsByTagName(tag)
      return if (nodes.length > 0) nodes.item(0).textContent.trim() else ""
    }
    val isHonor = when (document.documentElement.tagName) {
      "HnTheme" -> true
      "HwTheme" -> false
      else -> bad("description.xml has an unknown root element '${document.documentElement.tagName}' (expected HwTheme).")
    }
    val description = WatchfaceDescription(
      title = element("title"),
      titleCn = element("title-cn"),
      author = element("author"),
      designer = element("designer"),
      screen = element("screen"),
      version = element("version"),
      font = element("font"),
      fontCn = element("font-cn"),
      isHonor = isHonor,
      briefinfo = run {
        val raw = element("briefinfo").ifBlank { element("description") }
        if (raw.startsWith("{") && raw.endsWith("}")) {
          try {
            val obj = org.json.JSONObject(raw)
            obj.optString("en_US")
              .ifEmpty { obj.optString("default") }
              .ifEmpty { obj.optString("zh_CN") }
              .ifEmpty {
                val it = obj.keys()
                if (it.hasNext()) obj.optString(it.next()) else ""
              }
          } catch (_: Exception) {
            ""
          }
        } else {
          raw
        }
      },
    )
    return description
  }

  /**
   * GB `GBZipFile.getFileFromZip`, null instead of an exception when the entry is missing, is a
   * directory, or [zip] is no zip at all. Flexible slash- and case-insensitive matching.
   */
  fun entry(zip: ByteArray, name: String): ByteArray? {
    val target = name.replace('\\', '/').trim().lowercase(Locale.ROOT)
    try {
      ZipInputStream(ByteArrayInputStream(zip)).use { stream ->
        while (true) {
          val entry = stream.nextEntry ?: return null
          if (entry.isDirectory) continue
          val cleanName = entry.name.replace('\\', '/').trim().lowercase(Locale.ROOT)
          if (cleanName == target || cleanName.endsWith("/$target")) {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(16384)
            while (true) {
              val n = stream.read(buffer)
              if (n < 0) break
              out.write(buffer, 0, n)
            }
            return out.toByteArray()
          }
        }
      }
    } catch (_: Exception) {
      return null
    }
  }

  /**
   * Extracts the best preview image from a .hwt ZIP package with flexible, case-insensitive,
   * slash-normalized matching. Inspects outer zip and falls back to nested watchface archives.
   */
  fun extractPreview(bytes: ByteArray, targetW: Int = 194, targetH: Int = 368): Pair<ByteArray, String>? {
    return extractPreviewFromZip(bytes) ?: run {
      val innerZip = entry(bytes, "com.huawei.watchface")
        ?: entry(bytes, "com.honor.watchface")
      if (innerZip != null && innerZip.isNotEmpty()) {
        extractPreviewFromZip(innerZip) ?: extractPreviewFromBinary(innerZip, targetW, targetH)
      } else null
    }
  }

  /**
   * Reverse-engineered extractor for watch faces that lack preview/cover.jpg.
   * Scans com.huawei.watchface binary for full-screen ARGB8888 background bitmaps
   * compressed using Huawei RLE and converts them to standard 32-bit BMP.
   */
  fun extractPreviewFromBinary(data: ByteArray, targetW: Int = 194, targetH: Int = 368): Pair<ByteArray, String>? {
    try {
      // 1. Primary: check if data is a Huawei Watchface binary with an image table.
      // In Huawei Theme Studio, slot 0 in the table (Image 001) is the official composited preview thumbnail.
      if (data.size >= 16) {
        val layoutLen = (data[2].toInt() and 0xFF) or ((data[3].toInt() and 0xFF) shl 8)
        val tableLen = (data[4].toInt() and 0xFF) or
          ((data[5].toInt() and 0xFF) shl 8) or
          ((data[6].toInt() and 0xFF) shl 16) or
          ((data[7].toInt() and 0xFF) shl 24)
        val tableStart = 16 + layoutLen
        val binStart = tableStart + tableLen

        if (tableLen >= 8 && binStart <= data.size) {
          val off0 = (data[tableStart].toInt() and 0xFF) or
            ((data[tableStart + 1].toInt() and 0xFF) shl 8) or
            ((data[tableStart + 2].toInt() and 0xFF) shl 16) or
            ((data[tableStart + 3].toInt() and 0xFF) shl 24)
          val size0 = (data[tableStart + 4].toInt() and 0xFF) or
            ((data[tableStart + 5].toInt() and 0xFF) shl 8) or
            ((data[tableStart + 6].toInt() and 0xFF) shl 16) or
            ((data[tableStart + 7].toInt() and 0xFF) shl 24)

          val imgStart = binStart + off0
          if (size0 >= 8 && imgStart + size0 <= data.size) {
            val previewBmp = decodeBlobToBmp(data, imgStart, size0)
            if (previewBmp != null) {
              return previewBmp to "image/bmp"
            }
          }
        }
      }

      // 2. Secondary: scan the binary for the best full-screen or preview thumbnail bitmap
      class Candidate(val offset: Int, val w: Int, val h: Int, val score: Int, val bmp: ByteArray)

      val candidates = ArrayList<Candidate>()
      var i = 0
      val limit = data.size - 8
      while (i <= limit) {
        if (data[i] == 0x45.toByte() && data[i + 1] == 0x23.toByte()) {
          val formatCode = (data[i + 2].toInt() and 0xFF) or ((data[i + 3].toInt() and 0xFF) shl 8)
          if (formatCode == 0x8888 || formatCode == 0xF565) {
            val w = (data[i + 4].toInt() and 0xFF) or ((data[i + 5].toInt() and 0xFF) shl 8)
            val h = (data[i + 6].toInt() and 0xFF) or ((data[i + 7].toInt() and 0xFF) shl 8)
            val isExact = (w == targetW && h == targetH)
            val isPreviewThumb = (w in 120..260 && h in 200..320)
            val isAcceptable = (w in 120..600 && h in 160..800)
            if (isExact || isPreviewThumb || isAcceptable) {
              val bmp = decodeBlobToBmp(data, i, data.size - i)
              if (bmp != null) {
                val score = when {
                  isExact -> 10_000_000 + w * h
                  isPreviewThumb -> 5_000_000 + w * h
                  else -> w * h
                }
                candidates.add(Candidate(i, w, h, score, bmp))
              }
            }
          }
          i += 8
        } else {
          i++
        }
      }

      val best = candidates.maxByOrNull { it.score } ?: return null
      return best.bmp to "image/bmp"
    } catch (_: Exception) {
      return null
    }
  }

  fun decodeBlobToBmp(data: ByteArray, offset: Int, size: Int): ByteArray? {
    if (size < 8 || offset + size > data.size) return null
    if (data[offset] != 0x45.toByte() || data[offset + 1] != 0x23.toByte()) return null

    val formatCode = (data[offset + 2].toInt() and 0xFF) or ((data[offset + 3].toInt() and 0xFF) shl 8)
    val w = (data[offset + 4].toInt() and 0xFF) or ((data[offset + 5].toInt() and 0xFF) shl 8)
    val h = (data[offset + 6].toInt() and 0xFF) or ((data[offset + 7].toInt() and 0xFF) shl 8)
    if (w <= 0 || h <= 0 || w > 2000 || h > 2000) return null

    val totalPixels = w * h
    val rawPixels = ByteArray(totalPixels * 4) // Stores BGRA row-major

    val end = offset + size
    var streamIdx = offset + 8
    var px = 0

    when (formatCode) {
      0x8888 -> {
        // ARGB8888: 4 bytes per pixel (Huawei stores B, G, R, A)
        while (px < totalPixels && streamIdx < end) {
          if (streamIdx + 12 <= end &&
            data[streamIdx] == 0x89.toByte() && data[streamIdx + 1] == 0x67.toByte() &&
            data[streamIdx + 2] == 0x45.toByte() && data[streamIdx + 3] == 0x23.toByte()
          ) {
            val b = data[streamIdx + 4]
            val g = data[streamIdx + 5]
            val r = data[streamIdx + 6]
            val a = data[streamIdx + 7]
            val count = (data[streamIdx + 8].toInt() and 0xFF) or
              ((data[streamIdx + 9].toInt() and 0xFF) shl 8) or
              ((data[streamIdx + 10].toInt() and 0xFF) shl 16) or
              ((data[streamIdx + 11].toInt() and 0xFF) shl 24)
            streamIdx += 12

            for (c in 0 until count) {
              if (px >= totalPixels) break
              val o = px * 4
              rawPixels[o] = b
              rawPixels[o + 1] = g
              rawPixels[o + 2] = r
              rawPixels[o + 3] = a
              px++
            }
          } else {
            if (streamIdx + 4 > end) break
            val o = px * 4
            rawPixels[o] = data[streamIdx]
            rawPixels[o + 1] = data[streamIdx + 1]
            rawPixels[o + 2] = data[streamIdx + 2]
            rawPixels[o + 3] = data[streamIdx + 3]
            streamIdx += 4
            px++
          }
        }
      }
      0xF565 -> {
        // RGB565: 2 bytes per pixel, packed pairs in RLE
        while (px < totalPixels && streamIdx < end) {
          if (streamIdx + 12 <= end &&
            data[streamIdx] == 0x89.toByte() && data[streamIdx + 1] == 0x67.toByte() &&
            data[streamIdx + 2] == 0x45.toByte() && data[streamIdx + 3] == 0x23.toByte()
          ) {
            val p1 = (data[streamIdx + 4].toInt() and 0xFF) or ((data[streamIdx + 5].toInt() and 0xFF) shl 8)
            val p2 = (data[streamIdx + 6].toInt() and 0xFF) or ((data[streamIdx + 7].toInt() and 0xFF) shl 8)
            val pairs = (data[streamIdx + 8].toInt() and 0xFF) or
              ((data[streamIdx + 9].toInt() and 0xFF) shl 8) or
              ((data[streamIdx + 10].toInt() and 0xFF) shl 16) or
              ((data[streamIdx + 11].toInt() and 0xFF) shl 24)
            streamIdx += 12

            for (c in 0 until pairs) {
              if (px < totalPixels) write565ToBgra(p1, rawPixels, px++)
              if (px < totalPixels) write565ToBgra(p2, rawPixels, px++)
            }
          } else {
            if (streamIdx + 2 > end) break
            val p1 = (data[streamIdx].toInt() and 0xFF) or ((data[streamIdx + 1].toInt() and 0xFF) shl 8)
            streamIdx += 2
            if (px < totalPixels) write565ToBgra(p1, rawPixels, px++)
          }
        }
      }
      0x8808 -> {
        // RGB24: 3 bytes per pixel (B, G, R)
        while (px < totalPixels && streamIdx < end) {
          if (streamIdx + 9 <= end &&
            data[streamIdx] == 0x89.toByte() && data[streamIdx + 1] == 0x67.toByte() &&
            data[streamIdx + 2] == 0x45.toByte()
          ) {
            val b = data[streamIdx + 3]
            val g = data[streamIdx + 4]
            val r = data[streamIdx + 5]
            val count = (data[streamIdx + 6].toInt() and 0xFF) or
              ((data[streamIdx + 7].toInt() and 0xFF) shl 8) or
              ((data[streamIdx + 8].toInt() and 0xFF) shl 16)
            streamIdx += 9

            for (c in 0 until count) {
              if (px >= totalPixels) break
              val o = px * 4
              rawPixels[o] = b
              rawPixels[o + 1] = g
              rawPixels[o + 2] = r
              rawPixels[o + 3] = 0xFF.toByte()
              px++
            }
          } else {
            if (streamIdx + 3 > end) break
            val o = px * 4
            rawPixels[o] = data[streamIdx]
            rawPixels[o + 1] = data[streamIdx + 1]
            rawPixels[o + 2] = data[streamIdx + 2]
            rawPixels[o + 3] = 0xFF.toByte()
            streamIdx += 3
            px++
          }
        }
      }
      else -> return null
    }

    if (px < totalPixels) return null
    return encodeBottomUpBmp(rawPixels, w, h)
  }

  private fun write565ToBgra(p: Int, rawPixels: ByteArray, px: Int) {
    val r = (((p shr 11) and 0x1F) * 255 / 31).toByte()
    val g = (((p shr 5) and 0x3F) * 255 / 63).toByte()
    val b = ((p and 0x1F) * 255 / 31).toByte()
    val o = px * 4
    rawPixels[o] = b
    rawPixels[o + 1] = g
    rawPixels[o + 2] = r
    rawPixels[o + 3] = 0xFF.toByte()
  }

  private fun encodeBottomUpBmp(rawPixels: ByteArray, w: Int, h: Int): ByteArray {
    val pixelBytes = w * h * 4
    val fileSize = 54 + pixelBytes
    val bmp = ByteArray(fileSize)
    bmp[0] = 'B'.code.toByte()
    bmp[1] = 'M'.code.toByte()
    bmp[2] = (fileSize and 0xFF).toByte()
    bmp[3] = ((fileSize shr 8) and 0xFF).toByte()
    bmp[4] = ((fileSize shr 16) and 0xFF).toByte()
    bmp[5] = ((fileSize shr 24) and 0xFF).toByte()
    bmp[10] = 54
    bmp[14] = 40
    bmp[18] = (w and 0xFF).toByte()
    bmp[19] = ((w shr 8) and 0xFF).toByte()
    bmp[20] = ((w shr 16) and 0xFF).toByte()
    bmp[21] = ((w shr 24) and 0xFF).toByte()
    bmp[22] = (h and 0xFF).toByte()
    bmp[23] = ((h shr 8) and 0xFF).toByte()
    bmp[24] = ((h shr 16) and 0xFF).toByte()
    bmp[25] = ((h shr 24) and 0xFF).toByte()
    bmp[26] = 1
    bmp[28] = 32
    bmp[34] = (pixelBytes and 0xFF).toByte()
    bmp[35] = ((pixelBytes shr 8) and 0xFF).toByte()
    bmp[36] = ((pixelBytes shr 16) and 0xFF).toByte()
    bmp[37] = ((pixelBytes shr 24) and 0xFF).toByte()

    val rowBytes = w * 4
    var pOut = 54
    for (y in h - 1 downTo 0) {
      val rowStart = y * rowBytes
      System.arraycopy(rawPixels, rowStart, bmp, pOut, rowBytes)
      pOut += rowBytes
    }
    return bmp
  }

  private fun extractPreviewFromZip(bytes: ByteArray): Pair<ByteArray, String>? {
    try {
      ZipInputStream(ByteArrayInputStream(bytes)).use { stream ->
        var fallback: Pair<ByteArray, String>? = null
        var fallbackIsIcon = false
        var anyImage: Pair<ByteArray, String>? = null
        while (true) {
          val entry = stream.nextEntry ?: break
          if (entry.isDirectory) continue
          val cleanName = entry.name.replace('\\', '/').trim().lowercase(Locale.ROOT)
          val isImage = cleanName.endsWith(".jpg") || cleanName.endsWith(".jpeg") ||
            cleanName.endsWith(".png") || cleanName.endsWith(".bmp") || cleanName.endsWith(".webp")
          if (!isImage) continue

          val out = ByteArrayOutputStream()
          val buffer = ByteArray(16384)
          while (true) {
            val n = stream.read(buffer)
            if (n < 0) break
            out.write(buffer, 0, n)
          }
          val data = out.toByteArray()
          if (data.isEmpty()) continue
          val mime = when {
            cleanName.endsWith(".png") -> "image/png"
            cleanName.endsWith(".webp") -> "image/webp"
            cleanName.endsWith(".bmp") -> "image/bmp"
            else -> "image/jpeg"
          }
          val pair = data to mime

          // Priority 1: Direct cover or full screen preview
          if (cleanName.endsWith("cover.jpg") || cleanName.endsWith("cover.jpeg") ||
            cleanName.endsWith("cover.png") || cleanName.endsWith("screen.jpg") ||
            cleanName.endsWith("screen.png") || cleanName.endsWith("preview.jpg") ||
            cleanName.endsWith("preview.png")
          ) {
            return pair
          }

          // Priority 2: Preview folder, shot, thumbnail, icon
          val isIcon = cleanName.contains("icon")
          val isPreviewOrCover = cleanName.contains("preview") || cleanName.contains("cover") ||
            cleanName.contains("screen") || cleanName.contains("shot") || cleanName.contains("thumb")

          if (isPreviewOrCover) {
            if (fallback == null || (!isIcon && fallbackIsIcon)) {
              fallback = pair
              fallbackIsIcon = isIcon
            }
          }

          if (anyImage == null) {
            anyImage = pair
          }
        }
        return fallback ?: anyImage
      }
    } catch (_: Exception) {
      return null
    }
  }
  /**
   * GB `HuaweiInstallHandler.validateInstallation`: the package's theme version has to name the
   * watch's screen (`height*width`). A theme version GB does not know is allowed through (the watch
   * decides); a known one with another size is refused.
   */
  fun checkResolution(description: WatchfaceDescription, height: Int, width: Int, log: (String) -> Unit) {
    val deviceScreen = String.format(Locale.ROOT, "%d*%d", height, width)
    if (!WatchfaceResolutions.isKnown(description.screen)) {
      log("watch face theme version ${description.screen} is not in GB's resolution table; not checked against the watch's $deviceScreen")
      return
    }
    if (!WatchfaceResolutions.isValid(description.screen, deviceScreen)) {
      throw WearException(
        ErrorCodes.INVALID_ARGUMENT,
        "This watch face is made for a ${WatchfaceResolutions.screenByThemeVersion(description.screen)} screen (${description.screen}), " +
          "but the watch reports $deviceScreen. Make it in Theme Studio Pro for this watch's screen.",
      )
    }
  }

  /** Huawei Health `HwWatchFaceManager.getRandomVersion`: three numbers from 1 to 10, joined by dots. */
  fun randomVersion(random: Random = Random()): String =
    String.format(Locale.ROOT, "%d.%d.%d", random.nextInt(10) + 1, random.nextInt(10) + 1, random.nextInt(10) + 1)

  private val usableVersion = Regex("^\\d+(\\.\\d+){1,3}$")

  /**
   * The `<id>_<version>` the face is uploaded under. The id is nine random digits (GB `getRandomName`; Huawei Health's
   * local install always uses `000000001`, which would make two installed faces share an id). The version is the
   * face's own, like a store face (`2184389193_2.10.5`), when it is a plain dotted number; otherwise a random one in
   * Huawei Health's style. GB always used `1.0.0`, a version below the 2.1 to 2.10 range this watch lists.
   */
  fun randomName(random: Random = Random(), version: String? = null): String {
    val usable = version?.trim()?.takeIf { usableVersion.matches(it) } ?: randomVersion(random)
    return String.format(Locale.ROOT, "%09d_%s", random.nextInt(1_000_000_000), usable)
  }

  /** The leading `major.minor` of a version such as `2.10.5`, or null when it has none. */
  fun majorMinor(version: String): Pair<Int, Int>? {
    val parts = version.trim().split('.')
    if (parts.size < 2) return null
    val major = parts[0].toIntOrNull() ?: return null
    val minor = parts[1].toIntOrNull() ?: return null
    return major to minor
  }

  /**
   * Huawei Health `f2.d` (`verifyWatchFaceVersion`) with the watch's other versions as its compatible list: the
   * face's `<version>` has the watch's major version and a minor no higher than the watch's maximum, or is listed
   * among the other versions the watch accepts. A version that cannot be read on either side is left to the watch.
   */
  fun checkVersion(description: WatchfaceDescription, maxVersion: String, otherVersions: String, log: (String) -> Unit) {
    val face = majorMinor(description.version)
    val max = majorMinor(maxVersion)
    if (face == null || max == null) {
      log("watch face version '${description.version}' or the watch's maximum '$maxVersion' cannot be read; not checked")
      return
    }
    if (face.first == max.first && face.second <= max.second) return
    if (otherVersions.split(',').any { majorMinor(it) == face }) return
    throw WearException(
      ErrorCodes.INVALID_ARGUMENT,
      "This watch face was made for watch face version ${face.first}.${face.second} (description.xml version " +
        "${description.version}), but the watch supports up to $maxVersion" +
        (if (otherVersions.isNotBlank()) " (and $otherVersions)" else "") + ". Export it again from Theme Studio Pro for this watch.",
    )
  }

  private fun bad(message: String): Nothing = throw WearException(ErrorCodes.INVALID_ARGUMENT, message)
}
