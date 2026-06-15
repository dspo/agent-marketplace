#!/usr/bin/env node

// src/session-lifecycle-hook.ts
import fs3 from "node:fs";
import process4 from "node:process";

// src/lib/process.ts
import { spawnSync } from "node:child_process";
import process2 from "node:process";
function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer,
    stdio: options.stdio ?? "pipe",
    shell: process2.platform === "win32" ? process2.env.SHELL || true : false,
    windowsHide: true
  });
  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}
function looksLikeMissingProcessMessage(text) {
  return /not found|no running instance|cannot find|does not exist|no such process/i.test(text);
}
function terminateProcessTree(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return { attempted: false, delivered: false, method: null };
  }
  const platform = options.platform ?? process2.platform;
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const killImpl = options.killImpl ?? process2.kill.bind(process2);
  if (platform === "win32") {
    const result = runCommandImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: options.cwd,
      env: options.env
    });
    if (!result.error && result.status === 0) {
      return { attempted: true, delivered: true, method: "taskkill", result };
    }
    const combinedOutput = `${result.stderr}
${result.stdout}`.trim();
    if (!result.error && looksLikeMissingProcessMessage(combinedOutput)) {
      return { attempted: true, delivered: false, method: "taskkill", result };
    }
    if (result.error?.code === "ENOENT") {
      try {
        killImpl(pid);
        return { attempted: true, delivered: true, method: "kill" };
      } catch (error) {
        if (error?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "kill" };
        }
        throw error;
      }
    }
    if (result.error) {
      throw result.error;
    }
    throw new Error(formatCommandFailure(result));
  }
  try {
    killImpl(-pid, "SIGTERM");
    return { attempted: true, delivered: true, method: "process-group" };
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        killImpl(pid, "SIGTERM");
        return { attempted: true, delivered: true, method: "process" };
      } catch (innerError) {
        if (innerError?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "process" };
        }
        throw innerError;
      }
    }
    return { attempted: true, delivered: false, method: "process-group" };
  }
}
function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process2.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  } else {
    parts.push(`exit=${result.status}`);
  }
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}

// src/lib/server-lifecycle.ts
import fs2 from "node:fs";
import path2 from "node:path";
import process3 from "node:process";

// src/lib/state.ts
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// src/lib/git.ts
var MAX_UNTRACKED_BYTES = 24 * 1024;
var DEFAULT_INLINE_DIFF_MAX_BYTES = 256 * 1024;
function git(cwd, args, options = {}) {
  return runCommand("git", args, { cwd, ...options });
}
function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  const errorCode = result.error && "code" in result.error ? result.error.code : null;
  if (errorCode === "ENOENT") {
    throw new Error("git is not installed. Install Git and retry.");
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.");
  }
  return result.stdout.trim();
}

// src/lib/workspace.ts
function resolveWorkspaceRoot(cwd) {
  try {
    return ensureGitRepository(cwd);
  } catch {
    return cwd;
  }
}

// src/lib/state.ts
var STATE_VERSION = 1;
var PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
var FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "mimo-companion");
var STATE_FILE_NAME = "state.json";
var JOBS_DIR_NAME = "jobs";
var MAX_JOBS = 50;
function defaultState() {
  return {
    version: STATE_VERSION,
    config: {
      stopReviewGate: false
    },
    jobs: []
  };
}
function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonicalWorkspaceRoot = workspaceRoot;
  try {
    canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonicalWorkspaceRoot = workspaceRoot;
  }
  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonicalWorkspaceRoot).digest("hex").slice(0, 16);
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  const stateRoot = pluginDataDir ? path.join(pluginDataDir, "state") : FALLBACK_STATE_ROOT_DIR;
  return path.join(stateRoot, `${slug}-${hash}`);
}
function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), STATE_FILE_NAME);
}
function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), JOBS_DIR_NAME);
}
function ensureStateDir(cwd) {
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}
function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      config: {
        ...defaultState().config,
        ...parsed.config ?? {}
      },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState();
  }
}
function pruneJobs(jobs) {
  return [...jobs].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""))).slice(0, MAX_JOBS);
}
function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
function saveState(cwd, state) {
  const previousJobs = loadState(cwd).jobs;
  ensureStateDir(cwd);
  const nextJobs = pruneJobs(state.jobs ?? []);
  const nextState = {
    version: STATE_VERSION,
    config: {
      ...defaultState().config,
      ...state.config ?? {}
    },
    jobs: nextJobs
  };
  const retainedIds = new Set(nextJobs.map((job) => job.id));
  for (const job of previousJobs) {
    if (retainedIds.has(job.id)) {
      continue;
    }
    removeJobFile(resolveJobFile(cwd, job.id));
    removeFileIfExists(job.logFile);
  }
  fs.writeFileSync(resolveStateFile(cwd), `${JSON.stringify(nextState, null, 2)}
`, "utf8");
  return nextState;
}
function removeJobFile(jobFile) {
  if (fs.existsSync(jobFile)) {
    fs.unlinkSync(jobFile);
  }
}
function resolveJobFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}

// src/lib/server-lifecycle.ts
var SERVER_STATE_FILE = "server.json";
function serverStateFile(stateDir) {
  return path2.join(stateDir, SERVER_STATE_FILE);
}
function loadServerSession(stateDir) {
  const file = serverStateFile(stateDir);
  if (!fs2.existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs2.readFileSync(file, "utf8"));
    if (!Number.isFinite(parsed.pid) || !Number.isFinite(parsed.port)) {
      return null;
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      baseUrl: parsed.baseUrl ?? `http://127.0.0.1:${parsed.port}`,
      startedAt: parsed.startedAt ?? "",
      refSessions: Array.isArray(parsed.refSessions) ? parsed.refSessions.filter((v) => typeof v === "string") : []
    };
  } catch {
    return null;
  }
}
function saveServerSession(stateDir, session) {
  fs2.mkdirSync(stateDir, { recursive: true });
  const file = serverStateFile(stateDir);
  const tmp = `${file}.tmp-${process3.pid}`;
  fs2.writeFileSync(tmp, `${JSON.stringify(session, null, 2)}
`, "utf8");
  fs2.renameSync(tmp, file);
}
function clearServerSession(stateDir) {
  const file = serverStateFile(stateDir);
  if (fs2.existsSync(file)) {
    fs2.unlinkSync(file);
  }
}
function removeServerRef(stateDir, sessionId) {
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
function shutdownServer(stateDir) {
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
function shutdownServerIfUnreferenced(stateDir, endingSessionId) {
  const session = removeServerRef(stateDir, endingSessionId);
  if (!session) {
    return false;
  }
  if (session.refSessions.length > 0) {
    return false;
  }
  return shutdownServer(stateDir);
}

// src/lib/tracked-jobs.ts
var SESSION_ID_ENV = "MIMO_COMPANION_SESSION_ID";

// src/session-lifecycle-hook.ts
var PLUGIN_DATA_ENV2 = "CLAUDE_PLUGIN_DATA";
function readHookInput() {
  const raw = fs3.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}
function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}
function appendEnvVar(name, value) {
  if (!process4.env.CLAUDE_ENV_FILE || value == null || value === "") {
    return;
  }
  fs3.appendFileSync(process4.env.CLAUDE_ENV_FILE, `export ${name}=${shellEscape(value)}
`, "utf8");
}
function cleanupSessionJobs(cwd, sessionId) {
  if (!cwd || !sessionId) {
    return;
  }
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateFile = resolveStateFile(workspaceRoot);
  if (!fs3.existsSync(stateFile)) {
    return;
  }
  const state = loadState(workspaceRoot);
  const sessionJobs = state.jobs.filter((job) => job.sessionId === sessionId);
  if (sessionJobs.length === 0) {
    return;
  }
  for (const job of sessionJobs) {
    const stillRunning = job.status === "queued" || job.status === "running";
    if (!stillRunning) {
      continue;
    }
    try {
      terminateProcessTree(job.pid ?? Number.NaN);
    } catch {
    }
  }
  saveState(workspaceRoot, {
    ...state,
    jobs: state.jobs.filter((job) => job.sessionId !== sessionId)
  });
}
function handleSessionStart(input) {
  appendEnvVar(SESSION_ID_ENV, input.session_id);
  appendEnvVar(PLUGIN_DATA_ENV2, process4.env[PLUGIN_DATA_ENV2]);
}
function handleSessionEnd(input) {
  const cwd = input.cwd || process4.cwd();
  const sessionId = input.session_id || process4.env[SESSION_ID_ENV] || "";
  cleanupSessionJobs(cwd, sessionId);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  shutdownServerIfUnreferenced(resolveStateDir(workspaceRoot), sessionId);
}
function main() {
  const input = readHookInput();
  const eventName = process4.argv[2] ?? input.hook_event_name ?? "";
  if (eventName === "SessionStart") {
    handleSessionStart(input);
    return;
  }
  if (eventName === "SessionEnd") {
    handleSessionEnd(input);
  }
}
try {
  main();
} catch (error) {
  process4.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
  process4.exit(1);
}
