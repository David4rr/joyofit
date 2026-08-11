package com.watchfitre.ui.screens

import androidx.compose.foundation.clickable
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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.watchfitre.BuildConfig
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    autoReconnect: Boolean,
    debugEnabled: Boolean,
    onAutoReconnectChange: (Boolean) -> Unit,
    onEnableDebug: () -> Unit,
    onOpenDebugScanner: () -> Unit,
    onOpenDebugLog: () -> Unit,
    onOpenDebugReplay: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var taps by remember { mutableIntStateOf(0) }
    var hint by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ToggleRow(
                    label = "Auto-reconnect",
                    checked = autoReconnect,
                    onChange = onAutoReconnectChange,
                )
            }
        }

        if (debugEnabled) {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Debug tools", style = MaterialTheme.typography.titleLarge)
                    Button(onClick = onOpenDebugScanner, modifier = Modifier.fillMaxWidth()) {
                        Text("BLE Scanner")
                    }
                    Button(onClick = onOpenDebugLog, modifier = Modifier.fillMaxWidth()) {
                        Text("Packet Log")
                    }
                    OutlinedButton(onClick = onOpenDebugReplay, modifier = Modifier.fillMaxWidth()) {
                        Text("Replay Capture")
                    }
                }
            }
        }

        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            modifier = Modifier
                .fillMaxWidth()
                .clickable {
                    taps++
                    if (taps >= 7 && !debugEnabled) {
                        onEnableDebug()
                        taps = 0
                    } else if (taps >= 4) {
                        scope.launch {
                            hint = "${7 - taps} more…"
                            delay(800)
                            hint = null
                        }
                    }
                },
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("About", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Version ${BuildConfig.VERSION_NAME}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (debugEnabled) {
                    Text(
                        "Developer mode enabled",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                hint?.let { Text(it, style = MaterialTheme.typography.labelLarge) }
            }
        }
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
