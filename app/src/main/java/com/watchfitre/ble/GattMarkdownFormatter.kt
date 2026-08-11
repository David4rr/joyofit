package com.watchfitre.ble

import com.watchfitre.ble.model.GattCharacteristicInfo
import com.watchfitre.ble.model.GattServiceInfo
import com.watchfitre.ble.model.GattUuid
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Renders a discovered GATT tree to Markdown matching the `protocol/services.md` +
 * `characteristics.md` living-spec format (PRD §13). Pure — no Android — so it's unit-testable.
 *
 * Confidence rule (PRD §29): the export marks characteristic *presence* as OBSERVED but field
 * meaning as UNKNOWN until a command is VERIFIED. The footer says so explicitly so a dumped
 * tree is never mistaken for a decoded protocol.
 */
object GattMarkdownFormatter {

    /** `deviceLabel` may be null if no name resolved. */
    fun format(
        services: List<GattServiceInfo>,
        deviceLabel: String?,
        capturedEpochMs: Long,
    ): String = buildString {
        append("# GATT — ${deviceLabel ?: "Unknown device"}\n\n")
        append("Captured: ${iso(capturedEpochMs)}\n\n")
        append("> Presence = OBSERVED. Field meaning = UNKNOWN until a command is VERIFIED (PRD §29).\n\n")
        append("| Service UUID | Label | Chars |\n")
        append("|---|---|---|\n")
        for (svc in services) {
            append("| `").append(svc.uuid).append("` | ").append(labelOr(svc.uuid)).append(" | ").append(svc.characteristics.size).append(" |\n")
        }
        append("\n---\n\n")
        for (svc in services) {
            append("## ").append(labelOr(svc.uuid)).append("\n\n")
            append("`").append(svc.uuid).append("`  \n")
            append("instance: ").append(svc.instanceId).append("\n\n")
            if (svc.characteristics.isEmpty()) {
                append("_no characteristics_\n\n")
            }
            for (ch in svc.characteristics) {
                appendCharacteristic(ch)
            }
        }
    }

    private fun StringBuilder.appendCharacteristic(ch: GattCharacteristicInfo) {
        append("### ").append(labelOr(ch.uuid)).append("\n\n")
        append("`").append(ch.uuid).append("`  \n")
        append("Properties: **").append(ch.capabilitySummary()).append("**  \n")
        if (ch.descriptors.isNotEmpty()) {
            append("Descriptors: ")
            append(ch.descriptors.joinToString(", ") { "`${shortUuid(it.uuid)}`" })
            append("  \n")
        }
        ch.lastValue?.let { v ->
            if (v.isNotEmpty()) append("Last value (hex): `").append(v.toHex(" ")).append("`  \n")
        }
        append('\n')
    }

    private fun labelOr(uuidStr: String): String =
        runCatching { GattUuid.label(UUID.fromString(uuidStr)) }.getOrNull() ?: "Unknown"

    private fun shortUuid(uuid: String): String =
        if (uuid.length <= 8) uuid.uppercase(Locale.US) else uuid.substring(4, 8).uppercase(Locale.US)

    private fun ByteArray.toHex(separator: String = ""): String =
        joinToString(separator) { "%02X".format(it.toInt() and 0xFF) }

    private fun iso(ms: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(Date(ms))
}
