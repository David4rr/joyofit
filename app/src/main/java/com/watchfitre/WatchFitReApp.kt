package com.watchfitre

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/**
 * Application entry point. Hilt graph roots here.
 *
 * Privacy: no cloud, no analytics, no telemetry. This app talks to exactly one physical
 * watch over BLE and stores what it learns on this device only.
 */
@HiltAndroidApp
class WatchFitReApp : Application()
