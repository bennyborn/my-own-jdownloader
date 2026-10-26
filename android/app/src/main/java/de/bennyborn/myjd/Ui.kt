package de.bennyborn.myjd

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

// Small helpers for the native screens (built in code, no layout files).
fun Context.dp(n: Int) = (n * resources.displayMetrics.density).toInt()

const val ACCENT = 0xFF10AC84.toInt()
const val MUTED = 0xFF8B949E.toInt()
const val ERROR = 0xFFD14343.toInt()
const val CARD = 0xFF161B22.toInt()
const val BORDER = 0xFF30363D.toInt()
const val BASE = 0xFF0D1117.toInt()

fun Context.rounded(fill: Int, stroke: Int = Color.TRANSPARENT, radius: Int = 8) = GradientDrawable().apply {
    setColor(fill)
    cornerRadius = dp(radius).toFloat()
    if (stroke != Color.TRANSPARENT) setStroke(dp(1), stroke)
}

fun Context.label(text: String, size: Float = 14f, color: Int = Color.WHITE) = TextView(this).apply {
    this.text = text
    textSize = size
    setTextColor(color)
}

fun Context.field(hint: String, value: String = "", password: Boolean = false) = EditText(this).apply {
    this.hint = hint
    setText(value)
    setSingleLine()
    setTextColor(Color.WHITE)
    setHintTextColor(0xFF6E7681.toInt())
    textSize = 15f
    background = rounded(BASE, BORDER)
    setPadding(dp(12), dp(12), dp(12), dp(12))
    inputType = if (password) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
    else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
}

fun Context.primaryButton(text: String) = Button(this).apply {
    this.text = text
    isAllCaps = false
    textSize = 15f
    setTextColor(Color.WHITE)
    stateListAnimator = null
    background = rounded(ACCENT, radius = 10)
    setPadding(dp(16), dp(12), dp(16), dp(12))
}

// Lets a full-screen background (the drifting glow) run behind the status and navigation bars; `content` keeps clear of them
// (and of the keyboard). Not for the screen with the web interface: its page handles the bars itself.
fun Activity.drawBehindBars(content: View) {
    window.setDecorFitsSystemWindows(false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    content.setOnApplyWindowInsetsListener { v, insets ->
        val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
        v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
        insets
    }
}

// The WebViews of the app: scripts on, no pinch-to-zoom, no stretching of the whole page at the end of a list (Android 12's overscroll
// effect), no scroll bar (it would run over the fixed bars of the page). The user agent without the "wv" marker: sites treat it like Chrome.
@SuppressLint("SetJavaScriptEnabled")
fun WebView.configureForApp() {
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.setSupportZoom(false)
    settings.builtInZoomControls = false
    settings.displayZoomControls = false
    settings.userAgentString = settings.userAgentString.replace("; wv", "")
    overScrollMode = View.OVER_SCROLL_NEVER
    isVerticalScrollBarEnabled = false
    isHorizontalScrollBarEnabled = false
}

// Logo, name and a line of text: the head of the setup and the lock screen. Returns the logo (it floats on the setup screen).
fun LinearLayout.addBrand(subtitle: String): ImageView {
    val logo = ImageView(context).apply { setImageResource(R.drawable.logo) }
    addView(logo, LinearLayout.LayoutParams(context.dp(96), context.dp(96)))
    addView(context.label("My Own JD", 26f).apply { typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, context.dp(12), 0, 0) })
    addView(context.label(subtitle, 14f, MUTED).apply { gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, context.dp(2), 0, context.dp(28)) })
    return logo
}

// A screen with the drifting background; `content` sits in the middle, no wider than a card (a tablet), scrolls if it has to and
// keeps clear of the system bars and the keyboard.
fun Activity.ambientScreen(content: View) {
    val width = minOf(resources.displayMetrics.widthPixels - dp(48), dp(420))
    val holder = FrameLayout(this).apply { addView(content, FrameLayout.LayoutParams(width, -2, Gravity.CENTER)) }
    val scroll = ScrollView(this).apply { isFillViewport = true; addView(holder, FrameLayout.LayoutParams(-1, -1)) }
    setContentView(FrameLayout(this).apply {
        addView(AmbientView(this@ambientScreen), FrameLayout.LayoutParams(-1, -1))
        addView(scroll, FrameLayout.LayoutParams(-1, -1))
    })
    drawBehindBars(scroll)
}
