package com.drywatch

import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = ShareIntentModule.NAME)
class ShareIntentModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "DryWatchShareIntent"

    // Static so a share delivered before the JS context exists is never lost.
    @Volatile private var pendingShareUrl: String? = null

    // True when the share arrived via ShareActivity (background pipe) rather
    // than the legacy in-app share handling: the JS bootstrap runs the
    // pipeline with notification-only feedback instead of opening the UI.
    @Volatile private var pendingShareBackground: Boolean = false

    // Identity of the last handled Intent: onResume-style re-delivery passes
    // the same instance; real new shares create new Intent objects.
    private var handledIntent: Intent? = null

    @JvmStatic
    fun handleSharedText(intent: Intent?) {
      if (intent == null || intent === handledIntent) {
        return
      }
      if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        if (!text.isNullOrBlank()) {
          pendingShareUrl = text.trim()
          pendingShareBackground = false
          handledIntent = intent
        }
      }
    }

    /** Called by ShareActivity: background pipe, no UI takeover. */
    @JvmStatic
    fun enqueueShare(text: String) {
      pendingShareUrl = text
      pendingShareBackground = true
    }

    @JvmStatic
    fun isBackgroundShare(): Boolean = pendingShareBackground
  }

  override fun getName() = NAME

  @ReactMethod
  fun consumePendingShare(promise: Promise) {
    val url = pendingShareUrl
    val background = pendingShareBackground
    pendingShareUrl = null
    pendingShareBackground = false
    val map = com.facebook.react.bridge.Arguments.createMap()
    map.putString("url", url)
    map.putBoolean("background", background && url != null)
    promise.resolve(map)
  }
}
