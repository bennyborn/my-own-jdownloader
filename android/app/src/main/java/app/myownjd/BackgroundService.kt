package app.myownjd

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

// The one foreground service of the app. It does what the settings ask for: watches the backend (new captchas, finished downloads;
// the bell) and/or answers Click'n'Load on 127.0.0.1:9666. Android requires a permanent entry for a foreground service: there is
// exactly one, and it says what is on.
class BackgroundService : Service() {
    @Volatile private var watcher: Thread? = null
    private var cnl: CnlServer? = null
    private val notified = HashSet<Long>()
    // Per device: the packages that were unfinished at the last look (no entry yet = nothing to compare with, so no message for what was done before).
    private val unfinished = HashMap<String, Set<Long>>()
    private var round = 0

    override fun onBind(intent: Intent?): IBinder? = null

    // Called again whenever a setting changes (see sync): the workers follow the settings.
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // The "Turn off" button of the entry (Click'n'Load).
        if (intent?.action == STOP_CNL) Config.setCnl(this, false)
        val watch = wantsWatch(this)
        val serve = wantsCnl(this)
        if (!watch && !serve) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        Notifier.channels(this)
        val entry = entry(watch, serve)
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, entry, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(1, entry)
        if (watch) startWatching() else stopWatching()
        if (serve) {
            if (cnl == null) cnl = CnlServer(this).also { it.start() }
        } else {
            cnl?.stop()
            cnl = null
        }
        return START_STICKY
    }

    // What is on, in one line. With Click'n'Load the entry is visible in the status bar (the user should see that something listens on
    // the phone) and has a button to switch it off; with only the watching it stays as quiet as possible.
    private fun entry(watch: Boolean, serve: Boolean): Notification {
        val title = listOfNotNull("Watching captchas and downloads".takeIf { watch }, "Click'n'Load is on".takeIf { serve }).joinToString(" · ")
        val builder = Notifier.builder(this, if (serve) Notifier.CNL else Notifier.WATCH, logo = false)
            .setContentTitle(title).setContentIntent(Notifier.openApp(this)).setOngoing(true)
        if (serve) {
            val stop = PendingIntent.getService(this, 3, Intent(this, BackgroundService::class.java).setAction(STOP_CNL), PendingIntent.FLAG_IMMUTABLE)
            builder.setContentText("Websites can send links to this phone")
                .addAction(Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_stat), "Turn off Click'n'Load", stop).build())
        }
        return builder.build()
    }

    private fun startWatching() {
        if (watcher != null) return
        watcher = thread {
            while (!Thread.currentThread().isInterrupted) {
                val ok = try {
                    if (AppState.inFront) {
                        // The interface in front asks for everything itself (and every ask goes on to the MyJDownloader API). The baseline of
                        // the finished downloads is dropped, so nothing is reported for what happened while the user was looking.
                        unfinished.clear()
                    } else {
                        poll()
                        // Downloads change slowly and every look asks the JDownloader: every second round (30 s) is enough.
                        if (round++ % 2 == 0) pollDownloads()
                    }
                    true
                } catch (e: Exception) {
                    false
                }
                try {
                    Thread.sleep(if (ok) POLL_MS else POLL_MS * 2)
                } catch (e: InterruptedException) {
                    return@thread
                }
            }
        }
    }

    private fun stopWatching() {
        watcher?.interrupt()
        watcher = null
        notified.clear()
        unfinished.clear()
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
            if (before != null) {
                for (p in finished) if (p.getLong("uuid") in before) Notifier.downloadFinished(this, p.getLong("uuid"), p.optString("name"), if (devices.size > 1) device.name else null)
            }
            unfinished[device.id] = open
        }
    }

    override fun onDestroy() {
        stopWatching()
        cnl?.stop()
        cnl = null
        super.onDestroy()
    }

    companion object {
        // A captcha stays open for ten minutes: a look every 15 s is early enough, and every look goes on to the MyJDownloader API (not ours).
        private const val POLL_MS = 15_000L
        private const val STOP_CNL = "app.myownjd.CNL_STOP"

        // What the settings ask for: both need a stored backend and notifications that can be shown (the entry is one).
        private fun wantsWatch(c: Context) = Config.url(c) != null && Config.notify(c) && Notifier.enabled(c)
        private fun wantsCnl(c: Context) = Config.url(c) != null && Config.cnl(c) && Notifier.enabled(c)

        // Starts, updates or stops the service to match the settings and the permission. Call it after any of them changed.
        fun sync(c: Context) {
            val intent = Intent(c, BackgroundService::class.java)
            if (wantsWatch(c) || wantsCnl(c)) c.startForegroundService(intent) else c.stopService(intent)
        }
    }
}
