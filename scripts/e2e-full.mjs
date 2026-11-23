import { spawn } from "node:child_process";
import { randomUUID, webcrypto } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 8799;
const server = `http://127.0.0.1:${port}`;
const state = mkdtempSync(join(tmpdir(), "bridge-e2e-"));
const results = [];
const children = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    throw new Error(name);
  }
}

function canonicalJSON(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function sign(privateKey, payload) {
  const data = new TextEncoder().encode(canonicalJSON(payload));
  const sig = new Uint8Array(await webcrypto.subtle.sign({ name: "Ed25519" }, privateKey, data));
  return b64url(sig);
}

async function generate() {
  const key = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign"]);
  const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", key.publicKey));
  return { key: key.privateKey, publicKey: b64url(raw), id: randomUUID() };
}

async function signedBody(keys, payload) {
  return { payload, sig: await sign(keys.key, payload) };
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (method !== "GET") headers["x-requested-with"] = "mcp-bridge";
  const response = await fetch(`${server}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json, headers: response.headers };
}

async function begin(keys, name = "laptop") {
  const payload = {
    op: "pair_begin",
    protocol: 1,
    deviceId: keys.id,
    publicKey: keys.publicKey,
    name,
    os: "linux",
    arch: "amd64",
    ts: Math.floor(Date.now() / 1000),
    nonce: b64url(webcrypto.getRandomValues(new Uint8Array(16))),
  };
  const response = await api("/api/pair/begin", {
    method: "POST",
    body: await signedBody(keys, payload),
  });
  return response;
}

async function session(email) {
  const response = await api("/api/dev/session", {
    method: "POST",
    body: { email, name: email, issueToken: true },
  });
  if (response.status !== 200) {
    throw new Error(`session ${email} ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json;
}

async function complete(token, code) {
  return api("/api/pair/complete", { method: "POST", token, body: { code } });
}

async function hello(keys, { bad = false, folders = [] } = {}) {
  const payload = {
    op: "hello",
    protocol: 1,
    deviceId: keys.id,
    publicKey: keys.publicKey,
    name: "laptop",
    version: "0.1.0",
    ts: Math.floor(Date.now() / 1000),
    nonce: b64url(webcrypto.getRandomValues(new Uint8Array(16))),
    folders,
  };
  let sig = await sign(keys.key, payload);
  if (bad) sig = `${sig.startsWith("A") ? "B" : "A"}${sig.slice(1)}`;
  const ws = new WebSocket(`${server.replace("http", "ws")}/device/${keys.id}/ws`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("socket error")), { once: true });
  });
  const id = randomUUID();
  ws.send(JSON.stringify({ v: 1, type: "hello", id, payload, sig }));
  const frame = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    ws.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(event.data)));
      },
      { once: true },
    );
    ws.addEventListener(
      "close",
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { once: true },
    );
  });
  return { ws, frame };
}

async function mcp(token, body, sessionId) {
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
    headers["mcp-protocol-version"] = "2025-03-26";
  }
  const response = await fetch(`${server}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, json, session: response.headers.get("mcp-session-id") };
}

async function mcpSession(token) {
  const init = await mcp(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "e2e", version: "0" },
    },
  });
  return init.session;
}

async function tool(token, sessionId, name, args) {
  return mcp(
    token,
    { jsonrpc: "2.0", id: name, method: "tools/call", params: { name, arguments: args } },
    sessionId,
  );
}

function toolText(response) {
  return JSON.stringify(response.json);
}

function startBridge(home, project) {
  const child = spawn(join(state, "mcp-bridge"), ["--server", server, "--home", home], {
    cwd: join(root, "apps", "bridge"),
    env: { ...process.env, MCP_BRIDGE_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });
  children.push(child);
  return {
    child,
    text: () => log,
    project,
  };
}

async function waitFor(fn, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout: ${label}`);
}

async function main() {
  const { execFileSync } = await import("node:child_process");
  execFileSync("go", ["build", "-o", join(state, "mcp-bridge"), "./cmd/bridge"], {
    cwd: join(root, "apps", "bridge"),
    stdio: "inherit",
  });
  const devVars = join(root, "apps/worker/.dev.vars");
  try {
    readFileSync(devVars);
  } catch {
    writeFileSync(devVars, "DEV_AUTH=true\n");
  }
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@mcp-bridge/worker",
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "mcp-bridge",
      "--local",
      "--persist-to",
      state,
    ],
    { cwd: root, stdio: "inherit" },
  );
  const wrangler = spawn(
    "pnpm",
    [
      "--filter",
      "@mcp-bridge/worker",
      "exec",
      "wrangler",
      "dev",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      state,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(wrangler);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${server}/health`)).ok) break;
    } catch {
      // not up yet
    }
    if (attempt === 39) throw new Error("worker did not start");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  record("worker health", true);

  const issuer = await generate();
  const issued = await begin(issuer, "issuer");
  record(
    "pairing code issued",
    issued.status === 200 && Boolean(issued.json.code),
    JSON.stringify(issued.json),
  );
  const owner = await session("owner@localhost");
  const wrong = await complete(owner.token, "ZZZZ-ZZZZ");
  record(
    "wrong pairing code rejected",
    wrong.status === 400 && wrong.json.error.code === "invalid_code",
  );
  const once = await complete(owner.token, issued.json.code);
  record("pairing code single use accepts first time", once.status === 200);
  const twice = await complete(owner.token, issued.json.code);
  record("pairing code cannot be reused", twice.status === 400);

  const expiring = await generate();
  const exp = await begin(expiring, "expiring");
  const sqlite = execFileSync(
    "bash",
    ["-lc", `find ${state} -path '*d1*' -name '*.sqlite' | head -1`],
    { encoding: "utf8" },
  ).trim();
  execFileSync("python3", [
    "-c",
    `import sqlite3; db=sqlite3.connect(${JSON.stringify(sqlite)}); db.execute("UPDATE pairing_codes SET expires_at='2000-01-01T00:00:00.000Z' WHERE consumed_at IS NULL"); db.commit()`,
  ]);
  const expired = await complete(owner.token, exp.json.code);
  record(
    "expired pairing code rejected",
    expired.status === 400 && expired.json.error.code === "expired",
    JSON.stringify(expired.json),
  );

  const limited = await session("limited@localhost");
  let limitedStatus = 0;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const response = await complete(limited.token, "ABCD-EFGH");
    limitedStatus = response.status;
  }
  record("pairing attempts are rate limited", limitedStatus === 429, String(limitedStatus));

  const challenger = await generate();
  const challengeCode = await begin(challenger, "challenger");
  const challengeUser = await session("challenge@localhost");
  await complete(challengeUser.token, challengeCode.json.code);
  const good = await hello(challenger);
  record("device hello signature accepted", Boolean(good.frame?.payload?.ok));
  good.ws.close();
  const again = await hello(challenger);
  record("device reconnects after the socket drops", Boolean(again.frame?.payload?.ok));
  again.ws.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const bad = await hello(challenger, { bad: true });
  record("bad device signature is rejected", !bad.frame?.payload?.ok);
  bad.ws?.close();

  const sleeper = await generate();
  const sleepCode = await begin(sleeper, "sleeper");
  const sleepUser = await session("sleeper@localhost");
  await complete(sleepUser.token, sleepCode.json.code);
  const hungFolder = randomUUID();
  const hung = await hello(sleeper, { folders: [{ id: hungFolder, label: "hung" }] });
  const sleepFolders = await api("/api/folders", { token: sleepUser.token });
  await api(`/api/folders/${sleepFolders.json.folders[0].id}/approval`, {
    method: "POST",
    token: sleepUser.token,
    body: { approval: "approved" },
  });
  const sleepSession = await mcpSession(sleepUser.token);
  const timed = await tool(sleepUser.token, sleepSession, "read_file", {
    folder: "hung",
    path: "a.txt",
  });
  record(
    "device timeout when the socket does not answer",
    /did not respond/i.test(toolText(timed)),
    toolText(timed).slice(0, 220),
  );
  hung.ws.close();

  const alphaHome = mkdtempSync(join(tmpdir(), "bridge-a-"));
  const betaHome = mkdtempSync(join(tmpdir(), "bridge-b-"));
  const alphaProj = mkdtempSync(join(tmpdir(), "proj-a-"));
  const betaProj = mkdtempSync(join(tmpdir(), "proj-b-"));
  const outside = mkdtempSync(join(tmpdir(), "outside-"));
  mkdirSync(join(alphaProj, "notes"), { recursive: true });
  writeFileSync(join(alphaProj, "notes/hello.txt"), "hello from the bridge\n");
  writeFileSync(join(alphaProj, "notes/.env"), "SUPERSECRETVALUE\n");
  writeFileSync(join(alphaProj, "notes/bin.dat"), Buffer.from([0x68, 0x69, 0x00, 0x21]));
  writeFileSync(join(alphaProj, "notes/big.txt"), "abcdefghij".repeat(8000));
  for (const name of ["p1.txt", "p2.txt", "p3.txt", "p4.txt", "p5.txt"]) {
    writeFileSync(join(alphaProj, "notes", name), name);
  }
  writeFileSync(join(outside, "secret.txt"), "OUTSIDESECRET\n");
  symlinkSync(join(outside, "secret.txt"), join(alphaProj, "notes/escape"));
  mkdirSync(join(betaProj, "notes"), { recursive: true });
  writeFileSync(join(betaProj, "notes/only-beta.txt"), "beta only\n");

  const bin = join(state, "mcp-bridge");
  execFileSync(
    bin,
    [
      "--server",
      server,
      "--home",
      alphaHome,
      "allow",
      join(alphaProj, "notes"),
      "--label",
      "alpha",
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    bin,
    ["--server", server, "--home", betaHome, "allow", join(betaProj, "notes"), "--label", "beta"],
    { stdio: "inherit" },
  );
  const alpha = startBridge(alphaHome);
  const beta = startBridge(betaHome);
  await waitFor(() => /Pairing code:/.test(alpha.text()), "alpha code");
  await waitFor(() => /Pairing code:/.test(beta.text()), "beta code");
  const alphaCode = alpha.text().match(/Pairing code: (\S+)/)[1];
  const betaCode = beta.text().match(/Pairing code: (\S+)/)[1];
  const userA = await session("a@localhost");
  const userB = await session("b@localhost");
  const pairedA = await complete(userA.token, alphaCode);
  const pairedB = await complete(userB.token, betaCode);
  record("two devices pair to two users", pairedA.status === 200 && pairedB.status === 200);
  await waitFor(
    () => /Connected\./.test(alpha.text()) && /Connected\./.test(beta.text()),
    "both connected",
  );
  record("bridges connect over the websocket", true);

  const foldersA = await api("/api/folders", { token: userA.token });
  const foldersB = await api("/api/folders", { token: userB.token });
  record(
    "folder lists stay on the owning user",
    foldersA.json.folders.every((folder) => folder.label === "alpha") &&
      foldersB.json.folders.every((folder) => folder.label === "beta"),
  );
  await api(`/api/folders/${foldersA.json.folders[0].id}/approval`, {
    method: "POST",
    token: userA.token,
    body: { approval: "approved" },
  });
  await api(`/api/folders/${foldersB.json.folders[0].id}/approval`, {
    method: "POST",
    token: userB.token,
    body: { approval: "approved" },
  });
  const sessionA = await mcpSession(userA.token);
  const sessionB = await mcpSession(userB.token);

  const allowed = await tool(userA.token, sessionA, "read_file", {
    folder: "alpha",
    path: "hello.txt",
    deviceId: pairedB.json.deviceId,
  });
  record(
    "read_file returns an allowed file",
    toolText(allowed).includes("hello from the bridge") &&
      !toolText(allowed).includes('"isError":true'),
  );
  const secret = await tool(userA.token, sessionA, "read_file", { folder: "alpha", path: ".env" });
  record(
    "secret file is denied",
    /denylist|refused/i.test(toolText(secret)) && !toolText(secret).includes("SUPERSECRETVALUE"),
  );
  const escaped = await tool(userA.token, sessionA, "read_file", {
    folder: "alpha",
    path: "escape",
  });
  record(
    "symlink escape is denied",
    /outside/i.test(toolText(escaped)) && !toolText(escaped).includes("OUTSIDESECRET"),
  );
  const outsidePath = await tool(userA.token, sessionA, "read_file", {
    folder: "alpha",
    path: "../../secret.txt",
  });
  record("path outside the folder is denied", /outside/i.test(toolText(outsidePath)));
  const binary = await tool(userA.token, sessionA, "read_file", {
    folder: "alpha",
    path: "bin.dat",
  });
  record("binary file is denied", /binary/i.test(toolText(binary)));
  const chunk = await tool(userA.token, sessionA, "read_file", {
    folder: "alpha",
    path: "big.txt",
    max_bytes: 1000,
  });
  record(
    "large file is chunked",
    /"truncated":true/.test(toolText(chunk)) && /nextByteOffset/.test(toolText(chunk)),
  );
  const page = await tool(userA.token, sessionA, "list_files", {
    folder: "alpha",
    path: "",
    limit: 2,
  });
  record("directory listing is paginated", /nextCursor":"[^"]+"/.test(toolText(page)));
  const cross = await tool(userA.token, sessionA, "read_file", {
    folder: "beta",
    path: "only-beta.txt",
  });
  record("token cannot read another user's folder", !toolText(cross).includes("beta only"));
  const crossList = await api("/api/folders", { token: userA.token });
  record(
    "token cannot list another user's folders",
    !JSON.stringify(crossList.json).includes("beta"),
  );

  await api(`/api/devices/${pairedA.json.deviceId}/revoke`, { method: "POST", token: userA.token });
  const after = await tool(userA.token, sessionA, "read_file", {
    folder: "alpha",
    path: "hello.txt",
  });
  record(
    "revoked device no longer serves reads",
    /not connected|no paired device|unavailable|revoked/i.test(toolText(after)),
    toolText(after).slice(0, 180),
  );

  const other = await tool(userB.token, sessionB, "read_file", {
    folder: "beta",
    path: "only-beta.txt",
  });
  record("the other user's device still answers", toolText(other).includes("beta only"));
  beta.child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const offline = await tool(userB.token, sessionB, "read_file", {
    folder: "beta",
    path: "only-beta.txt",
  });
  record(
    "offline device does not serve reads",
    /no paired device|not connected|unavailable/i.test(toolText(offline)),
    toolText(offline).slice(0, 180),
  );
}

main()
  .then(() => {
    writeMatrix(true);
  })
  .catch((error) => {
    console.error(error);
    writeMatrix(false);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const child of children) child.kill("SIGTERM");
    setTimeout(() => {
      for (const child of children) child.kill("SIGKILL");
    }, 500).unref();
  });

function writeMatrix(ok) {
  const lines = [
    "# Test matrix",
    "",
    `Overall: ${ok && results.every((row) => row.ok) ? "pass" : "fail"}`,
    "",
    "| Case | Result | Detail |",
    "| --- | --- | --- |",
  ];
  for (const row of results) {
    lines.push(
      `| ${row.name} | ${row.ok ? "pass" : "fail"} | ${row.detail.replaceAll("|", "/")} |`,
    );
  }
  writeFileSync(join(root, "docs/TEST-MATRIX.md"), `${lines.join("\n")}\n`);
}
