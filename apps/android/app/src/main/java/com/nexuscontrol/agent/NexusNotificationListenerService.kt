package com.nexuscontrol.agent

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/**
 * Service d'écoute des notifications Android pour NEXUS CONTROL.
 * Transmet les notifications des applications autorisées au centre de contrôle PC.
 */
class NexusNotificationListenerService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val packageName = sbn.packageName ?: return
        // Ignorer les notifications de notre propre application pour éviter les boucles
        if (packageName == applicationContext.packageName) return

        val extras = sbn.notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        // Ne pas transmettre les notifications vides
        if (title.isBlank() && text.isBlank()) return

        val pm = applicationContext.packageManager
        val appName = try {
            val appInfo = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(appInfo).toString()
        } catch (_: Exception) {
            packageName
        }

        val payload = JSONObject().apply {
            put("type", "notification_received")
            put("id", sbn.key)
            put("package", packageName)
            put("appName", appName)
            put("title", title)
            put("text", text)
            put("timestamp", sbn.postTime)
            put("canReply", extras.containsKey(Notification.EXTRA_ACTIONS))
        }

        // Sauvegarder dans les préférences locales pour consultation / relai
        val prefs = applicationContext.getSharedPreferences("nexus_continuity", Context.MODE_PRIVATE)
        prefs.edit().putString("last_synced_notification", payload.toString()).apply()
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        super.onNotificationRemoved(sbn)
        // Possibilité de notifier le retrait côté PC
    }
}
