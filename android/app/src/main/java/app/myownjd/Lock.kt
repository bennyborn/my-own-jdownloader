package app.myownjd

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Bundle
import android.os.CancellationSignal
import android.os.SystemClock
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout

// App lock: the phone's fingerprint / face / PIN / pattern opens the app. It keeps casual eyes out (privacy), it does not
// encrypt anything. The state is per process: a fresh start is locked, going to the background for `lockAfter` minutes locks again.
object Lock {
    private const val AUTH = BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL

    @Volatile var locked = true
    private var suppress = false

    // The next return to the app does not count as coming from the background (a system picker was open in between).
    fun suppressOnce() {
        suppress = true
    }
    private var started = 0
    private var leftAt = 0L

    // The phone has a lock (or a biometric) the prompt can use.
    fun available(c: Context) = try {
        (c.getSystemService(Context.BIOMETRIC_SERVICE) as BiometricManager).canAuthenticate(AUTH) == BiometricManager.BIOMETRIC_SUCCESS
    } catch (e: Exception) {
        false
    }

    // An activity became visible. Returns true if the lock screen has to cover it.
    fun onStart(c: Context): Boolean {
        if (started++ == 0) {
            if (suppress) suppress = false
            else if (Config.lock(c) && SystemClock.elapsedRealtime() - leftAt >= Config.lockAfter(c) * 60_000L) locked = true
        }
        return Config.lock(c) && locked
    }

    // The last activity went away: the app is in the background.
    fun onStop() {
        if (--started == 0) leftAt = SystemClock.elapsedRealtime()
    }

    // Our own words: the system's texts come in the phone's language and would not match the rest of the app.
    // Cancelling (also by leaving the app while the prompt is open) is nothing to complain about.
    private fun explain(code: Int) = when (code) {
        BiometricPrompt.BIOMETRIC_ERROR_CANCELED, BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED -> "Tap Unlock to try again"
        BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT, BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT -> "Too many attempts, try again later"
        else -> "Could not unlock (error $code)"
    }

    // Asks for the phone's credentials; calls back on success only.
    fun prompt(activity: Activity, title: String, onSuccess: () -> Unit, onFailure: (String) -> Unit = {}): CancellationSignal {
        val cancel = CancellationSignal()
        BiometricPrompt.Builder(activity).setTitle(title).setAllowedAuthenticators(AUTH).build()
            .authenticate(cancel, activity.mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onSuccess()
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = onFailure(explain(errorCode))
            })
        return cancel
    }
}

// Base of every screen: counts what is visible for the lock, hides the content from the app switcher if wanted and puts the lock screen in front.
abstract class GuardedActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applySecure()
    }

    // Hides the content from the app switcher (and blocks screenshots) if the user wants that.
    protected fun applySecure() {
        if (Config.hideContent(this)) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    // False for the lock screen itself.
    protected open val coveredByLock = true

    override fun onStart() {
        super.onStart()
        if (Lock.onStart(this) && coveredByLock) startActivity(Intent(this, LockActivity::class.java))
    }

    override fun onStop() {
        Lock.onStop()
        super.onStop()
    }
}

// The lock screen, in the look of the setup screen. The phone's prompt opens by itself; the button asks again.
class LockActivity : GuardedActivity() {
    private var cancel: android.os.CancellationSignal? = null
    private lateinit var status: android.widget.TextView

    override val coveredByLock = false

    override fun onStart() {
        super.onStart()
        unlockPrompt()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        status = label("", 13f, MUTED).apply { gravity = Gravity.CENTER }
        val unlock = primaryButton("Unlock").apply { setOnClickListener { unlockPrompt() } }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(0, dp(24), 0, dp(24))
            addBrand("Locked")
            addView(unlock, LinearLayout.LayoutParams(dp(220), -2))
            addView(status, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        }
        ambientScreen(column)
    }

    private fun unlockPrompt() {
        cancel?.cancel()
        status.text = ""
        cancel = Lock.prompt(this, "Unlock My Own JD", {
            Lock.locked = false
            finish()
        }, { error -> status.text = error })
    }

    override fun onStop() {
        cancel?.cancel()
        super.onStop()
    }

    // Back leaves the app instead of the lock.
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        moveTaskToBack(true)
    }
}
