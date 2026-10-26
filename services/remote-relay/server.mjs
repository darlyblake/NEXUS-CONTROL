import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
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
  // Do not trust forwarded headers here; hosting should rate-limit at its edge too.
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
    tokens.set(hash(desktopToken), { pairId, deviceId: desktopDeviceId, role: "desktop", expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
    return json(res, 201, {
      protocol: 1,
      pairId,
      pairCode: code,
      desktopToken,
      expiresAt: new Date(expiresAt).toISOString(),
      instructions: "Affiche ce code uniquement à la personne qui doit associer son téléphone. Le code expire dans 5 minutes.",
    });
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
    const androidToken = randomToken();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    tokens.set(hash(androidToken), { pairId: pairing.pairId, deviceId, role: "android", expiresAt });
    return json(res, 200, { protocol: 1, pairId: pairing.pairId, deviceToken: androidToken, expiresAt: new Date(expiresAt).toISOString() });
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
      const otherRole = identity.role === "desktop" ? "android" : "desktop";
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
