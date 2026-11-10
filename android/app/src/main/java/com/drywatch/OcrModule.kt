package com.drywatch

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.TreeMap

@ReactModule(name = OcrModule.NAME)
class OcrModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "DryWatchOcr"
    // Speech content comes from Whisper + TikTok subtitles, so OCR only
    // needs enough frames to catch creator-made burned text, not full
    // coverage. ~0.5 fps catches overlays that persist 2+ seconds.
    private const val SAMPLE_INTERVAL_DIVISOR = 2
    private const val MAX_FRAMES = 60
    private const val MIN_TEXT_LENGTH = 3
    private const val MIN_WORDS = 2
    private const val MAX_LINES = 40
    // Lines whose normalized similarity exceeds this are the same text.
    private const val SIMILARITY_THRESHOLD = 0.75
  }

  override fun getName() = NAME

  @ReactMethod
  fun extractOnScreenText(uri: String, durationMs: Double, promise: Promise) {
    Thread {
      val retriever = MediaMetadataRetriever()
      try {
        try {
          retriever.setDataSource(reactContext, android.net.Uri.parse(uri))
        } catch (e: Exception) {
          retriever.setDataSource(uri)
        }

        val duration = if (durationMs > 0) durationMs.toLong() else 10_000L
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        // Timestamp -> text lines (TreeMap keeps chronological order).
        val frames = TreeMap<Long, MutableSet<String>>()

        val targetFrames = (duration / 1000L / SAMPLE_INTERVAL_DIVISOR).toInt()
        val sampleCount = minOf(MAX_FRAMES, maxOf(1, targetFrames))
        val stepUs = duration * 1000L / sampleCount
        for (index in 0 until sampleCount) {
          // OPTION_CLOSEST decodes the exact requested frame; CLOSEST_SYNC
          // jumps to keyframes and skips past subtitle frames.
          val offsetUs = stepUs * index + stepUs / 2
          val bitmap: Bitmap = retriever.getFrameAtTime(
            offsetUs,
            MediaMetadataRetriever.OPTION_CLOSEST,
          ) ?: continue

          val timestampSeconds = offsetUs / 1_000_000L
          val lines = frames.getOrPut(timestampSeconds) { mutableSetOf() }

          try {
            val image = InputImage.fromBitmap(bitmap, 0)
            val result = com.google.android.gms.tasks.Tasks.await(
              recognizer.process(image),
              15,
              java.util.concurrent.TimeUnit.SECONDS,
            )
            for (block in result.textBlocks) {
              for (line in block.lines) {
                val text = line.text.trim()
                // Single-word reads are almost always partial captures of
                // animated text or noise (HHIN, miğht); real overlays are
                // phrases.
                if (text.length >= MIN_TEXT_LENGTH &&
                  text.split(Regex("\\s+")).size >= MIN_WORDS
                ) {
                  lines.add(text)
                }
              }
            }
          } finally {
            bitmap.recycle()
          }
        }

        recognizer.close()

        if (frames.isEmpty()) {
          val map: WritableMap = Arguments.createMap()
          map.putString("status", "no_frames")
          promise.resolve(map)
          return@Thread
        }

        // Collapse near-duplicate lines across frames. ML Kit reads animated
        // burned-in text differently every frame ("pertormances" vs
        // "performances") AND splits the same overlay into different line
        // groups, so exact-match dedup leaks ~100 variants of one sentence.
        // Group by fuzzy word-set overlap; keep the longest read as the
        // representative (fullest capture of the overlay).
        data class LineRead(
          var text: String,
          var tokens: List<String>,
          var count: Int,
          var firstSeen: Long,
          var lastSeen: Long,
        )

        val groups = ArrayList<LineRead>()
        val normalizedCache = HashMap<String, String>()

        for ((timestamp, lines) in frames) {
          for (line in lines) {
            val normalized = normalizedCache.getOrPut(line) {
              normalizeForSimilarity(line)
            }
            val tokens = normalized.split(" ").filter { it.isNotBlank() }
            if (tokens.isEmpty()) continue
            var matched: LineRead? = null
            for (group in groups) {
              if (wordSetSimilarity(group.tokens, tokens) >= SIMILARITY_THRESHOLD) {
                matched = group
                break
              }
            }
            if (matched == null) {
              groups.add(LineRead(line, tokens, 1, timestamp, timestamp))
            } else {
              matched.count += 1
              matched.lastSeen = maxOf(matched.lastSeen, timestamp)
              if (tokens.size > matched.tokens.size) {
                matched.text = line
                matched.tokens = tokens
              }
            }
          }
        }

        // A line seen in more than half the samples is a persistent overlay
        // (username/watermark): no timestamp. Text spanning many frames gets
        // a first-last range; brief text gets its single timestamp.
        val persistentThreshold = frames.size / 2
        val textLines: WritableArray = Arguments.createArray()
        groups
          .sortedByDescending { it.count }
          .take(MAX_LINES)
          .forEach { group ->
            val text = group.text.trim()
            val rendered = when {
              group.count > persistentThreshold -> text
              group.count > 1 ->
                "[${formatSeconds(group.firstSeen)}-${formatSeconds(group.lastSeen)}] $text"
              else -> "[${formatSeconds(group.firstSeen)}] $text"
            }
            textLines.pushString(rendered)
          }

        val map: WritableMap = Arguments.createMap()
        map.putString("status", "ok")
        map.putArray("lines", textLines)
        promise.resolve(map)
      } catch (e: Exception) {
        promise.reject("OCR_FAILED", e.message, e)
      } finally {
        try {
          retriever.release()
        } catch (_: Exception) {}
      }
    }.start()
  }

  /** Lowercase, strip punctuation, collapse spacing: the comparison form. */
  private fun normalizeForSimilarity(text: String): String =
    text.lowercase().replace(Regex("[^\\p{L}\\p{Nd}\\s]"), "").replace(
      Regex("\\s+"),
      " ",
    ).trim()

  /**
   * Fuzzy token-set overlap: for each token in the smaller set, count it as
   * a hit if any token in the larger set is equal or within 1 edit. Tolerates
   * per-frame OCR jitter and line-split variation without dependencies.
   */
  private fun wordSetSimilarity(a: List<String>, b: List<String>): Double {
    val (small, large) = if (a.size <= b.size) a to b else b to a
    if (small.isEmpty()) return 0.0
    var hits = 0
    for (token in small) {
      val known = large.any { candidate ->
        candidate == token || levenshtein(candidate, token) <= 1
      }
      if (known) hits += 1
    }
    return hits.toDouble() / small.size
  }

  private fun levenshtein(a: String, b: String): Int {
    if (a == b) return 0
    if (a.isEmpty()) return b.length
    if (b.isEmpty()) return a.length
    var previous = IntArray(b.length + 1) { it }
    for (i in 1..a.length) {
      val current = IntArray(b.length + 1)
      current[0] = i
      for (j in 1..b.length) {
        val cost = if (a[i - 1] == b[j - 1]) 0 else 1
        current[j] = minOf(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + cost,
        )
      }
      previous = current
    }
    return previous[b.length]
  }

  private fun formatSeconds(seconds: Long): String {
    val total = seconds.toInt()
    val minutes = total / 60
    val rest = total % 60
    return "%d:%02d".format(minutes, rest)
  }
}
