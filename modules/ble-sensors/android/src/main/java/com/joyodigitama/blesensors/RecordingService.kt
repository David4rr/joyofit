package com.joyodigitama.blesensors

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder

/**
 * Keeps the process alive while a workout is recorded: a foreground service with an ongoing notification. The work (sensor links,
 * GPS) happens elsewhere; this only holds the process in the foreground. [WorkoutSession] starts and stops it and owns the wake lock.
 */
class RecordingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val session = WorkoutSession.snapshot()
    val notification = RecordingNotification.build(this, session.title, session.text)
    val types = ForegroundTypes.compute(
      Build.VERSION.SDK_INT,
      session.gps,
      checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED,
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
        checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED,
    )
    try {
      if (types != 0) startForeground(RecordingNotification.ID, notification, types) else startForeground(RecordingNotification.ID, notification)
      WorkoutSession.serviceStarted()
      // The session ended while this start was queued: Android still wants startForeground before the stop.
      if (!WorkoutSession.isActive) stopSelf()
    } catch (e: RuntimeException) {
      // SecurityException (missing permission for the type), ForegroundServiceStartNotAllowedException, IllegalStateException.
      WorkoutSession.serviceFailed(e)
    }
    // A session cannot survive the process: the JS state it belongs to is gone with it.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    WorkoutSession.end(this)
    super.onDestroy()
  }
}

internal object RecordingNotification {
  const val ID = 4707
  private const val CHANNEL_ID = "workout_recording"
  private const val CHANNEL_NAME = "Workout recording"

  fun build(context: Context, title: String, text: String): Notification {
    val manager = context.getSystemService(NotificationManager::class.java)
    manager?.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
        setSound(null, null)
      },
    )
    val builder = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Notification.CATEGORY_WORKOUT else Notification.CATEGORY_SERVICE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
      builder.setContentIntent(PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    return builder.build()
  }

  /** The status bar icon lives in another module (huawei-wear's `ic_stat_joyofit`); the app icon is the fallback. */
  private fun smallIcon(context: Context): Int {
    val statIcon = context.resources.getIdentifier("ic_stat_joyofit", "drawable", context.packageName)
    if (statIcon != 0) return statIcon
    val appIcon = context.applicationInfo.icon
    return if (appIcon != 0) appIcon else android.R.drawable.ic_dialog_info
  }
}
