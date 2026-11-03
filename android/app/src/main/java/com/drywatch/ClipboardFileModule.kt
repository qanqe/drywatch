package com.drywatch

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.File

@ReactModule(name = ClipboardFileModule.NAME)
class ClipboardFileModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "DryWatchClipboardFile"
    private const val SHARE_DIR = "context_notes"
  }

  override fun getName() = NAME

  private fun notesDir(): File {
    val base = reactContext.getExternalFilesDir(null)
        ?: File(reactContext.filesDir, "external")
    val dir = File(base, SHARE_DIR)
    if (!dir.exists()) {
      dir.mkdirs()
    }
    return dir
  }

  private fun safeName(base: String): String =
      base.replace(Regex("[^A-Za-z0-9_-]"), "_").take(60)

  @ReactMethod
  fun copyToClipboard(text: String, promise: Promise) {
    try {
      val clipboard =
          reactContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      clipboard.setPrimaryClip(ClipData.newPlainText("DryWatch context", text))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("CLIPBOARD_FAILED", "Could not copy: ${e.message}", e)
    }
  }

  @ReactMethod
  fun saveTextFile(baseName: String, content: String, promise: Promise) {
    try {
      val dir = notesDir()
      val file = File(dir, safeName(baseName) + ".md")
      file.writeText(content)
      promise.resolve(file.absolutePath)
    } catch (e: Exception) {
      promise.reject("SAVE_FAILED", "Could not save: ${e.message}", e)
    }
  }

  @ReactMethod
  fun shareTextFile(baseName: String, content: String, promise: Promise) {
    try {
      val dir = notesDir()
      val file = File(dir, safeName(baseName) + ".md")
      file.writeText(content)

      val uri: Uri = FileProvider.getUriForFile(
          reactContext, "${reactContext.packageName}.fileprovider", file)

      val sendIntent = Intent(android.content.Intent.ACTION_SEND).apply {
        type = "text/markdown"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, file.name)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = android.content.Intent.createChooser(sendIntent, "Share context note")
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(chooser)
      promise.resolve(file.absolutePath)
    } catch (e: Exception) {
      promise.reject("SHARE_FAILED", "Could not share: ${e.message}", e)
    }
  }
}
