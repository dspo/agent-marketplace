import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  addServerRef,
  ensureServer,
  isServerHealthy,
  loadServerSession,
  removeServerRef,
  saveServerSession,
  shutdownServer,
  shutdownServerIfUnreferenced
} from "./.build/server-lifecycle.mjs";
import { isProcessAlive } from "./.build/process.mjs";

const FAKE_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-mimo-bin.mjs");

function makeStateDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimo-plugin-test-"));
  // Shut the server down before removing the dir: t.after hooks run in
  // registration order, and removing server.json first would leak the process.
  t.after(() => {
    shutdownServer(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function withFakeBinEnv() {
  return { ...process.env, MIMO_COMPANION_BIN: `${process.execPath} ${FAKE_BIN}` };
}

// The fake bin needs `mimo serve` to be spawnable as a single executable; wrap
// it in a tiny shell script because spawn() does not split the env override.
function makeFakeBinWrapper(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimo-fake-bin-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wrapper = path.join(dir, "mimo");
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_BIN}" "$@"\n`, { mode: 0o755 });
  return wrapper;
}

test("ensureServer spawns the fake mimo serve, parses the port, and reuses it", async (t) => {
  const stateDir = makeStateDir(t);
  const mimoBin = makeFakeBinWrapper(t);

  const session = await ensureServer(stateDir, { mimoBin });
  t.after(() => shutdownServer(stateDir));

  assert.ok(session.port > 0);
  assert.ok(isProcessAlive(session.pid));
  assert.equal(session.baseUrl, `http://127.0.0.1:${session.port}`);
  assert.ok(await isServerHealthy(session));

  const reused = await ensureServer(stateDir, { mimoBin });
  assert.equal(reused.pid, session.pid);
  assert.equal(reused.port, session.port);
});

test("ensureServer replaces a dead server entry", async (t) => {
  const stateDir = makeStateDir(t);
  const mimoBin = makeFakeBinWrapper(t);

  saveServerSession(stateDir, {
    pid: 999999999,
    port: 1,
    baseUrl: "http://127.0.0.1:1",
    startedAt: new Date().toISOString(),
    refSessions: []
  });

  const session = await ensureServer(stateDir, { mimoBin });
  t.after(() => shutdownServer(stateDir));
  assert.notEqual(session.pid, 999999999);
  assert.ok(await isServerHealthy(session));
});

test("ensureServer fails with log tail when the binary is missing", async (t) => {
  const stateDir = makeStateDir(t);
  await assert.rejects(
    () => ensureServer(stateDir, { mimoBin: "/definitely/not/a/real/mimo", startupTimeoutMs: 2000 }),
    /Failed to start|Timed out/
  );
});

test("refcounted shutdown only stops the server when the last session leaves", async (t) => {
  const stateDir = makeStateDir(t);
  const mimoBin = makeFakeBinWrapper(t);

  const session = await ensureServer(stateDir, { mimoBin });
  addServerRef(stateDir, "claude-session-a");
  addServerRef(stateDir, "claude-session-b");

  assert.equal(shutdownServerIfUnreferenced(stateDir, "claude-session-a"), false);
  assert.ok(isProcessAlive(session.pid), "server must stay alive while session-b holds a ref");

  assert.equal(shutdownServerIfUnreferenced(stateDir, "claude-session-b"), true);
  // SIGTERM delivery is async; poll briefly.
  const deadline = Date.now() + 3000;
  while (isProcessAlive(session.pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(isProcessAlive(session.pid), false);
  assert.equal(loadServerSession(stateDir), null);
});

test("addServerRef/removeServerRef deduplicate and persist", async (t) => {
  const stateDir = makeStateDir(t);
  saveServerSession(stateDir, {
    pid: process.pid,
    port: 12345,
    baseUrl: "http://127.0.0.1:12345",
    startedAt: new Date().toISOString(),
    refSessions: []
  });

  addServerRef(stateDir, "s1");
  addServerRef(stateDir, "s1");
  addServerRef(stateDir, "s2");
  assert.deepEqual(loadServerSession(stateDir).refSessions, ["s1", "s2"]);

  removeServerRef(stateDir, "s1");
  assert.deepEqual(loadServerSession(stateDir).refSessions, ["s2"]);
});
