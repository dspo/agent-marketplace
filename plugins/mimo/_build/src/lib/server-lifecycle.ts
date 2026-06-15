import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { isProcessAlive, terminateProcessTree } from "./process.ts";
import { resolveStateDir } from "./state.ts";

const SERVER_STATE_FILE = "server.json";
const SERVER_LOCK_FILE = "server.lock";
const SERVER_LOG_FILE = "server.log";
const PORT_PATTERN = /listening on https?:\/\/[^:\s]+:(\d+)/g;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 2_000;
const LOCK_STALE_MS = 30_000;

export const MIMO_BIN_ENV = "MIMO_COMPANION_BIN";

export type ServerSession = {
  pid: number;
  port: number;
  baseUrl: string;
  startedAt: string;
  // Claude session ids that hold a reference to this server. The server is
  // only shut down once the last referencing session ends.
  refSessions: string[];
};

export type ServerLifecycleOptions = {
  mimoBin?: string;
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function resolveMimoBin(env: NodeJS.ProcessEnv = process.env): string {
  return env[MIMO_BIN_ENV] || "mimo";
}

function serverStateFile(stateDir: string): string {
  return path.join(stateDir, SERVER_STATE_FILE);
}

export function serverLogFile(stateDir: string): string {
  return path.join(stateDir, SERVER_LOG_FILE);
}

export function loadServerSession(stateDir: string): ServerSession | null {
  const file = serverStateFile(stateDir);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Number.isFinite(parsed.pid) || !Number.isFinite(parsed.port)) {
      return null;
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      baseUrl: parsed.baseUrl ?? `http://127.0.0.1:${parsed.port}`,
      startedAt: parsed.startedAt ?? "",
      refSessions: Array.isArray(parsed.refSessions) ? parsed.refSessions.filter((v: unknown) => typeof v === "string") : []
    };
  } catch {
    return null;
  }
}

export function saveServerSession(stateDir: string, session: ServerSession): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = serverStateFile(stateDir);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function clearServerSession(stateDir: string): void {
  const file = serverStateFile(stateDir);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

export async function isServerHealthy(session: ServerSession, options: ServerLifecycleOptions = {}): Promise<boolean> {
  if (!isProcessAlive(session.pid)) {
    return false;
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${session.baseUrl}/config`, { signal: controller.signal });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

function acquireLock(stateDir: string): boolean {
  fs.mkdirSync(stateDir, { recursive: true });
  const lockFile = path.join(stateDir, SERVER_LOCK_FILE);
  try {
    const fd = fs.openSync(lockFile, "wx");
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    try {
      const stat = fs.statSync(lockFile);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        fs.unlinkSync(lockFile);
        return acquireLock(stateDir);
      }
    } catch {
      // Lock vanished between open and stat; retry once.
      return acquireLock(stateDir);
    }
    return false;
  }
}

function releaseLock(stateDir: string): void {
  const lockFile = path.join(stateDir, SERVER_LOCK_FILE);
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // Already removed.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLogTail(logFile: string, maxBytes = 2048): string {
  try {
    const content = fs.readFileSync(logFile, "utf8");
    return content.slice(-maxBytes);
  } catch {
    return "";
  }
}

async function spawnServer(stateDir: string, options: ServerLifecycleOptions): Promise<ServerSession> {
  const mimoBin = options.mimoBin ?? resolveMimoBin(options.env ?? process.env);
  const logFile = serverLogFile(stateDir);
  const logFd = fs.openSync(logFile, "a");
  const child = spawn(mimoBin, ["serve", "--port", "0", "--hostname", "127.0.0.1"], {
    env: options.env ?? process.env,
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  fs.closeSync(logFd);

  const spawnError = await new Promise<Error | null>((resolve) => {
    const onError = (error: Error) => resolve(error);
    child.once("error", onError);
    setTimeout(() => {
      child.removeListener("error", onError);
      resolve(null);
    }, 100);
  });
  if (spawnError) {
    throw new Error(`Failed to start \`${mimoBin} serve\`: ${spawnError.message}. Is MiMo installed? Run /mimo:setup.`);
  }

  const timeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  // Only read content written AFTER this spawn — skip any stale port entries
  // from previous server instances that may still be in the log file.
  let logOffset = 0;
  try {
    logOffset = fs.statSync(logFile).size;
  } catch {
    logOffset = 0;
  }

  while (Date.now() < deadline) {
    const content = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").slice(logOffset) : "";
    // matchAll + last-match: if the server restarts internally and writes
    // multiple "listening on" lines, we always pick the current (latest) port.
    const matches = [...content.matchAll(PORT_PATTERN)];
    const match = matches[matches.length - 1];
    if (match) {
      const port = Number(match[1]);
      return {
        pid: child.pid!,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        startedAt: new Date().toISOString(),
        refSessions: []
      };
    }
    if (child.pid && !isProcessAlive(child.pid)) {
      break;
    }
    await sleep(100);
  }

  if (child.pid) {
    terminateProcessTree(child.pid);
  }
  const tail = readLogTail(logFile);
  throw new Error(
    `Timed out waiting for \`${mimoBin} serve\` to report its port after ${timeoutMs}ms.${tail ? `\nServer log tail:\n${tail}` : ""}`
  );
}

export async function ensureServer(stateDir: string, options: ServerLifecycleOptions = {}): Promise<ServerSession> {
  const existing = loadServerSession(stateDir);
  if (existing && (await isServerHealthy(existing, options))) {
    return existing;
  }

  if (existing) {
    if (isProcessAlive(existing.pid)) {
      terminateProcessTree(existing.pid);
    }
    clearServerSession(stateDir);
  }

  const lockDeadline = Date.now() + (options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS) + 5_000;
  while (!acquireLock(stateDir)) {
    // Another process is starting the server; wait for it to publish server.json.
    await sleep(150);
    const published = loadServerSession(stateDir);
    if (published && (await isServerHealthy(published, options))) {
      return published;
    }
    if (Date.now() > lockDeadline) {
      throw new Error("Timed out waiting for another process to start the MiMo server.");
    }
  }

  try {
    // Double check: the lock holder before us may have published a session.
    const published = loadServerSession(stateDir);
    if (published && (await isServerHealthy(published, options))) {
      return published;
    }
    const session = await spawnServer(stateDir, options);
    saveServerSession(stateDir, session);
    return session;
  } finally {
    releaseLock(stateDir);
  }
}

export function addServerRef(stateDir: string, sessionId: string): void {
  const session = loadServerSession(stateDir);
  if (!session || !sessionId) {
    return;
  }
  if (!session.refSessions.includes(sessionId)) {
    session.refSessions.push(sessionId);
    saveServerSession(stateDir, session);
  }
}

export function removeServerRef(stateDir: string, sessionId: string): ServerSession | null {
  const session = loadServerSession(stateDir);
  if (!session) {
    return null;
  }
  if (sessionId) {
    session.refSessions = session.refSessions.filter((id) => id !== sessionId);
    saveServerSession(stateDir, session);
  }
  return session;
}

export function shutdownServer(stateDir: string): boolean {
  const session = loadServerSession(stateDir);
  if (!session) {
    return false;
  }
  if (isProcessAlive(session.pid)) {
    terminateProcessTree(session.pid);
  }
  clearServerSession(stateDir);
  return true;
}

export function shutdownServerIfUnreferenced(stateDir: string, endingSessionId: string): boolean {
  const session = removeServerRef(stateDir, endingSessionId);
  if (!session) {
    return false;
  }
  if (session.refSessions.length > 0) {
    return false;
  }
  return shutdownServer(stateDir);
}

export function getServerRuntimeStatus(cwd: string): { mode: string; label: string; detail: string; baseUrl: string | null } {
  const stateDir = resolveStateDir(cwd);
  const session = loadServerSession(stateDir);
  if (session && isProcessAlive(session.pid)) {
    return {
      mode: "shared",
      label: `shared server (pid ${session.pid}, port ${session.port})`,
      detail: "This workspace reuses one shared MiMo server across Claude sessions.",
      baseUrl: session.baseUrl
    };
  }
  return {
    mode: "on-demand",
    label: "on-demand startup",
    detail: "No MiMo server is running yet. The first review or task command will start one.",
    baseUrl: null
  };
}
