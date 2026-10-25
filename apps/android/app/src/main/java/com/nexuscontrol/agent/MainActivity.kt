package com.nexuscontrol.agent

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.content.pm.PackageManager
import android.view.Gravity
import android.view.View
import android.widget.*
import java.net.Inet4Address
import java.net.NetworkInterface

class MainActivity : Activity() {
    private val navy = Color.rgb(12, 22, 43)
    private val panel = Color.rgb(23, 38, 64)
    private val accent = Color.rgb(75, 154, 255)
    private val textColor = Color.rgb(239, 244, 255)
    private val muted = Color.rgb(170, 187, 211)
    private lateinit var root: LinearLayout
    private val prefs by lazy { getSharedPreferences("nexus_agent", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
    }

    @Deprecated("Used for compatibility with the minimal Android scaffold")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 2001) {
            val message = if (resultCode == RESULT_OK) {
                "Autorisation accordée pour cette session. Le flux d'écran n'est pas encore transmis à un ordinateur."
            } else "Capture annulée : aucune capture n'a été démarrée."
            dialog("Capture d'écran", message)
        } else if (requestCode == 2002 && resultCode == RESULT_OK) {
            dialog("Fichier sélectionné", "Fichier choisi par l'utilisateur. Le transfert réseau sera disponible après l'intégration du protocole sécurisé.")
        }
    }

    private fun buildUi() {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(22), dp(20), dp(28))
            setBackgroundColor(navy)
        }
        val scroll = ScrollView(this).apply { addView(root) }
        setContentView(scroll)

        label("NEXUS CONTROL", 12f, accent, true)
        label("NEXUS Agent", 30f, textColor, true)
        label("Agent Android • accès explicite et révocable", 14f, muted, false)
        space(18)
        section("ÉTAT DE L'APPAREIL")
        card {
            label("${Build.MANUFACTURER} ${Build.MODEL}", 19f, textColor, true)
            label("Android ${Build.VERSION.RELEASE} • API ${Build.VERSION.SDK_INT}", 13f, muted, false)
            label("Réseau local : ${localIp()}", 14f, muted, false)
            label("État : agent local • aucun contrôleur distant connecté", 13f, Color.rgb(255, 204, 120), false)
        }
        section("FONCTIONS")
        action("Autoriser la capture d'écran", "Android affichera sa boîte de dialogue système.") {
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            @Suppress("DEPRECATION")
            startActivityForResult(manager.createScreenCaptureIntent(), 2001)
        }
        action("Choisir un fichier à envoyer", "Ouvre le sélecteur de fichiers Android.") {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"; addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            @Suppress("DEPRECATION")
            startActivityForResult(intent, 2002)
        }
        action("Consulter les applications installées", "Affiche l'inventaire local visible pour cette application.") { showInstalledApps() }
        action("Gérer les autorisations Android", "Ouvre les paramètres de cette application.") {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(android.net.Uri.parse("package:$packageName")))
        }
        action("Autoriser les fonctions d'accessibilité", "Activation manuelle dans les paramètres Android. Le service reste inactif dans cette version.") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        section("APPAREILS DE CONFIANCE")
        label("Liste locale enregistrée sur ce téléphone. Elle ne remplace pas l'authentification réseau.", 13f, muted, false)
        action("Ajouter un appareil de confiance", "Enregistre un nom et un identifiant fournis par le propriétaire.") { addTrustedDevice() }
        renderTrustedDevices()
        section("SÉCURITÉ")
        label("• Pas d'accès caché ni d'autorisation silencieuse\n• La capture exige l'accord Android\n• Les accès enregistrés peuvent être révoqués\n• Connexion USB/Wi-Fi et relais distant : intégration réseau à venir", 14f, muted, false)
    }

    private fun showInstalledApps() {
        val pm = packageManager
        val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
            .filter { pm.getLaunchIntentForPackage(it.packageName) != null }
            .sortedBy { pm.getApplicationLabel(it).toString().lowercase() }
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(10), dp(18), dp(10)) }
        body.addView(TextView(this).apply {
            text = "Applications visibles : ${apps.size}\n\n" + apps.take(100).joinToString("\n") {
                "• ${pm.getApplicationLabel(it)}\n  ${it.packageName}"
            } + if (apps.size > 100) "\n… liste limitée aux 100 premières." else ""
            setTextColor(textColor); textSize = 13f
        })
        AlertDialogBuilder(this).showList("Applications installées", body)
    }

    private fun addTrustedDevice() {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0) }
        val name = EditText(this).apply { hint = "Nom (ex. Mon ordinateur Ubuntu)"; setTextColor(textColor); setHintTextColor(muted) }
        val id = EditText(this).apply { hint = "Identifiant d'appareil / empreinte"; setTextColor(textColor); setHintTextColor(muted) }
        box.addView(name); box.addView(id)
        android.app.AlertDialog.Builder(this).setTitle("Ajouter à la liste locale").setView(box)
            .setNegativeButton("Annuler", null)
            .setPositiveButton("Enregistrer") { _, _ ->
                val n = name.text.toString().trim()
                val i = id.text.toString().trim()
                if (n.isEmpty() || i.isEmpty()) dialog("Champs requis", "Saisis un nom et un identifiant.")
                else {
                    val current = prefs.getStringSet("trusted", emptySet())!!.toMutableSet()
                    current.add("$n|$i")
                    prefs.edit().putStringSet("trusted", current).apply()
                    buildUi()
                }
            }.show()
    }

    private fun renderTrustedDevices() {
        val devices = prefs.getStringSet("trusted", emptySet())!!.toList().sorted()
        if (devices.isEmpty()) label("Aucun appareil enregistré.", 13f, muted, false)
        devices.forEach { entry ->
            val parts = entry.split("|", limit = 2)
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val t = TextView(this).apply {
                text = "${parts.getOrElse(0) { "Appareil" }}\n${parts.getOrElse(1) { "" }}"
                setTextColor(textColor); textSize = 13f
                layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            }
            val revoke = Button(this).apply { text = "Révoquer"; setOnClickListener {
                val updated = prefs.getStringSet("trusted", emptySet())!!.toMutableSet()
                updated.remove(entry); prefs.edit().putStringSet("trusted", updated).apply(); buildUi()
            } }
            row.addView(t); row.addView(revoke); root.addView(row)
        }
    }

    private fun action(title: String, subtitle: String, onClick: () -> Unit) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(14))
            setBackgroundColor(panel); isClickable = true; isFocusable = true; setOnClickListener { onClick() }
        }
        box.addView(TextView(this).apply { text = title; textSize = 16f; setTextColor(textColor); setTypeface(null, 1) })
        box.addView(TextView(this).apply { text = subtitle; textSize = 12f; setTextColor(muted); setPadding(0, dp(4), 0, 0) })
        val lp = LinearLayout.LayoutParams(-1, -2); lp.bottomMargin = dp(9)
        root.addView(box, lp)
    }

    private fun card(content: LinearLayout.() -> Unit) {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(16), dp(16), dp(16)); setBackgroundColor(panel); content() }
        val lp = LinearLayout.LayoutParams(-1, -2); lp.bottomMargin = dp(8); root.addView(box, lp)
    }

    private fun section(s: String) { space(16); label(s, 12f, accent, true); space(8) }
    private fun label(s: String, size: Float, color: Int, bold: Boolean) {
        root.addView(TextView(this).apply { text = s; textSize = size; setTextColor(color); if (bold) setTypeface(null, 1) })
    }
    private fun space(h: Int) { root.addView(View(this), LinearLayout.LayoutParams(1, dp(h))) }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun dialog(title: String, message: String) { android.app.AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("OK", null).show() }

    private fun localIp(): String = try {
        NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address && !it.isLoopbackAddress && it.hostAddress?.startsWith("169.254.") == false }
            ?.hostAddress ?: "non disponible"
    } catch (_: Exception) { "non disponible" }
}

private class AlertDialogBuilder(private val context: Context) {
    fun showList(title: String, body: View) {
        android.app.AlertDialog.Builder(context).setTitle(title).setView(ScrollView(context).apply { addView(body) })
            .setPositiveButton("Fermer", null).show()
    }
}
