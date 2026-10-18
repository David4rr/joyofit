package com.joyodigitama.huaweiwear

/** What the watch said in its answer to the phone's parameter question (1F/02). */
internal class AgpsConsult(val version: Int, val tag: String, val urls: List<String>) {
  /** The tag names only, each entry cut at its last `/`: the path before it can carry a rough position and is not kept. */
  val tagNames: String
    get() = tag.split(';').map { it.trim().substringAfterLast('/') }.filter { it.isNotEmpty() }.joinToString(",")

  companion object {
    /** The question the phone asks itself when no watch is involved: the default (version 0) data. */
    val DEFAULT = AgpsConsult(0, "", emptyList())
  }
}

/** The result of one fetch: files by the name the watch will ask for, or an [outcome] code and message saying why there are none. */
internal class AgpsFetch(
  val files: Map<String, ByteArray>,
  val source: String,
  val dataTimeMs: Long,
  val outcome: String,
  val message: String,
  /** Served from the phone's copy: nothing new was downloaded, so the download time must not move. */
  val fromCache: Boolean = false,
) {
  val ok: Boolean get() = files.isNotEmpty()

  companion object {
    fun failed(outcome: String, message: String) = AgpsFetch(emptyMap(), "", 0L, outcome, message)
  }
}

/** Where the data comes from. Blocking; callers run it on the IO dispatcher. Never throws for a failed download. */
internal interface AgpsSource {
  /** [force] skips the phone-side copy and goes to the network. */
  fun fetch(consult: AgpsConsult, force: Boolean): AgpsFetch
}

internal object AgpsSources {
  const val BROADCOM = "broadcom_lto"
  const val HUAWEI_AGNSS = "huawei_agnss"
  const val LTO_FILE = "gpslocation.dat"
  const val AGNSS_FILE = "HW_AGNSS_RTCM_33"
}

/**
 * The real source: the public Broadcom LTO file for version 0; for the versions that name the watch maker's servers, those
 * servers only when the user allowed it ([AgpsStore.huaweiServers]), and then only the one kind that is a plain download.
 */
internal class NetworkAgpsSource(
  private val cache: AgpsCache,
  private val store: AgpsStore,
  private val log: (String) -> Unit,
  private val logRaw: (String) -> Unit,
  private val isOnline: () -> Boolean,
  private val nowMs: () -> Long = System::currentTimeMillis,
) : AgpsSource {

  override fun fetch(consult: AgpsConsult, force: Boolean): AgpsFetch {
    return when (consult.version) {
      0 -> fetchBroadcom(force)
      1, 2, 3 -> {
        if (!store.huaweiServers) {
          AgpsFetch.failed(AgpsOutcome.HUAWEI_OFF, "the watch asked for data from the watch maker's servers (version ${consult.version}); they are switched off")
        } else {
          fetchHuawei(consult, force)
        }
      }
      else -> AgpsFetch.failed(AgpsOutcome.UNSUPPORTED, "download version ${consult.version} is not known")
    }
  }

  /** The phone-side copy when it is young enough, else the network; saved for next time only when it passed [validate]. */
  private class Got(val body: ByteArray, val dataMs: Long, val fromCache: Boolean)

  private fun cachedGet(url: String, force: Boolean, maxBytes: Int, source: String, label: String, unwrap: Boolean, validate: (ByteArray) -> String?): Got {
    if (!force) {
      val hit = cache.read(url, AgpsPolicy.CACHE_FRESH_MS)
      if (hit != null && validate(hit) == null) {
        log("$label: from the phone's copy, ${hit.size} bytes")
        val dataMs = store.cachedDataMs.takeIf { it > 0L && store.cachedSource == source } ?: nowMs()
        return Got(hit, dataMs, true)
      }
      if (hit != null) cache.delete(url)
    }
    if (!isOnline()) throw AgpsFetchException("no network")
    val started = nowMs()
    val download = EphemerisNet.get(url, maxBytes)
    val body = if (unwrap) EphemerisNet.gunzipIfNeeded(download.body, maxBytes) else download.body
    validate(body)?.let { throw AgpsInvalidFileException(it) }
    log("$label: downloaded ${body.size} bytes in ${nowMs() - started} ms")
    cache.write(url, body)
    return Got(body, download.lastModifiedMs.takeIf { it > 0L } ?: nowMs(), false)
  }

  private fun fail(e: AgpsFetchException, label: String): AgpsFetch {
    val outcome = when {
      e is AgpsInvalidFileException -> AgpsOutcome.INVALID_FILE
      e.message == "no network" -> AgpsOutcome.NO_NETWORK
      else -> AgpsOutcome.DOWNLOAD_FAILED
    }
    return AgpsFetch.failed(outcome, "$label: ${e.message}")
  }

  /** Version 0: always the fixed Broadcom address, whatever address the watch names. The file is `gpslocation.dat`. */
  private fun fetchBroadcom(force: Boolean): AgpsFetch = try {
    val got = cachedGet(
      EphemerisNet.LTO_HOST + EphemerisNet.LTO_PATH, force, AgpsPolicy.LTO_MAX_BYTES, AgpsSources.BROADCOM, "LTO", false, AgpsPolicy::validateLto,
    )
    AgpsFetch(mapOf(AgpsSources.LTO_FILE to got.body), AgpsSources.BROADCOM, got.dataMs, AgpsOutcome.NONE, "", got.fromCache)
  } catch (e: AgpsFetchException) {
    fail(e, "LTO")
  }

  /**
   * The watch maker's servers, switched on by the user. Only the plain download kind (`HW_AGNSS`) is made; the other kinds need
   * the maker's own decoder or an account and are declined. UNTESTED against the real server: the entry layout is
   * `<path>/<TAG>`; the path is appended to [HUAWEI_AGNSS_BASE] and the answer is gunzipped when it is gzip.
   */
  private fun fetchHuawei(consult: AgpsConsult, force: Boolean): AgpsFetch {
    val entries = consult.tag.split(';').map { it.trim() }.filter { it.isNotEmpty() }
    val agnss = entries.firstOrNull { it.substringAfterLast('/') == "HW_AGNSS" }
      ?: return AgpsFetch.failed(AgpsOutcome.UNSUPPORTED, "the watch asked for ${consult.tagNames.ifEmpty { "nothing named" }}; only HW_AGNSS can be served")
    val path = agnss.substringBeforeLast('/', "").trimStart('/')
    if (path.isEmpty()) return AgpsFetch.failed(AgpsOutcome.UNSUPPORTED, "the HW_AGNSS entry has no path")
    val url = HUAWEI_AGNSS_BASE + path
    logRaw("HW_AGNSS url=$url")
    return try {
      val got = cachedGet(url, force, AgpsPolicy.OTHER_MAX_BYTES, AgpsSources.HUAWEI_AGNSS, "HW_AGNSS", true, AgpsPolicy::validateOther)
      AgpsFetch(mapOf(AgpsSources.AGNSS_FILE to got.body), AgpsSources.HUAWEI_AGNSS, got.dataMs, AgpsOutcome.NONE, "", got.fromCache)
    } catch (e: AgpsFetchException) {
      fail(e, "HW_AGNSS")
    }
  }

  private companion object {
    const val HUAWEI_AGNSS_BASE = "https://geo-dra.platform.hicloud.com/"
  }
}

/** The download arrived but is not a file the watch may be sent. */
internal class AgpsInvalidFileException(message: String) : AgpsFetchException(message)

/** The phone-side copies of downloads, by URL. */
internal interface AgpsCache {
  /** The cached body of [url] when it is younger than [maxAgeMs]. */
  fun read(url: String, maxAgeMs: Long): ByteArray?

  fun write(url: String, data: ByteArray)

  fun delete(url: String)
}
