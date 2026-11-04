package com.drywatch

import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import dev.ffmpegkit_maintained.ytdlp.YtDlp
import dev.ffmpegkit_maintained.ytdlp.YtDlpRequest
import java.io.File

@ReactModule(name = TikTokDownloadModule.NAME)
class TikTokDownloadModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "DryWatchTikTokDownload"

    @Volatile private var initialized = false

    @JvmStatic
    fun ensureInitialized(context: ReactApplicationContext) {
      if (!initialized) {
        synchronized(this) {
          if (!initialized) {
            YtDlp.init(context)
            initialized = true
          }
        }
      }
    }
  }

  override fun getName() = NAME

  @ReactMethod
  fun downloadVideo(postUrl: String, promise: Promise) {
    Thread {
      var marker: String? = null
      try {
        ensureInitialized(reactContext)
        val downloadDir = File(reactContext.cacheDir, "tiktok_downloads")
        if (!downloadDir.exists()) {
          downloadDir.mkdirs()
        }

        marker = "dl-${SystemClock.elapsedRealtime()}"
        val request = YtDlpRequest(postUrl)
          .setOutputTemplate(File(downloadDir, "$marker.%(ext)s").absolutePath)
          .addOption("-f", "best[ext=mp4]/best")
          // Ask yt-dlp for TikTok's own subtitle tracks when they exist.
          .addOption("--write-sub")
          .addOption("--sub-lang", "en,en-US,en-GB")

        val response = YtDlp.execute(request) { _, _, _ -> }
        if (response.exitCode != 0) {
          promise.reject(
            "DOWNLOAD_FAILED",
            "yt-dlp could not download this post (exit code ${response.exitCode}). " +
              "The local video route still works.",
          )
          return@Thread
        }

        val videoFile = downloadDir.listFiles()
          ?.filter { it.name.startsWith("$marker.") }
          ?.maxByOrNull { it.length() }
        if (videoFile == null || videoFile.length() < 100_000) {
          promise.reject("DOWNLOAD_FAILED", "Downloaded file missing or too small.")
          return@Thread
        }

        val subtitleFile = downloadDir.listFiles()
          ?.firstOrNull {
            it.name.startsWith("$marker") &&
              (it.name.endsWith(".vtt") || it.name.endsWith(".srt"))
          }

        val map: WritableMap = Arguments.createMap()
        map.putString("videoPath", videoFile.absolutePath)
        map.putInt("sizeBytes", videoFile.length().toInt())
        if (subtitleFile != null) {
          map.putString("subtitlePath", subtitleFile.absolutePath)
        }
        promise.resolve(map)
      } catch (e: Exception) {
        marker?.let { prefix ->
          File(reactContext.cacheDir, "tiktok_downloads")
            .listFiles()?.filter { it.name.startsWith(prefix) }?.forEach { it.delete() }
        }
        promise.reject("DOWNLOAD_FAILED", e.message, e)
      }
    }.start()
  }

  @ReactMethod
  fun fetchInfo(postUrl: String, promise: Promise) {
    // Intentionally not implemented: the free yt-dlp runner whitelist does
    // not expose --print/--dump-json, so metadata extraction beyond the
    // subtitle sidecar files is not available. Do not call from JS.
    promise.reject("INFO_FAILED", "Not implemented in this build.")
  }
}
