import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let child;
let baseUrl;

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForHealth(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Relay exited before becoming ready");
    try {
      const response = await fetch(url + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Relay health endpoint did not become ready");
}

async function pairDevices() {
  const desktopResponse = await fetch(baseUrl + "/api/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "desktop-test-01" }),
  });
  assert.equal(desktopResponse.status, 201);
  const desktop = await desktopResponse.json();

  const androidResponse = await fetch(baseUrl + "/api/pair/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairCode: desktop.pairCode, deviceId: "android-test-01" }),
  });
  assert.equal(androidResponse.status, 200);
  const android = await androidResponse.json();
  return { desktop, android };
}

async function connect(deviceId, token) {
  const socket = new WebSocket(baseUrl.replace("http:", "ws:") + "/ws");
  await once(socket, "open");
  socket.send(JSON.stringify({ type: "auth", deviceId, token }));
  const [raw] = await once(socket, "message");
  const message = JSON.parse(raw.toString());
  assert.equal(message.type, "authenticated");
  return socket;
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [resolve(here, "../server.mjs")], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "ignore",
  });
  await waitForHealth(baseUrl);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
  }
});

test("pair code is single-use", async () => {
  const { desktop } = await pairDevices();
  const secondUse = await fetch(baseUrl + "/api/pair/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairCode: desktop.pairCode, deviceId: "android-test-02" }),
  });
  assert.equal(secondUse.status, 410);
});

test("authenticated desktop commands are relayed to the paired phone", async () => {
  const { desktop, android } = await pairDevices();
  const pc = await connect("desktop-test-01", desktop.desktopToken);
  const phone = await connect("android-test-01", android.deviceToken);
  try {
    const received = once(phone, "message");
    pc.send(JSON.stringify({
      type: "command",
      action: "ring_start",
      commandId: "test-command-1",
      timestamp: Date.now(),
    }));
    const [raw] = await received;
    const message = JSON.parse(raw.toString());
    assert.equal(message.action, "ring_start");
    assert.equal(message.commandId, "test-command-1");
  } finally {
    pc.close();
    phone.close();
  }
});

test("revocation invalidates the pairing and closes both relay sockets", async () => {
  const { desktop, android } = await pairDevices();
  const pc = await connect("desktop-test-01", desktop.desktopToken);
  const phone = await connect("android-test-01", android.deviceToken);
  try {
    const pcClosed = once(pc, "close");
    const phoneClosed = once(phone, "close");
    const response = await fetch(baseUrl + "/api/revoke", {
      method: "POST",
      headers: { authorization: "Bearer " + desktop.desktopToken },
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revoked, true);
    const [pcCode] = await pcClosed;
    const [phoneCode] = await phoneClosed;
    assert.equal(pcCode, 4001);
    assert.equal(phoneCode, 4001);
  } finally {
    pc.terminate();
    phone.terminate();
  }
});
