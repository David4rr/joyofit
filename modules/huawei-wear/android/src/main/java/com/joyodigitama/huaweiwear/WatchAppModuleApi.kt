package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * The watch app part of the `HuaweiWear` module (`listWatchApps` ... `sendFuelProfile` in `HuaweiWearModule.ts`): the 0x2a app service
 * and the JoyoFit Fuel link over P2P. Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.watchAppApi(runtime: () -> WearRuntime) {
  AsyncFunction("listWatchApps") Coroutine { ->
    runtime().watchApps.list()
  }

  AsyncFunction("inspectWatchApp") Coroutine { uri: String ->
    runtime().watchApps.inspect(uri)
  }

  AsyncFunction("installWatchApp") Coroutine { uri: String, allowUnsigned: Boolean ->
    runtime().watchApps.install(uri, allowUnsigned)
  }

  AsyncFunction("deleteWatchApp") Coroutine { packageName: String ->
    runtime().watchApps.delete(packageName)
  }

  AsyncFunction("getFuelLink") {
    runtime().p2p.fuelStatus()
  }

  AsyncFunction("setFuelWatchFingerprint") { fingerprint: String ->
    runtime().p2p.setFuelWatchFingerprint(fingerprint)
  }

  AsyncFunction("sendFuelProfile") Coroutine { ->
    runtime().p2p.sendFuelProfile()
  }
}
