package de.bennyborn.myjd

import android.os.Bundle
import android.widget.LinearLayout
import kotlin.concurrent.thread

// Click'n'Load with "ask every time": the links wait here until a device is picked (opened from the notification).
class ChooseDeviceActivity : GuardedActivity() {
    private lateinit var column: LinearLayout
    private var devices: List<Device> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
            background = rounded(0xE6161B22.toInt(), BORDER, 16)
        }
        ambientScreen(column)
        thread {
            val base = Config.url(this)
            devices = try { if (base != null) Api.devices(base, Config.password(this)).filter { it.online } else emptyList() } catch (e: Exception) { emptyList() }
            runOnUiThread { show() }
        }
    }

    private fun show() {
        column.removeAllViews()
        val job = CnlPending.first()?.second
        if (job == null) {
            finish()
            return
        }
        val what = job.optString("packageName").ifEmpty { job.optString("source").substringAfter("://").substringBefore('/') }
            .ifEmpty { job.optString("links").lineSequence().firstOrNull().orEmpty().take(60) }.ifEmpty { "Links" }
        column.addView(label("Send the links to", 18f))
        column.addView(label(what + if (CnlPending.size() > 1) "  (+${CnlPending.size() - 1} more)" else "", 13f, MUTED).apply { setPadding(0, dp(4), 0, dp(16)) })
        if (devices.isEmpty()) column.addView(label("No device answers right now", 14f, ERROR).apply { setPadding(0, 0, 0, dp(12)) })
        for (d in devices) column.addView(primaryButton(d.name).apply { setOnClickListener { send(d) } }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
        column.addView(primaryButton("Discard").apply { background = rounded(BASE, BORDER, 10); setOnClickListener { CnlPending.removeFirst(); afterAnswer() } }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
    }

    private fun send(device: Device) {
        val (path, job) = CnlPending.first() ?: return
        thread {
            Cnl.deliver(this, path, job, device.id, device.name)
            CnlPending.removeFirst()
            runOnUiThread { afterAnswer() }
        }
    }

    private fun afterAnswer() {
        if (CnlPending.size() == 0) {
            Notifier.cancel(this, Notifier.CHOOSE_ID.toLong())
            finish()
        } else show()
    }
}
