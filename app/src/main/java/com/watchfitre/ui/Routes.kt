package com.watchfitre.ui

/** Single source of truth for nav destinations. */
object Routes {
    const val HOME = "home"
    const val HEALTH = "health"
    const val SLEEP = "sleep"
    const val WORKOUTS = "workouts"
    const val DEVICE = "device"
    const val SETTINGS = "settings"

    // Debug (developer mode)
    const val DEBUG_SCANNER = "debug/scanner"
    const val DEBUG_GATT = "debug/gatt"
    const val DEBUG_LOG = "debug/log"

    val bottomNav = listOf(HOME, HEALTH, SLEEP, WORKOUTS, DEVICE, SETTINGS)
}
