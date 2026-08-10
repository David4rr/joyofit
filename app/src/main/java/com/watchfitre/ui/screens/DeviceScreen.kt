package com.watchfitre.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.watchfitre.ble.model.ConnectionState

@Composable
fun DeviceScreen(
    connection: ConnectionState,
    debugVisible: Boolean,
    onOpenExplorer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Huawei Watch Fit 4 Pro", style = MaterialTheme.typography.titleLarge)
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                InfoRow("Connection", connectionLabel(connection))
                InfoRow("Battery", "— %")
                InfoRow("Firmware", "—")
                InfoRow("Signal", "—")
            }
        }
        if (debugVisible) {
            Button(onClick = onOpenExplorer, modifier = Modifier.fillMaxWidth()) {
                Text("Open BLE explorer")
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleLarge)
    }
}

private fun connectionLabel(s: ConnectionState): String = when (s) {
    is ConnectionState.Disconnected -> "Disconnected"
    is ConnectionState.Scanning -> "Scanning…"
    is ConnectionState.Connecting -> "Connecting…"
    is ConnectionState.DiscoveringServices -> "Discovering…"
    is ConnectionState.Ready -> "Connected"
    is ConnectionState.Failed -> "Failed: ${s.reason}"
}
