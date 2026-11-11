package com.drywatch

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Invisible trampoline for TikTok's share sheet. Receives ACTION_SEND,
 * hands the URL to the share pipeline (native pending queue -> JS), and
 * finishes immediately so the user lands back in TikTok. The processing
 * notification carries all feedback from here.
 */
class ShareActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val text = intent?.getStringExtra(Intent.EXTRA_TEXT)
    if (!text.isNullOrBlank()) {
      // Store for the JS bootstrap (same queue the warm path polls) and
      // bring MainActivity's JS context up in the background to run it.
      ShareIntentModule.enqueueShare(text.trim())
      val launch = Intent(this, MainActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        // Do not bring a visible UI forward: we finish before it draws.
        addFlags(Intent.FLAG_ACTIVITY_NO_USER_ACTION)
      }
      startActivity(launch)
    }
    finish()
  }
}
