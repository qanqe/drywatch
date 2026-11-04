package com.drywatch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that owns the processing notification: shows real
 * stage progress, survives the activity going to the background, and is
 * stopped from JS when the pipeline finishes or the user cancels.
 *
 * The processing itself still runs in JS; this service only carries the
 * notification so Android does not kill the app mid-transcription.
 */
class ProcessingService : Service() {

  companion object {
    const val CHANNEL_ID = "drywatch_processing"
    const val NOTIFICATION_ID = 41

    const val ACTION_START = "com.drywatch.START_PROCESSING"
    const val ACTION_STOP = "com.drywatch.STOP_PROCESSING"
    const val EXTRA_TITLE = "title"
    const val EXTRA_STAGE = "stage"

    @Volatile private var isRunning = false

    fun start(context: Context, title: String) {
      val intent = Intent(context, ProcessingService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_TITLE, title)
      }
      context.startForegroundService(intent)
    }

    fun updateStage(context: Context, stage: String) {
      if (!isRunning) {
        return
      }
      val intent = Intent(context, ProcessingService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_STAGE, stage)
      }
      context.startService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, ProcessingService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Video processing",
        NotificationManager.IMPORTANCE_LOW,
      )
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.createNotificationChannel(channel)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Processing video"
        val stage = intent?.getStringExtra(EXTRA_STAGE)
        if (!isRunning) {
          startForeground(NOTIFICATION_ID, buildNotification(title, stage))
          isRunning = true
        } else if (stage != null) {
          val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          manager.notify(NOTIFICATION_ID, buildNotification(title, stage))
        }
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    super.onDestroy()
  }

  private fun buildNotification(title: String, stage: String?): Notification {
    val openApp = PendingIntent.getActivity(
      this,
      0,
      packageManager.getLaunchIntentForPackage(packageName),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val text = stage ?: "Working in the background. You can leave this screen."
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(openApp)
      .build()
  }
}
