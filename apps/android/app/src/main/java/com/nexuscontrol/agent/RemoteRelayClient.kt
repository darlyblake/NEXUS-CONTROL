package com.nexuscontrol.agent

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class RemoteRelayClient(context: Context) {
    private val prefs = context.getSharedPreferences("nexus_agent", Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    @Volatile private var socket: WebSocket? = null

    fun pairAndConnect(baseUrl: String, pairCode: String, deviceId: String, onStatus: (String) -> Unit) {
        Thread {
            try {
                val base = baseUrl.trimEnd('/')
                val parsed = java.net.URI(base)
                if (parsed.scheme != "https" && parsed.host != "10.0.2.2" && parsed.host != "localhost") {
                    throw IllegalArgumentException("Le relais doit utiliser HTTPS.")
                }
                val body = JSONObject().put("pairCode", pairCode).put("deviceId", deviceId)
                    .toString().toRequestBody("application/json; charset=utf-8".toMediaType())
                val request = Request.Builder().url(base + "/api/pair/redeem").post(body).build()
                http.newCall(request).execute().use { response ->
                    val raw = response.body?.string().orEmpty()
                    val json = JSONObject(raw.ifBlank { "{}" })
                    if (!response.isSuccessful || !json.has("deviceToken") || !json.has("pairId")) {
                        throw IllegalStateException(json.optString("message", json.optString("error", "Association refusée (HTTP " + response.code + ").")))
                    }
                    val token = json.getString("deviceToken")
                    val pairId = json.getString("pairId")
                    prefs.edit().putString("relay_token", token).putString("relay_pair_id", pairId)
                        .putString("relay_base_url", base).putString("relay_device_id", deviceId).apply()
                    connect(base, deviceId, token, onStatus)
                }
            } catch (error: Exception) {
                onStatus("Échec de l'association : " + (error.message ?: error.javaClass.simpleName))
            }
        }.start()
    }

    private fun connect(baseUrl: String, deviceId: String, token: String, onStatus: (String) -> Unit) {
        val parsed = java.net.URI(baseUrl)
        val scheme = if (parsed.scheme == "https") "wss" else "ws"
        val authority = parsed.rawAuthority
        val wsUrl = scheme + "://" + authority + "/ws"
        val request = Request.Builder().url(wsUrl).build()
        socket?.close(1000, "reconnect")
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(JSONObject().put("type", "auth").put("deviceId", deviceId).put("token", token).toString())
                onStatus("Connexion au relais établie, authentification en cours…")
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val message = JSONObject(text)
                    when (message.optString("type")) {
                        "authenticated" -> onStatus("Téléphone authentifié auprès du relais.")
                        "peer_status" -> onStatus(if (message.optBoolean("connected")) "PC et téléphone sont connectés au relais." else "Relais connecté ; en attente du PC.")
                    }
                } catch (_: Exception) { onStatus("Message reçu du relais.") }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                onStatus("Connexion distante interrompue : " + (t.message ?: "erreur réseau"))
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onStatus("Déconnecté du relais.")
            }
        })
    }

    fun disconnect() {
        socket?.close(1000, "user_disconnect")
        socket = null
    }
}
