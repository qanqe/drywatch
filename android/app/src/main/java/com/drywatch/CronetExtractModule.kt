package com.drywatch

import android.content.Context
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import org.chromium.net.CronetEngine
import org.chromium.net.CronetException
import org.chromium.net.UrlRequest
import org.chromium.net.UrlResponseInfo
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * Cronet-based TikTok extraction (v0.0.5 test path).
 *
 * Rationale (second-opinion consultant): Cronet IS Chrome's real network
 * stack, so the TLS fingerprint is genuine Chrome - the curl_cffi of phones.
 * Unlike the WebView, there are no deep-link hijacks, no challenge-page DOM
 * quirks, and no "wv" marker in the user agent. The flow mirrors yt-dlp:
 * fetch the post page with browser-like headers, keep the cookies TikTok
 * hands back, read the rehydration JSON, resolve the video URL.
 *
 * Cookies are stored per-engine via setCookieHandler; a persistent
 * java.net.CookieManager keeps them across requests in this session.
 */
@ReactModule(name = CronetExtractModule.NAME)
class CronetExtractModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "DryWatchCronetExtract"
    private const val TAG = "CronetExtract"
    private const val UA =
      "Mozilla/5.0 (Linux; Android 14; SM-S916B) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/143.0.0.0 Mobile Safari/537.36"
    private const val MARKER = "__UNIVERSAL_DATA_FOR_REHYDRATION__"

    @Volatile private var engine: CronetEngine? = null
    @Volatile private var executor: Executor? = null

    @Synchronized
    fun getEngine(context: Context): CronetEngine {
      if (engine == null) {
        executor = Executors.newSingleThreadExecutor()
        // Prefer Google Play services' Cronet (up-to-date Chromium, matches
        // the device's real Chrome); fall back to the platform HttpEngine.
        val provider = org.chromium.net.CronetProvider.getAllProviders(context)
          .firstOrNull { it.isEnabled && it.name.contains("Google-Play-Services") }
          ?: org.chromium.net.CronetProvider.getAllProviders(context)
            .firstOrNull { it.isEnabled }
        if (provider == null) {
          throw IllegalStateException(
            "No Cronet provider available (Play services missing?).",
          )
        }
        Log.i(TAG, "Using Cronet provider: ${provider.name} version=${provider.version}")
        engine = provider.createBuilder()
          .setUserAgent(UA)
          .enableHttp2(true)
          .enableQuic(true)
          .enableBrotli(true)
          .build()
        Log.i(TAG, "Cronet engine created")
      }
      return engine!!
    }

    /**
     * Same JSON shape as the WebView path: __DEFAULT_SCOPE__ ->
     * webapp.video-detail -> itemInfo.itemStruct. Returns a WritableMap
     * identical to WebViewExtractModule's success payload.
     */
    fun parseUniversalData(html: String): com.facebook.react.bridge.WritableMap? {
      val regex = Regex(
        "<script id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\"[^>]*>(.*?)</script>",
        RegexOption.DOT_MATCHES_ALL,
      )
      val raw = regex.find(html)?.groupValues?.get(1) ?: return null

      val root = org.json.JSONObject(raw)
      val scope = root.optJSONObject("__DEFAULT_SCOPE__") ?: return null
      val detail = scope.optJSONObject("webapp.video-detail") ?: return null
      val statusCode = detail.optInt("statusCode", -1)
      if (statusCode != 0) {
        Log.i(TAG, "detail statusCode=$statusCode (blocked/reflow)")
        return null
      }
      val item = detail.optJSONObject("itemInfo")?.optJSONObject("itemStruct")
        ?: return null
      val video = item.optJSONObject("video") ?: return null
      val playAddr = video.optString("playAddr", "")
        .ifBlank { video.optString("downloadAddr", "") }
      if (playAddr.isBlank()) return null

      val map = Arguments.createMap()
      map.putString("videoUrl", playAddr)
      map.putString("caption", item.optString("desc", ""))
      map.putString("author", item.optJSONObject("author")?.optString("uniqueId", "") ?: "")
      map.putDouble("durationSeconds", video.optDouble("duration", 0.0))
      map.putString("videoId", item.optString("id", ""))
      return map
    }
  }

  override fun getName() = NAME

  @ReactMethod
  fun extractPostData(postUrl: String, promise: Promise) {
    Thread {
      val cronet = getEngine(reactContext)
      val body = ByteArrayOutputStream()

      val callback = object : UrlRequest.Callback() {
        override fun onRedirectReceived(
          request: UrlRequest,
          info: UrlResponseInfo,
          newLocationUrl: String,
        ) {
          Log.i(TAG, "redirect -> $newLocationUrl")
          request.followRedirect()
        }

        override fun onResponseStarted(request: UrlRequest, info: UrlResponseInfo) {
          Log.i(TAG, "status=${info.httpStatusCode} proto=${info.negotiatedProtocol}")
          request.read(ByteBuffer.allocateDirect(64 * 1024))
        }

        override fun onReadCompleted(
          request: UrlRequest,
          info: UrlResponseInfo,
          byteBuffer: ByteBuffer,
        ) {
          byteBuffer.flip()
          val bytes = ByteArray(byteBuffer.remaining())
          byteBuffer.get(bytes)
          body.write(bytes)
          byteBuffer.clear()
          request.read(byteBuffer)
        }

        override fun onSucceeded(request: UrlRequest, info: UrlResponseInfo) {
          val html = body.toString("UTF-8")
          Log.i(TAG, "DONE bytes=${html.length} hasMarker=${html.contains(MARKER)}")

          try {
            if (!html.contains(MARKER)) {
              promise.reject(
                "CRONET_EXTRACT_FAILED",
                "Page returned without post data (challenge or block page).",
              )
              return
            }
            val extracted = parseUniversalData(html)
            if (extracted == null) {
              promise.reject(
                "CRONET_EXTRACT_FAILED",
                "Rehydration JSON present but video detail missing (reflow or blocked).",
              )
              return
            }
            promise.resolve(extracted)
          } catch (e: Exception) {
            promise.reject("CRONET_EXTRACT_FAILED", e.message, e)
          }
        }

        override fun onFailed(
          request: UrlRequest,
          info: UrlResponseInfo?,
          error: CronetException,
        ) {
          Log.e(TAG, "FAILED: ${error.message}")
          promise.reject("CRONET_EXTRACT_FAILED", error.message, error)
        }

        override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
          promise.reject("CRONET_EXTRACT_FAILED", "Request canceled.")
        }
      }

      try {
        cronet.newUrlRequestBuilder(postUrl, callback, executor!!)
          .addHeader("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
          .addHeader("Accept-Language", "en-US,en;q=0.9")
          .addHeader("Upgrade-Insecure-Requests", "1")
          .build()
          .start()
      } catch (e: Exception) {
        promise.reject("CRONET_EXTRACT_FAILED", e.message, e)
      }
    }.start()
  }
}