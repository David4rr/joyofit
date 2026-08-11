package com.watchfitre.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.watchfitre.ble.model.ConnectionState
import com.watchfitre.device.DeviceInfo

@Composable
fun DeviceScreen(
    connection: ConnectionState,
    info: DeviceInfo,
    debugVisible: Boolean,
    onRefresh: () -> Unit,
    onOpenExplorer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
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
                InfoRow("Battery", info.batteryPct?.let { "$it %" })
                InfoRow("Model", info.model)
                InfoRow("Firmware", info.firmware)
                InfoRow("Hardware", info.hardware)
                InfoRow("Manufacturer", info.manufacturer)
                InfoRow("Serial", info.serial)
                InfoRow("Signal", info.signalLabel(rssi = null))
            }
        }

        if (connection is ConnectionState.Ready) {
            OutlinedButton(onClick = onRefresh, modifier = Modifier.fillMaxWidth()) {
                Text("Read device info")
            }
        }

        if (debugVisible) {
            Button(onClick = onOpenExplorer, modifier = Modifier.fillMaxWidth()) {
                Text("Open BLE explorer")
            }
        }

        if (info.isEmpty()) {
            Text(
                text = "No device info yet. Connect, then tap “Read device info”. " +
                    "Standard fields (battery, model, firmware) populate from observed GATT reads.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String?) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value ?: "—", style = MaterialTheme.typography.titleLarge)
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
