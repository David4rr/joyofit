package com.watchfitre.log

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

enum class ExportFormat(val mime: String, val ext: String) {
    JSON("application/json", "json"),
    CSV("text/csv", "csv"),
    TXT("text/plain", "txt"),
}

/**
 * Writes the current in-memory log to app-specific external storage and returns the file.
 * Caller wraps it in a FileProvider URI + ACTION_SEND share intent.
 *
 * Privacy: lives under getExternalFilesDir — no permission needed, not scanned by media,
 * deleted on uninstall. User must explicitly share to move data off-device.
 *
 * Serialization lives in [PacketLogFormatter] (pure, unit-tested); this class only owns
 * the file write + naming.
 */
@Singleton
class PacketLogExporter @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    fun export(entries: List<PacketLogEntry>, format: ExportFormat): File {
        val dir = File(context.getExternalFilesDir(null), EXPORT_DIR).apply { mkdirs() }
        val file = File(dir, "watchfit-log-${tsStamp()}.${format.ext}")
        file.writeText(
            when (format) {
                ExportFormat.JSON -> PacketLogFormatter.toJson(entries)
                ExportFormat.CSV -> PacketLogFormatter.toCsv(entries)
                ExportFormat.TXT -> PacketLogFormatter.toTxt(entries)
            },
            Charsets.UTF_8,
        )
        return file
    }

    private fun tsStamp(): String =
        SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())

    companion object {
        const val EXPORT_DIR = "watchfit-logs"
    }
}

/** Byte helpers shared across logger + UI. */
fun ByteArray.toHex(separator: String = ""): String =
    joinToString(separator) { b -> "%02X".format(b.toInt() and 0xFF) }

fun ByteArray.toAscii(): String =
    String(this, Charsets.US_ASCII)
        .map { c -> if (c.code in 32..126) c else '.' }
        .joinToString("")
