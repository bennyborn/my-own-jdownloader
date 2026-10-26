package de.bennyborn.myjd

import android.content.Context
import android.net.Uri

// The connection data live in the app's private storage on the phone and nowhere else.
object Config {
    private fun prefs(c: Context) = c.getSharedPreferences("config", Context.MODE_PRIVATE)

    fun url(c: Context): String? = prefs(c).getString("url", null)
    fun password(c: Context): String = prefs(c).getString("password", "") ?: ""
    fun save(c: Context, url: String, password: String) = prefs(c).edit().putString("url", url).putString("password", password).apply()

    // The bell of the web interface: do captchas notify? (the permission itself is Android's)
    fun notify(c: Context) = prefs(c).getBoolean("notify", true)
    fun setNotify(c: Context, on: Boolean) = prefs(c).edit().putBoolean("notify", on).apply()

    // After a captcha is solved: go on with the next open one, and when none is left either go back ('back') or show the downloads ('downloads').
    fun solverNext(c: Context) = prefs(c).getBoolean("solverNext", true)
    fun afterSolve(c: Context) = prefs(c).getString("afterSolve", "back") ?: "back"
    fun saveSolver(c: Context, next: Boolean, after: String) = prefs(c).edit().putBoolean("solverNext", next).putString("afterSolve", after).apply()

    // Native notification when a package has finished downloading (while the app is not in front).
    fun notifyDownloads(c: Context) = prefs(c).getBoolean("notifyDownloads", true)
    fun setNotifyDownloads(c: Context, on: Boolean) = prefs(c).edit().putBoolean("notifyDownloads", on).apply()

    // Click'n'Load: a small server on 127.0.0.1:9666 gives pages the "local JDownloader" they look for.
    fun cnl(c: Context) = prefs(c).getBoolean("cnl", false)
    fun setCnl(c: Context, on: Boolean) = prefs(c).edit().putBoolean("cnl", on).apply()

    // Where Click'n'Load links go: '' = the backend's default device, 'ask' = choose each time, otherwise a device id.
    fun cnlDevice(c: Context) = prefs(c).getString("cnlDevice", "") ?: ""
    fun setCnlDevice(c: Context, id: String) = prefs(c).edit().putString("cnlDevice", id).apply()

    // App lock (privacy, not security): the phone's own fingerprint / PIN opens the app. lockAfter = minutes in the background
    // before it locks again (0 = every time).
    fun lock(c: Context) = prefs(c).getBoolean("lock", false)
    fun lockAfter(c: Context) = prefs(c).getInt("lockAfter", 1)
    fun hideContent(c: Context) = prefs(c).getBoolean("hideContent", false)
    fun saveLock(c: Context, on: Boolean, after: Int, hide: Boolean) = prefs(c).edit().putBoolean("lock", on).putInt("lockAfter", after).putBoolean("hideContent", hide).apply()

    // The permission was asked for once; if it is still missing afterwards, only the system settings can grant it.
    fun asked(c: Context) = prefs(c).getBoolean("asked", false)
    fun setAsked(c: Context) = prefs(c).edit().putBoolean("asked", true).apply()

    // "server:3000" -> "http://server:3000"; null if it is no usable address.
    fun normalize(raw: String): String? {
        var s = raw.trim().trimEnd('/')
        if (s.isEmpty()) return null
        if (!Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(s)) s = "http://$s"
        val uri = Uri.parse(s)
        if ((uri.scheme != "http" && uri.scheme != "https") || uri.host.isNullOrEmpty()) return null
        return s
    }

    // host:port, the identity of the backend for the checks that keep other sites away from the bridge.
    fun authority(url: String?): String? = url?.let { Uri.parse(it).authority }
}
