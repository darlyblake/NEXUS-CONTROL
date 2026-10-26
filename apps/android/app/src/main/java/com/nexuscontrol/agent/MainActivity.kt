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
import android.net.Uri
import android.location.LocationManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.Manifest
import org.json.JSONObject
import android.content.ClipboardManager
import android.content.ClipData
import android.database.Cursor
import android.provider.OpenableColumns
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import java.io.File
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
    private lateinit var sendTarget: EditText
    private lateinit var sendToken: EditText
    private lateinit var transferStatus: TextView
    private var selectedFile: Uri? = null
    private var selectedFileName: String = ""
    private var receiver: LocalTransferServer? = null
    private var remoteClient: RemoteRelayClient? = null
    private var remoteStatusView: TextView? = null
    private var activeRingtone: Ringtone? = null
    private var pendingLocationCommandId: String? = null
    private var receiverToken: String = UUID.randomUUID().toString().replace("-", "")
    private val prefs by lazy { getSharedPreferences("nexus_agent", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
    }

    @Deprecated("Used for compatibility with the minimal Android scaffold")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 2001) {
            dialog("Capture d'écran", if (resultCode == RESULT_OK) "Autorisation accordée. Le flux d'écran distant n'est pas encore intégré." else "Capture annulée.")
        } else if (requestCode == 2002 && resultCode == RESULT_OK) {
            selectedFile = data?.data
            selectedFileName = selectedFile?.let { displayName(it) } ?: ""
            if (::transferStatus.isInitialized) transferStatus.text = if (selectedFile != null) "Fichier choisi : " + selectedFileName else "Aucun fichier choisi."
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 3101) {
            val commandId = pendingLocationCommandId
            pendingLocationCommandId = null
            if (commandId != null) {
                if (grantResults.any { it == PackageManager.PERMISSION_GRANTED }) sendLastKnownLocation(commandId)
                else sendCommandResult(commandId, "location_request", false, "Autorisation de localisation refusée.")
            }
        }
    }

    private fun configureRemoteClient(): RemoteRelayClient {
        if (remoteClient == null) remoteClient = RemoteRelayClient(this)
        val client = remoteClient!!
        client.setCommandHandler { message -> runOnUiThread { handleRemoteCommand(message) } }
        return client
    }

    private fun handleRemoteCommand(message: JSONObject) {
        val action = message.optString("action")
        val commandId = message.optString("commandId").ifBlank { UUID.randomUUID().toString() }
        when (action) {
            "location_request" -> {
                val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                val coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                if (!fine && !coarse) {
                    pendingLocationCommandId = commandId
                    requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 3101)
                } else sendLastKnownLocation(commandId)
            }
            "ring_start" -> {
                try {
                    val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                    activeRingtone?.stop()
                    activeRingtone = RingtoneManager.getRingtone(this, uri)
                    activeRingtone?.play()
                    sendCommandResult(commandId, action, true, "Sonnerie démarrée. Arrêt possible depuis l'application.")
                } catch (error: Exception) {
                    sendCommandResult(commandId, action, false, "Impossible de démarrer la sonnerie : " + (error.message ?: "erreur"))
                }
            }
            "ring_stop" -> {
                activeRingtone?.stop()
                activeRingtone = null
                sendCommandResult(commandId, action, true, "Sonnerie arrêtée.")
            }
            "show_message" -> {
                val text = message.optString("message").trim().take(240)
                if (text.isBlank()) sendCommandResult(commandId, action, false, "Message vide.")
                else {
                    dialog("Message du propriétaire", text)
                    sendCommandResult(commandId, action, true, "Message affiché dans l'application ouverte.")
                }
            }
        }
    }

    @Suppress("MissingPermission")
    private fun sendLastKnownLocation(commandId: String) {
        val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) {
            sendCommandResult(commandId, "location_request", false, "Autorisation de localisation absente.")
            return
        }
        try {
            val manager = getSystemService(LOCATION_SERVICE) as LocationManager
            val location = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
                .filter { manager.isProviderEnabled(it) }
                .mapNotNull { provider -> try { manager.getLastKnownLocation(provider) } catch (_: SecurityException) { null } }
                .maxByOrNull { it.time }
            if (location == null) {
                sendCommandResult(commandId, "location_request", false, "Aucune position connue disponible. Active le GPS et réessaie.")
                return
            }
            val payload = JSONObject()
                .put("type", "command_result").put("commandId", commandId).put("action", "location_request")
                .put("ok", true).put("latitude", location.latitude).put("longitude", location.longitude)
                .put("accuracyMeters", location.accuracy.toDouble()).put("locationTime", location.time)
                .put("provider", location.provider ?: "unknown")
            configureRemoteClient().sendMessage(payload)
        } catch (error: Exception) {
            sendCommandResult(commandId, "location_request", false, "Lecture de la position impossible : " + (error.message ?: "erreur"))
        }
    }

    private fun sendCommandResult(commandId: String, action: String, ok: Boolean, detail: String) {
        configureRemoteClient().sendMessage(JSONObject().put("type", "command_result").put("commandId", commandId)
            .put("action", action).put("ok", ok).put("detail", detail).put("timestamp", System.currentTimeMillis()))
    }

    private fun buildUi() = showPage("home")

    private fun showPage(page: String) {
        // Structure verticale : contenu défilant en haut, barre de navigation fixe en bas.
        val frame = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(navy)
        }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(20), dp(16), dp(16))
            setBackgroundColor(navy)
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root)
        }
        frame.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        val bottomNav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(5), dp(4), dp(5))
            setBackgroundColor(Color.rgb(8, 16, 32))
            elevation = dp(10).toFloat()
        }
        val menu = listOf(
            Triple("home", "⌂", "Accueil"),
            Triple("send", "↑", "Envoyer"),
            Triple("receive", "↓", "Réception"),
            Triple("device", "▣", "Appareil"),
            Triple("remote", "↔", "Distant"),
            Triple("security", "◇", "Sécurité")
        )
        menu.forEach { item ->
            val selected = page == item.first
            val navItem = TextView(this).apply {
                text = item.second + "\\n" + item.third
                gravity = Gravity.CENTER
                textSize = 10f
                setLineSpacing(0f, 1f)
                setTextColor(if (selected) accent else muted)
                setTypeface(null, if (selected) 1 else 0)
                setPadding(dp(2), dp(7), dp(2), dp(7))
                if (selected) setBackgroundColor(panel)
                isClickable = true
                isFocusable = true
                contentDescription = item.third
                setOnClickListener { showPage(item.first) }
            }
            bottomNav.addView(navItem, LinearLayout.LayoutParams(0, -1, 1f))
        }
        frame.addView(bottomNav, LinearLayout.LayoutParams(-1, dp(62)))
        setContentView(frame)

        when (page) {
            "home" -> {
                label("NEXUS CONTROL", 12f, accent, true)
                label("Centre de contrôle", 24f, textColor, true)
                label("Transferts locaux et gestion de cet appareil.", 13f, muted, false)
                section("ÉTAT DE L'APPAREIL")
                card {
                    label(Build.MANUFACTURER + " " + Build.MODEL, 18f, textColor, true)
                    label("Android " + Build.VERSION.RELEASE + " • API " + Build.VERSION.SDK_INT, 13f, muted, false)
                    label("Adresse IP : " + localIp(), 13f, muted, false)
                    label(if (receiver?.isRunning == true) "Réception : active" else "Réception : arrêtée", 13f, if (receiver?.isRunning == true) Color.rgb(94, 220, 155) else muted, false)
                }
                section("ACCÈS RAPIDE")
                action("↑  Envoyer un fichier", "Vers un récepteur compatible sur le même Wi-Fi.") { showPage("send") }
                action("↓  Recevoir des fichiers", "Activer le récepteur et afficher son adresse et son jeton.") { showPage("receive") }
                action("Appareil et autorisations", "Informations Android et autorisations locales.") { showPage("device") }
            }
            "send" -> buildSendPage()
            "receive" -> buildReceivePage()
            "device" -> buildDevicePage()
            "remote" -> buildRemotePage()
            "security" -> buildSecurityPage()
        }
    }

    private fun buildSendPage() {
        label("TRANSFERT DE FICHIERS", 12f, accent, true)
        label("Envoyer", 26f, textColor, true)
        label("Le destinataire doit activer Réception et être joignable sur le même réseau Wi-Fi.", 13f, muted, false)
        section("DESTINATAIRE")
        sendTarget = EditText(this).apply {
            hint = "http://192.168.1.20:8765"
            setSingleLine(true); setTextColor(textColor); setHintTextColor(muted)
            setPadding(dp(12), dp(12), dp(12), dp(12)); setBackgroundColor(panel)
        }
        root.addView(sendTarget, LinearLayout.LayoutParams(-1, -2))
        space(10)
        sendToken = EditText(this).apply {
            hint = "Jeton affiché sur l'appareil destinataire"
            setSingleLine(true); setTextColor(textColor); setHintTextColor(muted)
            setPadding(dp(12), dp(12), dp(12), dp(12)); setBackgroundColor(panel)
        }
        root.addView(sendToken, LinearLayout.LayoutParams(-1, -2))
        space(10)
        action("Choisir un fichier", "Ouvre le sélecteur Android.") {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            @Suppress("DEPRECATION")
            startActivityForResult(intent, 2002)
        }
        transferStatus = TextView(this).apply {
            text = if (selectedFile != null) "Fichier choisi : " + selectedFileName else "Aucun fichier sélectionné."
            textSize = 13f; setTextColor(muted); setPadding(0, dp(8), 0, dp(12))
        }
        root.addView(transferStatus)
        action("Envoyer maintenant", "Envoie le fichier après validation du jeton.") { sendSelectedFile() }
        section("LIMITE")
        label("Ce transfert fonctionne sur le réseau local. Le protocole Internet sécurisé de NEXUS CONTROL reste à développer.", 12f, muted, false)
    }

    private fun buildReceivePage() {
        label("TRANSFERT DE FICHIERS", 12f, accent, true)
        label("Réception", 26f, textColor, true)
        label("Active cette page pour recevoir un fichier d'un appareil compatible sur le même réseau.", 13f, muted, false)
        section("RÉCEPTEUR")
        card {
            label(if (receiver?.isRunning == true) "● Récepteur actif" else "○ Récepteur arrêté", 17f, if (receiver?.isRunning == true) Color.rgb(94, 220, 155) else Color.rgb(255, 190, 100), true)
            if (receiver?.isRunning == true) {
                label("Adresse : http://" + localIp() + ":8765", 13f, textColor, true)
                label("Jeton : " + receiverToken, 12f, muted, false)
            } else {
                label("Démarre la réception pour afficher l'adresse et le jeton.", 13f, muted, false)
            }
        }
        if (receiver?.isRunning == true) {
            action("Copier l'adresse et le jeton", "Colle-les dans NEXUS CONTROL sur le PC.") {
                val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("NEXUS réception", "http://" + localIp() + ":8765\n" + receiverToken))
                dialog("Informations copiées", "L'adresse locale et le jeton sont dans le presse-papiers.")
            }
        }
        action(if (receiver?.isRunning == true) "Arrêter la réception" else "Démarrer la réception", "Le serveur n'est actif que lorsque tu l'as démarré.") {
            if (receiver?.isRunning == true) {
                receiver?.stop()
                receiver = null
                showPage("receive")
            } else {
                try {
                    receiverToken = UUID.randomUUID().toString().replace("-", "")
                    receiver = LocalTransferServer(this, receiverToken) { file ->
                        runOnUiThread { showPage("receive"); dialog("Fichier reçu", "Fichier enregistré : " + file.name) }
                    }.also { it.start() }
                    showPage("receive")
                } catch (error: Exception) {
                    dialog("Erreur de réception", error.message ?: "Impossible de démarrer le récepteur.")
                }
            }
        }
        section("FICHIERS REÇUS")
        val dir = File(getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS), "NexusReceived")
        val files = dir.listFiles()?.filter { it.isFile }?.sortedByDescending { it.lastModified() } ?: emptyList()
        if (files.isEmpty()) label("Aucun fichier reçu pour le moment.", 13f, muted, false)
        files.forEach { file ->
            card {
                label(file.name, 14f, textColor, true)
                label(file.length().toString() + " octets", 12f, muted, false)
            }
        }
        section("SÉCURITÉ")
        label("Utilise uniquement un Wi-Fi de confiance. Le transfert local est limité à 100 Mo par fichier, protégé par un jeton temporaire mais n'utilise pas HTTPS. Arrête la réception après usage.", 12f, muted, false)
    }

    private fun buildDevicePage() {
        label("APPAREIL", 12f, accent, true)
        label("Informations et autorisations", 23f, textColor, true)
        section("IDENTITÉ")
        card {
            label(Build.MANUFACTURER + " " + Build.MODEL, 18f, textColor, true)
            label("Android " + Build.VERSION.RELEASE + " • API " + Build.VERSION.SDK_INT, 13f, muted, false)
            label("Adresse IP : " + localIp(), 13f, muted, false)
        }
        action("Autoriser la localisation", "Accorde la permission pendant que l'application est ouverte pour permettre les demandes de position à distance.") {
            val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            if (fine || coarse) dialog("Localisation", "Une permission de localisation est déjà accordée.")
            else requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 3101)
        }
        action("Autoriser la capture d'écran", "Android demande confirmation ; le flux distant n'est pas encore intégré.") {
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            @Suppress("DEPRECATION")
            startActivityForResult(manager.createScreenCaptureIntent(), 2001)
        }
        action("Applications installées", "Affiche les applications locales visibles.") { showInstalledApps() }
        action("Paramètres de l'application", "Gérer les autorisations Android.") {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(android.net.Uri.parse("package:" + packageName)))
        }
        action("Paramètres d'accessibilité", "Activation manuelle uniquement.") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        section("APPAREILS DE CONFIANCE")
        label("Liste locale indicative ; elle ne remplace pas l'authentification réseau.", 12f, muted, false)
        action("Ajouter un appareil", "Enregistrer un nom et un identifiant localement.") { addTrustedDevice() }
        renderTrustedDevices()
    }

    private fun buildRemotePage() {
        label("ACCÈS DISTANT", 12f, accent, true)
        label("Associer au PC", 23f, textColor, true)
        label("Le PC et le téléphone peuvent être sur des réseaux différents. Un relais NEXUS accessible en HTTPS/WSS est nécessaire.", 13f, muted, false)
        section("RELAIS SÉCURISÉ")
        val relayUrl = EditText(this).apply {
            hint = "https://relais.ton-domaine.tld"
            setSingleLine(true); setTextColor(textColor); setHintTextColor(muted)
            setPadding(dp(12), dp(12), dp(12), dp(12)); setBackgroundColor(panel)
            setText(prefs.getString("relay_base_url", "") ?: "")
        }
        root.addView(relayUrl, LinearLayout.LayoutParams(-1, -2))
        space(10)
        val pairCode = EditText(this).apply {
            hint = "Code temporaire affiché sur le PC"
            setSingleLine(true); setTextColor(textColor); setHintTextColor(muted)
            setPadding(dp(12), dp(12), dp(12), dp(12)); setBackgroundColor(panel)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        }
        root.addView(pairCode, LinearLayout.LayoutParams(-1, -2))
        space(10)
        val status = TextView(this).apply {
            text = "Aucune session distante active."
            textSize = 13f; setTextColor(muted); setPadding(0, dp(8), 0, dp(8))
        }
        remoteStatusView = status
        root.addView(status)
        action("Associer et connecter", "Utilise le code affiché dans NEXUS CONTROL sur le PC.") {
            val base = relayUrl.text.toString().trim().trimEnd('/')
            val code = pairCode.text.toString().trim().uppercase()
            if (!base.startsWith("https://") && !base.startsWith("http://10.0.2.2") && !base.startsWith("http://localhost")) {
                dialog("Adresse du relais", "Utilise une adresse HTTPS publique avec un certificat valide.")
            } else if (code.isBlank()) {
                dialog("Code manquant", "Crée d'abord un code d'association depuis le PC.")
            } else {
                prefs.edit().putString("relay_base_url", base).apply()
                status.text = "Association en cours…"
                val deviceId = prefs.getString("relay_device_id", null) ?: ("android-" + UUID.randomUUID().toString()).also {
                    prefs.edit().putString("relay_device_id", it).apply()
                }
                configureRemoteClient().let { client ->
                    client.pairAndConnect(base, code, deviceId) { message -> runOnUiThread { remoteStatusView?.text = message } }
                }
            }
        }
        section("ÉTAT ET AUTORISATIONS")
        card {
            label("• Association par code temporaire à usage unique", 13f, textColor, true)
            label("• Connexion sortante vers le relais (pas de port entrant ouvert)", 13f, muted, false)
            label("• Le transfert Internet et le contrôle d'écran restent à intégrer.", 13f, muted, false)
        }
        action("Révoquer la session enregistrée", "Révoque l'association sur le serveur si le relais est joignable.") {
            configureRemoteClient().let { client ->
                client.revoke { message -> runOnUiThread { remoteStatusView?.text = message } }
            }
        }
    }

    private fun buildSecurityPage() {
        label("SÉCURITÉ", 12f, accent, true)
        label("Contrôle et confidentialité", 23f, textColor, true)
        section("PRINCIPES")
        card {
            label("• Pas de capture silencieuse", 14f, textColor, true)
            label("• Réception activée manuellement", 13f, muted, false)
            label("• Jeton de réception privé", 13f, muted, false)
            label("• Arrêter le serveur après le transfert", 13f, muted, false)
        }
        action("Gérer les appareils de confiance", "Ouvrir les paramètres de l'appareil.") { showPage("device") }
    }

    private fun displayName(uri: Uri): String {
        var name = "fichier"
        val cursor: Cursor? = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        cursor?.use { if (it.moveToFirst()) name = it.getString(0) ?: name }
        return name.replace(Regex("[^A-Za-z0-9._ -]"), "_").take(120).ifBlank { "fichier" }
    }

    private fun sendSelectedFile() {
        val uri = selectedFile
        if (uri == null) { dialog("Fichier manquant", "Choisis d'abord un fichier."); return }
        val base = sendTarget.text.toString().trim().trimEnd('/')
        val token = sendToken.text.toString().trim()
        if (!base.startsWith("http://") || token.isBlank()) {
            dialog("Destinataire incomplet", "Saisis l'adresse http:// du récepteur et son jeton.")
            return
        }
        transferStatus.text = "Envoi en cours…"
        Thread {
            try {
                val size = contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use {
                    if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else -1L
                } ?: -1L
                if (size < 0) throw IllegalStateException("Taille du fichier indisponible.")
                val encoded = URLEncoder.encode(selectedFileName, "UTF-8")
                val connection = (URL(base + "/upload?name=" + encoded).openConnection() as HttpURLConnection).apply {
                    requestMethod = "PUT"
                    connectTimeout = 10000
                    readTimeout = 120000
                    doOutput = true
                    setRequestProperty("Authorization", "Bearer " + token)
                    setRequestProperty("Content-Type", "application/octet-stream")
                    setFixedLengthStreamingMode(size)
                }
                val input = contentResolver.openInputStream(uri) ?: throw IllegalStateException("Impossible de lire le fichier.")
                input.use { stream -> connection.outputStream.use { output -> stream.copyTo(output) } }
                val code = connection.responseCode
                connection.disconnect()
                val message = if (code in 200..299) "Transfert terminé : " + selectedFileName else "Échec HTTP " + code + ". Vérifie l'adresse, le jeton et le Wi-Fi."
                runOnUiThread { transferStatus.text = message }
            } catch (error: Exception) {
                runOnUiThread { transferStatus.text = "Échec : " + (error.message ?: error.javaClass.simpleName) }
            }
        }.start()
    }

    override fun onDestroy() {
        receiver?.stop()
        receiver = null
        remoteClient?.disconnect()
        remoteClient = null
        super.onDestroy()
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
