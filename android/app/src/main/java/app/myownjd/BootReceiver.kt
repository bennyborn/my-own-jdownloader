package app.myownjd

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// After a restart of the phone (or an update of the app) the services come back as the settings say.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try {
            BackgroundService.sync(context)
        } catch (e: Exception) {
            /* Android refused a background start: the next time the app is opened */
        }
    }
}
