package app.myownjd

import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import kotlin.concurrent.thread

// Click'n'Load on the phone: websites send their links to "a JDownloader on this computer" (http://127.0.0.1:9666). This is that
// JDownloader. It only listens on the phone itself (loopback) and hands the links to the backend, like the browser extension does on
// a computer. Started and stopped by the BackgroundService.
class CnlServer(private val ctx: Context) {
    @Volatile private var socket: ServerSocket? = null
    @Volatile private var stopped = false

    fun start() {
        thread { serve() }
    }

    fun stop() {
        stopped = true
        socket?.close()
        socket = null
    }

    private fun serve() {
        val s = try {
            ServerSocket(PORT, 20, InetAddress.getByName("127.0.0.1"))
        } catch (e: Exception) {
            // Something else holds the port: switch the feature off again, so the button and the entry tell the truth.
            Notifier.info(ctx, 4, "Click'n'Load", "Port $PORT is in use, Click'n'Load could not start")
            Config.setCnl(ctx, false)
            BackgroundService.sync(ctx)
            return
        }
        if (stopped) return s.close()
        socket = s
        while (!s.isClosed) {
            val client = try { s.accept() } catch (e: Exception) { break }
            thread { try { handle(client) } catch (e: Exception) { /* a broken request is dropped */ } }
        }
    }

    private class Request(val method: String, val path: String, val query: String, val headers: Map<String, String>, val body: ByteArray)

    private fun readRequest(input: BufferedInputStream): Request? {
        val head = ByteArrayOutputStream()
        while (head.size() < 16384) {
            val b = input.read()
            if (b < 0) return null
            head.write(b)
            val a = head.toByteArray()
            if (a.size >= 4 && a[a.size - 4] == '\r'.code.toByte() && a[a.size - 3] == '\n'.code.toByte() && a[a.size - 2] == '\r'.code.toByte() && a[a.size - 1] == '\n'.code.toByte()) break
        }
        val lines = head.toString("ISO-8859-1").split("\r\n")
        val parts = lines[0].split(" ")
        if (parts.size < 2) return null
        val target = parts[1]
        val headers = lines.drop(1).mapNotNull { val i = it.indexOf(':'); if (i > 0) it.substring(0, i).trim().lowercase() to it.substring(i + 1).trim() else null }.toMap()
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        if (length > MAX_BODY) return null
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) break
            read += n
        }
        return Request(parts[0], target.substringBefore('?'), target.substringAfter('?', ""), headers, body)
    }

    private fun decode(s: String) = URLDecoder.decode(s, "UTF-8")

    private fun formFields(text: String): Map<String, String> =
        text.split('&').filter { it.contains('=') }.associate { decode(it.substringBefore('=')) to decode(it.substringAfter('=')) }

    // Pages post either a URL-encoded form or FormData (multipart).
    private fun fields(req: Request): Map<String, String> {
        val all = HashMap(formFields(req.query))
        val type = req.headers["content-type"] ?: ""
        val text = String(req.body, Charsets.UTF_8)
        if (type.startsWith("multipart/form-data")) {
            val boundary = type.substringAfter("boundary=", "").trim('"')
            if (boundary.isNotEmpty()) for (part in text.split("--$boundary")) {
                val split = part.indexOf("\r\n\r\n")
                val name = Regex("name=\"([^\"]*)\"").find(part.take(if (split > 0) split else 0))?.groupValues?.get(1)
                if (split > 0 && name != null) all[name] = part.substring(split + 4).removeSuffix("\r\n")
            }
        } else if (text.isNotEmpty()) all.putAll(formFields(text))
        return all
    }

    private fun respond(client: Socket, status: String, type: String, body: String, req: Request?) {
        val bytes = body.toByteArray()
        val allowHeaders = req?.headers?.get("access-control-request-headers") ?: "*"
        val head = "HTTP/1.1 $status\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: $allowHeaders\r\nContent-Type: $type\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        client.getOutputStream().apply {
            write(head.toByteArray())
            write(bytes)
            flush()
        }
    }

    private fun handle(client: Socket) = client.use {
        it.soTimeout = 10000
        val req = readRequest(BufferedInputStream(it.getInputStream())) ?: return@use
        when {
            req.method == "OPTIONS" -> respond(it, "204 No Content", "text/plain", "", req)
            req.path == "/jdcheck.js" -> respond(it, "200 OK", "application/javascript", "var jdownloader = true;", req)
            req.path == "/flash" || req.path == "/flash/" -> respond(it, "200 OK", "text/plain", "JDownloader", req)
            req.path == "/crossdomain.xml" -> respond(it, "200 OK", "text/xml", "<?xml version=\"1.0\"?><cross-domain-policy><allow-access-from domain=\"*\"/></cross-domain-policy>", req)
            req.path == "/flash/addcrypted2" || req.path == "/flash/add" -> {
                val ok = forward(req, fields(req))
                respond(it, if (ok) "200 OK" else "500 Internal Server Error", "text/plain", if (ok) "success\r\n" else "failed\r\n", req)
            }
            else -> respond(it, "404 Not Found", "text/plain", "Not found", req)
        }
    }

    // Same payload as the extension sends to the backend; the device follows the setting (default, fixed, ask).
    private fun forward(req: Request, p: Map<String, String>): Boolean {
        val referrer = req.headers["referer"] ?: req.headers["origin"]
        val payload = JSONObject()
        fun put(key: String, value: String?) { if (!value.isNullOrEmpty()) payload.put(key, value) }
        if (req.path == "/flash/addcrypted2") {
            put("crypted", p["crypted"]); put("jk", p["jk"]); put("key", p["k"])
        } else put("urls", p["urls"])
        put("passwords", p["passwords"]); put("packageName", p["package"]); put("source", p["source"] ?: referrer); put("referrer", referrer)
        return Cnl.route(ctx, "/api/linkgrabber/cnl", payload, false)
    }

    private companion object {
        const val PORT = 9666
        const val MAX_BODY = 5_000_000
    }
}

// Links that wait for the user to choose a device (kept in memory, like a pending page in the extension): endpoint + payload.
object CnlPending {
    private val items = ArrayList<Pair<String, JSONObject>>()
    @Synchronized fun add(path: String, payload: JSONObject) { items.add(path to payload) }
    @Synchronized fun first(): Pair<String, JSONObject>? = items.firstOrNull()
    @Synchronized fun removeFirst() { if (items.isNotEmpty()) items.removeAt(0) }
    @Synchronized fun size() = items.size
}

// Links that come from outside the interface (Click'n'Load from a page, "share" from another app) go to the device the user chose.
object Cnl {
    // Follows the device setting: the default device, a fixed one, or ask (a notification, or at once when the app is in front).
    fun route(c: Context, path: String, payload: JSONObject, foreground: Boolean): Boolean {
        val base = Config.url(c) ?: return false
        val choice = Config.cnlDevice(c)
        if (choice != "ask") return deliver(c, path, payload, choice, null)
        // Only devices that answer count: with one of them there is nothing to choose, with none the default fails visibly.
        val online = try { Api.devices(base, Config.password(c)).filter { it.online } } catch (e: Exception) { emptyList() }
        if (online.size > 1) {
            CnlPending.add(path, payload)
            if (foreground) c.startActivity(Intent(c, ChooseDeviceActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) else Notifier.chooseDevice(c, CnlPending.size())
            return true
        }
        return deliver(c, path, payload, online.singleOrNull()?.id ?: "", null)
    }

    // Hands the links to the backend; device '' = its default device. Tells the user what came of it.
    fun deliver(c: Context, path: String, payload: JSONObject, device: String, deviceName: String?): Boolean {
        val base = Config.url(c) ?: return false
        if (device.isNotEmpty()) payload.put("device", device)
        val title = if (path.endsWith("/cnl")) "Click'n'Load" else "Shared links"
        val name = payload.optString("packageName").takeIf { it.isNotEmpty() }
        return try {
            val res = Api.request(base, Config.password(c), "POST", path, payload.toString())
            if (res.status in 200..299) {
                Notifier.info(c, 5, title, "Links sent to " + (deviceName ?: "JDownloader") + (name?.let { ": $it" } ?: ""))
                true
            } else {
                Notifier.info(c, 5, title, "The backend refused the links (${res.status})")
                false
            }
        } catch (e: Exception) {
            Notifier.info(c, 5, title, "Cannot reach the backend")
            false
        }
    }
}
