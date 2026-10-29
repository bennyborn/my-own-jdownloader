package app.myownjd

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

// Solves a token captcha (Turnstile, hCaptcha, reCAPTCHA v2) of the backend. The WebView asks for the hoster's page, but
// the request is answered here with an empty page that renders the widget: it keeps the hoster's origin, which the token
// is bound to (the same trick as the browser extension). The token goes back to the backend, which hands it to JDownloader.
class SolverActivity : GuardedActivity() {
    private lateinit var status: TextView
    private lateinit var host: TextView
    private lateinit var web: WebView
    private val handler = Handler(Looper.getMainLooper())
    private var base = ""
    private var password = ""
    private var id = ""
    private var device = ""
    private var done = false
    private val handled = HashSet<String>() // solved or gone in this screen, never offered again

    private fun path(suffix: String = "") = "/api/captcha/$id$suffix?device=${java.net.URLEncoder.encode(device, "UTF-8")}"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        base = Config.url(this) ?: return finish()
        password = Config.password(this)
        id = intent.getStringExtra("id") ?: return finish()
        device = intent.getStringExtra("device") ?: ""

        host = label("Captcha", 18f)
        status = label("Loading ...", 14f, MUTED)
        web = WebView(this).apply {
            configureForApp()
            addJavascriptInterface(Bridge(), "Solver")
        }
        val close = primaryButton("Close").apply { setOnClickListener { finish() } }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(24), dp(16), dp(12))
            addView(host)
            addView(status.apply { setPadding(0, dp(4), 0, dp(8)) })
            addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(close)
        })

        load()
    }

    // Fetches the job and shows its widget; also the way to the next captcha.
    private fun load() {
        done = false
        handler.removeCallbacksAndMessages(null)
        say("Loading ...")
        thread {
            try {
                val res = Api.request(base, password, "GET", path())
                if (res.status == 404) return@thread proceed("This captcha is no longer open")
                if (res.status != 200) return@thread say("The backend answered ${res.status}", true)
                val job = JSONObject(res.body)
                runOnUiThread { show(job) }
            } catch (e: Exception) {
                say("Cannot reach the backend: ${e.message}", true)
            }
        }
    }

    private fun show(job: JSONObject) {
        val siteUrl = job.optString("siteUrl")
        val siteKey = job.optString("siteKey")
        val type = job.optString("challengeType")
        host.text = job.optString("hoster", "Captcha")
        val kind = when {
            Regex("turnstile|cloudflare", RegexOption.IGNORE_CASE).containsMatchIn(type) -> "turnstile"
            Regex("hcaptcha", RegexOption.IGNORE_CASE).containsMatchIn(type) -> "hcaptcha"
            Regex("recaptcha", RegexOption.IGNORE_CASE).containsMatchIn(type) -> "recaptcha"
            else -> null
        }
        if (siteUrl.isEmpty() || siteKey.isEmpty() || kind == null) return say("Unsupported captcha type: $type", true)
        status.text = "Solve the captcha below"
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (!request.isForMainFrame || request.url.toString().substringBefore('#') != siteUrl.substringBefore('#')) return null
                return WebResourceResponse("text/html", "utf-8", 200, "OK", mapOf("Cache-Control" to "no-store"), page(kind, siteKey).byteInputStream())
            }
        }
        web.loadUrl(siteUrl)
        watch()
    }

    // Checks now and then that JDownloader still waits for it (answered elsewhere, timed out).
    private fun watch() {
        handler.postDelayed({
            if (done) return@postDelayed
            thread {
                try {
                    if (Api.request(base, password, "GET", path()).status == 404) proceed("The captcha is gone") else runOnUiThread { watch() }
                } catch (e: Exception) {
                    runOnUiThread { watch() }
                }
            }
        }, 5000)
    }

    private fun say(text: String, error: Boolean = false) = runOnUiThread {
        status.text = text
        status.setTextColor(if (error) ERROR else MUTED)
    }

    // This captcha is over (solved, or gone): on to the next open one if the user wants that, otherwise leave as the settings say.
    private fun proceed(message: String) {
        done = true
        handled.add(id)
        if (!Config.solverNext(this)) return leave(message)
        thread {
            val next = try { nextJob() } catch (e: Exception) { null }
            runOnUiThread {
                if (next == null) leave(message)
                else {
                    Toast.makeText(this, "$message, next captcha", Toast.LENGTH_SHORT).show()
                    id = next.first
                    device = next.second
                    load()
                }
            }
        }
    }

    // The open widget captcha with the least time left (image captchas are answered in the interface).
    private fun nextJob(): Pair<String, String>? {
        val res = Api.request(base, password, "GET", "/api/captcha")
        if (res.status != 200) return null
        val jobs = JSONArray(res.body)
        var best: JSONObject? = null
        for (i in 0 until jobs.length()) {
            val job = jobs.getJSONObject(i)
            if (job.optString("kind") != "widget" || job.getLong("id").toString() in handled) continue
            if (best == null || job.optLong("remaining") < best.optLong("remaining")) best = job
        }
        return best?.let { it.getLong("id").toString() to it.optString("device") }
    }

    private fun leave(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
        if (Config.afterSolve(this) == "downloads") startActivity(Intent(this, MainActivity::class.java).putExtra("downloads", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    override fun onStart() {
        super.onStart()
        AppState.solving = true
    }

    override fun onStop() {
        AppState.solving = false
        super.onStop()
    }

    override fun onDestroy() {
        done = true
        handler.removeCallbacksAndMessages(null)
        web.destroy()
        super.onDestroy()
    }

    private fun page(kind: String, siteKey: String): String {
        val script = mapOf(
            "turnstile" to "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=ready",
            "hcaptcha" to "https://js.hcaptcha.com/1/api.js?render=explicit&onload=ready",
            "recaptcha" to "https://www.google.com/recaptcha/api.js?render=explicit&onload=ready"
        )[kind]
        val lib = mapOf("turnstile" to "turnstile", "hcaptcha" to "hcaptcha", "recaptcha" to "grecaptcha")[kind]
        return """
            <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
            <body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0d1117;color:#8b949e;font-family:sans-serif">
            <div id="w">loading ...</div>
            <script>
              function ready() {
                document.getElementById('w').textContent = '';
                $lib.render(document.getElementById('w'), { sitekey: ${JSONObject.quote(siteKey)},
                  callback: function (t) { Solver.token(t); },
                  'error-callback': function () { Solver.error('The captcha reported an error'); },
                  'expired-callback': function () { Solver.error('The captcha expired, solve it again'); } });
              }
            </script>
            <script src="$script" async onerror="Solver.error('Could not load the captcha script')"></script>
            </body>
        """.trimIndent()
    }

    private inner class Bridge {
        @JavascriptInterface
        fun token(t: String) {
            say("Sending ...")
            thread {
                try {
                    val res = Api.request(base, password, "POST", path("/solve"), JSONObject().put("token", t).toString())
                    if (res.status in 200..299) {
                        proceed("Captcha solved")
                    } else say("Failed: ${runCatching { JSONObject(res.body).optString("error") }.getOrNull().orEmpty().ifEmpty { "HTTP ${res.status}" }}", true)
                } catch (e: Exception) {
                    say("Failed: ${e.message}", true)
                }
            }
        }

        @JavascriptInterface
        fun error(e: String) = say(e, true)
    }
}
