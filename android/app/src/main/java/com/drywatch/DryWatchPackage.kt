package com.drywatch

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class DryWatchPackage : ReactPackage {
  override fun createNativeModules(
      reactContext: ReactApplicationContext
  ): List<NativeModule> {
    return listOf(
        ShareIntentModule(reactContext),
        VideoMetaModule(reactContext),
        ClipboardFileModule(reactContext),
        AudioExtractorModule(reactContext),
    )
  }

  override fun createViewManagers(
      reactContext: ReactApplicationContext
  ): List<ViewManager<in Nothing, in Nothing>> {
    return emptyList()
  }
}
