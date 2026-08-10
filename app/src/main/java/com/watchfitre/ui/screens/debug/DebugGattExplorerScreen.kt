package com.watchfitre.ui.screens.debug

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.watchfitre.ble.capabilitySummary
import com.watchfitre.ble.model.GattCharacteristicInfo
import com.watchfitre.ble.model.GattServiceInfo
import com.watchfitre.ble.model.GattUuid
import com.watchfitre.ui.components.BytePayloadViewer
import com.watchfitre.ui.components.HexInputField
import com.watchfitre.ui.debug.GattExplorerViewModel
import java.util.UUID

@Composable
fun DebugGattExplorerScreen(
    vm: GattExplorerViewModel = hiltViewModel(),
) {
    val ui = vm.ui.collectAsStateWithLifecycle().value

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("GATT Explorer", style = MaterialTheme.typography.titleLarge)
                OutlinedButton(onClick = { vm.disconnect() }) { Text("Disconnect") }
            }
        }
        item {
            Text(
                text = "Services: ${ui.services.size}",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        items(ui.services, key = { it.uuid + it.instanceId }) { svc ->
            ServiceCard(svc, vm)
        }
    }
}

@Composable
private fun ServiceCard(svc: GattServiceInfo, vm: GattExplorerViewModel) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = GattUuid.label(UUID.fromString(svc.uuid)) ?: "Service",
                style = MaterialTheme.typography.titleLarge,
            )
            Text(svc.uuid, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelLarge)
            HorizontalDivider()
            svc.characteristics.forEach { ch -> CharacteristicRow(ch, vm) }
        }
    }
}

@Composable
private fun CharacteristicRow(ch: GattCharacteristicInfo, vm: GattExplorerViewModel) {
    var writeText by remember { mutableStateOf("") }
    var writeBytes by remember { mutableStateOf<ByteArray?>(null) }

    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = GattUuid.label(UUID.fromString(ch.uuid)) ?: "Characteristic",
            style = MaterialTheme.typography.labelLarge,
        )
        Text(ch.uuid, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            text = "Props: ${ch.capabilitySummary()}",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        ch.lastValue?.let { bytes ->
            BytePayloadViewer(bytes = bytes)
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (ch.canRead) {
                ElevatedButton(onClick = { vm.read(UUID.fromString(ch.uuid)) }) { Text("Read") }
            }
            if (ch.canNotify || ch.canIndicate) {
                val subscribed = ch.subscribed
                ElevatedButton(onClick = { vm.setNotify(UUID.fromString(ch.uuid), !subscribed) }) {
                    Text(if (subscribed) "Unsubscribe" else "Subscribe")
                }
            }
        }

        if (ch.canWrite || ch.canWriteNoResponse) {
            HexInputField(
                value = writeText,
                onValueChange = { text, parsed -> writeText = text; writeBytes = parsed },
                label = "TX payload (hex)",
            )
            Button(
                onClick = { writeBytes?.let { vm.write(UUID.fromString(ch.uuid), it) } },
                enabled = writeBytes != null,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Write") }
        }
    }
}
