package app.myownjd

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.provider.Settings
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// Updates the app from the APK the backend offers (/api/app); a backend with none sends it to GitHub (release.json of the latest release), but only
// if that release does not need a newer backend than the one in use. Android never installs silently: the app downloads and checks the file,
// the system then asks the user once. Nothing runs on a timer: the check happens at the start and on the button in the settings.
object Updater {
    // kind: idle | checking | current | unavailable | available | downloading | installing | error
    class State(val kind: String, val name: String = "", val message: String = "")

    @Volatile var state = State("idle")
        private set
    // Called from any thread when the state changed.
    @Volatile var onChange: (() -> Unit)? = null
    // The start check runs once per process.
    var checkedAtStart = false

    private const val RELEASE_INFO = "https://github.com/bennyborn/my-own-jdownloader/releases/latest/download/release.json"

    // url: where to download it; null = from the backend (with its password, which must never go anywhere else).
    private class Offer(val code: Long, val name: String, val sha256: String, val url: String? = null)
    @Volatile private var offer: Offer? = null

    fun installedCode(c: Context): Long = c.packageManager.getPackageInfo(c.packageName, 0).longVersionCode
    fun installedName(c: Context): String = c.packageManager.getPackageInfo(c.packageName, 0).versionName ?: ""

    private fun set(kind: String, name: String = "", message: String = "") {
        state = State(kind, name, message)
        onChange?.invoke()
    }

    private fun open(base: String, password: String, path: String): HttpURLConnection {
        val conn = URL(base + path).openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        conn.readTimeout = 30000
        if (password.isNotEmpty()) conn.setRequestProperty("Authorization", "Basic " + Base64.encodeToString(":$password".toByteArray(), Base64.NO_WRAP))
        return conn
    }

    fun check(c: Context) {
        val ctx = c.applicationContext
        val base = Config.url(ctx) ?: return
        if (state.kind == "checking" || state.kind == "downloading" || state.kind == "installing") return
        set("checking")
        Thread {
            try {
                val res = Api.request(base, Config.password(ctx), "GET", "/api/app")
                if (res.status != 200) throw java.io.IOException("HTTP ${res.status}")
                val json = JSONObject(res.body)
                val code = json.optLong("versionCode", 0)
                if (!json.optBoolean("available") || code == 0L) {
                    checkGitHub(ctx, base)
                } else if (code > installedCode(ctx)) {
                    offer = Offer(code, json.optString("versionName"), json.optString("sha256"))
                    set("available", json.optString("versionName"))
                } else {
                    offer = null
                    set("current")
                }
            } catch (e: Exception) {
                set("error", message = e.message ?: "The check failed")
            }
        }.start()
    }

    // The backend has no app: the latest release at GitHub, if this backend is new enough for it (the release says which API level it needs).
    private fun checkGitHub(ctx: Context, base: String) {
        val health = Api.request(base, Config.password(ctx), "GET", "/api/health")
        if (health.status != 200) throw java.io.IOException("HTTP ${health.status}")
        val backendLevel = JSONObject(health.body).optInt("apiLevel", 0) // an older backend does not tell: level 0
        val conn = URL(RELEASE_INFO).openConnection() as HttpURLConnection
        val info = try {
            conn.connectTimeout = 8000
            conn.readTimeout = 15000
            if (conn.responseCode != 200) throw java.io.IOException("GitHub: HTTP ${conn.responseCode}")
            JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
        } finally {
            conn.disconnect()
        }
        val apk = info.getJSONObject("apk")
        val code = apk.optLong("versionCode", 0)
        val name = apk.optString("versionName")
        val url = apk.optString("url")
        if (code == 0L || apk.optString("sha256").isEmpty() || !url.startsWith("https://")) {
            offer = null
            set("unavailable", message = "The backend has no app to offer")
        } else if (code <= installedCode(ctx)) {
            offer = null
            set("current")
        } else if (backendLevel < info.optInt("requiresApi", 0)) {
            offer = null
            set("unavailable", message = "Version ${info.optString("version")} is out, but it needs a newer backend than yours. Update the backend first.")
        } else {
            offer = Offer(code, name, apk.getString("sha256"), url)
            set("available", name)
        }
    }

    // Downloads the offered APK into the cache, checks it and hands it to the system's installer.
    fun install(c: Context) {
        val ctx = c.applicationContext
        val base = Config.url(ctx) ?: return
        val current = offer ?: return
        if (state.kind != "available") return
        if (!ctx.packageManager.canRequestPackageInstalls()) {
            set("error", message = "Allow installing apps from this app in the Android settings that just opened, then try again")
            ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        }
        set("downloading", current.name)
        Thread {
            val file = File(ctx.cacheDir, "update.apk")
            try {
                val conn = if (current.url != null) (URL(current.url).openConnection() as HttpURLConnection).apply { connectTimeout = 8000; readTimeout = 30000 }
                else open(base, Config.password(ctx), "/api/app/my-own-jdownloader.apk")
                try {
                    if (conn.responseCode != 200) throw java.io.IOException("HTTP ${conn.responseCode}")
                    val digest = MessageDigest.getInstance("SHA-256")
                    conn.inputStream.use { input ->
                        file.outputStream().use { out ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val n = input.read(buffer)
                                if (n < 0) break
                                digest.update(buffer, 0, n)
                                out.write(buffer, 0, n)
                            }
                        }
                    }
                    val sum = digest.digest().joinToString("") { "%02x".format(it) }
                    if (current.sha256.isNotEmpty() && !sum.equals(current.sha256, ignoreCase = true)) throw java.io.IOException("The download is damaged")
                } finally {
                    conn.disconnect()
                }
                set("installing", current.name)
                commit(ctx, file)
            } catch (e: Exception) {
                file.delete()
                set("error", message = e.message ?: "The download failed")
            }
        }.start()
    }

    private fun commit(ctx: Context, file: File) {
        val installer = ctx.packageManager.packageInstaller
        val id = installer.createSession(PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))
        installer.openSession(id).use { session ->
            session.openWrite("update", 0, file.length()).use { out ->
                file.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            // The result comes back as a broadcast; it has to be mutable because the system adds the status to it.
            val result = PendingIntent.getBroadcast(ctx, id, Intent(ctx, UpdateReceiver::class.java).setPackage(ctx.packageName), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            session.commit(result.intentSender)
        }
    }

    fun result(ctx: Context, status: Int, message: String?) {
        if (status == PackageInstaller.STATUS_SUCCESS) return // the app is replaced and restarts
        File(ctx.cacheDir, "update.apk").delete()
        // The user declined the system's question: nothing to complain about, the offer stays.
        if (status == PackageInstaller.STATUS_FAILURE_ABORTED) set("available", offer?.name ?: "")
        else set("error", message = message ?: "The installation failed")
    }
}

// The installer's answer: the first one asks for the user's consent (its dialog is started from here), the last one tells how it went.
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
            if (confirm != null) context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        }
        Updater.result(context, status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
    }
}
