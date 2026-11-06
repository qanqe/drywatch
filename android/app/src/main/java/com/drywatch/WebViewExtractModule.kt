package com.drywatch

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
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
 * WebView-based TikTok extraction (v0.0.5).
 *
 * Strategy: a hidden system WebView IS real Chromium, so TikTok sees a genuine
 * browser TLS fingerprint and its JS challenge solves itself. After the page
 * finishes loading we read __UNIVERSAL_DATA_FOR_REHYDRATION__ (the hydration
 * JSON that contains playAddr, caption, author) via evaluateJavascript, parse
 * it natively, and return the data to JS.
 *
 * Threading: WebView must be created and used on Android's main (UI) thread.
 * Creating it on a background thread crashes with NullPointerException inside
 * WebViewChromium (verified via logcat on a real device). All WebView calls
 * therefore run through a main-thread Handler; this method's thread just
 * waits on the result.
 */
@ReactModule(name = WebViewExtractModule.NAME)
class WebViewExtractModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "DryWatchWebViewExtract"
    private const val PAGE_TIMEOUT_MS = 25_000L
    private const val SETTLE_MS = 1_500L
    private const val JS_RESULT_TIMEOUT_MS = 5_000L
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
  private val mainHandler = Handler(Looper.getMainLooper())

  @SuppressLint("SetJavaScriptEnabled")
  @ReactMethod
  fun extractPostData(postUrl: String, promise: Promise) {
    Thread {
      var timedOut = false
      var extractError: String? = null
      var raw: String? = null

      try {
        // The whole WebView lifecycle must run on the main thread. Park a
        // signal object here and let the main-thread block fill it.
        val done = Object()
        var setupFailed: Exception? = null

        mainHandler.post {
          var webView: WebView? = null
          try {
            webView = WebView(reactContext)
            webView.settings.javaScriptEnabled = true
            webView.settings.domStorageEnabled = true
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

            // Wait for the page on THIS background thread; WebView itself was
            // only created and configured on the main thread.
            val startedAt = SystemClock.elapsedRealtime()
            while (SystemClock.elapsedRealtime() - startedAt < PAGE_TIMEOUT_MS) {
              synchronized(pageFinished) {
                if (pageFinished[0]) break
              }
              SystemClock.sleep(120)
            }
            if (!pageFinished[0]) {
              throw IllegalStateException("Page did not finish loading in time.")
            }

            SystemClock.sleep(SETTLE_MS)

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
                  SystemClock.elapsedRealtime() - waitStart < JS_RESULT_TIMEOUT_MS) {
                lock.wait(250)
              }
            }
            raw = receivedJson
            if (raw.isNullOrBlank()) {
              throw IllegalStateException(
                "TikTok page loaded but no post data was present. Try again.",
              )
            }
          } catch (e: Exception) {
            setupFailed = e
          } finally {
            val wv = webView
            if (wv != null) {
              mainHandler.post { wv.destroy() }
            }
            synchronized(done) { done.notifyAll() }
          }
        }

        synchronized(done) {
          while (raw == null && setupFailed == null) {
            done.wait(500)
          }
        }
        setupFailed?.let { throw it }
        if (raw == null) {
          throw IllegalStateException("Extraction ended without a result.")
        }
      } catch (e: Exception) {
        extractError = e.message ?: "WebView extraction failed."
      }

      // Back on the background thread: parse and resolve/reject.
      if (extractError != null) {
        promise.reject("WEBVIEW_EXTRACT_FAILED", extractError)
        return@Thread
      }

      try {
        val root = JSONObject(raw!!)
        val scope = root.optJSONObject("__DEFAULT_SCOPE__") ?: JSONObject()
        val detail = scope.optJSONObject("webapp.video-detail") ?: JSONObject()
        val statusCode = detail.optInt("statusCode", -1)
        if (statusCode != 0) {
          promise.reject(
            "WEBVIEW_EXTRACT_FAILED",
            "TikTok returned status $statusCode for this post (private, removed, or blocked).",
          )
          return@Thread
        }
        val item = detail.optJSONObject("itemInfo")
          ?.optJSONObject("itemStruct") ?: JSONObject()
        val video = item.optJSONObject("video") ?: JSONObject()
        val playAddr = video.optString("playAddr", "")
          .ifBlank { video.optString("downloadAddr", "") }

        if (playAddr.isBlank()) {
          promise.reject(
            "WEBVIEW_EXTRACT_FAILED",
            "This post has no downloadable video.",
          )
          return@Thread
        }

        val map = Arguments.createMap()
        map.putString("videoUrl", playAddr)
        map.putString("caption", item.optString("desc", ""))
        map.putString("author", item.optJSONObject("author")?.optString("uniqueId", "") ?: "")
        map.putDouble("durationSeconds", video.optDouble("duration", 0.0))
        map.putString("videoId", item.optString("id", ""))
        promise.resolve(map)
      } catch (e: Exception) {
        promise.reject("WEBVIEW_EXTRACT_FAILED", e.message, e)
      }
    }.start()
  }
}
