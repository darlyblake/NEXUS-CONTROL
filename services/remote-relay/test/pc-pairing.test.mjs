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
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function waitForMessage(socket, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for relay message"));
    }, timeoutMs);
    const onMessage = (data, isBinary) => {
      if (isBinary) return;
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function connectAuthenticated(url, deviceId, token) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  const authenticated = waitForMessage(socket, message => message.type === "authenticated");
  socket.send(JSON.stringify({ type: "auth", deviceId, token }));
  await authenticated;
  return socket;
}

test("desktop and Windows agent pair, authenticate, and relay an allowlisted command", async t => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) if (socket.readyState < WebSocket.CLOSING) socket.close();
    child.kill("SIGTERM");
  });

  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error("Relay exited early: " + stderr);
    try {
      const response = await fetch(base + "/health");
      if (response.ok) { healthy = true; break; }
    } catch { /* wait for startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(healthy, true, "relay health endpoint should become ready");

  const pairResponse = await fetch(base + "/api/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "desktop-phase4-test" })
  });
  assert.equal(pairResponse.status, 201);
  const pairing = await pairResponse.json();

  const redeemResponse = await fetch(base + "/api/pair/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairCode: pairing.pairCode, deviceId: "windows-phase4-test", platform: "windows" })
  });
  assert.equal(redeemResponse.status, 200);
  const target = await redeemResponse.json();

  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const desktop = await connectAuthenticated(wsUrl, "desktop-phase4-test", pairing.desktopToken);
  sockets.push(desktop);
  const desktopPeer = waitForMessage(desktop, message => message.type === "peer_status" && message.role === "windows" && message.connected === true);
  const windows = await connectAuthenticated(wsUrl, "windows-phase4-test", target.deviceToken);
  sockets.push(windows);
  await desktopPeer;

  const command = {
    type: "command",
    action: "windows_status",
    commandId: "phase4-smoke-001",
    timestamp: Date.now()
  };
  const receivedCommand = waitForMessage(windows, message => message.type === "command" && message.commandId === command.commandId);
  desktop.send(JSON.stringify(command));
  assert.deepEqual(await receivedCommand, command);

  const receivedResult = waitForMessage(desktop, message => message.type === "command_result" && message.commandId === command.commandId);
  const result = {
    type: "command_result",
    commandId: command.commandId,
    action: "windows_status",
    ok: true,
    detail: "smoke-test",
    output: "{\"hostname\":\"test-pc\"}"
  };
  windows.send(JSON.stringify(result));
  assert.deepEqual(await receivedResult, result);
});
