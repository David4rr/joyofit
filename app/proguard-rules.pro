# Keep Hilt generated entry points (handled by Hilt gradle plugin, but explicit is safe).
-keep class dagger.hilt.** { *; }
-keep class * extends dagger.hilt.android.Hilt_AndroidApp { *; }

# Coroutines
-dontwarn kotlinx.coroutines.**

# Keep BLE model classes (reflection-free, but be safe for serialization helpers later).
-keep class com.watchfitre.ble.model.** { *; }
-keep class com.watchfitre.log.** { *; }

# Compose / Kotlin metadata
-keep class kotlin.Metadata { *; }
