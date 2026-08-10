package com.watchfitre.log

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import org.json.JSONArray
import org.json.JSONObject
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
 */
@Singleton
class PacketLogExporter @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    fun export(entries: List<PacketLogEntry>, format: ExportFormat): File {
        val dir = File(context.getExternalFilesDir(null), EXPORT_DIR).apply { mkdirs() }
        val name = "watchfit-log-${tsStamp()}.${format.ext}"
        val file = File(dir, name)
        file.writeText(when (format) {
            ExportFormat.JSON -> toJson(entries)
            ExportFormat.CSV -> toCsv(entries)
            ExportFormat.TXT -> toTxt(entries)
        }, Charsets.UTF_8)
        return file
    }

    private fun toJson(entries: List<PacketLogEntry>): String {
        val arr = JSONArray()
        for (e in entries) {
            val o = JSONObject()
            o.put("timestamp_iso", isoStamp(e.epochMs))
            o.put("epoch_ms", e.epochMs)
            o.put("direction", e.direction.name)
            o.put("op", e.op.name)
            o.put("service_uuid", e.serviceUuid ?: JSONObject.NULL)
            o.put("characteristic_uuid", e.characteristicUuid ?: JSONObject.NULL)
            o.put("gatt_status", e.gattStatus)
            if (e.rssi != null) o.put("rssi", e.rssi)
            o.put("payload_hex", e.payload.toHex())
            o.put("payload_ascii", e.payload.toAscii())
            arr.put(o)
        }
        return arr.toString(2)
    }

    private fun toCsv(entries: List<PacketLogEntry>): String {
        val sb = StringBuilder()
        sb.appendLine("timestamp_iso,epoch_ms,direction,op,gatt_status,rssi,service_uuid,characteristic_uuid,payload_hex")
        for (e in entries) {
            sb.append(isoStamp(e.epochMs)).append(',')
              .append(e.epochMs).append(',')
              .append(e.direction.name).append(',')
              .append(e.op.name).append(',')
              .append(e.gattStatus).append(',')
              .append(e.rssi ?: "").append(',')
              .append(csv(e.serviceUuid)).append(',')
              .append(csv(e.characteristicUuid)).append(',')
              .append(csv(e.payload.toHex())).append('\n')
        }
        return sb.toString()
    }

    private fun toTxt(entries: List<PacketLogEntry>): String {
        val sb = StringBuilder()
        for (e in entries) {
            sb.append(hms(e.epochMs)).append('\n')
              .append(e.direction.name).append('\n')
              .append(e.op.name).append('\n')
            e.serviceUuid?.let { sb.append("Service: ").append(shortUuid(it)).append('\n') }
            e.characteristicUuid?.let { sb.append("Characteristic: ").append(shortUuid(it)).append('\n') }
            if (e.rssi != null) sb.append("RSSI: ").append(e.rssi).append(" dBm\n")
            if (e.gattStatus != 0) sb.append("GATT status: ").append(e.gattStatus).append('\n')
            sb.append(e.payload.toHex(" ")).append('\n').append('\n')
        }
        return sb.toString()
    }

    private fun csv(v: String?): String =
        if (v == null) "" else "\"" + v.replace("\"", "\"\"") + "\""

    private fun tsStamp(): String =
        SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())

    private fun isoStamp(ms: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(Date(ms))

    private fun hms(ms: Long): String =
        SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(Date(ms))

    private fun shortUuid(uuid: String): String =
        if (uuid.length <= 8) uuid else uuid.substring(4, 8)

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
