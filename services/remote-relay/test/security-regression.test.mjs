import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import WebSocket from "ws";

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startRelay(t) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  t.after(() => child.kill("SIGTERM"));

  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error("Relay exited early: " + stderr);
    try {
      const response = await fetch(base + "/health");
      if (response.ok) { healthy = true; break; }
    } catch { /* wait for startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(healthy, true, "relay health endpoint should become ready");
  return { base, wsUrl: `ws://127.0.0.1:${port}/ws` };
}

async function createPair(base, desktopId = "desktop-security-test") {
  const response = await fetch(base + "/api/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: desktopId })
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function redeem(base, pairCode, deviceId, platform = "windows") {
  return fetch(base + "/api/pair/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairCode, deviceId, platform })
  });
}

async function connect(wsUrl, deviceId, token) {
  const socket = new WebSocket(wsUrl);
  await once(socket, "open");
  socket.send(JSON.stringify({ type: "auth", deviceId, token }));
  return socket;
}

async function expectClose(socket, expectedCode) {
  const [code] = await once(socket, "close");
  assert.equal(code, expectedCode);
}

test("relay rejects reused pairing codes", async t => {
  const { base } = await startRelay(t);
  const pair = await createPair(base);
  const first = await redeem(base, pair.pairCode, "windows-first", "windows");
  assert.equal(first.status, 200);
  const second = await redeem(base, pair.pairCode, "windows-second", "windows");
  assert.equal(second.status, 410);
});

test("relay binds each token to its registered device identity", async t => {
  const { base, wsUrl } = await startRelay(t);
  const pair = await createPair(base);
  const socket = await connect(wsUrl, "forged-device-id", pair.desktopToken);
  t.after(() => { if (socket.readyState < WebSocket.CLOSING) socket.terminate(); });
  await expectClose(socket, 4401);
});

test("Android role cannot issue Windows-only commands", async t => {
  const { base, wsUrl } = await startRelay(t);
  const pair = await createPair(base);
  const redeemed = await redeem(base, pair.pairCode, "android-security-test", "android");
  assert.equal(redeemed.status, 200);
  const target = await redeemed.json();

  const desktop = await connect(wsUrl, "desktop-security-test", pair.desktopToken);
  const android = await connect(wsUrl, "android-security-test", target.deviceToken);
  t.after(() => {
    if (desktop.readyState < WebSocket.CLOSING) desktop.terminate();
    if (android.readyState < WebSocket.CLOSING) android.terminate();
  });
  await Promise.all([once(desktop, "message"), once(android, "message")]);
  android.send(JSON.stringify({
    type: "command",
    action: "windows_status",
    commandId: "forbidden-windows-command",
    timestamp: Date.now()
  }));
  await expectClose(android, 4403);
});

test("relay rejects stale and unsupported controller commands", async t => {
  const { base, wsUrl } = await startRelay(t);
  const pair = await createPair(base);
  const redeemed = await redeem(base, pair.pairCode, "windows-stale-test", "windows");
  const target = await redeemed.json();

  const desktop = await connect(wsUrl, "desktop-security-test", pair.desktopToken);
  const windows = await connect(wsUrl, "windows-stale-test", target.deviceToken);
  t.after(() => {
    if (desktop.readyState < WebSocket.CLOSING) desktop.terminate();
    if (windows.readyState < WebSocket.CLOSING) windows.terminate();
  });
  await Promise.all([once(desktop, "message"), once(windows, "message")]);

  desktop.send(JSON.stringify({
    type: "command",
    action: "windows_status",
    commandId: "stale-command",
    timestamp: Date.now() - 120_000
  }));
  await expectClose(desktop, 4403);
});

test("revocation invalidates both sides and closes active sessions", async t => {
  const { base, wsUrl } = await startRelay(t);
  const pair = await createPair(base);
  const redeemed = await redeem(base, pair.pairCode, "windows-revoke-test", "windows");
  const target = await redeemed.json();

  const desktop = await connect(wsUrl, "desktop-security-test", pair.desktopToken);
  const windows = await connect(wsUrl, "windows-revoke-test", target.deviceToken);
  t.after(() => {
    if (desktop.readyState < WebSocket.CLOSING) desktop.terminate();
    if (windows.readyState < WebSocket.CLOSING) windows.terminate();
  });
  await Promise.all([once(desktop, "message"), once(windows, "message")]);

  const desktopClosed = expectClose(desktop, 4001);
  const windowsClosed = expectClose(windows, 4001);
  const response = await fetch(base + "/api/revoke", {
    method: "POST",
    headers: { authorization: "Bearer " + pair.desktopToken }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revoked, true);
  await Promise.all([desktopClosed, windowsClosed]);

  const replay = await connect(wsUrl, "desktop-security-test", pair.desktopToken);
  t.after(() => { if (replay.readyState < WebSocket.CLOSING) replay.terminate(); });
  await expectClose(replay, 4401);
});
