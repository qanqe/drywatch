package com.drywatch

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Invisible trampoline for TikTok's share sheet. Receives ACTION_SEND and
 * starts the headless pipeline service directly - it never starts
 * MainActivity, so TikTok stays in the foreground the whole time. All
 * feedback comes from ProcessingService's notification and, on completion,
 * the done notification + overlay card.
 */
class ShareActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val text = intent?.getStringExtra(Intent.EXTRA_TEXT)
    if (!text.isNullOrBlank()) {
      ShareHeadlessService.start(this, text.trim())
    }
    finish()
  }
}
