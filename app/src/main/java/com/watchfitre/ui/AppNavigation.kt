package com.watchfitre.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.Bluetooth
import androidx.compose.material.icons.outlined.DirectionsRun
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.watchfitre.R
import com.watchfitre.ui.dashboard.DashboardViewModel
import com.watchfitre.ui.screens.ComingSoonScreen
import com.watchfitre.ui.screens.DeviceScreen
import com.watchfitre.ui.screens.HomeScreen
import com.watchfitre.ui.screens.SettingsScreen
import com.watchfitre.ui.settings.SettingsViewModel
import com.watchfitre.ui.screens.debug.DebugGattExplorerScreen
import com.watchfitre.ui.screens.debug.DebugPacketLogScreen
import com.watchfitre.ui.screens.debug.DebugReplayScreen
import com.watchfitre.ui.screens.debug.DebugScannerScreen

private data class NavItem(val route: String, val labelRes: Int, val icon: ImageVector)

private val NAV_ITEMS = listOf(
    NavItem(Routes.HOME, R.string.nav_home, Icons.Outlined.Home),
    NavItem(Routes.HEALTH, R.string.nav_health, Icons.Outlined.Favorite),
    NavItem(Routes.SLEEP, R.string.nav_sleep, Icons.Outlined.Bedtime),
    NavItem(Routes.WORKOUTS, R.string.nav_workouts, Icons.Outlined.DirectionsRun),
    NavItem(Routes.DEVICE, R.string.nav_device, Icons.Outlined.Bluetooth),
    NavItem(Routes.SETTINGS, R.string.nav_settings, Icons.Outlined.Settings),
)

@Composable
fun AppNavigation() {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route

    val showBottomBar = current in Routes.bottomNav

    Scaffold(
        bottomBar = {
            if (showBottomBar) {
                NavigationBar {
                    NAV_ITEMS.forEach { item ->
                        NavigationBarItem(
                            selected = current == item.route,
                            onClick = {
                                nav.navigate(item.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(item.icon, contentDescription = null) },
                            label = { Text(stringResource(item.labelRes)) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = nav,
            startDestination = Routes.HOME,
            modifier = Modifier.padding(padding),
        ) {
            composable(Routes.HOME) {
                val vm: DashboardViewModel = hiltViewModel()
                val ui = vm.ui.collectAsStateWithLifecycle().value
                HomeScreen(lastSyncMs = ui.settings.lastSyncEpochMs)
            }
            composable(Routes.HEALTH) {
                ComingSoonScreen("Health", "Heart rate, steps, calories, activity. Available once sync is implemented.")
            }
            composable(Routes.SLEEP) {
                ComingSoonScreen("Sleep", "Sleep stages and duration. Available once the sleep protocol is decoded.")
            }
            composable(Routes.WORKOUTS) {
                ComingSoonScreen("Workouts", "Workout history. Available once the workout protocol is decoded.")
            }
            composable(Routes.DEVICE) {
                val vm: com.watchfitre.ui.device.DeviceViewModel = hiltViewModel()
                val ui = vm.ui.collectAsStateWithLifecycle().value
                DeviceScreen(
                    connection = ui.connection,
                    info = ui.info,
                    debugVisible = false,
                    onRefresh = { vm.refresh() },
                    onOpenExplorer = { nav.navigate(Routes.DEBUG_SCANNER) },
                )
            }
            composable(Routes.SETTINGS) {
                val vm: SettingsViewModel = hiltViewModel()
                val s = vm.settings.collectAsStateWithLifecycle().value
                SettingsScreen(
                    autoReconnect = s.autoReconnect,
                    debugEnabled = s.debugEnabled,
                    onAutoReconnectChange = vm::setAutoReconnect,
                    onEnableDebug = vm::enableDebug,
                    onOpenDebugScanner = { nav.navigate(Routes.DEBUG_SCANNER) },
                    onOpenDebugLog = { nav.navigate(Routes.DEBUG_LOG) },
                    onOpenDebugReplay = { nav.navigate(Routes.DEBUG_REPLAY) },
                )
            }
            composable(Routes.DEBUG_SCANNER) {
                DebugScannerScreen(onDevicePicked = { nav.navigate(Routes.DEBUG_GATT) })
            }
            composable(Routes.DEBUG_GATT) { DebugGattExplorerScreen() }
            composable(Routes.DEBUG_LOG) { DebugPacketLogScreen() }
            composable(Routes.DEBUG_REPLAY) {
                DebugReplayScreen(onInjected = { nav.navigate(Routes.DEBUG_LOG) })
            }
        }
    }
}
