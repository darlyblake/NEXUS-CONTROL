package com.nexuscontrol.agent

import android.content.Context
import android.os.Environment
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Récepteur de fichiers HTTP local. À démarrer uniquement sur un réseau de confiance.
 * Le jeton est requis pour chaque téléversement. Ce protocole local n'utilise pas TLS.
 */
class LocalTransferServer(
    context: Context,
    private val token: String,
    private val onReceived: (File) -> Unit
) {
    private val appContext = context.applicationContext
    private val running = AtomicBoolean(false)
    @Volatile private var serverSocket: ServerSocket? = null
    val isRunning: Boolean get() = running.get()

    fun start() {
        if (!running.compareAndSet(false, true)) return
        Thread({
            try {
                ServerSocket(8765, 20).use { server ->
                    serverSocket = server
                    while (running.get()) {
                        val socket = try { server.accept() } catch (_: Exception) { break }
                        Thread({ handle(socket) }, "nexus-transfer-client").start()
                    }
                }
            } catch (_: Exception) {
                running.set(false)
            } finally {
                serverSocket = null
                running.set(false)
            }
        }, "nexus-transfer-server").apply { isDaemon = true }.start()
    }

    fun stop() {
        running.set(false)
        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
    }

    private fun handle(socket: Socket) {
        socket.use { client ->
            client.soTimeout = 120_000
            val remoteIp = client.inetAddress
            if (remoteIp !is java.net.Inet4Address || !(remoteIp.isSiteLocalAddress || remoteIp.isLinkLocalAddress)) {
                val denied = BufferedOutputStream(client.getOutputStream())
                respond(denied, 403, "Forbidden", "Private local network only")
                return
            }
            val input = client.getInputStream()
            val output = BufferedOutputStream(client.getOutputStream())
            try {
                val headerBytes = readHeaders(input)
                val headerText = String(headerBytes, StandardCharsets.ISO_8859_1)
                val lines = headerText.split("\r\n")
                val request = lines.firstOrNull().orEmpty().split(" ")
                val method = request.getOrNull(0).orEmpty()
                val uri = URI(request.getOrNull(1).orEmpty())
                val headers = lines.drop(1).mapNotNull {
                    val index = it.indexOf(':')
                    if (index <= 0) null else it.substring(0, index).trim().lowercase(Locale.ROOT) to it.substring(index + 1).trim()
                }.toMap()
                if (method == "GET" && uri.path == "/health") {
                    respond(output, 200, "OK", "NEXUS receiver ready")
                    return
                }
                if (method != "PUT" || uri.path != "/upload") {
                    respond(output, 404, "Not Found", "Only PUT /upload is supported")
                    return
                }
                if (headers["authorization"] != "Bearer $token") {
                    respond(output, 401, "Unauthorized", "Invalid receiver token")
                    return
                }
                val length = headers["content-length"]?.toLongOrNull()
                if (length == null || length < 0 || length > 100L * 1024L * 1024L) {
                    respond(output, 413, "Payload Too Large", "Content-Length required; maximum 100 MB")
                    return
                }
                val query = uri.rawQuery.orEmpty().split("&").mapNotNull {
                    val p = it.split("=", limit = 2)
                    if (p.size == 2 && p[0] == "name") URLDecoder.decode(p[1], "UTF-8") else null
                }.firstOrNull().orEmpty()
                val safeName = File(query).name.replace(Regex("[^A-Za-z0-9._ -]"), "_").take(120).ifBlank { "received_file" }
                val dir = File(appContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "NexusReceived")
                if (!dir.exists() && !dir.mkdirs()) {
                    respond(output, 500, "Storage Error", "Cannot create destination folder")
                    return
                }
                var destination = File(dir, safeName)
                if (destination.exists()) destination = File(dir, System.currentTimeMillis().toString() + "_" + safeName)
                destination.outputStream().use { fileOut ->
                    val buffer = ByteArray(16 * 1024)
                    var remaining = length
                    while (remaining > 0) {
                        val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                        if (read < 0) throw IllegalStateException("Unexpected end of upload")
                        fileOut.write(buffer, 0, read)
                        remaining -= read
                    }
                }
                respond(output, 200, "OK", "Received")
                onReceived(destination)
            } catch (error: Exception) {
                try { respond(output, 400, "Bad Request", error.message ?: "Transfer failed") } catch (_: Exception) {}
            }
        }
    }

    private fun readHeaders(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        var state = 0
        while (out.size() < 16 * 1024) {
            val b = input.read()
            if (b < 0) throw IllegalStateException("Connection closed before headers")
            out.write(b)
            state = when {
                state == 0 && b == 13 -> 1
                state == 1 && b == 10 -> 2
                state == 2 && b == 13 -> 3
                state == 3 && b == 10 -> 4
                b == 13 -> 1
                else -> 0
            }
            if (state == 4) return out.toByteArray()
        }
        throw IllegalStateException("Headers too large")
    }

    private fun respond(output: BufferedOutputStream, status: Int, reason: String, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val header = "HTTP/1.1 $status $reason\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        output.write(header.toByteArray(StandardCharsets.ISO_8859_1))
        output.write(bytes)
        output.flush()
    }
}
