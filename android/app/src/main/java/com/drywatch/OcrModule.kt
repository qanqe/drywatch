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
    // Dense sampling: creator subtitles burn one phrase per frame, so 8
    // sync-frame snapshots missed most of them. ~2 fps catches phrase-level
    // text; the cap keeps long videos from stalling the pipeline
    // (300 frames ~= 20-40 s of OCR on a mid-range phone).
    private const val SAMPLES_PER_SECOND = 2
    private const val MAX_FRAMES = 300
    private const val MIN_TEXT_LENGTH = 3
    private const val MAX_LINES = 200
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

        val targetFrames = (duration / 1000L * SAMPLES_PER_SECOND).toInt()
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
                if (text.length >= MIN_TEXT_LENGTH) {
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

        // Collapse near-duplicate lines across frames: persistent overlays
        // (usernames, watermarks appearing in most samples) lose their
        // timestamp; text seen in only a few frames gets its first-seen time.
        val appearanceCounts = HashMap<String, Int>()
        val firstSeen = HashMap<String, Long>()
        for ((timestamp, lines) in frames) {
          for (line in lines) {
            appearanceCounts[line] = (appearanceCounts[line] ?: 0) + 1
            firstSeen.putIfAbsent(line, timestamp)
          }
        }
        val persistentThreshold = frames.size / 2

        val textLines: WritableArray = Arguments.createArray()
        firstSeen.entries
          .sortedBy { it.value }
          .take(MAX_LINES)
          .forEach { (line, timestamp) ->
            val isPersistent = (appearanceCounts[line] ?: 0) > persistentThreshold
            val rendered = if (isPersistent) line else "[${formatSeconds(timestamp)}] $line"
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

  private fun formatSeconds(seconds: Long): String {
    val total = seconds.toInt()
    val minutes = total / 60
    val rest = total % 60
    return "%d:%02d".format(minutes, rest)
  }
}
