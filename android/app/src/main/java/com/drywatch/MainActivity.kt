package com.drywatch

import android.content.Intent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "DryWatch"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    ShareIntentModule.handleSharedText(intent)
  }

  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    // Cold start: activity launched directly by a share action.
    ShareIntentModule.handleSharedText(intent)
  }

  override fun onResume() {
    super.onResume()
    // Warm start re-delivery of the same launch intent.
    ShareIntentModule.handleSharedText(intent)
  }
}
