package com.drywatch

import android.media.MediaMetadataRetriever
import android.os.SystemClock
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

  /**
   * Writes a JPEG thumbnail of the video's first seconds to the app cache and
   * resolves its absolute path. Used for the in-app video preview and the
   * history list rows.
   */
  @ReactMethod
  fun getThumbnail(uri: String, promise: Promise) {
    Thread {
      val retriever = MediaMetadataRetriever()
      try {
        try {
          retriever.setDataSource(reactApplicationContext, android.net.Uri.parse(uri))
        } catch (e: Exception) {
          retriever.setDataSource(uri)
        }
        // 1s in: past the black/intro frames most TikTok videos open with.
        val bitmap = retriever.getFrameAtTime(
          1_000_000L,
          MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
        ) ?: retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        if (bitmap == null) {
          promise.reject("THUMBNAIL_FAILED", "No frame could be decoded from the video.")
          return@Thread
        }
        val target = java.io.File(
          reactApplicationContext.cacheDir,
          "drywatch-thumb-${SystemClock.elapsedRealtime()}.jpg",
        )
        target.outputStream().use { out ->
          bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, out)
        }
        bitmap.recycle()
        promise.resolve(target.absolutePath)
      } catch (e: Exception) {
        promise.reject("THUMBNAIL_FAILED", "Could not create thumbnail: ${e.message}", e)
      } finally {
        try {
          retriever.release()
        } catch (_: Exception) {}
      }
    }.start()
  }

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
