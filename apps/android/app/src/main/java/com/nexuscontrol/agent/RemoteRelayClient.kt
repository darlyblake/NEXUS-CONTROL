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

class RemoteRelayClient(private val context: Context) {
    private val prefs = context.getSharedPreferences("nexus_agent", Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    @Volatile private var socket: WebSocket? = null
    @Volatile private var commandHandler: ((JSONObject) -> Unit)? = null

    fun setCommandHandler(handler: (JSONObject) -> Unit) { commandHandler = handler }

    fun sendMessage(message: JSONObject): Boolean = socket?.send(message.toString()) == true

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
                    onStatus("Association enregistrée. Démarrage du service distant visible…")
                    val serviceIntent = android.content.Intent(context, RemoteAgentService::class.java)
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent)
                    } else {
                        context.startService(serviceIntent)
                    }
                    onStatus("Service distant demandé. Vérifie sa notification et l'état de connexion.")
                }
            } catch (error: Exception) {
                onStatus("Échec de l'association : " + (error.message ?: error.javaClass.simpleName))
            }
        }.start()
    }

    
    fun connectSavedSession(onStatus: (String) -> Unit) {
        val base = prefs.getString("relay_base_url", null)
        val token = prefs.getString("relay_token", null)
        val deviceId = prefs.getString("relay_device_id", null)
        if (base.isNullOrBlank() || token.isNullOrBlank() || deviceId.isNullOrBlank()) {
            onStatus("Aucune association enregistrée. Associe d'abord cet appareil depuis l'application.")
            return
        }
        try {
            connect(base, deviceId, token, onStatus)
        } catch (error: Exception) {
            onStatus("Connexion au relais impossible : " + (error.message ?: error.javaClass.simpleName))
        }
    }
\n    private fun connect(baseUrl: String, deviceId: String, token: String, onStatus: (String) -> Unit) {
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
                        "command" -> {
                            val action = message.optString("action")
                            if (action in setOf("location_request", "ring_start", "ring_stop", "show_message", "device_info", "installed_apps")) {
                                commandHandler?.invoke(message)
                            } else {
                                onStatus("Commande refusée : action inconnue.")
                            }
                        }
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

    fun revoke(onStatus: (String) -> Unit) {
        Thread {
            try {
                val base = prefs.getString("relay_base_url", null)
                val token = prefs.getString("relay_token", null)
                if (base.isNullOrBlank() || token.isNullOrBlank()) {
                    prefs.edit().remove("relay_token").remove("relay_pair_id").apply()
                    disconnect()
                    context.stopService(android.content.Intent(context, RemoteAgentService::class.java))
                    onStatus("Aucun jeton local enregistré.")
                    return@Thread
                }
                val request = Request.Builder().url(base.trimEnd('/') + "/api/revoke")
                    .header("Authorization", "Bearer " + token)
                    .post("{}".toRequestBody("application/json; charset=utf-8".toMediaType()))
                    .build()
                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IllegalStateException("Le serveur n'a pas confirmé la révocation (HTTP " + response.code + "). Réessaie quand le relais est accessible.")
                    }
                }
                disconnect()
                prefs.edit().remove("relay_token").remove("relay_pair_id").remove("relay_base_url").apply()
                context.stopService(android.content.Intent(context, RemoteAgentService::class.java))
                onStatus("Association révoquée côté serveur et jeton local supprimé.")
            } catch (error: Exception) {
                onStatus("Révocation impossible : " + (error.message ?: error.javaClass.simpleName))
            }
        }.start()
    }

    fun disconnect() {
        socket?.close(1000, "user_disconnect")
        socket = null
    }
}
