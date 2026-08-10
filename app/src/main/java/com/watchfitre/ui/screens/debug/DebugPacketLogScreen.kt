package com.watchfitre.ui.screens.debug

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ElevatedButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.watchfitre.log.ExportFormat
import com.watchfitre.log.PacketDirection
import com.watchfitre.log.PacketLogEntry
import com.watchfitre.log.toHex
import com.watchfitre.ui.debug.PacketLogViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun DebugPacketLogScreen(vm: PacketLogViewModel = hiltViewModel()) {
    val context = LocalContext.current
    val dirFilter = vm.filterDirection.collectAsStateWithLifecycle().value
    val charFilter = vm.filterChar.collectAsStateWithLifecycle().value
    val all = vm.entries.collectAsStateWithLifecycle().value
    var menuOpen by remember { mutableStateOf(false) }

    val shown = remember(all, dirFilter, charFilter) { vm.filtered() }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ElevatedButton(onClick = { vm.setDirectionFilter(if (dirFilter == PacketDirection.TX) null else PacketDirection.TX) }) {
                Text("TX" + if (dirFilter == PacketDirection.TX) " ✓" else "")
            }
            ElevatedButton(onClick = { vm.setDirectionFilter(if (dirFilter == PacketDirection.RX) null else PacketDirection.RX) }) {
                Text("RX" + if (dirFilter == PacketDirection.RX) " ✓" else "")
            }
            OutlinedButton(onClick = { vm.setDirectionFilter(null) }) { Text("All") }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { vm.clear() }) { Text("Clear") }
            OutlinedButton(onClick = { menuOpen = true }) { Text("Export") }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                ExportFormat.entries.forEach { fmt ->
                    DropdownMenuItem(
                        text = { Text(fmt.name) },
                        onClick = {
                            menuOpen = false
                            val file = vm.export(fmt)
                            val uri = FileProvider.getUriForFile(
                                context,
                                "${context.packageName}.fileprovider",
                                file,
                            )
                            val share = Intent(Intent.ACTION_SEND).apply {
                                type = fmt.mime
                                putExtra(Intent.EXTRA_STREAM, uri)
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }
                            context.startActivity(Intent.createChooser(share, "Export packet log"))
                        },
                    )
                }
            }
        }

        Text(
            text = "${shown.size} entries" + (charFilter?.let { " · char ~ $it" } ?: ""),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(shown, key = { it.epochMs.toString() + it.direction + it.op + it.payload.contentHashCode() }) { e ->
                LogRow(e)
            }
        }
    }
}

@Composable
private fun LogRow(e: PacketLogEntry) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (e.direction == PacketDirection.TX)
                MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(hms(e.epochMs), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelLarge)
                Text("${e.direction.name} · ${e.op.name}", style = MaterialTheme.typography.labelLarge)
            }
            e.characteristicUuid?.let {
                Text(
                    it,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (e.payload.isNotEmpty()) {
                Text(
                    e.payload.toHex(" "),
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
            if (e.rssi != null) Text("RSSI ${e.rssi} dBm", style = MaterialTheme.typography.labelLarge)
            if (e.gattStatus != 0) Text("GATT ${e.gattStatus}", style = MaterialTheme.typography.labelLarge)
        }
    }
}

private fun hms(ms: Long): String =
    SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault()).format(Date(ms))
