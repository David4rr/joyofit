package com.joyodigitama.blesensors

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `WorkoutSessionOptions` in `BleSensors.types.ts`. */
class WorkoutSessionOptionsRecord : Record {
  @Field var title: String = ""
  @Field var text: String = ""
  @Field var gps: Boolean = false
  @Field var openUrl: String? = null
}

/**
 * Expo module implementing `BleSensorsModule.ts`. The work lives in the process-wide [SensorHub] and [WorkoutSession]; this
 * class wires the TS contract to them and forwards their events to JS while the module is alive. Destroying the module does
 * not disconnect sensors or end the workout: a recording may continue across a JS reload.
 */
class BleSensorsModule : Module() {
  private fun context(): Context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private fun hub(): SensorHub = SensorHub.get(context())

  override fun definition() = ModuleDefinition {
    Name("BleSensors")

    Events("onScanResult", "onScanState", "onConnection", "onValue", "onLocation", "onBluetoothState")

    OnCreate {
      hub().install(this@BleSensorsModule) { name, payload -> sendEvent(name, payload) }
    }

    OnDestroy {
      // The hub may already be gone with the app context; nothing to detach then.
      SensorHub.peek()?.uninstall(this@BleSensorsModule)
    }

    AsyncFunction("bluetoothState") { hub().bluetoothState() }

    AsyncFunction("startScan") { hub().startScan() }

    AsyncFunction("stopScan") { hub().stopScan() }

    AsyncFunction("connect") { id: String -> hub().connect(id) }

    AsyncFunction("disconnect") { id: String -> hub().disconnect(id) }

    AsyncFunction("disconnectAll") { hub().disconnectAll() }

    AsyncFunction("connectionStates") { hub().connectionStates() }

    // Android cannot tell "never asked" from "denied", so undetermined is iOS only.
    AsyncFunction("locationPermission") {
      if (context().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) "granted" else "denied"
    }

    AsyncFunction("startWorkoutSession") Coroutine { options: WorkoutSessionOptionsRecord ->
      WorkoutSession.start(context(), options.title, options.text, options.gps, options.openUrl)
    }

    AsyncFunction("updateWorkoutSession") { text: String -> WorkoutSession.update(context(), text) }

    AsyncFunction("endWorkoutSession") { WorkoutSession.end(context()) }

    Function("isWorkoutSessionActive") { WorkoutSession.isActive }
  }
}
