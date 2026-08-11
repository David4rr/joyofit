package com.watchfitre.ui.screens.debug

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.watchfitre.log.PacketDirection
import com.watchfitre.ui.debug.ReplayViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun DebugReplayScreen(
    onInjected: () -> Unit,
    vm: ReplayViewModel = hiltViewModel(),
) {
    val state = vm.state.collectAsStateWithLifecycle().value
    val pickLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? -> if (uri != null) vm.load(uri) }

    val entries = state.entries
    val txCount = remember(entries) { entries.count { it.direction == PacketDirection.TX } }
    val rxCount = remember(entries) { entries.count { it.direction == PacketDirection.RX } }
    val chars = remember(entries) { entries.mapNotNull { it.characteristicUuid }.distinct() }
    val timeRange = remember(entries) {
        if (entries.isEmpty()) null else {
            val min = entries.minOf { it.epochMs }
            val max = entries.maxOf { it.epochMs }
            fmt(min) to fmt(max)
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Replay capture", style = MaterialTheme.typography.titleLarge)
        Text(
            "Pick an exported JSON capture to inspect, inject into the live log, or feed through the parser.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        OutlinedButton(
            onClick = { pickLauncher.launch(arrayOf("application/json", "application/octet-stream", "*/*")) },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Pick capture file (JSON)") }

        state.error?.let {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Error: $it", Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }

        if (entries.isNotEmpty()) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SummaryRow("Entries", "${entries.size}")
                    SummaryRow("TX / RX", "$txCount / $rxCount")
                    timeRange?.let { (a, b) -> SummaryRow("Time", "$a → $b") }
                    SummaryRow("Distinct chars", "${chars.size}")
                    SummaryRow("Parser decoded", "${vm.decodedCount()} / $rxCount RX  (0 until protocol is VERIFIED)")
                    if (chars.isNotEmpty()) {
                        Text("Characteristics:", style = MaterialTheme.typography.labelLarge)
                        chars.take(20).forEach {
                            Text(it, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelLarge)
                        }
                        if (chars.size > 20) Text("+${chars.size - 20} more", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }

            Button(
                onClick = {
                    vm.inject()
                    onInjected()
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Inject ${entries.size} entries into live log") }
        }
    }
}

@Composable
private fun SummaryRow(label: String, value: String) {
    androidx.compose.foundation.layout.Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleLarge)
    }
}

private fun fmt(ms: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date(ms))
