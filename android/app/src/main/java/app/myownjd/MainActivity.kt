package app.myownjd

import android.Manifest
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.os.Bundle
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.webkit.HttpAuthHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import org.json.JSONObject

// Shows the web interface of the backend. The page gets a bridge ("Android") to open the solver and to edit the
// connection data; it is only trusted while the page comes from the backend's own address, and every other site opens in
// the browser instead of this WebView.
class MainActivity : GuardedActivity() {
    private companion object {
        const val NOTIFY_REQUEST = 77
        const val CNL_REQUEST = 79
        const val FILE_REQUEST = 78
    }

    private lateinit var web: WebView
    private lateinit var errorView: FrameLayout
    private lateinit var errorText: android.widget.TextView
    private var base = ""
    private var password = ""

    private var fileCallback: ValueCallback<Array<Uri>>? = null

    @Volatile private var pageAuthority: String? = null
    private var authAttempts = 0
    private var authWindowStart = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val configured = Config.url(this)
        if (configured == null) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        base = configured
        password = Config.password(this)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)

        web = WebView(this)
        web.configureForApp()
        web.addJavascriptInterface(UiBridge(), "Android")
        web.webViewClient = Client()
        // <input type="file"> (containers, ...): the WebView does not open a picker by itself.
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    Lock.suppressOnce()
                    startActivityForResult(params.createIntent(), FILE_REQUEST)
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }

        errorText = label("", 14f, MUTED).apply { gravity = Gravity.CENTER }
        val retry = primaryButton("Try again").apply { setOnClickListener { load() } }
        val change = primaryButton("Change connection").apply {
            background = rounded(BASE, BORDER, 10)
            setOnClickListener { startActivity(Intent(this@MainActivity, SetupActivity::class.java)) }
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(android.widget.ImageView(this@MainActivity).apply { setImageResource(R.drawable.logo); alpha = 0.9f }, LinearLayout.LayoutParams(dp(80), dp(80)))
            addView(label("Cannot show the interface", 20f).apply { typeface = Typeface.DEFAULT_BOLD; setPadding(0, dp(12), 0, dp(6)) })
            addView(errorText, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(24) })
            addView(retry, LinearLayout.LayoutParams(-1, -2))
            addView(change, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        }
        errorView = FrameLayout(this).apply {
            visibility = View.GONE
            addView(AmbientView(this@MainActivity), FrameLayout.LayoutParams(-1, -1))
            addView(card, FrameLayout.LayoutParams(minOf(resources.displayMetrics.widthPixels - dp(48), dp(420)), -2, Gravity.CENTER))
        }
        setContentView(FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(-1, -1))
            addView(errorView, FrameLayout.LayoutParams(-1, -1))
        })
        Notifier.channels(this)
        load()
        if (!Updater.checkedAtStart) {
            Updater.checkedAtStart = true
            Updater.check(this)
        }
    }

    // The solver asks for the downloads once its work is done (launchMode singleTask: this screen is reused, not stacked).
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra("downloads", false) && ::web.isInitialized) load()
    }

    // Saved connection data may have changed in the setup screen.
    override fun onStart() {
        super.onStart()
        AppState.visible = true
        Updater.onChange = { onUpdateState() }
    }

    // The page shows the state of the update; a newer version found at the start is offered once, the settings keep the button.
    private var offeredUpdate = false
    private fun onUpdateState() {
        if (!::web.isInitialized) return
        tellPage()
        val state = Updater.state
        if (state.kind != "available" || offeredUpdate) return
        offeredUpdate = true
        runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            android.app.AlertDialog.Builder(this)
                .setTitle("Update available")
                .setMessage("Version ${state.name} of the app is available. Download and install it now?")
                .setPositiveButton("Install") { _, _ -> Updater.install(this) }
                .setNegativeButton("Later", null)
                .show()
        }
    }

    // The notification shade (its "Turn off" buttons) takes the focus without pausing the app: the page reads its state again afterwards.
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && ::web.isInitialized) tellPage()
    }

    override fun onStop() {
        AppState.visible = false
        Updater.onChange = null
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        if (!::web.isInitialized) return
        // Back from the system settings the permission may have changed: service and bell follow.
        BackgroundService.sync(this)
        tellPage()
        val url = Config.url(this)
        val pw = Config.password(this)
        if (url != null && (url != base || pw != password)) {
            base = url
            password = pw
            load()
        }
    }

    private fun enableCnl() {
        Config.setCnl(this, true)
        BackgroundService.sync(this)
        tellPage()
    }

    // The bell of the page asks for its state again.
    private fun tellPage() = runOnUiThread { web.evaluateJavascript("window.dispatchEvent(new Event('android-state'))", null) }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != NOTIFY_REQUEST && requestCode != CNL_REQUEST) return
        Config.setAsked(this)
        if (requestCode == CNL_REQUEST) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) enableCnl()
            else android.widget.Toast.makeText(this, "Click'n'Load needs notifications so you can see that it runs", android.widget.Toast.LENGTH_LONG).show()
            tellPage()
            return
        }
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            Config.setNotify(this, true)
            BackgroundService.sync(this)
            Notifier.test(this)
        }
        tellPage()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_REQUEST) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        } else super.onActivityResult(requestCode, resultCode, data)
    }

    private fun load() {
        errorView.visibility = View.GONE
        web.loadUrl(base)
    }

    private fun fail(message: String) {
        errorText.text = message
        errorView.visibility = View.VISIBLE
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (errorView.visibility != View.VISIBLE && web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private inner class Client : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            pageAuthority = Config.authority(url)
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (Config.authority(request.url.toString()) == Config.authority(base)) return false
            startActivity(Intent(Intent.ACTION_VIEW, request.url))
            return true
        }

        // The backend asks for its password with Basic auth. A wrong password would be asked again and again: give up after a few tries.
        override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) {
            val now = System.currentTimeMillis()
            if (now - authWindowStart > 5000) {
                authWindowStart = now
                authAttempts = 0
            }
            if (host != Uri.parse(base).authority?.substringBefore(':') || ++authAttempts > 3) {
                handler.cancel()
                fail("The backend refused the password.")
            } else handler.proceed("", password)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) fail("${error.description} ($base)")
        }
    }

    private inner class UiBridge {
        // False while the page comes from anywhere but the backend.
        private fun trusted() = pageAuthority != null && pageAuthority == Config.authority(Config.url(this@MainActivity))

        @JavascriptInterface
        fun solve(id: String, device: String) {
            if (!trusted()) return
            runOnUiThread { startActivity(Intent(this@MainActivity, SolverActivity::class.java).putExtra("id", id).putExtra("device", device)) }
        }

        // 'on', 'off', 'ask' (the permission can still be requested) or 'blocked' (only the system settings can allow it).
        @JavascriptInterface
        fun notifyState(): String = when {
            !trusted() -> "blocked"
            Notifier.enabled(this@MainActivity) -> if (Config.notify(this@MainActivity)) "on" else "off"
            Build.VERSION.SDK_INT >= 33 && !Config.asked(this@MainActivity) -> "ask"
            else -> "blocked"
        }

        // The bell was clicked.
        @JavascriptInterface
        fun toggleNotify() {
            if (!trusted()) return
            runOnUiThread {
                when (notifyState()) {
                    "ask" -> requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFY_REQUEST)
                    "blocked" -> startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                    else -> {
                        Config.setNotify(this@MainActivity, !Config.notify(this@MainActivity))
                        BackgroundService.sync(this@MainActivity)
                        tellPage()
                    }
                }
            }
        }

        // JSON {next, after}: what the solver does once a captcha is done.
        @JavascriptInterface
        fun getSolverOptions(): String = if (trusted()) JSONObject().put("next", Config.solverNext(this@MainActivity)).put("after", Config.afterSolve(this@MainActivity)).toString() else "{}"

        @JavascriptInterface
        fun setSolverOptions(next: Boolean, after: String) {
            if (trusted()) Config.saveSolver(this@MainActivity, next, if (after == "downloads") "downloads" else "back")
        }

        @JavascriptInterface
        fun getNotifyDownloads(): Boolean = trusted() && Config.notifyDownloads(this@MainActivity)

        @JavascriptInterface
        fun setNotifyDownloads(on: Boolean) {
            if (trusted()) Config.setNotifyDownloads(this@MainActivity, on)
        }

        // 'on' only while the service can run: its notification is what shows the user that something listens on the phone.
        @JavascriptInterface
        fun cnlState(): String = if (trusted() && Config.cnl(this@MainActivity) && Notifier.enabled(this@MainActivity)) "on" else "off"

        @JavascriptInterface
        fun getCnlDevice(): String = if (trusted()) Config.cnlDevice(this@MainActivity) else ""

        @JavascriptInterface
        fun setCnlDevice(id: String) {
            if (trusted()) Config.setCnlDevice(this@MainActivity, id)
        }

        @JavascriptInterface
        fun setCnl(on: Boolean) {
            if (!trusted()) return
            runOnUiThread {
                when {
                    !on -> {
                        Config.setCnl(this@MainActivity, false)
                        BackgroundService.sync(this@MainActivity)
                        tellPage()
                    }
                    Notifier.enabled(this@MainActivity) -> enableCnl()
                    Build.VERSION.SDK_INT >= 33 && !Config.asked(this@MainActivity) -> requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), CNL_REQUEST)
                    else -> {
                        android.widget.Toast.makeText(this@MainActivity, "Allow notifications for this app to use Click'n'Load", android.widget.Toast.LENGTH_LONG).show()
                        startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                    }
                }
            }
        }

        // JSON {enabled, after, hide, available}
        @JavascriptInterface
        fun getLock(): String {
            if (!trusted()) return "{}"
            return JSONObject().put("enabled", Config.lock(this@MainActivity)).put("after", Config.lockAfter(this@MainActivity))
                .put("hide", Config.hideContent(this@MainActivity)).put("available", Lock.available(this@MainActivity)).toString()
        }

        // Switching the lock on or off asks for the phone's credentials first (the answer comes as the "android-state" event);
        // the other options change at once. Returns '' or an error message.
        @JavascriptInterface
        fun setLock(enabled: Boolean, after: Int, hide: Boolean): String {
            if (!trusted()) return "Not allowed"
            val ctx = this@MainActivity
            if (enabled == Config.lock(ctx)) {
                Config.saveLock(ctx, enabled, after, hide)
                runOnUiThread { applySecure() }
                tellPage()
                return ""
            }
            if (enabled && !Lock.available(ctx)) return "Set up a screen lock or a fingerprint in the Android settings first"
            runOnUiThread {
                Lock.prompt(ctx, if (enabled) "Turn on the app lock" else "Turn off the app lock", {
                    Config.saveLock(ctx, enabled, after, hide)
                    Lock.locked = false
                    applySecure()
                    tellPage()
                }, { tellPage() })
            }
            return ""
        }

        // JSON {name, code}: the installed version of the app.
        @JavascriptInterface
        fun appVersion(): String {
            if (!trusted()) return "{}"
            return JSONObject().put("name", Updater.installedName(this@MainActivity)).put("code", Updater.installedCode(this@MainActivity)).toString()
        }

        // JSON {kind, name, message}: see Updater.State. Changes arrive as the event "android-state".
        @JavascriptInterface
        fun updateState(): String {
            if (!trusted()) return "{}"
            val s = Updater.state
            return JSONObject().put("kind", s.kind).put("name", s.name).put("message", s.message).toString()
        }

        @JavascriptInterface
        fun checkUpdate() {
            if (trusted()) Updater.check(this@MainActivity)
        }

        @JavascriptInterface
        fun installUpdate() {
            if (trusted()) Updater.install(this@MainActivity)
        }

        @JavascriptInterface
        fun getConfig(): String {
            if (!trusted()) return "{}"
            return JSONObject().put("url", Config.url(this@MainActivity)).put("password", Config.password(this@MainActivity)).toString()
        }

        @JavascriptInterface
        fun setConfig(url: String, password: String): String {
            if (!trusted()) return "Not allowed"
            val normalized = Config.normalize(url) ?: return "That is no valid address"
            Config.save(this@MainActivity, normalized, password)
            runOnUiThread {
                base = normalized
                this@MainActivity.password = password
                load()
            }
            return ""
        }
    }
}
