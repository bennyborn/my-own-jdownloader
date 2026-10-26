package de.bennyborn.myjd

import android.util.Base64
import java.net.HttpURLConnection
import java.net.URL

class ApiResult(val status: Int, val body: String)

class Device(val id: String, val name: String, val online: Boolean)

// Calls to the backend (blocking: use a background thread). The backend wants the password as Basic auth, any user name.
object Api {
    fun request(base: String, password: String, method: String, path: String, body: String? = null): ApiResult {
        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 8000
            conn.readTimeout = 15000
            if (password.isNotEmpty()) conn.setRequestProperty("Authorization", "Basic " + Base64.encodeToString(":$password".toByteArray(), Base64.NO_WRAP))
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray()) }
            }
            val status = conn.responseCode
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            return ApiResult(status, stream?.bufferedReader()?.use { it.readText() } ?: "")
        } finally {
            conn.disconnect()
        }
    }

    fun devices(base: String, password: String): List<Device> {
        val res = request(base, password, "GET", "/api/devices")
        if (res.status != 200) throw java.io.IOException("HTTP ${res.status}")
        val list = org.json.JSONArray(res.body)
        return (0 until list.length()).map { list.getJSONObject(it) }.map { Device(it.getString("id"), it.optString("name"), it.optBoolean("online", true)) }
    }
}
