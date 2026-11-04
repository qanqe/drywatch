package com.drywatch

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.SystemClock
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.BufferedOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max

@ReactModule(name = AudioExtractorModule.NAME)
class AudioExtractorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "DryWatchAudioExtractor"
    private const val TARGET_SAMPLE_RATE = 16000
    private const val TARGET_CHANNELS = 1
  }

  override fun getName() = NAME

  @ReactMethod
  fun extractToWav(uri: String, promise: Promise) {
    Thread {
      var extractor: MediaExtractor? = null
      var decoder: MediaCodec? = null
      var output: BufferedOutputStream? = null
      try {
        extractor = MediaExtractor()
        extractor.setDataSource(reactApplicationContext, android.net.Uri.parse(uri), null)

        var audioTrack = -1
        var audioFormat: MediaFormat? = null
        for (index in 0 until extractor.trackCount) {
          val format = extractor.getTrackFormat(index)
          val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
          if (mime.startsWith("audio/")) {
            audioTrack = index
            audioFormat = format
            break
          }
        }
        if (audioTrack < 0 || audioFormat == null) {
          throw IllegalArgumentException("Video has no audio track")
        }

        extractor.selectTrack(audioTrack)
        val mime = audioFormat.getString(MediaFormat.KEY_MIME)
          ?: throw IllegalArgumentException("Audio MIME type is unavailable")
        decoder = MediaCodec.createDecoderByType(mime)
        decoder.configure(audioFormat, null, null, 0)
        decoder.start()

        val outputFile = File(
          reactApplicationContext.cacheDir,
          "drywatch-audio-${SystemClock.elapsedRealtime()}.wav",
        )
        output = BufferedOutputStream(outputFile.outputStream())
        writeWavHeader(output, 0)

        val bufferInfo = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        var pcmBytes = 0L

        while (!outputDone) {
          if (!inputDone) {
            val inputIndex = decoder.dequeueInputBuffer(10000)
            if (inputIndex >= 0) {
              val inputBuffer = decoder.getInputBuffer(inputIndex)
                ?: throw IllegalStateException("Decoder input buffer unavailable")
              val sampleSize = extractor.readSampleData(inputBuffer, 0)
              if (sampleSize < 0) {
                decoder.queueInputBuffer(
                  inputIndex,
                  0,
                  0,
                  0,
                  MediaCodec.BUFFER_FLAG_END_OF_STREAM,
                )
                inputDone = true
              } else {
                decoder.queueInputBuffer(
                  inputIndex,
                  0,
                  sampleSize,
                  extractor.sampleTime,
                  0,
                )
                extractor.advance()
              }
            }
          }

          val outputIndex = decoder.dequeueOutputBuffer(bufferInfo, 10000)
          when {
            outputIndex >= 0 -> {
              if (bufferInfo.size > 0) {
                val buffer = decoder.getOutputBuffer(outputIndex)
                  ?: throw IllegalStateException("Decoder output buffer unavailable")
                buffer.position(bufferInfo.offset)
                buffer.limit(bufferInfo.offset + bufferInfo.size)
                val bytes = copyPcm16Mono(buffer, audioFormat)
                output.write(bytes)
                pcmBytes += bytes.size
              }
              decoder.releaseOutputBuffer(outputIndex, false)
              if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                outputDone = true
              }
            }
            outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
              // Decoder output format is accepted; PCM conversion uses its source format.
            }
          }
        }

        output.flush()
        output.close()
        output = null
        writeWavHeader(outputFile, pcmBytes)
        promise.resolve(outputFile.absolutePath)
      } catch (error: Exception) {
        output?.close()
        promise.reject("AUDIO_EXTRACTION_FAILED", error.message, error)
      } finally {
        try {
          decoder?.stop()
        } catch (_: Exception) {}
        decoder?.release()
        extractor?.release()
      }
    }.start()
  }

  private fun copyPcm16Mono(buffer: ByteBuffer, format: MediaFormat): ByteArray {
    val sourceChannels = max(1, format.getInteger(MediaFormat.KEY_CHANNEL_COUNT, 1))
    val sourceRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE, TARGET_SAMPLE_RATE)
    val sourceBytes = ByteArray(buffer.remaining())
    buffer.get(sourceBytes)

    if (sourceChannels == TARGET_CHANNELS && sourceRate == TARGET_SAMPLE_RATE) {
      return sourceBytes
    }

    val sourceSamples = sourceBytes.size / 2 / sourceChannels
    val targetSamples = max(1, sourceSamples * TARGET_SAMPLE_RATE / sourceRate)
    val result = ByteArray(targetSamples * 2)
    val source = ByteBuffer.wrap(sourceBytes).order(ByteOrder.LITTLE_ENDIAN)
    val target = ByteBuffer.wrap(result).order(ByteOrder.LITTLE_ENDIAN)

    for (targetIndex in 0 until targetSamples) {
      val sourceIndex = minOf(sourceSamples - 1, targetIndex * sourceRate / TARGET_SAMPLE_RATE)
      var sum = 0
      for (channel in 0 until sourceChannels) {
        val position = (sourceIndex * sourceChannels + channel) * 2
        sum += source.getShort(position).toInt()
      }
      target.putShort((sum / sourceChannels).toShort())
    }
    return result
  }

  private fun writeWavHeader(output: BufferedOutputStream, dataBytes: Long) {
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray(Charsets.US_ASCII))
    header.putInt((36 + dataBytes).toInt())
    header.put("WAVE".toByteArray(Charsets.US_ASCII))
    header.put("fmt ".toByteArray(Charsets.US_ASCII))
    header.putInt(16)
    header.putShort(1)
    header.putShort(TARGET_CHANNELS.toShort())
    header.putInt(TARGET_SAMPLE_RATE)
    header.putInt(TARGET_SAMPLE_RATE * TARGET_CHANNELS * 2)
    header.putShort((TARGET_CHANNELS * 2).toShort())
    header.putShort(16)
    header.put("data".toByteArray(Charsets.US_ASCII))
    header.putInt(dataBytes.toInt())
    output.write(header.array())
  }

  private fun writeWavHeader(file: File, dataBytes: Long) {
    val randomAccess = java.io.RandomAccessFile(file, "rw")
    randomAccess.use {
      it.seek(0)
      val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
      header.put("RIFF".toByteArray(Charsets.US_ASCII))
      header.putInt((36 + dataBytes).toInt())
      header.put("WAVE".toByteArray(Charsets.US_ASCII))
      header.put("fmt ".toByteArray(Charsets.US_ASCII))
      header.putInt(16)
      header.putShort(1)
      header.putShort(TARGET_CHANNELS.toShort())
      header.putInt(TARGET_SAMPLE_RATE)
      header.putInt(TARGET_SAMPLE_RATE * TARGET_CHANNELS * 2)
      header.putShort((TARGET_CHANNELS * 2).toShort())
      header.putShort(16)
      header.put("data".toByteArray(Charsets.US_ASCII))
      header.putInt(dataBytes.toInt())
      it.write(header.array())
    }
  }
}
