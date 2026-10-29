package app.myownjd

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import org.json.JSONObject
import kotlin.concurrent.thread

// "Share" from another app (a browser, a messenger, a notes app): the text, usually a link, goes to the linkgrabber of the
// chosen device (see "Incoming links" in the app settings). No screen of its own.
class ShareActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
        when {
            Config.url(this) == null -> toast("Set up My Own JD first")
            text.isEmpty() -> toast("Nothing to add")
            else -> {
                toast("Sending ...")
                thread {
                    val ok = Cnl.route(this, "/api/linkgrabber/add", JSONObject().put("links", text), true)
                    runOnUiThread {
                        if (!ok) toast("Could not send the links")
                        finish()
                    }
                }
                return
            }
        }
        finish()
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
}
