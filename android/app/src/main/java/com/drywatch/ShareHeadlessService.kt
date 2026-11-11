package com.drywatch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the share-sheet pipeline (extraction -> download -> transcription ->
 * OCR -> document) as a headless JS task: no Activity is ever created, so
 * TikTok (or whatever app shared into us) never loses the foreground.
 *
 * The service is itself a foreground service with its own notification:
 * starting ProcessingService from JS later would be a background
 * startForegroundService, which Android 12+ blocks. Here the foreground
 * promotion happens while ShareActivity (a visible activity) is still alive,
 * which is allowed.
 */
class ShareHeadlessService : HeadlessJsTaskService() {

  companion object {
    private const val EXTRA_POST_URL = "postUrl"
    private const val NOTIFICATION_ID = 43
    private const val CHANNEL_ID = "drywatch_processing"

    // Generous ceiling: on-device whisper-small transcription of a long
    // video plus OCR can take several minutes. A timeout of 0 would mean
    // "no timeout", risking a stuck JS error holding a wake lock forever.
    private const val TASK_TIMEOUT_MS = 10 * 60 * 1000L

    fun start(context: Context, postUrl: String) {
      val intent = Intent(context, ShareHeadlessService::class.java)
      intent.putExtra(EXTRA_POST_URL, postUrl)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val postUrl = intent?.getStringExtra(EXTRA_POST_URL)
    if (postUrl == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    startForeground(NOTIFICATION_ID, buildNotification())
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val postUrl = intent?.getStringExtra(EXTRA_POST_URL) ?: return null
    val data = Arguments.createMap()
    data.putString("postUrl", postUrl)
    return HeadlessJsTaskConfig(
      "DryWatchShareTask",
      data,
      TASK_TIMEOUT_MS,
      // All heavy work runs in native threads behind Promises; the JS thread
      // only awaits. Allowing foreground avoids HeadlessJsTaskContext's hard
      // check() crash if the app happens to be RESUMED (e.g. split screen).
      true,
    )
  }

  override fun onDestroy() {
    // The done notification (posted from JS, separate id/channel) replaces
    // this ongoing one.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  private fun buildNotification(): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "Video processing",
          NotificationManager.IMPORTANCE_LOW,
        ),
      )
    }
    val openApp = PendingIntent.getActivity(
      this,
      0,
      packageManager.getLaunchIntentForPackage(packageName),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setSmallIcon(R.drawable.ic_stat_drywatch)
      .setContentTitle("Preparing your note")
      .setContentText("Working in the background. You can keep using TikTok.")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(openApp)
      .build()
  }
}
