package com.watchfitre

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.watchfitre.ble.ReconnectController
import com.watchfitre.ui.AppNavigation
import com.watchfitre.ui.theme.WatchFitReTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    // Foreground-only: reconnect lives while the app process is alive (PRD §19).
    @Inject lateinit var reconnectController: ReconnectController

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            WatchFitReTheme {
                AppNavigation()
            }
        }
        reconnectController.start()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) reconnectController.stop()
    }
}
