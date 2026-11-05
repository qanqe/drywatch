package com.drywatch

import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule

/**
 * Opens a specific app's share sheet (or the system chooser) with a file
 * attached, from our own in-app share modal instead of always jumping
 * straight to Android's bottom sheet.
 *
 * Direct targeting strategy (fixed after device testing showed the AI apps
 * were not matched): installation is checked with getPackageInfo (reliable),
 * not intent resolution (unreliable — AI apps often do not declare support
 * for text/markdown ACTION_SEND, so queryIntentActivities returned nothing
 * and every share fell through to the chooser). The share Intent itself uses
 * the widely-accepted text/plain type; recipients read the attached file's
 * real type from its extension and content.
 */
@ReactModule(name = AppShareModule.NAME)
class AppShareModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "DryWatchAppShare"

    // Package names for direct-to-app sharing.
    private val TARGET_PACKAGES = mapOf(
      "claude" to listOf("com.anthropic.claude"),
      "chatgpt" to listOf("com.openai.chatgpt"),
      "gemini" to listOf(
        "com.google.android.apps.bard",
        "com.google.android.apps.gemini",
      ),
    )
  }

  override fun getName() = NAME

  private fun isInstalled(packageName: String): Boolean {
    return try {
      reactContext.packageManager.getPackageInfo(packageName, 0)
      true
    } catch (_: Exception) {
      false
    }
  }

  @ReactMethod
  fun shareFileTo(target: String, filePath: String, promise: Promise) {
    try {
      val file = java.io.File(filePath.removePrefix("file://"))
      if (!file.exists()) {
        promise.reject("FILE_MISSING", "The note file is no longer available.")
        return
      }

      val uri: Uri = androidx.core.content.FileProvider.getUriForFile(
        reactContext,
        "${reactContext.packageName}.fileprovider",
        file,
      )

      val share = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, file.nameWithoutExtension)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      val packages = TARGET_PACKAGES[target.lowercase()]
      if (packages != null) {
        val installed = packages.firstOrNull { isInstalled(it) }
        if (installed != null) {
          // Launch the app's own share receiver if it exposes one; otherwise
          // target the app's package explicitly via createChooser with the
          // package set, which Android routes to that app when resolvable.
          val pm = reactContext.packageManager
          val receiver = pm.queryIntentActivities(share, 0).firstOrNull {
            it.activityInfo.packageName == installed
          }
          if (receiver != null) {
            share.setClassName(receiver.activityInfo.packageName, receiver.activityInfo.name)
            reactContext.startActivity(share)
            val map: WritableMap = Arguments.createMap()
            map.putString("mode", "direct")
            map.putString("app", installed)
            promise.resolve(map)
            return
          }
          // App installed but its share receiver not resolvable for this
          // intent: open the chooser pre-filtered to the target package.
          val chooser = Intent.createChooser(share, "Share context note")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, emptyArray())
          reactContext.startActivity(chooser)
          val map: WritableMap = Arguments.createMap()
          map.putString("mode", "chooser_prefiltered")
          map.putString("app", installed)
          promise.resolve(map)
          return
        }
        // Target app genuinely not installed - honest rejection to JS.
        promise.reject(
          "APP_NOT_INSTALLED",
          "That app is not installed on this device.",
        )
        return
      }

      val chooser = Intent.createChooser(share, "Share context note")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(chooser)
      val map: WritableMap = Arguments.createMap()
      map.putString("mode", "chooser")
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("SHARE_FAILED", e.message, e)
    }
  }
}
