package com.watchfitre.log

/**
 * Reads a packet capture (JSON produced by [PacketLogFormatter.toJson]) back into
 * [PacketLogEntry] objects — enables replay and round-trip tests (PRD §28: "raw packet
 * captures can be replayed in tests").
 *
 * Pure, no Android, no third-party JSON lib: ships a tiny tolerant parser sufficient for our
 * flat-object schema. Tolerant by design — a malformed entry is skipped, never fatal (PRD §24:
 * unknown packets never break the app).
 */
object PacketCaptureReader {

    fun from(json: String): List<PacketLogEntry> {
        val tree = try {
            MiniJson.parse(json)
        } catch (_: IllegalArgumentException) {
            return emptyList()
        }
        val arr = tree as? List<*> ?: return emptyList()
        return arr.mapNotNull { item ->
            val o = item as? Map<*, *> ?: return@mapNotNull null
            parseEntry(o)
        }
    }

    private fun parseEntry(o: Map<*, *>): PacketLogEntry? {
        return try {
            val epochMs = (o["epoch_ms"] as? Number)?.toLong() ?: return null
            PacketLogEntry(
                epochMs = epochMs,
                direction = PacketDirection.valueOf(o["direction"] as String),
                op = PacketOp.valueOf(o["op"] as String),
                serviceUuid = o["service_uuid"] as? String,
                characteristicUuid = o["characteristic_uuid"] as? String,
                payload = (o["payload_hex"] as? String).orEmpty().hexToBytes(),
                gattStatus = (o["gatt_status"] as? Number)?.toInt() ?: 0,
                rssi = (o["rssi"] as? Number)?.toInt(),
            )
        } catch (_: IllegalArgumentException) {
            null // unknown enum / bad shape — skip per PRD §24
        }
    }
}

/** Parse a hex string ("AA5501" or "AA 55 01") to bytes. Whitespace ignored. */
fun String.hexToBytes(): ByteArray {
    val cleaned = filter { it.isLetterOrDigit() }
    if (cleaned.length % 2 != 0) return ByteArray(0)
    return ByteArray(cleaned.length / 2) { i ->
        cleaned.substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
}

/**
 * Replays a capture into a [PacketLogger] so a previously recorded session can be re-analysed
 * live in the debug UI. Timestamps are preserved as-is (historic).
 */
fun PacketLogger.replay(entries: List<PacketLogEntry>) {
    entries.forEach { log(it) }
}

/**
 * Minimal JSON parser → Kotlin Any tree:
 *  - Object  -> Map<String, Any?>
 *  - Array   -> List<Any?>
 *  - String  -> String (escapes resolved)
 *  - Number  -> Long or Double
 *  - true/false/null -> Boolean/Boolean/null
 *
 * Sufficient for [PacketLogFormatter] output; not a general-purpose JSON library.
 */
private object MiniJson {
    private class Cursor(val s: String) {
        var i = 0
        fun skipWs() { while (i < s.length && s[i].isWhitespace()) i++ }
        fun eof() = i >= s.length
    }

    fun parse(s: String): Any? {
        val c = Cursor(s)
        c.skipWs()
        return parseValue(c)
    }

    private fun parseValue(c: Cursor): Any? {
        c.skipWs()
        require(!c.eof()) { "unexpected end of input" }
        return when (val ch = c.s[c.i]) {
            '{' -> parseObject(c)
            '[' -> parseArray(c)
            '"' -> parseString(c)
            't', 'f' -> parseBool(c)
            'n' -> parseNull(c)
            else -> if (ch == '-' || ch.isDigit()) parseNumber(c)
            else throw IllegalArgumentException("unexpected char '$ch' at ${c.i}")
        }
    }

    private fun parseObject(c: Cursor): Map<String, Any?> {
        c.i++ // {
        val out = LinkedHashMap<String, Any?>()
        c.skipWs()
        if (c.s[c.i] == '}') { c.i++; return out }
        while (true) {
            c.skipWs()
            require(c.s[c.i] == '"') { "expected string key at ${c.i}" }
            val key = parseString(c) as String
            c.skipWs()
            require(c.s[c.i] == ':') { "expected ':' at ${c.i}" }
            c.i++
            val value = parseValue(c)
            out[key] = value
            c.skipWs()
            when (c.s[c.i]) {
                ',' -> { c.i++; continue }
                '}' -> { c.i++; return out }
                else -> throw IllegalArgumentException("expected ',' or '}' at ${c.i}")
            }
        }
    }

    private fun parseArray(c: Cursor): List<Any?> {
        c.i++ // [
        val out = ArrayList<Any?>()
        c.skipWs()
        if (c.s[c.i] == ']') { c.i++; return out }
        while (true) {
            out.add(parseValue(c))
            c.skipWs()
            when (c.s[c.i]) {
                ',' -> { c.i++; continue }
                ']' -> { c.i++; return out }
                else -> throw IllegalArgumentException("expected ',' or ']' at ${c.i}")
            }
        }
    }

    private fun parseString(c: Cursor): String {
        require(c.s[c.i] == '"') { "expected '\"' at ${c.i}" }
        c.i++
        val sb = StringBuilder()
        while (true) {
            require(!c.eof()) { "unterminated string" }
            val ch = c.s[c.i++]
            if (ch == '"') return sb.toString()
            if (ch == '\\') {
                require(!c.eof()) { "unterminated escape" }
                val e = c.s[c.i++]
                sb.append(when (e) {
                    '"' -> '"'; '\\' -> '\\'; '/' -> '/'
                    'n' -> '\n'; 'r' -> '\r'; 't' -> '\t'; 'b' -> '\b'; 'f' -> ''
                    'u' -> {
                        val hex = c.s.substring(c.i, c.i + 4); c.i += 4
                        hex.toInt(16).toChar()
                    }
                    else -> e
                })
            } else sb.append(ch)
        }
    }

    private fun parseNumber(c: Cursor): Number {
        val start = c.i
        if (c.s[c.i] == '-') c.i++
        var isFloat = false
        while (!c.eof()) {
            val ch = c.s[c.i]
            when {
                ch.isDigit() -> c.i++
                ch == '.' || ch == 'e' || ch == 'E' || ch == '+' || ch == '-' -> { isFloat = true; c.i++ }
                else -> break
            }
        }
        val tok = c.s.substring(start, c.i)
        return if (isFloat) tok.toDouble() else tok.toLong()
    }

    private fun parseBool(c: Cursor): Boolean {
        if (c.s.startsWith("true", c.i)) { c.i += 4; return true }
        if (c.s.startsWith("false", c.i)) { c.i += 5; return false }
        throw IllegalArgumentException("invalid literal at ${c.i}")
    }

    private fun parseNull(c: Cursor): Any? {
        require(c.s.startsWith("null", c.i)) { "invalid literal at ${c.i}" }
        c.i += 4; return null
    }
}
