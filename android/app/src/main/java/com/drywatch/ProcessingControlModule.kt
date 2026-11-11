package com.drywatch

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = ProcessingControlModule.NAME)
class ProcessingControlModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "DryWatchProcessingControl"
    const val NOTIFICATION_PERMISSION_REQUEST = 8123

    @Volatile
    var pendingPermissionPromise: Promise? = null

    fun onPermissionResult(granted: Boolean) {
      val promise = pendingPermissionPromise
      pendingPermissionPromise = null
      promise?.resolve(granted)
    }
  }

  override fun getName() = NAME

  @ReactMethod
  fun startService(title: String, promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val granted = ContextCompat.checkSelfPermission(
          reactContext,
          Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
          // Android 13+ requires a runtime request from the activity.
          // The JS side fires the request before calling this.
          promise.reject(
            "NOTIFICATION_PERMISSION_MISSING",
            "Notification permission has not been granted yet.",
          )
          return
        }
      }
      ProcessingService.start(reactContext, title)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SERVICE_START_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun updateStage(stage: String, promise: Promise) {
    try {
      ProcessingService.updateStage(reactContext, stage)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SERVICE_UPDATE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun stopService(promise: Promise) {
    try {
      ProcessingService.stop(reactContext)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SERVICE_STOP_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun showDoneNotification(title: String, promise: Promise) {
    try {
      ProcessingService.showDone(reactContext, title)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("DONE_NOTIFICATION_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun showDoneOverlay(title: String, documentText: String, promise: Promise) {
    try {
      DoneOverlayActivity.show(reactContext, title, documentText)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("DONE_OVERLAY_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun requestNotificationPermission(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      promise.resolve(true)
      return
    }
    val activity = getCurrentActivity()
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No foreground activity to show the permission dialog.")
      return
    }
    val granted = ContextCompat.checkSelfPermission(
      reactContext,
      Manifest.permission.POST_NOTIFICATIONS,
    ) == PackageManager.PERMISSION_GRANTED
    if (granted) {
      promise.resolve(true)
      return
    }
    // Store the promise; MainActivity delivers the result via
    // onRequestPermissionsResult.
    pendingPermissionPromise = promise
    androidx.core.app.ActivityCompat.requestPermissions(
      activity,
      arrayOf(Manifest.permission.POST_NOTIFICATIONS),
      NOTIFICATION_PERMISSION_REQUEST,
    )
  }
}
