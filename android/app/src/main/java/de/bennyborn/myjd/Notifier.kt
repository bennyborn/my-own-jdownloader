package de.bennyborn.myjd

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon

// True while the app is on screen: an image captcha is then already open in front of the user.
object AppState {
    @Volatile var visible = false
}

object Notifier {
    const val WATCH = "watch"
    const val CNL = "cnl"
    private const val DOWNLOADS = "downloads"
    private const val CAPTCHA = "captcha"

    private fun manager(c: Context) = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    fun channels(c: Context) {
        val nm = manager(c)
        nm.createNotificationChannel(NotificationChannel(CAPTCHA, "Captchas", NotificationManager.IMPORTANCE_HIGH).apply { description = "JDownloader waits for a captcha" })
        nm.createNotificationChannel(NotificationChannel(DOWNLOADS, "Finished downloads", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "A package has finished downloading" })
        // Visible in the status bar (but silent): the user should see that something listens on the phone.
        nm.createNotificationChannel(NotificationChannel(CNL, "Click'n'Load active", NotificationManager.IMPORTANCE_LOW).apply { description = "Shown while websites can send links to this phone" })
        nm.createNotificationChannel(NotificationChannel(WATCH, "Watching for captchas", NotificationManager.IMPORTANCE_MIN).apply { description = "The permanent entry while the app watches the backend" })
    }

    // False if the user (or Android, before the permission is granted) blocks the notifications of this app.
    fun enabled(c: Context) = manager(c).areNotificationsEnabled()

    // The common look of the app's notifications: the arrow of the logo in green, the logo as large icon, nothing the system adds.
    fun builder(c: Context, channel: String, logo: Boolean = true): Notification.Builder =
        Notification.Builder(c, channel).setSmallIcon(R.drawable.ic_stat).setColor(ACCENT).setAllowSystemGeneratedContextualActions(false)
            .apply { if (logo) setLargeIcon(Icon.createWithResource(c, R.drawable.logo)) }

    // A tap opens the app.
    fun openApp(c: Context, request: Int = 0): PendingIntent = PendingIntent.getActivity(c, request, Intent(c, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)

    // Widget captchas open the solver, image captchas the interface (its dialog is the answer form).
    fun captcha(c: Context, id: Long, device: String, hoster: String, widget: Boolean, remainingMs: Long) {
        val open = if (widget) Intent(c, SolverActivity::class.java).putExtra("id", id.toString()).putExtra("device", device) else Intent(c, MainActivity::class.java)
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val intent = PendingIntent.getActivity(c, id.toInt(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = builder(c, CAPTCHA)
            .setContentTitle("Captcha waiting")
            .setContentText(if (widget) "$hoster: tap to solve it" else "$hoster: tap to answer it")
            .setContentIntent(intent).setAutoCancel(true).setCategory(Notification.CATEGORY_MESSAGE)
            .apply { if (remainingMs > 0) setTimeoutAfter(remainingMs) }
            .build()
        manager(c).notify(id.toInt(), n)
    }

    // A package finished downloading. The id comes from the package, so a repeat replaces the earlier message.
    fun downloadFinished(c: Context, uuid: Long, name: String, deviceName: String?) {
        manager(c).notify((uuid % 1_000_000_000L).toInt() + 100, builder(c, DOWNLOADS)
            .setContentTitle("Download finished").setContentText(name + (deviceName?.let { " ($it)" } ?: ""))
            .setContentIntent(openApp(c, 7)).setAutoCancel(true).setCategory(Notification.CATEGORY_STATUS).build())
    }

    // A plain one-off message (Click'n'Load result).
    fun info(c: Context, id: Int, title: String, text: String) {
        manager(c).notify(id, builder(c, CAPTCHA).setContentTitle(title).setContentText(text).setContentIntent(openApp(c)).setAutoCancel(true).build())
    }

    fun test(c: Context) = info(c, 2, "My Own JD", "Notifications work.")

    // Click'n'Load links wait for the user to pick the device (see ChooseDeviceActivity).
    fun chooseDevice(c: Context, waiting: Int) {
        val open = PendingIntent.getActivity(c, 6, Intent(c, ChooseDeviceActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        manager(c).notify(CHOOSE_ID, builder(c, CAPTCHA)
            .setContentTitle("Click'n'Load: which device?").setContentText(if (waiting > 1) "$waiting packages wait for a device" else "Tap to choose the device for the links")
            .setContentIntent(open).setAutoCancel(true).build())
    }

    const val CHOOSE_ID = 6

    fun cancel(c: Context, id: Long) = manager(c).cancel(id.toInt())
}
