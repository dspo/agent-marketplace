#!/usr/bin/env node

// src/stop-review-gate-hook.ts
import fs3 from "node:fs";
import process4 from "node:process";
import path3 from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";
import { fileURLToPath } from "node:url";

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
function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const result = runCommand(command, versionArgs, options);
  if (result.error && result.error.code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail };
  }
  return { available: true, detail: result.stdout.trim() || result.stderr.trim() || "ok" };
}

// src/lib/server-lifecycle.ts
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
function listJobs(cwd) {
  return loadState(cwd).jobs;
}
function getConfig(cwd) {
  return loadState(cwd).config;
}

// src/lib/server-lifecycle.ts
var MIMO_BIN_ENV = "MIMO_COMPANION_BIN";
function resolveMimoBin(env = process3.env) {
  return env[MIMO_BIN_ENV] || "mimo";
}

// src/lib/mimo-client.ts
function ensureMiMoAvailable(cwd) {
  return binaryAvailable(resolveMimoBin(), ["--version"], { cwd });
}

// src/lib/tracked-jobs.ts
var SESSION_ID_ENV = "MIMO_COMPANION_SESSION_ID";

// src/lib/mimo-runtime.ts
function getMiMoAvailability(cwd) {
  return ensureMiMoAvailable(cwd);
}

// src/lib/prompts.ts
import fs2 from "node:fs";
import path2 from "node:path";
function loadPromptTemplate(rootDir, name) {
  const promptPath = path2.join(rootDir, "prompts", `${name}.md`);
  return fs2.readFileSync(promptPath, "utf8");
}
function interpolateTemplate(template, variables) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : "";
  });
}

// src/lib/job-control.ts
function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
}

// src/stop-review-gate-hook.ts
var STOP_REVIEW_TIMEOUT_MS = 15 * 60 * 1e3;
var SCRIPT_DIR = path3.dirname(fileURLToPath(import.meta.url));
var ROOT_DIR = path3.resolve(SCRIPT_DIR, "..");
function readHookInput() {
  const raw = fs3.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}
function emitDecision(payload) {
  process4.stdout.write(`${JSON.stringify(payload)}
`);
}
function logNote(message) {
  if (!message) {
    return;
  }
  process4.stderr.write(`${message}
`);
}
function filterJobsForCurrentSession(jobs, input = {}) {
  const sessionId = input.session_id || process4.env[SESSION_ID_ENV] || null;
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}
function buildStopReviewPrompt(input = {}) {
  const lastAssistantMessage = String(input.last_assistant_message ?? "").trim();
  const template = loadPromptTemplate(ROOT_DIR, "stop-review-gate");
  const claudeResponseBlock = lastAssistantMessage ? ["Previous Claude response:", lastAssistantMessage].join("\n") : "";
  return interpolateTemplate(template, {
    CLAUDE_RESPONSE_BLOCK: claudeResponseBlock
  });
}
function buildSetupNote(cwd) {
  const availability = getMiMoAvailability(cwd);
  if (availability.available) {
    return null;
  }
  const detail = availability.detail ? ` ${availability.detail}.` : "";
  return `MiMo is not set up for the review gate.${detail} Run /mimo:setup.`;
}
function parseStopReviewOutput(rawOutput) {
  const text = String(rawOutput ?? "").trim();
  if (!text) {
    return {
      ok: false,
      reason: "The stop-time MiMo review task returned no final output. Run /mimo:review --wait manually or bypass the gate."
    };
  }
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (firstLine.startsWith("ALLOW:")) {
    return { ok: true, reason: null };
  }
  if (firstLine.startsWith("BLOCK:")) {
    const reason = firstLine.slice("BLOCK:".length).trim() || text;
    return {
      ok: false,
      reason: `MiMo stop-time review found issues that still need fixes before ending the session: ${reason}`
    };
  }
  return {
    ok: false,
    reason: "The stop-time MiMo review task returned an unexpected answer. Run /mimo:review --wait manually or bypass the gate."
  };
}
function runStopReview(cwd, input = {}) {
  const scriptPath = path3.join(SCRIPT_DIR, "mimo-companion.mjs");
  const prompt = buildStopReviewPrompt(input);
  const childEnv = {
    ...process4.env,
    ...input.session_id ? { [SESSION_ID_ENV]: input.session_id } : {}
  };
  const result = spawnSync2(process4.execPath, [scriptPath, "task", "--json", prompt], {
    cwd,
    env: childEnv,
    encoding: "utf8",
    timeout: STOP_REVIEW_TIMEOUT_MS
  });
  if (result.error?.code === "ETIMEDOUT") {
    return {
      ok: false,
      reason: "The stop-time MiMo review task timed out after 15 minutes. Run /mimo:review --wait manually or bypass the gate."
    };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      reason: detail ? `The stop-time MiMo review task failed: ${detail}` : "The stop-time MiMo review task failed. Run /mimo:review --wait manually or bypass the gate."
    };
  }
  try {
    const payload = JSON.parse(result.stdout);
    return parseStopReviewOutput(payload?.rawOutput);
  } catch {
    return {
      ok: false,
      reason: "The stop-time MiMo review task returned invalid JSON. Run /mimo:review --wait manually or bypass the gate."
    };
  }
}
function main() {
  const input = readHookInput();
  const cwd = input.cwd || process4.env.CLAUDE_PROJECT_DIR || process4.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);
  const jobs = sortJobsNewestFirst(filterJobsForCurrentSession(listJobs(workspaceRoot), input));
  const runningJob = jobs.find((job) => job.status === "queued" || job.status === "running");
  const runningTaskNote = runningJob ? `MiMo task ${runningJob.id} is still running. Check /mimo:status and use /mimo:cancel ${runningJob.id} if you want to stop it before ending the session.` : null;
  if (!config.stopReviewGate) {
    logNote(runningTaskNote);
    return;
  }
  const setupNote = buildSetupNote(cwd);
  if (setupNote) {
    logNote(setupNote);
    logNote(runningTaskNote);
    return;
  }
  const review = runStopReview(cwd, input);
  if (!review.ok) {
    emitDecision({
      decision: "block",
      reason: runningTaskNote ? `${runningTaskNote} ${review.reason}` : review.reason ?? ""
    });
    return;
  }
  logNote(runningTaskNote);
}
try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process4.stderr.write(`${message}
`);
  process4.exitCode = 0;
}
