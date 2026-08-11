package com.watchfitre.log

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Pure (no-Android) formatter for packet logs. Produces JSON / CSV / TXT strings from a list
 * of entries. Separated from [PacketLogExporter] so the serialization is unit-testable on the
 * JVM — the exporter only adds file I/O + the shareable File.
 */
object PacketLogFormatter {

    fun toJson(entries: List<PacketLogEntry>): String = buildString {
        append('[')
        for ((i, e) in entries.withIndex()) {
            if (i > 0) append(',')
            append('{')
            appendJsonKV("timestamp_iso", isoStamp(e.epochMs)); append(',')
            appendJsonNum("epoch_ms", e.epochMs); append(',')
            appendJsonKV("direction", e.direction.name); append(',')
            appendJsonKV("op", e.op.name); append(',')
            appendJsonKV("service_uuid", e.serviceUuid); append(',')
            appendJsonKV("characteristic_uuid", e.characteristicUuid); append(',')
            appendJsonNum("gatt_status", e.gattStatus); append(',')
            if (e.rssi != null) { appendJsonNum("rssi", e.rssi); append(',') }
            appendJsonKV("payload_hex", e.payload.toHex()); append(',')
            appendJsonKV("payload_ascii", e.payload.toAscii())
            append('}')
        }
        append(']')
    }

    fun toCsv(entries: List<PacketLogEntry>): String = buildString {
        append("timestamp_iso,epoch_ms,direction,op,gatt_status,rssi,service_uuid,characteristic_uuid,payload_hex\n")
        for (e in entries) {
            append(isoStamp(e.epochMs)).append(',')
              .append(e.epochMs).append(',')
              .append(e.direction.name).append(',')
              .append(e.op.name).append(',')
              .append(e.gattStatus).append(',')
              .append(e.rssi ?: "").append(',')
              .append(csv(e.serviceUuid)).append(',')
              .append(csv(e.characteristicUuid)).append(',')
              .append(csv(e.payload.toHex())).append('\n')
        }
    }

    fun toTxt(entries: List<PacketLogEntry>): String = buildString {
        for (e in entries) {
            append(hms(e.epochMs)).append('\n')
              .append(e.direction.name).append('\n')
              .append(e.op.name).append('\n')
            e.serviceUuid?.let { append("Service: ").append(shortUuid(it)).append('\n') }
            e.characteristicUuid?.let { append("Characteristic: ").append(shortUuid(it)).append('\n') }
            if (e.rssi != null) append("RSSI: ").append(e.rssi).append(" dBm\n")
            if (e.gattStatus != 0) append("GATT status: ").append(e.gattStatus).append('\n')
            append(e.payload.toHex(" ")).append('\n').append('\n')
        }
    }

    private fun StringBuilder.appendJsonKV(key: String, value: String?) {
        append('"').append(jsonEscape(key)).append("\":")
        if (value == null) append("null") else append('"').append(jsonEscape(value)).append('"')
    }

    /** Numbers emit bare (no quotes) so JSON consumers see numeric types. */
    private fun StringBuilder.appendJsonNum(key: String, value: Number) {
        append('"').append(jsonEscape(key)).append("\":").append(value.toString())
    }

    private fun jsonEscape(s: String): String = buildString(s.length + 2) {
        for (c in s) when (c) {
            '\\' -> append("\\\\")
            '"' -> append("\\\"")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> if (c.code < 0x20) append("\\u%04x".format(c.code)) else append(c)
        }
    }

    private fun csv(v: String?): String =
        if (v == null) "" else "\"" + v.replace("\"", "\"\"") + "\""

    internal fun isoStamp(ms: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(Date(ms))

    internal fun hms(ms: Long): String =
        SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(Date(ms))

    internal fun shortUuid(uuid: String): String =
        if (uuid.length <= 8) uuid.uppercase(Locale.US) else uuid.substring(4, 8).uppercase(Locale.US)
}
