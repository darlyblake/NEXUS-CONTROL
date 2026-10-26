import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const PAIR_TTL_MS = 5 * 60 * 1000;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PAIR_CREATES_PER_MINUTE = 5;
const MAX_REDEEM_ATTEMPTS_PER_MINUTE = 10;

// This MVP stores active pairings in memory. Restarting the process revokes all
// tokens and pairings. Use HTTPS/WSS at the hosting proxy; never expose plain WS.
const pairings = new Map();
const tokens = new Map();
const rateLimits = new Map();
const socketsByPair = new Map();

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
function newPairCode() {
  // 10 characters from an alphabet that avoids visually ambiguous symbols.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function rateLimit(ip, action, max) {
  const now = Date.now();
  const key = action + ":" + ip;
  const old = rateLimits.get(key) || [];
  const recent = old.filter((time) => now - time < 60_000);
  if (recent.length >= max) return false;
  recent.push(now);
  rateLimits.set(key, recent);
  return true;
}
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  });
  res.end(body);
}
async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_JSON_BYTES) throw new Error("payload_too_large");
  }
  try { return JSON.parse(raw || "{}"); } catch { throw new Error("invalid_json"); }
}
function getClientIp(req) {
  // Render terminates TLS at a reverse proxy. Use its forwarded client address
  // only in the Render environment; do not trust arbitrary forwarded headers
  // when the relay runs directly on a local machine or another host.
  if (process.env.RENDER_SERVICE_ID) {
    const forwarded = req.headers["x-forwarded-for"];
    const values = Array.isArray(forwarded) ? forwarded : [forwarded];
    for (const value of values) {
      if (typeof value !== "string") continue;
      const clientIp = value.split(",")[0]?.trim();
      if (clientIp && isIP(clientIp)) return clientIp;
    }
  }
  return req.socket.remoteAddress || "unknown";
}
function cleanupExpired() {
  const now = Date.now();
  for (const [code, pairing] of pairings) {
    if (pairing.expiresAt <= now || pairing.redeemed) pairings.delete(code);
  }
  for (const [tokenHash, token] of tokens) {
    if (token.expiresAt <= now) tokens.delete(tokenHash);
  }
  for (const [key, times] of rateLimits) {
    const recent = times.filter((time) => now - time < 60_000);
    if (recent.length) rateLimits.set(key, recent);
    else rateLimits.delete(key);
  }
}
const cleanupTimer = setInterval(cleanupExpired, 30_000);
cleanupTimer.unref();

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "600" });
    return res.end();
  }
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "nexus-control-remote-relay", protocol: 1 });
  }
  if (req.method === "POST" && url.pathname === "/api/pair") {
    const ip = getClientIp(req);
    if (!rateLimit(ip, "create", MAX_PAIR_CREATES_PER_MINUTE)) {
      return json(res, 429, { error: "rate_limited", message: "Trop de demandes. Réessaie dans une minute." });
    }
    const body = await readJson(req).catch((error) => {
      json(res, 400, { error: error.message === "payload_too_large" ? "payload_too_large" : "invalid_json" });
      return null;
    });
    if (!body) return;
    const desktopDeviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    if (!/^[a-zA-Z0-9._:-]{3,100}$/.test(desktopDeviceId)) {
      return json(res, 400, { error: "invalid_device_id" });
    }
    const code = newPairCode();
    const pairId = randomToken(18);
    const desktopToken = randomToken();
    const expiresAt = Date.now() + PAIR_TTL_MS;
    pairings.set(code, { pairId, desktopDeviceId, expiresAt, redeemed: false });
    tokens.set(hash(desktopToken), { pairId, deviceId: desktopDeviceId, role: "desktop", targetRole: "android", expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    return json(res, 201, {
      protocol: 1,
      pairId,
      pairCode: code,
      desktopToken,
      expiresAt: new Date(expiresAt).toISOString(),
      instructions: "Affiche ce code uniquement à la personne qui doit associer son téléphone. Le code expire dans 5 minutes.",
    });
  }
  if (req.method === "POST" && url.pathname === "/api/revoke") {
    const authorization = req.headers.authorization || "";
    const tokenValue = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const tokenRecord = tokenValue ? tokens.get(hash(tokenValue)) : null;
    if (!tokenRecord || tokenRecord.expiresAt <= Date.now()) {
      return json(res, 401, { error: "invalid_token", message: "Jeton invalide ou expiré." });
    }
    const pairId = tokenRecord.pairId;
    for (const [tokenHash, record] of tokens) {
      if (record.pairId === pairId) tokens.delete(tokenHash);
    }
    for (const [code, pairing] of pairings) {
      if (pairing.pairId === pairId) pairings.delete(code);
    }
    const peers = socketsByPair.get(pairId);
    if (peers) {
      for (const peer of peers.values()) {
        if (peer.readyState === WebSocket.OPEN) peer.close(4001, "pair_revoked");
      }
      socketsByPair.delete(pairId);
    }
    return json(res, 200, { ok: true, revoked: true });
  }
  if (req.method === "POST" && url.pathname === "/api/pair/redeem") {
    const ip = getClientIp(req);
    if (!rateLimit(ip, "redeem", MAX_REDEEM_ATTEMPTS_PER_MINUTE)) {
      return json(res, 429, { error: "rate_limited", message: "Trop de tentatives. Réessaie dans une minute." });
    }
    const body = await readJson(req).catch((error) => {
      json(res, 400, { error: error.message === "payload_too_large" ? "payload_too_large" : "invalid_json" });
      return null;
    });
    if (!body) return;
    const code = typeof body.pairCode === "string" ? body.pairCode.trim().toUpperCase() : "";
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    const platform = body.platform === "windows" ? "windows" : "android";
    if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code) || !/^[a-zA-Z0-9._:-]{3,100}$/.test(deviceId)) {
      return json(res, 400, { error: "invalid_pairing_data" });
    }
    const pairing = pairings.get(code);
    if (!pairing || pairing.redeemed || pairing.expiresAt <= Date.now()) {
      return json(res, 410, { error: "pair_code_expired_or_used", message: "Code expiré ou déjà utilisé. Génère un nouveau code depuis le PC." });
    }
    if (deviceId === pairing.desktopDeviceId) {
      return json(res, 400, { error: "same_device_id" });
    }
    pairing.redeemed = true;
    const deviceToken = randomToken();
    const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
    const role = platform;
    for (const record of tokens.values()) {
      if (record.pairId === pairing.pairId && record.role === "desktop") record.targetRole = role;
    }
    tokens.set(hash(deviceToken), { pairId: pairing.pairId, deviceId, role, expiresAt });
    return json(res, 200, { protocol: 1, pairId: pairing.pairId, deviceToken, role, expiresAt: new Date(expiresAt).toISOString() });
  }
  if (req.method === "GET" && url.pathname === "/") {
    return json(res, 200, { service: "NEXUS CONTROL remote relay", protocol: 1, health: "/health" });
  }
  return json(res, 404, { error: "not_found" });
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_FRAME_BYTES,
  perMessageDeflate: false,
});
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws) => {
  let identity = null;
  const authTimer = setTimeout(() => {
    if (!identity) ws.close(4401, "authentication_required");
  }, 5000);

  ws.on("message", (data, isBinary) => {
    if (!identity) {
      if (isBinary || data.length > MAX_JSON_BYTES) return ws.close(4400, "invalid_auth");
      let message;
      try { message = JSON.parse(data.toString("utf8")); } catch { return ws.close(4400, "invalid_auth"); }
      if (message.type !== "auth" || typeof message.token !== "string" || typeof message.deviceId !== "string") {
        return ws.close(4400, "invalid_auth");
      }
      const tokenHash = hash(message.token);
      const stored = tokens.get(tokenHash);
      if (!stored || stored.expiresAt <= Date.now() || stored.deviceId !== message.deviceId) {
        return ws.close(4401, "invalid_credentials");
      }
      identity = { ...stored, tokenHash };
      clearTimeout(authTimer);
      const peers = socketsByPair.get(identity.pairId) || new Map();
      const existing = peers.get(identity.role);
      if (existing && existing.readyState === WebSocket.OPEN) existing.close(4409, "replaced_by_new_connection");
      peers.set(identity.role, ws);
      socketsByPair.set(identity.pairId, peers);
      ws.send(JSON.stringify({ type: "authenticated", protocol: 1, pairId: identity.pairId, role: identity.role }));
      const otherRole = identity.role === "desktop" ? (identity.targetRole || "android") : "desktop";
      const other = peers.get(otherRole);
      if (other && other.readyState === WebSocket.OPEN) {
        other.send(JSON.stringify({ type: "peer_status", role: identity.role, connected: true }));
        ws.send(JSON.stringify({ type: "peer_status", role: otherRole, connected: true }));
      } else {
        ws.send(JSON.stringify({ type: "peer_status", role: otherRole, connected: false }));
      }
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    const peers = socketsByPair.get(identity.pairId);
    const otherRole = identity.role === "desktop" ? "android" : "desktop";
    const other = peers?.get(otherRole);
    if (!other || other.readyState !== WebSocket.OPEN) {
      if (!isBinary) ws.send(JSON.stringify({ type: "peer_status", role: otherRole, connected: false }));
      return;
    }
    // The relay forwards opaque payloads only; it cannot interpret commands or files.
    if (isBinary) other.send(data, { binary: true });
    else {
      if (data.length > MAX_JSON_BYTES) return ws.close(4400, "message_too_large");
      let message;
      try { message = JSON.parse(data.toString("utf8")); } catch { return ws.close(4400, "invalid_message"); }
      if (!message || typeof message.type !== "string" || message.type === "auth") return ws.close(4400, "invalid_message");
      const allowedActions = new Set(["location_request", "ring_start", "ring_stop", "show_message", "windows_status", "windows_list_processes", "windows_run_powershell"]);
      if (message.type === "command") {
        if (identity.role !== "desktop" || !allowedActions.has(message.action) ||
            typeof message.commandId !== "string" || message.commandId.length > 100 ||
            typeof message.timestamp !== "number" || Math.abs(Date.now() - message.timestamp) > 60_000 ||
            (message.action === "show_message" && (typeof message.message !== "string" || message.message.trim().length < 1 || message.message.length > 240)) ||
            (message.action === "windows_run_powershell" && (typeof message.script !== "string" || message.script.trim().length < 1 || message.script.length > 8000))) {
          return ws.close(4403, "invalid_or_unauthorized_command");
        }
      } else if (message.type === "command_result") {
        if (identity.role === "desktop" || !allowedActions.has(message.action) ||
            typeof message.commandId !== "string" || message.commandId.length > 100 ||
            (typeof message.detail === "string" && message.detail.length > 2000) ||
            (typeof message.output === "string" && message.output.length > 12000)) {
          return ws.close(4403, "invalid_or_unauthorized_result");
        }
      }
      other.send(data, { binary: false });
    }
  });

  ws.on("close", () => {
    clearTimeout(authTimer);
    if (!identity) return;
    const peers = socketsByPair.get(identity.pairId);
    if (peers?.get(identity.role) === ws) {
      peers.delete(identity.role);
      const otherRole = identity.role === "desktop" ? "android" : "desktop";
      const other = peers.get(otherRole);
      if (other && other.readyState === WebSocket.OPEN) {
        other.send(JSON.stringify({ type: "peer_status", role: identity.role, connected: false }));
      }
      if (peers.size === 0) socketsByPair.delete(identity.pairId);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`NEXUS remote relay listening on ${HOST}:${PORT}`);
});
