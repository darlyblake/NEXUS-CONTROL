package com.nexuscontrol.agent

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import org.json.JSONObject
import java.util.UUID

/**
 * Visible foreground connection for a device explicitly paired by its owner.
 * The notification remains visible while the relay session is active.
 */
class RemoteAgentService : Service() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var client: RemoteRelayClient? = null
    private var ringtone: Ringtone? = null
    private var reconnectPending = false
    private var stoppedByUser = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Service distant actif — connexion en cours"))
        connect()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stoppedByUser = true
            client?.disconnect()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (client == null) connect()
        return START_STICKY
    }

    private fun connect() {
        if (stoppedByUser) return
        val remote = client ?: RemoteRelayClient(this).also { client = it }
        remote.setCommandHandler { message -> mainHandler.post { handleCommand(message) } }
        remote.connectSavedSession { status ->
            mainHandler.post {
                val safeStatus = status.take(160)
                val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.notify(NOTIFICATION_ID, buildNotification(safeStatus))
                if ((status.contains("interrompue", true) ||
                     status.contains("Déconnecté", true) ||
                     status.contains("impossible", true) ||
                     status.contains("Échec", true)) && !reconnectPending && !stoppedByUser) {
                    reconnectPending = true
                    mainHandler.postDelayed({
                        reconnectPending = false
                        if (!stoppedByUser) connect()
                    }, RECONNECT_DELAY_MS)
                }
            }
        }
    }

    private fun handleCommand(message: JSONObject) {
        val action = message.optString("action")
        val commandId = message.optString("commandId").ifBlank { UUID.randomUUID().toString() }
        when (action) {
            "location_request" -> sendLastKnownLocation(commandId)
            "ring_start" -> {
                try {
                    val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                    ringtone?.stop()
                    ringtone = RingtoneManager.getRingtone(this, uri)
                    ringtone?.play()
                    sendResult(commandId, action, true, "Sonnerie démarrée. Arrête-la depuis l'application ou avec la commande d'arrêt.")
                } catch (e: Exception) {
                    sendResult(commandId, action, false, "Sonnerie impossible : " + (e.message ?: "erreur"))
                }
            }
            "ring_stop" -> {
                ringtone?.stop()
                ringtone = null
                sendResult(commandId, action, true, "Sonnerie arrêtée.")
            }
            "show_message" -> {
                val text = message.optString("message").trim().take(240)
                if (text.isBlank()) {
                    sendResult(commandId, action, false, "Message vide.")
                } else {
                    showOwnerMessage(text)
                    sendResult(commandId, action, true, "Notification du propriétaire publiée.")
                }
            }
            else -> sendResult(commandId, action, false, "Commande non prise en charge par le service.")
        }
    }

    @Suppress("MissingPermission")
    private fun sendLastKnownLocation(commandId: String) {
        val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) {
            sendResult(commandId, "location_request", false, "Autorisation de localisation absente. Ouvre NEXUS CONTROL et accorde-la.")
            return
        }
        try {
            val manager = getSystemService(LOCATION_SERVICE) as LocationManager
            val location = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
                .filter { manager.isProviderEnabled(it) }
                .mapNotNull { provider -> try { manager.getLastKnownLocation(provider) } catch (_: SecurityException) { null } }
                .maxByOrNull { it.time }
            if (location == null) {
                sendResult(commandId, "location_request", false, "Aucune position connue. Active la localisation et réessaie.")
                return
            }
            val payload = JSONObject()
                .put("type", "command_result")
                .put("commandId", commandId)
                .put("action", "location_request")
                .put("ok", true)
                .put("latitude", location.latitude)
                .put("longitude", location.longitude)
                .put("accuracyMeters", location.accuracy.toDouble())
                .put("locationTime", location.time)
                .put("provider", location.provider ?: "unknown")
            client?.sendMessage(payload)
        } catch (e: Exception) {
            sendResult(commandId, "location_request", false, "Lecture de la position impossible : " + (e.message ?: "erreur"))
        }
    }

    private fun sendResult(commandId: String, action: String, ok: Boolean, detail: String) {
        client?.sendMessage(JSONObject()
            .put("type", "command_result")
            .put("commandId", commandId)
            .put("action", action)
            .put("ok", ok)
            .put("detail", detail)
            .put("timestamp", System.currentTimeMillis()))
    }

    private fun showOwnerMessage(text: String) {
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Message de NEXUS CONTROL")
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(openAppPendingIntent())
            .build()
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(MESSAGE_NOTIFICATION_ID, notification)
    }

    private fun buildNotification(status: String): Notification =
        Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle("NEXUS CONTROL — accès distant")
            .setContentText(status)
            .setStyle(Notification.BigTextStyle().bigText(status))
            .setOngoing(true)
            .setContentIntent(openAppPendingIntent())
            .addAction(
                android.R.drawable.ic_media_pause,
                "Arrêter",
                PendingIntent.getService(
                    this, 22, Intent(this, RemoteAgentService::class.java).setAction(ACTION_STOP),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )
            .build()

    private fun openAppPendingIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            this, 21, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "NEXUS CONTROL — service distant", NotificationManager.IMPORTANCE_LOW)
            channel.description = "État visible de la connexion distante activée par le propriétaire."
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        ringtone?.stop()
        ringtone = null
        client?.disconnect()
        client = null
        mainHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL_ID = "nexus_remote_agent"
        private const val NOTIFICATION_ID = 9101
        private const val MESSAGE_NOTIFICATION_ID = 9102
        private const val ACTION_STOP = "com.nexuscontrol.agent.STOP_REMOTE_SERVICE"
        private const val RECONNECT_DELAY_MS = 15_000L
    }
}
