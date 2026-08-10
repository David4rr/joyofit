package com.watchfitre.ui.screens.debug

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.watchfitre.ble.BlePermissionManager
import com.watchfitre.ble.model.BleDevice
import com.watchfitre.ui.debug.BleScannerViewModel
import com.watchfitre.ble.model.ConnectionState as Conn

@Composable
fun DebugScannerScreen(
    onDevicePicked: () -> Unit,
    vm: BleScannerViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    var permissionsOk by remember {
        mutableStateOf(BlePermissionManager.areAllGranted(context))
    }
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result -> permissionsOk = result.values.all { it } }

    LaunchedEffect(Unit) {
        if (!permissionsOk) launcher.launch(BlePermissionManager.required.toTypedArray())
    }

    val ui = vm.ui.collectAsStateWithLifecycle().value

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (ui.scanning) {
                ElevatedButton(onClick = { vm.stopScan() }, modifier = Modifier.weight(1f)) {
                    Text("Stop")
                }
            } else {
                Button(
                    onClick = {
                        if (!permissionsOk) {
                            launcher.launch(BlePermissionManager.required.toTypedArray())
                        } else {
                            vm.startScan()
                        }
                    },
                    modifier = Modifier.weight(1f),
                ) { Text("Scan") }
            }
        }

        if (!permissionsOk) {
            Text(
                "Bluetooth permissions required to scan. Tap Scan to grant.",
                color = MaterialTheme.colorScheme.error,
            )
        }

        Text(
            text = "State: ${stateLabel(ui.connection)}",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(ui.devices, key = { it.address }) { device ->
                DeviceRow(device) {
                    pickDevice(vm, device.address, onDevicePicked)
                }
            }
        }
    }
}

private fun pickDevice(vm: BleScannerViewModel, address: String, onPicked: () -> Unit) {
    // Connect handled by GattExplorerViewModel via shared BleConnectionManager; trigger here.
    vm.connectByAddress(address)
    onPicked()
}

@Composable
private fun DeviceRow(device: BleDevice, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        onClick = onClick,
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(device.displayName, style = MaterialTheme.typography.titleLarge)
            Text(
                text = device.address,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text("RSSI: ${device.rssi} dBm", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun stateLabel(s: Conn): String = when (s) {
    is Conn.Disconnected -> "Disconnected"
    is Conn.Scanning -> "Scanning"
    is Conn.Connecting -> "Connecting to ${s.address}"
    is Conn.DiscoveringServices -> "Discovering services…"
    is Conn.Ready -> "Connected (${s.address})"
    is Conn.Failed -> "Failed: ${s.reason}"
}
