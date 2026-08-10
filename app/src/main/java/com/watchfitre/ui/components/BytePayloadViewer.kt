package com.watchfitre.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.watchfitre.log.toAscii
import com.watchfitre.log.toHex

enum class ByteView { HEX, DEC, ASCII }

/** Read-only rendering of a [ByteArray] in hex / decimal / ASCII. */
@Composable
fun BytePayloadViewer(
    bytes: ByteArray,
    modifier: Modifier = Modifier,
) {
    var mode by remember { mutableStateOf(ByteView.HEX) }
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ByteView.entries.forEach { v ->
                FilterChip(
                    selected = mode == v,
                    onClick = { mode = v },
                    label = { Text(v.name) },
                )
            }
        }
        Box(
            modifier = Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(12.dp),
        ) {
            Text(
                text = when (mode) {
                    ByteView.HEX -> bytes.toHex(" ")
                    ByteView.DEC -> bytes.joinToString(" ") { (it.toInt() and 0xFF).toString() }
                    ByteView.ASCII -> bytes.toAscii()
                }.ifEmpty { "(empty)" },
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}

/** Hex input ("AA 55 01" or "AA5501"). Returns parsed bytes, or null if invalid. */
@Composable
fun HexInputField(
    value: String,
    onValueChange: (String, ByteArray?) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { raw ->
            val cleaned = raw.replace(Regex("[^0-9a-fA-F]"), "")
            val parsed = if (cleaned.length % 2 == 0) parseHexOrNull(cleaned) else null
            onValueChange(raw, parsed)
        },
        label = { Text(label) },
        placeholder = { Text("AA 55 01 00 …") },
        singleLine = false,
        isError = value.isNotBlank() && parseHexOrNull(value.replace(Regex("[^0-9a-fA-F]"), "")) == null
                    || value.replace(Regex("[^0-9a-fA-F]"), "").length % 2 != 0,
        modifier = modifier.fillMaxWidth(),
    )
}

fun parseHexOrNull(s: String): ByteArray? = runCatching {
    require(s.length % 2 == 0) { "odd length" }
    ByteArray(s.length / 2) { i ->
        val b = s.substring(i * 2, i * 2 + 2).toInt(16)
        b.toByte()
    }
}.getOrNull()
