package com.drywatch

import android.media.MediaMetadataRetriever
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = VideoMetaModule.NAME)
class VideoMetaModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "DryWatchVideoMeta"
  }

  override fun getName() = NAME

  @ReactMethod
  fun readMeta(uri: String, promise: Promise) {
    val retriever = MediaMetadataRetriever()
    try {
      try {
        retriever.setDataSource(reactApplicationContext, android.net.Uri.parse(uri))
      } catch (e: Exception) {
        // Fall back to direct path for file:// URIs from older flows.
        retriever.setDataSource(uri)
      }
      val map: WritableMap = Arguments.createMap()
      val durationMs =
          retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
      val rotation =
          retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
      val hasAudio =
          retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)

      map.putString("durationMs", durationMs)
      map.putString("width", width)
      map.putString("height", height)
      map.putString("rotation", rotation)
      map.putBoolean("hasAudio", hasAudio == "yes")
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("READ_META_FAILED", "Could not read video metadata: ${e.message}", e)
    } finally {
      try {
        retriever.release()
      } catch (_: Exception) {}
    }
  }
}
