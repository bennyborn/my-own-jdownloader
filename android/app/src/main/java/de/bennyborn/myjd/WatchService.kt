package de.bennyborn.myjd

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import org.json.JSONArray
import kotlin.concurrent.thread

// Foreground service while the bell is on: polls the backend for open captchas and notifies about new ones, also when the
// app is closed. Android requires the permanent entry of a foreground service; it is kept as quiet as possible.
class WatchService : Service() {
    @Volatile private var running = false
    private val notified = HashSet<Long>()
    // Per device: the packages that were unfinished at the last look (no entry yet = nothing to compare with, so no message for what was done before).
    private val unfinished = HashMap<String, Set<Long>>()
    private var round = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Notifier.channels(this)
        val entry = Notifier.builder(this, Notifier.WATCH, logo = false).setContentTitle("Watching for captchas").setContentIntent(Notifier.openApp(this)).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, entry, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(1, entry)
        if (!running) {
            running = true
            thread {
                while (running) {
                    val ok = try {
                        poll()
                        // Downloads change slowly and every look asks the JDownloader: every 30 s is enough.
                        if (round++ % 6 == 0) pollDownloads()
                        true
                    } catch (e: Exception) {
                        false
                    }
                    try {
                        Thread.sleep(if (ok) 5000 else 15000)
                    } catch (e: InterruptedException) {
                        return@thread
                    }
                }
            }
        }
        return START_STICKY
    }

    private fun poll() {
        val base = Config.url(this) ?: return
        val res = Api.request(base, Config.password(this), "GET", "/api/captcha")
        if (res.status != 200) return
        val jobs = JSONArray(res.body)
        val open = HashSet<Long>()
        for (i in 0 until jobs.length()) {
            val job = jobs.getJSONObject(i)
            val id = job.getLong("id")
            open.add(id)
            if (!notified.add(id)) continue
            val widget = job.optString("kind") == "widget"
            if (!widget && AppState.visible) continue
            Notifier.captcha(this, id, job.optString("device"), job.optString("hoster"), widget, job.optLong("remaining"))
        }
        for (id in notified.toList()) if (id !in open) {
            notified.remove(id)
            Notifier.cancel(this, id)
        }
    }

    // A package that was unfinished the last time and is finished now: tell the user, unless the app is in front (the interface shows it itself).
    private fun pollDownloads() {
        val base = Config.url(this) ?: return
        if (!Config.notifyDownloads(this)) {
            unfinished.clear()
            return
        }
        val password = Config.password(this)
        val devices = Api.devices(base, password).filter { it.online }
        for (device in devices) {
            val res = Api.request(base, password, "GET", "/api/downloads?device=${java.net.URLEncoder.encode(device.id, "UTF-8")}")
            if (res.status != 200) continue
            val packages = org.json.JSONObject(res.body).optJSONArray("packages") ?: continue
            val open = HashSet<Long>()
            val finished = ArrayList<org.json.JSONObject>()
            for (i in 0 until packages.length()) {
                val p = packages.getJSONObject(i)
                if (p.optBoolean("finished")) finished.add(p) else open.add(p.getLong("uuid"))
            }
            val before = unfinished[device.id]
            if (before != null && !AppState.visible) {
                for (p in finished) if (p.getLong("uuid") in before) Notifier.downloadFinished(this, p.getLong("uuid"), p.optString("name"), if (devices.size > 1) device.name else null)
            }
            unfinished[device.id] = open
        }
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    companion object {
        // Starts or stops the service to match the bell and the permission.
        fun sync(c: Context) {
            val intent = Intent(c, WatchService::class.java)
            if (Config.url(c) != null && Config.notify(c) && Notifier.enabled(c)) c.startForegroundService(intent) else c.stopService(intent)
        }
    }
}
