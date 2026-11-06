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
class WebViewExtractModule(private val reactContext: ReactApplicationContext) :
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
    android.util.Log.i("DryWatchWebView", "extractPostData called for: $postUrl")
    Thread {
      var timedOut = false
      var extractError: String? = null
      var raw: String? = null
      var webView: WebView? = null
      var attachedRoot: android.view.ViewGroup? = null
      val pageFinished = arrayOf(false)

      try {
        // WebView creation and configuration must run on the main thread.
        // The wait loop below runs on THIS background thread - keeping it on
        // the main thread starves the looper so WebView callbacks never fire
        // (verified: zero navigation callbacks while the loop slept).

        mainHandler.post {
          try {
            android.util.Log.i("DryWatchWebView", "creating WebView on main thread")
            webView = WebView(reactContext)
            android.util.Log.i("DryWatchWebView", "WebView created, attaching hidden")
            val wv = webView!!
            wv.settings.javaScriptEnabled = true
            wv.settings.domStorageEnabled = true
            wv.isVerticalScrollBarEnabled = false
            wv.visibility = android.view.View.INVISIBLE

            // Attach so Chromium considers the view live; 1x1 at (-10,-10)
            // keeps it effectively invisible to the user.
            val activity = getCurrentActivity()
            if (activity != null) {
              val root = activity.findViewById(android.R.id.content) as? android.view.ViewGroup
              if (root != null) {
                wv.layoutParams = android.view.ViewGroup.LayoutParams(1, 1)
                wv.x = -10f
                wv.y = -10f
                root.addView(wv, 0)
                attachedRoot = root
                android.util.Log.i("DryWatchWebView", "WebView attached to activity root as 1x1")
              }
            }

            CookieManager.getInstance().setAcceptCookie(true)

            val receiver = ExtractResultReceiver()
            wv.addJavascriptInterface(receiver, "DryWatchExtract")

            wv.webViewClient = object : WebViewClient() {
              override fun onPageFinished(view: WebView, url: String) {
                android.util.Log.i("DryWatchWebView", "onPageFinished: $url")
                synchronized(pageFinished) { pageFinished[0] = true }
              }

              override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                android.util.Log.i("DryWatchWebView", "navigated to: $url")
              }
            }

            wv.loadUrl(postUrl, mapOf(
              "Accept-Language" to "en-US,en;q=0.9",
            ))
            android.util.Log.i("DryWatchWebView", "loadUrl issued, releasing main thread")

            // IMPORTANT: this mainHandler.post block ENDS here. Everything
            // below runs on the background thread. A previous version kept
            // the wait loop inside this block, which blocked the main looper
            // so onPageFinished/doUpdateVisitedHistory could never fire
            // (verified: zero navigation callbacks while the loop slept).
          } catch (e: Exception) {
            val wv = webView
            val root = attachedRoot
            if (wv != null) {
              mainHandler.post {
                try {
                  root?.removeView(wv)
                } catch (_: Exception) {}
                wv.destroy()
              }
            }
            promise.reject("WEBVIEW_EXTRACT_FAILED", e.message ?: "WebView setup failed.", e)
          }
        }

        // Background thread: wait for the page. WebView callbacks fire on
        // the main looper, which is now free to deliver them.
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
        // evaluateJavascript must run on the main thread; deliver its result
        // through the same receiver the JS bridge calls into.
        mainHandler.post {
          webView?.evaluateJavascript(
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
        }

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
