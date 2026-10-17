package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `FamilyScopes` in `HuaweiWearFamily.types.ts`. */
class FamilyScopesRecord : Record {
  @Field var sync: Boolean = false
  @Field var steps: Boolean = false
  @Field var sleep: Boolean = false
  @Field var restingHr: Boolean = false
  @Field var spo2: Boolean = false

  internal fun toScopes() = FamilyScopes(sync, steps, sleep, restingHr, spo2)
}

/** `FamilyConfig` in `HuaweiWearFamily.types.ts`. */
class FamilyConfigRecord : Record {
  @Field var baseUrl: String = ""
  @Field var token: String = ""
  @Field var scopes: FamilyScopesRecord = FamilyScopesRecord()
  @Field var enabled: Boolean = false

  internal fun toConfig() = FamilyConfig(baseUrl, token, scopes.toScopes(), enabled)
}

/**
 * The family monitoring part of the `HuaweiWear` module (`familyConfigure` ... in `HuaweiWearModule.ts`), kept out of
 * [HuaweiWearModule]. Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.familyApi(runtime: () -> WearRuntime) {
  AsyncFunction("familyConfigure") { config: FamilyConfigRecord? ->
    runtime().family.configure(config?.toConfig())
  }

  AsyncFunction("familyUploadNow") Coroutine { ->
    runtime().family.upload(force = true).toJs()
  }

  Function("familyUploadStatus") {
    runtime().family.status()
  }
}
