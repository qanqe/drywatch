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
import java.util.concurrent.atomic.AtomicBoolean

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

    /**
     * TikTok signs media CDN URLs against the tt_chain_token cookie handed out
     * to the request that minted them; a replay without it gets HTTP 403 even
     * with the correct Referer. Cronet's cookie jar is not reachable through
     * the bundled cronet-api surface, so the value is scraped from the
     * extraction response and replayed on the download request.
     */
    @Volatile private var chainToken: String? = null

    private fun captureChainToken(info: UrlResponseInfo) {
      val headers = info.allHeaders
      for (name in headers.keys) {
        if (!name.equals("set-cookie", ignoreCase = true)) continue
        for (value in headers[name] ?: emptyList()) {
          val match = Regex("(?:^|;\\s*)tt_chain_token=([^;]+)").find(value) ?: continue
          val token = match.groupValues[1]
          if (token.isNotEmpty()) {
            chainToken = token
            val preview = token.take(12)
            Log.i(TAG, "captured tt_chain_token len=${token.length} prefix=$preview")
          }
        }
      }
    }

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
     * TikTok serves this page in at least three shapes depending on client
     * fingerprint: a plain <script id="api-data"> tag, and a rehydration blob
     * whose video detail sits under either webapp.video-detail or
     * webapp.reflow.video.detail. Key names move between variants, so after
     * trying the known shapes we fall back to walking the whole payload for
     * any object carrying a playAddr. Any object with that field is the
     * video; the item is whichever ancestor also has id/desc/author.
     */
    fun parseUniversalData(html: String): com.facebook.react.bridge.WritableMap? {
      // Diagnostic: which payload shapes does this device's response contain?
      val needles = listOf("api-data", "playAddr", "downloadAddr", "itemStruct",
        "webapp.video-detail", "webapp.reflow.video.detail", "video/mp4", ".mp4\"")
      Log.i(TAG, "diag: needles=" + needles.joinToString(", ") {
        "$it=${html.split(it).size - 1}"
      })
      extractFromApiData(html)?.let { return it }
      extractFromRehydration(html)?.let { return it }
      return extractByDeepSearch(html)
    }

    private fun buildResult(item: org.json.JSONObject, video: org.json.JSONObject):
      com.facebook.react.bridge.WritableMap? {
      val playAddr = video.optString("playAddr", "")
        .ifBlank { video.optString("downloadAddr", "") }
      if (playAddr.isBlank()) {
        Log.i(TAG, "parse: video has no playAddr/downloadAddr, keys=${video.keys().asSequence().toList()}")
        return null
      }
      val map = Arguments.createMap()
      map.putString("videoUrl", playAddr)
      map.putString("caption", item.optString("desc", ""))
      map.putString("author", item.optJSONObject("author")?.optString("uniqueId", "") ?: "")
      map.putDouble("durationSeconds", video.optDouble("duration", 0.0))
      map.putString("videoId", item.optString("id", ""))

      // Creator-added text overlays (stickerText arrays on the item).
      val stickers = Arguments.createArray()
      val stickerContainers = item.optJSONArray("stickersOnItem")
      if (stickerContainers != null) {
        for (i in 0 until stickerContainers.length()) {
          val texts = stickerContainers.optJSONObject(i)?.optJSONArray("stickerText") ?: continue
          for (j in 0 until texts.length()) {
            val entry = texts.optString(j, "").trim()
            if (entry.isNotEmpty()) stickers.pushString(entry)
          }
        }
      }
      map.putArray("stickers", stickers)

      // Language-tagged subtitle track descriptors; JS decides which to fetch.
      val subtitles = Arguments.createArray()
      val subtitleInfos = video.optJSONArray("subtitleInfos")
      if (subtitleInfos != null) {
        for (i in 0 until subtitleInfos.length()) {
          val sub = subtitleInfos.optJSONObject(i) ?: continue
          val url = sub.optString("url", "").ifBlank { sub.optString("Url", "") }
          if (url.isBlank()) continue
          val info = Arguments.createMap()
          info.putString("languageID", sub.optString("LanguageID", ""))
          info.putString("url", url)
          info.putString("format", sub.optString("Format", ""))
          subtitles.pushMap(info)
        }
      }
      map.putArray("subtitleInfos", subtitles)

      // Sound: title, author, and whether it is the creator's own upload or
      // a licensed TikTok sound.
      val music = item.optJSONObject("music")
      if (music != null) {
        val sound = Arguments.createMap()
        sound.putString("title", music.optString("title", ""))
        sound.putString("authorName", music.optString("authorName", ""))
        sound.putBoolean("isOriginal", music.optBoolean("original", false))
        map.putMap("sound", sound)
      }
      return map
    }

    /** Reflow layout: <script id="api-data"> holding {videoDetail:{...}}. */
    private fun extractFromApiData(html: String):
      com.facebook.react.bridge.WritableMap? {
      val regex = Regex(
        "<script id=\"api-data\"[^>]*>(.*?)</script>",
        RegexOption.DOT_MATCHES_ALL,
      )
      val raw = regex.find(html)?.groupValues?.get(1) ?: return null
      Log.i(TAG, "parse: api-data found, length=${raw.length}")

      val root = org.json.JSONObject(raw)
      val detail = root.optJSONObject("videoDetail") ?: run {
        Log.i(TAG, "parse: api-data has no videoDetail, keys=${root.keys().asSequence().toList()}")
        return null
      }
      val statusCode = detail.optInt("statusCode", -1)
      if (statusCode != 0) {
        Log.i(TAG, "parse: api-data statusCode=$statusCode (blocked/private/removed)")
        return null
      }
      val item = detail.optJSONObject("itemInfo")?.optJSONObject("itemStruct") ?: run {
        Log.i(TAG, "parse: api-data has no itemInfo.itemStruct, keys=${detail.keys().asSequence().toList()}")
        return null
      }
      val video = item.optJSONObject("video") ?: run {
        Log.i(TAG, "parse: api-data item has no video, keys=${item.keys().asSequence().toList()}")
        return null
      }
      return buildResult(item, video)
    }

    /**
     * Last resort: walk every JSON object in the payload looking for one that
     * carries a playAddr. TikTok renames the containing keys between variants,
     * so this finds the video regardless of where it is nested.
     */
    private fun extractByDeepSearch(html: String):
      com.facebook.react.bridge.WritableMap? {
      val regex = Regex(
        "<script id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\"[^>]*>(.*?)</script>",
        RegexOption.DOT_MATCHES_ALL,
      )
      val raw = regex.find(html)?.groupValues?.get(1) ?: run {
        Log.i(TAG, "deep: no rehydration payload at all")
        return null
      }
      val found = findVideoObject(org.json.JSONObject(raw), 0)
      if (found == null) {
        Log.i(TAG, "deep: no object with playAddr anywhere in payload")
        return null
      }
      Log.i(TAG, "deep: found video at depth ${found.depth}, path=${found.path}")
      val item = found.item ?: run {
        Log.i(TAG, "deep: video found but no enclosing item with id/desc")
        return null
      }
      return buildResult(item, found.video)
    }

    private class VideoHit(
      val video: org.json.JSONObject,
      val item: org.json.JSONObject?,
      val depth: Int,
      val path: String,
    )

    /** Depth-first walk returning the first object with a usable playAddr. */
    private fun findVideoObject(node: Any?, depth: Int, path: String = ""): VideoHit? {
      if (depth > 12) return null
      when (node) {
        is org.json.JSONObject -> {
          val hasAddr = node.optString("playAddr", "").isNotBlank() ||
            node.optString("downloadAddr", "").isNotBlank()
          if (hasAddr && node.has("duration")) {
            return VideoHit(node, null, depth, path)
          }
          val keys = node.keys()
          while (keys.hasNext()) {
            val key = keys.next()
            val child = node.opt(key)
            val childPath = if (path.isEmpty()) key else "$path.$key"
            val hit = findVideoObject(child, depth + 1, childPath)
            if (hit != null) {
              // Record the nearest ancestor that looks like the item so the
              // caller can read desc/author/id from it.
              val item = if (hit.item == null && looksLikeItem(node)) node else hit.item
              return VideoHit(hit.video, item, hit.depth, hit.path)
            }
          }
        }
        is org.json.JSONArray -> {
          for (i in 0 until minOf(node.length(), 200)) {
            val hit = findVideoObject(node.opt(i), depth + 1, "$path[$i]")
            if (hit != null) return hit
          }
        }
      }
      return null
    }

    private fun looksLikeItem(node: org.json.JSONObject): Boolean =
      node.has("id") && (node.has("desc") || node.has("author"))

    /** Logcat truncates long lines, so emit in 3000-char slices. */
    private fun dumpChunked(label: String, text: String) {
      val size = 3000
      var i = 0
      while (i < text.length) {
        val end = minOf(i + size, text.length)
        Log.i(TAG, "diag:$label[${i / size}] ${text.substring(i, end)}")
        i = end
      }
    }

    /** Older layout: __UNIVERSAL_DATA_FOR_REHYDRATION__ -> __DEFAULT_SCOPE__. */
    private fun extractFromRehydration(html: String):
      com.facebook.react.bridge.WritableMap? {
      val regex = Regex(
        "<script id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\"[^>]*>(.*?)</script>",
        RegexOption.DOT_MATCHES_ALL,
      )
      val raw = regex.find(html)?.groupValues?.get(1) ?: run {
        Log.i(TAG, "parse: neither api-data nor rehydration script matched")
        return null
      }
      Log.i(TAG, "parse: rehydration json length=${raw.length}")

      val root = org.json.JSONObject(raw)
      val scope = root.optJSONObject("__DEFAULT_SCOPE__") ?: run {
        Log.i(TAG, "parse: no __DEFAULT_SCOPE__, root keys=${root.keys().asSequence().toList()}")
        return null
      }
      // Diagnostic: the device gets a lighter reflow page than desktop. Dump
      // the video-carrying keys in chunks so the real shape can be
      // reconstructed offline instead of probing one key per build.
      scope.optJSONObject("webapp.reflow.video.detail")?.let { rd ->
        Log.i(TAG, "diag: reflow.video.detail keys=${rd.keys().asSequence().toList()}")
        dumpChunked("reflow.video.detail", rd.toString())
      }
      // The signature scope carries the token needed to call TikTok's item
      // detail API, which is likely how the video URL is fetched on mobile.
      scope.optJSONObject("webapp.reflow.global.signature")?.let { sg ->
        Log.i(TAG, "diag: signature keys=${sg.keys().asSequence().toList()}")
        dumpChunked("signature", sg.toString())
      }
      val detail = (scope.optJSONObject("webapp.video-detail")
        ?: scope.optJSONObject("webapp.reflow.video.detail")) ?: run {
        Log.i(TAG, "parse: no video detail, scope keys=${scope.keys().asSequence().toList()}")
        return null
      }
      val statusCode = detail.optInt("statusCode", -1)
      if (statusCode != 0) {
        Log.i(TAG, "parse: rehydration statusCode=$statusCode (blocked/private/removed)")
        return null
      }
      val item = detail.optJSONObject("itemInfo")?.optJSONObject("itemStruct") ?: run {
        Log.i(TAG, "parse: rehydration has no itemInfo.itemStruct, keys=${detail.keys().asSequence().toList()}")
        return null
      }
      val video = item.optJSONObject("video") ?: run {
        Log.i(TAG, "parse: rehydration item has no video, keys=${item.keys().asSequence().toList()}")
        return null
      }
      return buildResult(item, video)
    }
  }

  override fun getName() = NAME

  /**
   * Fetch one URL to completion, returning the body. Errors surface as
   * exceptions so the caller can decide whether to abort or retry.
   */
  private fun fetch(url: String, cronet: CronetEngine): String {
    val body = ByteArrayOutputStream()
    val latch = java.util.concurrent.CountDownLatch(1)
    var failure: Exception? = null

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
        captureChainToken(info)
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
        latch.countDown()
      }

      override fun onFailed(
        request: UrlRequest,
        info: UrlResponseInfo?,
        error: CronetException,
      ) {
        Log.e(TAG, "FAILED: ${error.message}")
        failure = error
        latch.countDown()
      }

      override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
        failure = IllegalStateException("Request canceled.")
        latch.countDown()
      }
    }

    cronet.newUrlRequestBuilder(url, callback, executor!!)
      .addHeader("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
      .addHeader("Accept-Language", "en-US,en;q=0.9")
      .addHeader("Upgrade-Insecure-Requests", "1")
      .build()
      .start()

    latch.await(60, java.util.concurrent.TimeUnit.SECONDS)
    failure?.let { throw it }
    return body.toString("UTF-8")
  }

  /**
   * Download a CDN file into [destPath] using this module's Cronet engine.
   *
   * TikTok signs media URLs against the tt_chain_token cookie that the
   * extraction request received, so the bytes must be fetched by the same
   * engine/session that produced the URL. A plain HTTP client (RNFS/OkHttp)
   * has no such cookie and gets 403; the Referer header is also required.
   */
  @ReactMethod
  fun downloadToFile(url: String, destPath: String, promise: Promise) {
    Thread {
      var lastError: Exception? = null
      // Mid-transfer connection drops (ERR_CONNECTION_ABORTED) are the dominant
      // failure mode on flaky networks; retry the whole download with backoff.
      for (attempt in 1..3) {
        try {
        val cronet = getEngine(reactContext)
        val target = java.io.File(destPath)
        target.parentFile?.mkdirs()
        val out = java.io.FileOutputStream(target)
        val get = AtomicBoolean(false)
        val latch = java.util.concurrent.CountDownLatch(1)
        var failure: Exception? = null

        val callback = object : UrlRequest.Callback() {
          override fun onRedirectReceived(
            request: UrlRequest,
            info: UrlResponseInfo,
            newLocationUrl: String,
          ) = request.followRedirect()

          override fun onResponseStarted(request: UrlRequest, info: UrlResponseInfo) {
            if (info.httpStatusCode != 200) {
              failure = IllegalStateException("CDN returned HTTP ${info.httpStatusCode}.")
              latch.countDown()
              return
            }
            get.set(true)
            request.read(ByteBuffer.allocateDirect(256 * 1024))
          }

          override fun onReadCompleted(
            request: UrlRequest,
            info: UrlResponseInfo,
            byteBuffer: ByteBuffer,
          ) {
            byteBuffer.flip()
            val chunk = ByteArray(byteBuffer.remaining())
            byteBuffer.get(chunk)
            out.write(chunk)
            byteBuffer.clear()
            request.read(byteBuffer)
          }

          override fun onSucceeded(request: UrlRequest, info: UrlResponseInfo) {
            latch.countDown()
          }

          override fun onFailed(
            request: UrlRequest,
            info: UrlResponseInfo?,
            error: CronetException,
          ) {
            failure = error
            latch.countDown()
          }

          override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
            failure = IllegalStateException("Download canceled.")
            latch.countDown()
          }
        }

        val builder = cronet.newUrlRequestBuilder(url, callback, executor!!)
          .addHeader("Referer", "https://www.tiktok.com/")
          .addHeader("Accept", "*/*")
          .addHeader("Accept-Language", "en-US,en;q=0.9")
        chainToken?.let { builder.addHeader("Cookie", "tt_chain_token=$it") }
        builder.build().start()

        Log.i(
          TAG,
          "download start chainToken=" +
            (chainToken?.let { "len=${it.length}" } ?: "MISSING"),
        )

        latch.await(300, java.util.concurrent.TimeUnit.SECONDS)
        out.flush()
        out.close()

        if (failure != null || !get.get()) {
          target.delete()
          throw failure ?: IllegalStateException("Download did not start.")
        }

        val size = target.length()
        Log.i(TAG, "download done bytes=$size -> $destPath")
        val result = Arguments.createMap()
        result.putString("videoPath", destPath)
        result.putDouble("sizeBytes", size.toDouble())
        promise.resolve(result)
        return@Thread
      } catch (e: Exception) {
        lastError = e
        Log.i(TAG, "download attempt $attempt/3 failed: ${e.message}")
        if (attempt < 3) {
          Thread.sleep(if (attempt == 1) 1000L else 3000L)
        }
      }
      }
      promise.reject(
        "CRONET_DOWNLOAD_FAILED",
        lastError?.message ?: "Download failed.",
        lastError,
      )
    }.start()
  }

  @ReactMethod
  fun extractPostData(postUrl: String, promise: Promise) {
    Thread {
      try {
        val cronet = getEngine(reactContext)

        // A cold session gets statusCode=10204 (empty detail) even though the
        // HTTP fetch succeeds. Visiting the homepage first sets the cookies
        // TikTok expects and the same post URL then returns statusCode=0.
        // Verified against TikTok: cold 0/1 success, warmed 8/8.
        try {
          val home = fetch("https://www.tiktok.com/", cronet)
          Log.i(TAG, "warmup bytes=${home.length}")
        } catch (e: Exception) {
          Log.i(TAG, "warmup failed (continuing): ${e.message}")
        }

        // The block/connection is intermittent (observed 10204 then 0 on
        // consecutive fetches for the same link), so retry once on failure
        // before handing over to the WebView fallback.
        var extracted: com.facebook.react.bridge.WritableMap? = null
        var lastError: String? = null
        for (attempt in 1..2) {
          try {
            val html = fetch(postUrl, cronet)
            Log.i(TAG, "DONE(attempt=$attempt) bytes=${html.length} hasMarker=${html.contains(MARKER)}")
            val hasApiData = html.contains("id=\"api-data\"")
            if (!hasApiData && !html.contains(MARKER)) {
              lastError = "Page returned without post data (challenge or block page)."
              continue
            }
            extracted = parseUniversalData(html)
            if (extracted != null) break
            lastError = "Rehydration JSON present but video detail missing (reflow or blocked)."
          } catch (e: Exception) {
            lastError = e.message
            Log.i(TAG, "attempt $attempt failed: ${e.message}")
          }
        }
        if (extracted == null) {
          promise.reject("CRONET_EXTRACT_FAILED", lastError ?: "Extraction failed.")
          return@Thread
        }
        promise.resolve(extracted)
      } catch (e: Exception) {
        promise.reject("CRONET_EXTRACT_FAILED", e.message, e)
      }
    }.start()
  }
}