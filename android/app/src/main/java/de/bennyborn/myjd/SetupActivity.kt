package de.bennyborn.myjd

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.animation.DecelerateInterpolator
import android.widget.LinearLayout
import kotlin.concurrent.thread

// First start (and "change connection" from the error page): address and password of the backend, checked before saving.
class SetupActivity : GuardedActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Ids keep what was typed over a rotation.
        val url = field("http://192.168.1.10:3000", Config.url(this) ?: "").apply { id = 1001 }
        val password = field("Empty if there is none", Config.password(this), password = true).apply { id = 1002 }
        val status = label(intent.getStringExtra("message") ?: "", 13f, ERROR)
        val connect = primaryButton("Connect")

        connect.setOnClickListener {
            val base = Config.normalize(url.text.toString())
            if (base == null) {
                status.setTextColor(ERROR)
                status.text = "That is no valid address"
                return@setOnClickListener
            }
            val pw = password.text.toString()
            connect.isEnabled = false
            connect.alpha = 0.6f
            status.setTextColor(MUTED)
            status.text = "Connecting ..."
            thread {
                val error = check(base, pw)
                runOnUiThread {
                    connect.isEnabled = true
                    connect.alpha = 1f
                    if (error != null) {
                        status.setTextColor(ERROR)
                        status.text = error
                        return@runOnUiThread
                    }
                    Config.save(this, base, pw)
                    startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
                    finish()
                }
            }
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(0xE6161B22.toInt(), BORDER, 16)
            setPadding(dp(20), dp(20), dp(20), dp(20))
            addView(label("Backend address", 12f, MUTED))
            addView(url, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6); bottomMargin = dp(16) })
            addView(label("Password", 12f, MUTED))
            addView(password, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6); bottomMargin = dp(20) })
            addView(connect, LinearLayout.LayoutParams(-1, -2))
            addView(status, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(40), 0, dp(24))
            addBrand("Connect to your JDownloader")
            addView(card, LinearLayout.LayoutParams(-1, -2))
            addView(label("Address and password stay on this phone.", 12f, MUTED).apply { gravity = Gravity.CENTER; setPadding(0, dp(16), 0, 0) })
        }
        ambientScreen(column)
        val logo = column.getChildAt(0)

        if (Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f) {
            // The card fades in; the logo floats very slightly.
            column.alpha = 0f
            column.translationY = dp(14).toFloat()
            column.animate().alpha(1f).translationY(0f).setDuration(450).setInterpolator(DecelerateInterpolator()).start()
            ObjectAnimator.ofFloat(logo, "translationY", 0f, -dp(5).toFloat()).apply {
                duration = 3200
                repeatMode = ValueAnimator.REVERSE
                repeatCount = ValueAnimator.INFINITE
                interpolator = android.view.animation.AccelerateDecelerateInterpolator()
                start()
            }
        }
    }

    // null = fine, otherwise what is wrong.
    private fun check(base: String, password: String): String? = try {
        if (Api.request(base, "", "GET", "/api/health").status != 200) "That address does not look like my-own-jdownloader"
        else when (Api.request(base, password, "GET", "/api/captcha").status) {
            200 -> null
            401 -> "Wrong password"
            else -> "The backend answered with an error"
        }
    } catch (e: Exception) {
        "Cannot reach the backend: ${e.message ?: e.javaClass.simpleName}"
    }
}
