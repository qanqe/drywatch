package com.drywatch

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
 * background share run finishes. Not fullscreen: dimmed edges, the card
 * occupies the middle ~78% width. "Copy" puts the context note on the
 * clipboard; "Later" dismisses it; tapping outside also dismisses.
 */
class DoneOverlayActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
    window.setFlags(
      WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
    )

    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "DryWatch"
    val documentText = intent?.getStringExtra(EXTRA_DOCUMENT) ?: ""

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.TRANSPARENT)
      setOnClickListener { finish() } // tap outside the card dismisses
    }

    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(52, 44, 52, 44)
      setBackgroundColor(0xFF242A28.toInt()) // colors.card, dark palette
    }

    val heading = TextView(this).apply {
      text = "Note ready"
      setTextColor(0xFFEAF2EF.toInt())
      textSize = 19f
      letterSpacing = -0.02f
    }

    val body = TextView(this).apply {
      text = title
      setTextColor(0xFF9BB0A9.toInt())
      textSize = 14f
      setLineSpacing(0f, 1.25f)
      setPadding(0, 18, 0, 0)
    }

    val actions = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      setPadding(0, 30, 0, 0)

      val copy = TextView(this).apply {
        text = "Copy"
        setTextColor(0xFFEAF2EF.toInt())
        textSize = 14f
        setPadding(20, 14, 20, 14)
        setBackgroundColor(0xFF404845.toInt())
        setOnClickListener {
          val clipboard =
            getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
          clipboard.setPrimaryClip(ClipData.newPlainText("drywatch note", documentText))
          finish()
        }
      }

      val later = TextView(this).apply {
        text = "Later"
        setTextColor(0xFF71716F.toInt())
        textSize = 14f
        setPadding(20, 14, 20, 14)
        setOnClickListener { finish() }
      }

      addView(copy)
      addView(TextView(this).apply { setWidth(16) }) // spacer
      addView(later)
    }

    card.addView(heading)
    card.addView(body)
    card.addView(actions)
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

    card.layoutParams = LinearLayout.LayoutParams(
      (resources.displayMetrics.widthPixels * 0.78f).toInt(),
      WindowManager.LayoutParams.WRAP_CONTENT,
    ).also { it.gravity = Gravity.CENTER }

    card.setOnClickListener { /* do not dismiss on card tap */ }
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_DOCUMENT = "document"

    fun show(context: Context, title: String, documentText: String? = null) {
      val intent = Intent(context, DoneOverlayActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_DOCUMENT, documentText ?: "")
      }
      context.startActivity(intent)
    }
  }
}
