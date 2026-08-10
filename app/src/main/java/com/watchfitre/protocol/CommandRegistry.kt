package com.watchfitre.protocol

/**
 * Catalogue of reverse-engineered commands. Each entry carries a [ConfidenceLevel];
 * only [ConfidenceLevel.VERIFIED] / [ConfidenceLevel.REPRODUCED] entries are sent to the watch.
 *
 * Mirrors the living `protocol/commands.md` doc at repo root (PRD §13).
 */
data class CommandSpec(
    val name: String,
    val commandId: Int,
    val characteristicUuid: String,
    val requestExampleHex: String,
    val responseExampleHex: String,
    val confidence: ConfidenceLevel,
    val notes: String,
)

object CommandRegistry {

    /** Empty by design. Populate only via VERIFIED observations. */
    val commands: List<CommandSpec> = emptyList()

    fun byName(name: String): CommandSpec? = commands.firstOrNull { it.name == name }
}
