package com.drywatch

import android.annotation.SuppressLint
import android.os.SystemClock
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONObject

/**
 * WebView-based TikTok extraction spike (v0.0.5).
 *
 * Strategy: a hidden system WebView IS real Chromium, so TikTok sees a genuine
 * browser TLS fingerprint and serves the real page (its JS challenge runs and
 * solves itself, exactly like in a normal browser). After the page finishes
 * loading we read __UNIVERSAL_DATA_FOR_REHYDRATION__ (the hydration JSON that
 * contains playAddr, caption, author) via evaluateJavascript, parse it
 * natively, and return the data to JS.
 *
 * The video file itself is downloaded separately by the JS layer with a
 * plain request plus Referer header (CDN downloads are not fingerprint-
 * gated; verified during the earlier spike).
 */
@ReactModule(name = WebViewExtractModule.NAME)
class WebViewExtractModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "DryWatchWebViewExtract"
    private const val PAGE_TIMEOUT_MS = 25_000L
    private const val SETTLE_MS = 1_500L
  }

  override fun getName() = NAME

  private inner class ExtractResultReceiver {
    @JavascriptInterface
    fun onUniversalData(json: String) {
      synchronized(lock) {
        receivedJson = json
        lock.notifyAll()
      }
    }

    @JavascriptInterface
    fun onNotFound() {
      synchronized(lock) {
        receivedJson = ""
        lock.notifyAll()
      }
    }
  }

  private val lock = Object()
  private var receivedJson: String? = null

  @SuppressLint("SetJavaScriptEnabled")
  @ReactMethod
  fun extractPostData(postUrl: String, promise: Promise) {
    Thread {
      val webView = WebView(reactContext)
      var timedOut = false
      try {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.userAgentString = null // keep genuine WebView UA
        CookieManager.getInstance().setAcceptCookie(true)

        val receiver = ExtractResultReceiver()
        webView.addJavascriptInterface(receiver, "DryWatchExtract")

        val pageFinished = arrayOf(false)
        webView.webViewClient = object : WebViewClient() {
          override fun onPageFinished(view: WebView, url: String) {
            synchronized(pageFinished) { pageFinished[0] = true }
          }
        }

        webView.loadUrl(postUrl, mapOf(
          "Accept-Language" to "en-US,en;q=0.9",
        ))

        // Wait for page load (or timeout).
        val startedAt = SystemClock.elapsedRealtime()
        while (SystemClock.elapsedRealtime() - startedAt < PAGE_TIMEOUT_MS) {
          synchronized(pageFinished) {
            if (pageFinished[0]) break
          }
          SystemClock.sleep(120)
        }
        if (!pageFinished[0]) {
          timedOut = true
          throw IllegalStateException("Page did not finish loading in time.")
        }

        // Give TikTok's hydration scripts a moment to populate the JSON.
        SystemClock.sleep(SETTLE_MS)

        // Read the hydration JSON from the DOM, out to the receiver.
        receivedJson = null
        webView.evaluateJavascript(
          """
          (function() {
            var el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
            if (el && el.textContent) {
              window.DryWatchExtract.onUniversalData(el.textContent);
            } else {
              window.DryWatchExtract.onNotFound();
            }
          })();
          """.trimIndent(),
          null,
        )

        val waitStart = SystemClock.elapsedRealtime()
        synchronized(lock) {
          while (receivedJson == null &&
              SystemClock.elapsedRealtime() - waitStart < 5_000L) {
            lock.wait(250)
          }
        }

        val raw = receivedJson
        if (raw.isNullOrBlank()) {
          throw IllegalStateException(
            "TikTok page loaded but no post data was present. Try again.",
          )
        }

        // Navigate JSON: __DEFAULT_SCOPE__ -> webapp.video-detail -> itemInfo.itemStruct
        val root = JSONObject(raw)
        val scope = root.optJSONObject("__DEFAULT_SCOPE__") ?: JSONObject()
        val detail = scope.optJSONObject("webapp.video-detail") ?: JSONObject()
        val statusCode = detail.optInt("statusCode", -1)
        if (statusCode != 0) {
          throw IllegalStateException(
            "TikTok returned status $statusCode for this post (private, removed, or blocked).",
          )
        }
        val item = detail.optJSONObject("itemInfo")
          ?.optJSONObject("itemStruct") ?: JSONObject()
        val video = item.optJSONObject("video") ?: JSONObject()
        val playAddr = video.optString("playAddr", "")
          .ifBlank { video.optString("downloadAddr", "") }

        if (playAddr.isBlank()) {
          throw IllegalStateException("This post has no downloadable video.")
        }

        val map = Arguments.createMap()
        map.putString("videoUrl", playAddr)
        map.putString("caption", item.optString("desc", ""))
        map.putString("author", item.optJSONObject("author")?.optString("uniqueId", "") ?: "")
        map.putDouble("durationSeconds", video.optDouble("duration", 0.0))
        map.putString("videoId", item.optString("id", ""))
        promise.resolve(map)
      } catch (e: Exception) {
        val message =
          if (timedOut) "Page took too long to load. Try again."
          else e.message ?: "WebView extraction failed."
        promise.reject("WEBVIEW_EXTRACT_FAILED", message, e)
      } finally {
        webView.destroy()
      }
    }.start()
  }
}
