package com.drywatch

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Small centered card shown over whatever app the user is in (TikTok) when a
 * share-initiated background run finishes. Not fullscreen: dimmed edges, the
 * card occupies the middle ~70% width. Tapping anywhere dismisses it.
 */
class DoneOverlayActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
    // Appear over the lockscreen-adjacent state too; do not force fullscreen.
    window.setFlags(
      WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
    )

    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "DryWatch"

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.TRANSPARENT)
      setOnClickListener { finish() }
    }

    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(52, 44, 52, 44)
      setBackgroundColor(0xFF242A28.toInt()) // colors.card, dark palette
      // Rounded corners via background drawable would need XML; keep the card
      // flat-edged to match the app's hairline aesthetic.
    }

    val heading = TextView(this).apply {
      text = "Note ready"
      setTextColor(0xFFEAF2EF.toInt())
      textSize = 19f
      letterSpacing = -0.02f
    }

    val body = TextView(this).apply {
      text = "$title\n\nOpen DryWatch to review and share the note."
      setTextColor(0xFF9BB0A9.toInt())
      textSize = 14f
      setLineSpacing(0f, 1.25f)
      setPadding(0, 18, 0, 0)
    }

    val action = TextView(this).apply {
      text = "Tap anywhere to dismiss"
      setTextColor(0xFF71716F.toInt())
      textSize = 11f
      setPadding(0, 30, 0, 0)
    }

    card.addView(heading)
    card.addView(body)
    card.addView(action)
    root.addView(card)

    setContentView(
      root,
      WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_APPLICATION,
        WindowManager.LayoutParams.FLAG_DIM_BEHIND or
          WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
        android.graphics.PixelFormat.TRANSLUCENT,
      ),
    )
    window.attributes.dimAmount = 0.45f
    window.setGravity(Gravity.CENTER)

    // Window inset for a centered card: constrain the card width.
    card.layoutParams = LinearLayout.LayoutParams(
      (resources.displayMetrics.widthPixels * 0.78f).toInt(),
      WindowManager.LayoutParams.WRAP_CONTENT,
    ).also { it.gravity = Gravity.CENTER }

    card.setOnClickListener { finish() }
    root.setOnClickListener { finish() }
  }

  companion object {
    const val EXTRA_TITLE = "title"

    fun show(context: android.content.Context, title: String) {
      val intent = Intent(context, DoneOverlayActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        putExtra(EXTRA_TITLE, title)
      }
      context.startActivity(intent)
    }
  }
}
