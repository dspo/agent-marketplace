#!/usr/bin/env node

// src/mimo-companion.ts
import { spawn as spawn2 } from "node:child_process";
import fs8 from "node:fs";
import path5 from "node:path";
import process7 from "node:process";
import { fileURLToPath } from "node:url";

// src/lib/args.ts
function parseArgs(argv, config = {}) {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const options = {};
  const positionals = [];
  let passthrough = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (passthrough) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      passthrough = true;
      continue;
    }
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    if (token.startsWith("--")) {
      const [rawKey, inlineValue] = token.slice(2).split("=", 2);
      const key2 = aliasMap[rawKey] ?? rawKey;
      if (booleanOptions.has(key2)) {
        options[key2] = inlineValue === void 0 ? true : inlineValue !== "false";
        continue;
      }
      if (valueOptions.has(key2)) {
        const nextValue = inlineValue ?? argv[index + 1];
        if (nextValue === void 0) {
          throw new Error(`Missing value for --${rawKey}`);
        }
        options[key2] = nextValue;
        if (inlineValue === void 0) {
          index += 1;
        }
        continue;
      }
      positionals.push(token);
      continue;
    }
    const shortKey = token.slice(1);
    const key = aliasMap[shortKey] ?? shortKey;
    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }
    if (valueOptions.has(key)) {
      const nextValue = argv[index + 1];
      if (nextValue === void 0) {
        throw new Error(`Missing value for -${shortKey}`);
      }
      options[key] = nextValue;
      index += 1;
      continue;
    }
    positionals.push(token);
  }
  return { options, positionals };
}
function splitRawArgumentString(raw) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;
  for (const character of raw) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }
    if (character === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (escaping) {
    current += "\\";
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

// src/lib/fs.ts
import fs from "node:fs";
function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function isProbablyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const value of sample) {
    if (value === 0) {
      return false;
    }
  }
  return true;
}
function readStdinIfPiped() {
  if (process.stdin.isTTY) {
    return "";
  }
  return fs.readFileSync(0, "utf8");
}

// src/lib/git.ts
import fs2 from "node:fs";
import path from "node:path";

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
function runCommandChecked(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
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

// src/lib/git.ts
var MAX_UNTRACKED_BYTES = 24 * 1024;
var DEFAULT_INLINE_DIFF_MAX_FILES = 2;
var DEFAULT_INLINE_DIFF_MAX_BYTES = 256 * 1024;
function git(cwd, args, options = {}) {
  return runCommand("git", args, { cwd, ...options });
}
function gitChecked(cwd, args, options = {}) {
  return runCommandChecked("git", args, { cwd, ...options });
}
function listUniqueFiles(...groups) {
  return [...new Set(groups.flat().filter(Boolean))].sort();
}
function normalizeMaxInlineFiles(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_INLINE_DIFF_MAX_FILES;
  }
  return Math.floor(parsed);
}
function normalizeMaxInlineDiffBytes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_INLINE_DIFF_MAX_BYTES;
  }
  return Math.floor(parsed);
}
function measureGitOutputBytes(cwd, args, maxBytes) {
  const result = git(cwd, args, { maxBuffer: maxBytes + 1 });
  if (result.error && result.error.code === "ENOBUFS") {
    return maxBytes + 1;
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return Buffer.byteLength(result.stdout, "utf8");
}
function measureCombinedGitOutputBytes(cwd, argSets, maxBytes) {
  let totalBytes = 0;
  for (const args of argSets) {
    const remainingBytes = maxBytes - totalBytes;
    if (remainingBytes < 0) {
      return maxBytes + 1;
    }
    totalBytes += measureGitOutputBytes(cwd, args, remainingBytes);
    if (totalBytes > maxBytes) {
      return totalBytes;
    }
  }
  return totalBytes;
}
function buildBranchComparison(cwd, baseRef) {
  const mergeBase = gitChecked(cwd, ["merge-base", "HEAD", baseRef]).stdout.trim();
  return {
    mergeBase,
    commitRange: `${mergeBase}..HEAD`,
    reviewRange: `${baseRef}...HEAD`
  };
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
function getRepoRoot(cwd) {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}
function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const remoteHead = symbolic.stdout.trim();
    if (remoteHead.startsWith("refs/remotes/origin/")) {
      return remoteHead.replace("refs/remotes/origin/", "");
    }
  }
  const candidates = ["main", "master", "trunk", "dev"];
  for (const candidate of candidates) {
    const local = git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (local.status === 0) {
      return candidate;
    }
    const remote = git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]);
    if (remote.status === 0) {
      return `origin/${candidate}`;
    }
  }
  throw new Error("Unable to detect the repository default branch. Pass --base <ref> or use --scope working-tree.");
}
function getCurrentBranch(cwd) {
  return gitChecked(cwd, ["branch", "--show-current"]).stdout.trim() || "HEAD";
}
function getWorkingTreeState(cwd) {
  const staged = gitChecked(cwd, ["diff", "--cached", "--name-only"]).stdout.trim().split("\n").filter(Boolean);
  const unstaged = gitChecked(cwd, ["diff", "--name-only"]).stdout.trim().split("\n").filter(Boolean);
  const untracked = gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout.trim().split("\n").filter(Boolean);
  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0
  };
}
function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd);
  const requestedScope = options.scope ?? "auto";
  const baseRef = options.base ?? null;
  const state = getWorkingTreeState(cwd);
  const supportedScopes = /* @__PURE__ */ new Set(["auto", "working-tree", "branch"]);
  if (baseRef) {
    return {
      mode: "branch",
      label: `branch diff against ${baseRef}`,
      baseRef,
      explicit: true
    };
  }
  if (requestedScope === "working-tree") {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: true
    };
  }
  if (!supportedScopes.has(requestedScope)) {
    throw new Error(
      `Unsupported review scope "${requestedScope}". Use one of: auto, working-tree, branch, or pass --base <ref>.`
    );
  }
  if (requestedScope === "branch") {
    const detectedBase2 = detectDefaultBranch(cwd);
    return {
      mode: "branch",
      label: `branch diff against ${detectedBase2}`,
      baseRef: detectedBase2,
      explicit: true
    };
  }
  if (state.isDirty) {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: false
    };
  }
  const detectedBase = detectDefaultBranch(cwd);
  return {
    mode: "branch",
    label: `branch diff against ${detectedBase}`,
    baseRef: detectedBase,
    explicit: false
  };
}
function formatSection(title, body) {
  return [`## ${title}`, "", body.trim() ? body.trim() : "(none)", ""].join("\n");
}
function formatUntrackedFile(cwd, relativePath) {
  const absolutePath = path.join(cwd, relativePath);
  let stat;
  try {
    stat = fs2.statSync(absolutePath);
  } catch {
    return `### ${relativePath}
(skipped: broken symlink or unreadable file)`;
  }
  if (stat.isDirectory()) {
    return `### ${relativePath}
(skipped: directory)`;
  }
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return `### ${relativePath}
(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`;
  }
  let buffer;
  try {
    buffer = fs2.readFileSync(absolutePath);
  } catch {
    return `### ${relativePath}
(skipped: broken symlink or unreadable file)`;
  }
  if (!isProbablyText(buffer)) {
    return `### ${relativePath}
(skipped: binary file)`;
  }
  return [`### ${relativePath}`, "```", buffer.toString("utf8").trimEnd(), "```"].join("\n");
}
function collectWorkingTreeContext(cwd, state, options = {}) {
  const includeDiff = options.includeDiff !== false;
  const status = gitChecked(cwd, ["status", "--short", "--untracked-files=all"]).stdout.trim();
  const changedFiles = listUniqueFiles(state.staged, state.unstaged, state.untracked);
  let parts;
  if (includeDiff) {
    const stagedDiff = gitChecked(cwd, ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout;
    const unstagedDiff = gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout;
    const untrackedBody = state.untracked.map((file) => formatUntrackedFile(cwd, file)).join("\n\n");
    parts = [
      formatSection("Git Status", status),
      formatSection("Staged Diff", stagedDiff),
      formatSection("Unstaged Diff", unstagedDiff),
      formatSection("Untracked Files", untrackedBody)
    ];
  } else {
    const stagedStat = gitChecked(cwd, ["diff", "--shortstat", "--cached"]).stdout.trim();
    const unstagedStat = gitChecked(cwd, ["diff", "--shortstat"]).stdout.trim();
    const untrackedBody = state.untracked.map((file) => formatUntrackedFile(cwd, file)).join("\n\n");
    parts = [
      formatSection("Git Status", status),
      formatSection("Staged Diff Stat", stagedStat),
      formatSection("Unstaged Diff Stat", unstagedStat),
      formatSection("Changed Files", changedFiles.join("\n")),
      formatSection("Untracked Files", untrackedBody)
    ];
  }
  return {
    mode: "working-tree",
    summary: `Reviewing ${state.staged.length} staged, ${state.unstaged.length} unstaged, and ${state.untracked.length} untracked file(s).`,
    content: parts.join("\n"),
    changedFiles
  };
}
function collectBranchContext(cwd, baseRef, options = {}) {
  const includeDiff = options.includeDiff !== false;
  const comparison = options.comparison ?? buildBranchComparison(cwd, baseRef);
  const currentBranch = getCurrentBranch(cwd);
  const changedFiles = gitChecked(cwd, ["diff", "--name-only", comparison.commitRange]).stdout.trim().split("\n").filter(Boolean);
  const logOutput = gitChecked(cwd, ["log", "--oneline", "--decorate", comparison.commitRange]).stdout.trim();
  const diffStat = gitChecked(cwd, ["diff", "--stat", comparison.commitRange]).stdout.trim();
  return {
    mode: "branch",
    summary: `Reviewing branch ${currentBranch} against ${baseRef} from merge-base ${comparison.mergeBase}.`,
    content: includeDiff ? [
      formatSection("Commit Log", logOutput),
      formatSection("Diff Stat", diffStat),
      formatSection(
        "Branch Diff",
        gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff", comparison.commitRange]).stdout
      )
    ].join("\n") : [
      formatSection("Commit Log", logOutput),
      formatSection("Diff Stat", diffStat),
      formatSection("Changed Files", changedFiles.join("\n"))
    ].join("\n"),
    changedFiles,
    comparison
  };
}
function buildCollectionGuidance(options = {}) {
  if (options.includeDiff !== false) {
    return "Use the repository context below as primary evidence.";
  }
  return "The repository context below is a lightweight summary. Inspect the target diff yourself with read-only git commands before finalizing findings.";
}
function collectReviewContext(cwd, target, options = {}) {
  const repoRoot = getRepoRoot(cwd);
  const currentBranch = getCurrentBranch(repoRoot);
  const maxInlineFiles = normalizeMaxInlineFiles(options.maxInlineFiles);
  const maxInlineDiffBytes = normalizeMaxInlineDiffBytes(options.maxInlineDiffBytes);
  let details;
  let includeDiff;
  let diffBytes;
  if (target.mode === "working-tree") {
    const state = getWorkingTreeState(repoRoot);
    diffBytes = measureCombinedGitOutputBytes(
      repoRoot,
      [
        ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"],
        ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]
      ],
      maxInlineDiffBytes
    );
    includeDiff = options.includeDiff ?? (listUniqueFiles(state.staged, state.unstaged, state.untracked).length <= maxInlineFiles && diffBytes <= maxInlineDiffBytes);
    details = collectWorkingTreeContext(repoRoot, state, { includeDiff });
  } else {
    const comparison = buildBranchComparison(repoRoot, target.baseRef);
    const fileCount = gitChecked(repoRoot, ["diff", "--name-only", comparison.commitRange]).stdout.trim().split("\n").filter(Boolean).length;
    diffBytes = measureGitOutputBytes(
      repoRoot,
      ["diff", "--binary", "--no-ext-diff", "--submodule=diff", comparison.commitRange],
      maxInlineDiffBytes
    );
    includeDiff = options.includeDiff ?? (fileCount <= maxInlineFiles && diffBytes <= maxInlineDiffBytes);
    details = collectBranchContext(repoRoot, target.baseRef, { includeDiff, comparison });
  }
  return {
    cwd: repoRoot,
    repoRoot,
    branch: currentBranch,
    target,
    fileCount: details.changedFiles.length,
    diffBytes,
    inputMode: includeDiff ? "inline-diff" : "self-collect",
    collectionGuidance: buildCollectionGuidance({ includeDiff }),
    ...details
  };
}

// src/lib/mimo-runtime.ts
import process6 from "node:process";

// src/lib/mimo-client.ts
import process4 from "node:process";

// src/lib/server-lifecycle.ts
import fs4 from "node:fs";
import path3 from "node:path";
import process3 from "node:process";
import { spawn } from "node:child_process";

// src/lib/state.ts
import { createHash } from "node:crypto";
import fs3 from "node:fs";
import os from "node:os";
import path2 from "node:path";

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
var FALLBACK_STATE_ROOT_DIR = path2.join(os.tmpdir(), "mimo-companion");
var STATE_FILE_NAME = "state.json";
var JOBS_DIR_NAME = "jobs";
var MAX_JOBS = 50;
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
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
    canonicalWorkspaceRoot = fs3.realpathSync.native(workspaceRoot);
  } catch {
    canonicalWorkspaceRoot = workspaceRoot;
  }
  const slugSource = path2.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonicalWorkspaceRoot).digest("hex").slice(0, 16);
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  const stateRoot = pluginDataDir ? path2.join(pluginDataDir, "state") : FALLBACK_STATE_ROOT_DIR;
  return path2.join(stateRoot, `${slug}-${hash}`);
}
function resolveStateFile(cwd) {
  return path2.join(resolveStateDir(cwd), STATE_FILE_NAME);
}
function resolveJobsDir(cwd) {
  return path2.join(resolveStateDir(cwd), JOBS_DIR_NAME);
}
function ensureStateDir(cwd) {
  fs3.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}
function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  if (!fs3.existsSync(stateFile)) {
    return defaultState();
  }
  try {
    const parsed = JSON.parse(fs3.readFileSync(stateFile, "utf8"));
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
  if (filePath && fs3.existsSync(filePath)) {
    fs3.unlinkSync(filePath);
  }
}
function atomicWriteJSON(filePath, data) {
  const tmpFile = path2.join(path2.dirname(filePath), `.tmp-${process.pid}-${Date.now()}`);
  fs3.writeFileSync(tmpFile, data, "utf8");
  fs3.renameSync(tmpFile, filePath);
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
  atomicWriteJSON(resolveStateFile(cwd), `${JSON.stringify(nextState, null, 2)}
`);
  return nextState;
}
function updateState(cwd, mutate) {
  const state = loadState(cwd);
  mutate(state);
  return saveState(cwd, state);
}
function generateJobId(prefix = "job") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
function upsertJob(cwd, jobPatch) {
  return updateState(cwd, (state) => {
    const timestamp = nowIso();
    const existingIndex = state.jobs.findIndex((job) => job.id === jobPatch.id);
    if (existingIndex === -1) {
      state.jobs.unshift({
        createdAt: timestamp,
        updatedAt: timestamp,
        ...jobPatch
      });
      return;
    }
    state.jobs[existingIndex] = {
      ...state.jobs[existingIndex],
      ...jobPatch,
      updatedAt: timestamp
    };
  });
}
function listJobs(cwd) {
  return loadState(cwd).jobs;
}
function setConfig(cwd, key, value) {
  return updateState(cwd, (state) => {
    state.config = {
      ...state.config,
      [key]: value
    };
  });
}
function getConfig(cwd) {
  return loadState(cwd).config;
}
function writeJobFile(cwd, jobId, payload) {
  ensureStateDir(cwd);
  const jobFile = resolveJobFile(cwd, jobId);
  atomicWriteJSON(jobFile, `${JSON.stringify(payload, null, 2)}
`);
  return jobFile;
}
function readJobFile(jobFile) {
  return JSON.parse(fs3.readFileSync(jobFile, "utf8"));
}
function removeJobFile(jobFile) {
  if (fs3.existsSync(jobFile)) {
    fs3.unlinkSync(jobFile);
  }
}
function resolveJobLogFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path2.join(resolveJobsDir(cwd), `${jobId}.log`);
}
function resolveJobFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path2.join(resolveJobsDir(cwd), `${jobId}.json`);
}

// src/lib/server-lifecycle.ts
var SERVER_STATE_FILE = "server.json";
var SERVER_LOCK_FILE = "server.lock";
var SERVER_LOG_FILE = "server.log";
var PORT_PATTERN = /listening on https?:\/\/[^:\s]+:(\d+)/g;
var DEFAULT_STARTUP_TIMEOUT_MS = 1e4;
var HEALTH_CHECK_TIMEOUT_MS = 2e3;
var LOCK_STALE_MS = 6e4;
var MIMO_BIN_ENV = "MIMO_COMPANION_BIN";
function resolveMimoBin(env = process3.env) {
  return env[MIMO_BIN_ENV] || "mimo";
}
function serverStateFile(stateDir) {
  return path3.join(stateDir, SERVER_STATE_FILE);
}
function serverLogFile(stateDir) {
  return path3.join(stateDir, SERVER_LOG_FILE);
}
function loadServerSession(stateDir) {
  const file = serverStateFile(stateDir);
  if (!fs4.existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs4.readFileSync(file, "utf8"));
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
  fs4.mkdirSync(stateDir, { recursive: true });
  const file = serverStateFile(stateDir);
  const tmp = `${file}.tmp-${process3.pid}`;
  fs4.writeFileSync(tmp, `${JSON.stringify(session, null, 2)}
`, "utf8");
  fs4.renameSync(tmp, file);
}
function clearServerSession(stateDir) {
  const file = serverStateFile(stateDir);
  if (fs4.existsSync(file)) {
    fs4.unlinkSync(file);
  }
}
async function isServerHealthy(session, options = {}) {
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
function acquireLock(stateDir) {
  fs4.mkdirSync(stateDir, { recursive: true });
  const lockFile = path3.join(stateDir, SERVER_LOCK_FILE);
  try {
    const fd = fs4.openSync(lockFile, "wx");
    fs4.writeSync(fd, String(process3.pid));
    fs4.closeSync(fd);
    return true;
  } catch {
    try {
      const stat = fs4.statSync(lockFile);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        fs4.unlinkSync(lockFile);
        return acquireLock(stateDir);
      }
    } catch {
      return acquireLock(stateDir);
    }
    return false;
  }
}
function releaseLock(stateDir) {
  const lockFile = path3.join(stateDir, SERVER_LOCK_FILE);
  try {
    fs4.unlinkSync(lockFile);
  } catch {
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function readLogTail(logFile, maxBytes = 2048) {
  try {
    const content = fs4.readFileSync(logFile, "utf8");
    return content.slice(-maxBytes);
  } catch {
    return "";
  }
}
async function spawnServer(stateDir, options) {
  const mimoBin = options.mimoBin ?? resolveMimoBin(options.env ?? process3.env);
  const logFile = serverLogFile(stateDir);
  const logFd = fs4.openSync(logFile, "a");
  const child = spawn(mimoBin, ["serve", "--port", "0", "--hostname", "127.0.0.1"], {
    env: options.env ?? process3.env,
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  fs4.closeSync(logFd);
  const spawnError = await new Promise((resolve) => {
    const onError = (error) => resolve(error);
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
  let logOffset = 0;
  try {
    logOffset = fs4.statSync(logFile).size;
  } catch {
    logOffset = 0;
  }
  while (Date.now() < deadline) {
    const content = fs4.existsSync(logFile) ? fs4.readFileSync(logFile, "utf8").slice(logOffset) : "";
    const matches = [...content.matchAll(PORT_PATTERN)];
    const match = matches[matches.length - 1];
    if (match) {
      const port = Number(match[1]);
      return {
        pid: child.pid,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
    `Timed out waiting for \`${mimoBin} serve\` to report its port after ${timeoutMs}ms.${tail ? `
Server log tail:
${tail}` : ""}`
  );
}
async function ensureServer(stateDir, options = {}) {
  const existing = loadServerSession(stateDir);
  if (existing && await isServerHealthy(existing, options)) {
    return existing;
  }
  if (existing) {
    if (isProcessAlive(existing.pid)) {
      terminateProcessTree(existing.pid);
    }
    clearServerSession(stateDir);
  }
  const lockDeadline = Date.now() + (options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS) + 5e3;
  while (!acquireLock(stateDir)) {
    await sleep(150);
    const published = loadServerSession(stateDir);
    if (published && await isServerHealthy(published, options)) {
      return published;
    }
    if (Date.now() > lockDeadline) {
      throw new Error("Timed out waiting for another process to start the MiMo server.");
    }
  }
  try {
    const published = loadServerSession(stateDir);
    if (published && await isServerHealthy(published, options)) {
      return published;
    }
    const session = await spawnServer(stateDir, options);
    saveServerSession(stateDir, session);
    return session;
  } finally {
    releaseLock(stateDir);
  }
}
function addServerRef(stateDir, sessionId) {
  const session = loadServerSession(stateDir);
  if (!session || !sessionId) {
    return;
  }
  if (!session.refSessions.includes(sessionId)) {
    session.refSessions.push(sessionId);
    saveServerSession(stateDir, session);
  }
}
function getServerRuntimeStatus(cwd) {
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

// src/lib/mimo-client.ts
var SERVER_PASSWORD_ENV = "MIMOCODE_SERVER_PASSWORD";
var SERVER_USERNAME_ENV = "MIMOCODE_SERVER_USERNAME";
var READ_ONLY_RULESET = [
  { permission: "*", pattern: "*", action: "allow" },
  { permission: "edit", pattern: "*", action: "deny" },
  { permission: "write", pattern: "*", action: "deny" },
  { permission: "apply_patch", pattern: "*", action: "deny" },
  { permission: "multiedit", pattern: "*", action: "deny" },
  { permission: "external_directory", pattern: "*", action: "deny" }
];
var WRITE_RULESET = [{ permission: "*", pattern: "*", action: "allow" }];
var MiMoHttpError = class extends Error {
  status;
  body;
  constructor(message, status, body) {
    super(message);
    this.name = "MiMoHttpError";
    this.status = status;
    this.body = body;
  }
};
function buildAuthHeader(env) {
  const password = env[SERVER_PASSWORD_ENV];
  if (!password) {
    return null;
  }
  const username = env[SERVER_USERNAME_ENV] || "mimocode";
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}
function createMiMoClient(baseUrl, directory, options = {}) {
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    directory,
    fetchImpl: options.fetchImpl ?? fetch,
    authHeader: buildAuthHeader(options.env ?? process4.env)
  };
}
function ensureMiMoAvailable(cwd) {
  return binaryAvailable(resolveMimoBin(), ["--version"], { cwd });
}
function buildHeaders(client, extra = {}) {
  const headers = {
    "x-mimocode-directory": client.directory,
    ...extra
  };
  if (client.authHeader) {
    headers["authorization"] = client.authHeader;
  }
  return headers;
}
async function request(client, method, pathName, body, init = {}) {
  const response = await client.fetchImpl(`${client.baseUrl}${pathName}`, {
    method,
    headers: buildHeaders(client, body === void 0 ? {} : { "content-type": "application/json" }),
    body: body === void 0 ? void 0 : JSON.stringify(body),
    ...init
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 409) {
      throw new MiMoHttpError(
        "The MiMo session is busy with another prompt (HTTP 409). Wait for the active job to finish, or cancel it with /mimo:cancel.",
        409,
        text
      );
    }
    throw new MiMoHttpError(`MiMo server responded ${response.status} for ${method} ${pathName}${text ? `: ${text.slice(0, 500)}` : ""}`, response.status, text);
  }
  return response;
}
async function createSession(client, options = {}) {
  const response = await request(client, "POST", "/session", {
    ...options.title ? { title: options.title } : {},
    ...options.permission ? { permission: options.permission } : {}
  });
  return await response.json();
}
async function getSession(client, sessionID) {
  try {
    const response = await request(client, "GET", `/session/${encodeURIComponent(sessionID)}`);
    return await response.json();
  } catch (error) {
    if (error instanceof MiMoHttpError && (error.status === 404 || error.status === 400)) {
      return null;
    }
    throw error;
  }
}
async function setSessionPermission(client, sessionID, permission) {
  await request(client, "PATCH", `/session/${encodeURIComponent(sessionID)}`, { permission });
}
async function sendPrompt(client, sessionID, options) {
  const body = {
    parts: [{ type: "text", text: options.prompt }]
  };
  if (options.system) body.system = options.system;
  if (options.model) body.model = options.model;
  if (options.modelRef) body.modelRef = options.modelRef;
  if (options.format) body.format = options.format;
  const response = await request(client, "POST", `/session/${encodeURIComponent(sessionID)}/message`, body, {
    signal: options.signal
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`MiMo returned a non-JSON prompt response: ${text.slice(0, 500)}`);
  }
}
async function abortSession(client, sessionID) {
  try {
    await request(client, "POST", `/session/${encodeURIComponent(sessionID)}/abort`, {});
    return true;
  } catch {
    return false;
  }
}
async function getSessionDiff(client, sessionID, messageID) {
  const query = messageID ? `?messageID=${encodeURIComponent(messageID)}` : "";
  const response = await request(client, "GET", `/session/${encodeURIComponent(sessionID)}/diff${query}`);
  return await response.json();
}
async function listSessions(client, options = {}) {
  const params = new URLSearchParams();
  params.set("directory", client.directory);
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  const response = await request(client, "GET", `/session?${params.toString()}`);
  return await response.json();
}
async function rejectQuestion(client, requestID) {
  await request(client, "POST", `/question/${encodeURIComponent(requestID)}/reject`, {});
}
async function rejectPermission(client, sessionID, permissionID) {
  await request(client, "POST", `/session/${encodeURIComponent(sessionID)}/permissions/${encodeURIComponent(permissionID)}`, {
    response: "reject"
  });
}
function subscribeEvents(client, onEvent, options = {}) {
  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  const done = (async () => {
    const response = await client.fetchImpl(`${client.baseUrl}/event`, {
      headers: buildHeaders(client),
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`MiMo event stream failed with status ${response.status}.`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (; ; ) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split("\n\n");
      buffer = segments.pop() ?? "";
      for (const segment of segments) {
        for (const line of segment.split("\n")) {
          if (!line.startsWith("data:")) {
            continue;
          }
          const payload = line.slice(5).trim();
          if (!payload) {
            continue;
          }
          try {
            const event = JSON.parse(payload);
            if (event && typeof event.type === "string") {
              onEvent(event);
            }
          } catch {
          }
        }
      }
    }
  })().catch((error) => {
    if (controller.signal.aborted) {
      return;
    }
    throw error;
  });
  return {
    close: () => controller.abort(),
    done
  };
}
function extractFinalText(result) {
  const texts = result.parts.filter((part) => part.type === "text" && typeof part.text === "string" && !part.synthetic).map((part) => part.text).filter(Boolean);
  return texts.join("\n\n").trim();
}
function parseStructuredResult(result, fallbackMessage) {
  const rawOutput = extractFinalText(result);
  if (result.info.structured !== void 0 && result.info.structured !== null) {
    return { parsed: result.info.structured, parseError: null, rawOutput };
  }
  if (result.info.error) {
    const message = result.info.error.data?.message || result.info.error.name || "MiMo reported an error.";
    return { parsed: null, parseError: message, rawOutput };
  }
  if (!rawOutput) {
    return {
      parsed: null,
      parseError: fallbackMessage ?? "MiMo did not return a final structured message.",
      rawOutput: ""
    };
  }
  try {
    return { parsed: JSON.parse(rawOutput), parseError: null, rawOutput };
  } catch {
    const fencedMatch = rawOutput.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (fencedMatch) {
      try {
        return { parsed: JSON.parse(fencedMatch[1]), parseError: null, rawOutput };
      } catch {
      }
    }
    return { parsed: null, parseError: "The final message was not valid JSON.", rawOutput };
  }
}

// src/lib/tracked-jobs.ts
import fs5 from "node:fs";
import process5 from "node:process";
var SESSION_ID_ENV = "MIMO_COMPANION_SESSION_ID";
function nowIso2() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function normalizeProgressEvent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      message: String(value.message ?? "").trim(),
      phase: typeof value.phase === "string" && value.phase.trim() ? value.phase.trim() : null,
      mimoSessionID: typeof value.mimoSessionID === "string" && value.mimoSessionID.trim() ? value.mimoSessionID.trim() : null,
      messageID: typeof value.messageID === "string" && value.messageID.trim() ? value.messageID.trim() : null,
      stderrMessage: value.stderrMessage == null ? null : String(value.stderrMessage).trim(),
      logTitle: typeof value.logTitle === "string" && value.logTitle.trim() ? value.logTitle.trim() : null,
      logBody: value.logBody == null ? null : String(value.logBody).trimEnd()
    };
  }
  return {
    message: String(value ?? "").trim(),
    phase: null,
    mimoSessionID: null,
    messageID: null,
    stderrMessage: String(value ?? "").trim(),
    logTitle: null,
    logBody: null
  };
}
function appendLogLine(logFile, message) {
  const normalized = String(message ?? "").trim();
  if (!logFile || !normalized) {
    return;
  }
  fs5.appendFileSync(logFile, `[${nowIso2()}] ${normalized}
`, "utf8");
}
function appendLogBlock(logFile, title, body) {
  if (!logFile || !body) {
    return;
  }
  fs5.appendFileSync(logFile, `
[${nowIso2()}] ${title}
${String(body).trimEnd()}
`, "utf8");
}
function createJobLogFile(workspaceRoot, jobId, title) {
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  fs5.writeFileSync(logFile, "", "utf8");
  if (title) {
    appendLogLine(logFile, `Starting ${title}.`);
  }
  return logFile;
}
function createJobRecord(base, options = {}) {
  const env = options.env ?? process5.env;
  const sessionId = env[options.sessionIdEnv ?? SESSION_ID_ENV];
  return {
    ...base,
    createdAt: nowIso2(),
    ...sessionId ? { sessionId } : {}
  };
}
function createJobProgressUpdater(workspaceRoot, jobId) {
  let lastPhase = null;
  let lastMimoSessionID = null;
  let lastMessageID = null;
  return (event) => {
    const normalized = normalizeProgressEvent(event);
    const patch = { id: jobId };
    let changed = false;
    if (normalized.phase && normalized.phase !== lastPhase) {
      lastPhase = normalized.phase;
      patch.phase = normalized.phase;
      changed = true;
    }
    if (normalized.mimoSessionID && normalized.mimoSessionID !== lastMimoSessionID) {
      lastMimoSessionID = normalized.mimoSessionID;
      patch.mimoSessionID = normalized.mimoSessionID;
      changed = true;
    }
    if (normalized.messageID && normalized.messageID !== lastMessageID) {
      lastMessageID = normalized.messageID;
      patch.messageID = normalized.messageID;
      changed = true;
    }
    if (!changed) {
      return;
    }
    upsertJob(workspaceRoot, patch);
    const jobFile = resolveJobFile(workspaceRoot, jobId);
    if (!fs5.existsSync(jobFile)) {
      return;
    }
    const storedJob = readJobFile(jobFile);
    writeJobFile(workspaceRoot, jobId, {
      ...storedJob,
      ...patch
    });
  };
}
function createProgressReporter({ stderr = false, logFile = null, onEvent = null } = {}) {
  if (!stderr && !logFile && !onEvent) {
    return null;
  }
  return (eventOrMessage) => {
    const event = normalizeProgressEvent(eventOrMessage);
    const stderrMessage = event.stderrMessage ?? event.message;
    if (stderr && stderrMessage) {
      process5.stderr.write(`[mimo] ${stderrMessage}
`);
    }
    appendLogLine(logFile, event.message);
    appendLogBlock(logFile, event.logTitle, event.logBody);
    onEvent?.(event);
  };
}
function readStoredJobOrNull(workspaceRoot, jobId) {
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs5.existsSync(jobFile)) {
    return null;
  }
  return readJobFile(jobFile);
}
async function runTrackedJob(job, runner, options = {}) {
  const runningRecord = {
    ...job,
    status: "running",
    startedAt: nowIso2(),
    phase: "starting",
    pid: process5.pid,
    logFile: options.logFile ?? job.logFile ?? null
  };
  writeJobFile(job.workspaceRoot, job.id, runningRecord);
  upsertJob(job.workspaceRoot, runningRecord);
  try {
    const execution = await runner();
    const completionStatus = execution.exitStatus === 0 ? "completed" : "failed";
    const completedAt = nowIso2();
    writeJobFile(job.workspaceRoot, job.id, {
      ...runningRecord,
      status: completionStatus,
      mimoSessionID: execution.mimoSessionID ?? null,
      messageID: execution.messageID ?? null,
      pid: null,
      phase: completionStatus === "completed" ? "done" : "failed",
      completedAt,
      result: execution.payload,
      rendered: execution.rendered
    });
    upsertJob(job.workspaceRoot, {
      id: job.id,
      status: completionStatus,
      mimoSessionID: execution.mimoSessionID ?? null,
      messageID: execution.messageID ?? null,
      summary: execution.summary,
      phase: completionStatus === "completed" ? "done" : "failed",
      pid: null,
      completedAt
    });
    appendLogBlock(options.logFile ?? job.logFile ?? null, "Final output", execution.rendered);
    return execution;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const existing = readStoredJobOrNull(job.workspaceRoot, job.id) ?? runningRecord;
    const completedAt = nowIso2();
    writeJobFile(job.workspaceRoot, job.id, {
      ...existing,
      status: "failed",
      phase: "failed",
      errorMessage,
      pid: null,
      completedAt,
      logFile: options.logFile ?? job.logFile ?? existing.logFile ?? null
    });
    upsertJob(job.workspaceRoot, {
      id: job.id,
      status: "failed",
      phase: "failed",
      pid: null,
      errorMessage,
      completedAt
    });
    throw error;
  }
}

// src/lib/mimo-runtime.ts
var TASK_SESSION_PREFIX = "MiMo Companion Task";
var DEFAULT_CONTINUE_PROMPT = "Continue from the current session state. Pick the next highest-value step and follow through until the task is resolved.";
function shorten(text, limit = 72) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}
function buildTaskSessionTitle(prompt) {
  const excerpt = shorten(prompt, 56);
  return excerpt ? `${TASK_SESSION_PREFIX}: ${excerpt}` : TASK_SESSION_PREFIX;
}
function getMiMoAvailability(cwd) {
  return ensureMiMoAvailable(cwd);
}
function ensureMiMoReady(cwd) {
  const availability = getMiMoAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      "MiMo CLI is not installed or not working. Install it (e.g. `npm install -g @mimo-ai/cli`), then rerun `/mimo:setup`."
    );
  }
}
async function connectMiMo(cwd, options = {}) {
  const stateDir = resolveStateDir(cwd);
  const server = await ensureServer(stateDir, options);
  const sessionId = (options.env ?? process6.env)[SESSION_ID_ENV];
  if (sessionId) {
    addServerRef(stateDir, sessionId);
  }
  return createMiMoClient(server.baseUrl, cwd, { env: options.env, fetchImpl: options.fetchImpl });
}
function emitProgress(onProgress, message, phase = null, extra = {}) {
  if (!onProgress || !message) {
    return;
  }
  onProgress({ message, phase, ...extra });
}
function describeEventPhase(event) {
  switch (event.type) {
    case "session.status": {
      const statusType = event.properties?.status?.type;
      if (statusType === "busy") {
        return { message: "MiMo is working.", phase: "investigating" };
      }
      if (statusType === "retry") {
        return { message: "MiMo is retrying a model call.", phase: "investigating" };
      }
      return null;
    }
    case "file.edited":
      return { message: `Editing ${event.properties?.file ?? "a file"}.`, phase: "editing" };
    case "session.error": {
      const message = event.properties?.error?.data?.message ?? event.properties?.error?.name ?? "unknown error";
      return { message: `MiMo error: ${message}`, phase: "failed" };
    }
    default:
      return null;
  }
}
function watchSessionEvents(client, sessionID, onProgress, signal) {
  try {
    subscribeEvents(
      client,
      (event) => {
        const eventSessionID = event.properties?.sessionID ?? event.properties?.request?.sessionID ?? null;
        if (eventSessionID !== sessionID) {
          return;
        }
        if (event.type === "question.asked") {
          const requestID = event.properties?.id ?? event.properties?.requestID ?? null;
          emitProgress(onProgress, "MiMo asked a question; auto-rejecting to keep the unattended run moving.", null);
          if (requestID) {
            void rejectQuestion(client, String(requestID)).catch(() => {
            });
          }
          return;
        }
        if (event.type === "permission.asked") {
          const permissionID = event.properties?.id ?? null;
          emitProgress(onProgress, "MiMo asked for permission; auto-rejecting to keep the unattended run moving.", null);
          if (permissionID) {
            void rejectPermission(client, sessionID, String(permissionID)).catch(() => {
            });
          }
          return;
        }
        const update = describeEventPhase(event);
        if (update) {
          emitProgress(onProgress, update.message, update.phase);
        }
      },
      { signal }
    ).done.catch(() => {
    });
  } catch {
  }
}
async function runMiMoTurn(cwd, options) {
  ensureMiMoReady(cwd);
  emitProgress(options.onProgress, "Connecting to the MiMo server.", "starting");
  const client = await connectMiMo(cwd, options.serverOptions ?? {});
  const ruleset = options.write ? WRITE_RULESET : READ_ONLY_RULESET;
  let sessionID;
  if (options.resumeSessionID) {
    const existing = await getSession(client, options.resumeSessionID);
    if (existing) {
      sessionID = options.resumeSessionID;
      await setSessionPermission(client, sessionID, ruleset).catch(() => {
      });
      emitProgress(options.onProgress, `Resuming MiMo session ${sessionID}.`, "starting", { mimoSessionID: sessionID });
    } else {
      emitProgress(options.onProgress, `Previous MiMo session ${options.resumeSessionID} is gone; starting a new one.`, "starting");
      const session = await createSession(client, {
        title: options.sessionTitle ?? buildTaskSessionTitle(options.prompt || options.defaultPrompt || ""),
        permission: ruleset
      });
      sessionID = session.id;
    }
  } else {
    const session = await createSession(client, {
      title: options.sessionTitle ?? buildTaskSessionTitle(options.prompt || options.defaultPrompt || ""),
      permission: ruleset
    });
    sessionID = session.id;
    emitProgress(options.onProgress, `MiMo session ready (${sessionID}).`, "starting", { mimoSessionID: sessionID });
  }
  const prompt = options.prompt?.trim() || options.defaultPrompt || "";
  if (!prompt) {
    throw new Error("A prompt is required for this MiMo run.");
  }
  const watchController = new AbortController();
  watchSessionEvents(client, sessionID, options.onProgress, watchController.signal);
  try {
    emitProgress(options.onProgress, "Prompt sent; waiting for MiMo to finish.", "investigating");
    const result = await sendPrompt(client, sessionID, {
      prompt,
      system: options.system,
      modelRef: options.modelRef,
      format: options.outputSchema ? { type: "json_schema", schema: options.outputSchema, retryCount: 2 } : void 0
    });
    const finalMessage = extractFinalText(result);
    const rawError = result.info.error ? result.info.error.data?.message || result.info.error.name || "MiMo reported an error." : null;
    let errorMessage = rawError;
    if (rawError && /api key/i.test(rawError)) {
      errorMessage = `MiMo provider authentication failed: ${rawError}. Run /mimo:setup to check your provider configuration, or set the required API key environment variable (e.g. OPENAI_API_KEY or ANTHROPIC_API_KEY) and restart \`mimo serve\`.`;
    }
    let diffs = [];
    if (options.write) {
      diffs = await getSessionDiff(client, sessionID, result.info.id).catch(() => []);
    }
    const touchedFiles = diffs.map((diff) => String(diff.file ?? diff.path ?? "")).filter(Boolean);
    emitProgress(options.onProgress, errorMessage ? `MiMo finished with an error: ${errorMessage}` : "MiMo turn completed.", "finalizing", {
      messageID: result.info.id ?? null
    });
    return {
      status: errorMessage ? 1 : 0,
      mimoSessionID: sessionID,
      messageID: result.info.id ?? null,
      finalMessage,
      structured: result.info.structured ?? null,
      errorMessage,
      touchedFiles,
      diffs,
      raw: result
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitProgress(options.onProgress, `MiMo request failed: ${message}`, "failed");
    return {
      status: 1,
      mimoSessionID: sessionID,
      messageID: null,
      finalMessage: "",
      structured: null,
      errorMessage: message,
      touchedFiles: [],
      diffs: [],
      raw: null
    };
  } finally {
    watchController.abort();
  }
}
async function interruptMiMoSession(cwd, mimoSessionID) {
  if (!mimoSessionID) {
    return { attempted: false, interrupted: false, detail: "missing MiMo session id" };
  }
  const availability = getMiMoAvailability(cwd);
  if (!availability.available) {
    return { attempted: false, interrupted: false, detail: availability.detail };
  }
  try {
    const client = await connectMiMo(cwd);
    const interrupted = await abortSession(client, mimoSessionID);
    return {
      attempted: true,
      interrupted,
      detail: interrupted ? `Aborted MiMo session ${mimoSessionID}.` : `Abort request for ${mimoSessionID} was not accepted.`
    };
  } catch (error) {
    return {
      attempted: true,
      interrupted: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}
async function findLatestTaskSession(cwd) {
  ensureMiMoReady(cwd);
  const client = await connectMiMo(cwd);
  const sessions = await listSessions(client, { limit: 20 });
  const match = sessions.find((session) => typeof session.title === "string" && session.title.startsWith(TASK_SESSION_PREFIX));
  return match ? { id: match.id } : null;
}
function getSessionRuntimeStatus(env = process6.env, cwd = process6.cwd()) {
  return getServerRuntimeStatus(cwd);
}

// src/lib/prompts.ts
import fs6 from "node:fs";
import path4 from "node:path";
function loadPromptTemplate(rootDir, name) {
  const promptPath = path4.join(rootDir, "prompts", `${name}.md`);
  return fs6.readFileSync(promptPath, "utf8");
}
function interpolateTemplate(template, variables) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : "";
  });
}

// src/lib/job-control.ts
import fs7 from "node:fs";
var DEFAULT_MAX_STATUS_JOBS = 8;
var DEFAULT_MAX_PROGRESS_LINES = 4;
function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
}
function getCurrentSessionId(options = {}) {
  return options.env?.[SESSION_ID_ENV] ?? process.env[SESSION_ID_ENV] ?? null;
}
function filterJobsForCurrentSession(jobs, options = {}) {
  const sessionId = getCurrentSessionId(options);
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}
function getJobTypeLabel(job) {
  if (typeof job.kindLabel === "string" && job.kindLabel) {
    return job.kindLabel;
  }
  if (job.kind === "adversarial-review") {
    return "adversarial-review";
  }
  if (job.jobClass === "review") {
    return "review";
  }
  if (job.jobClass === "task") {
    return "rescue";
  }
  if (job.kind === "review") {
    return "review";
  }
  if (job.kind === "task") {
    return "rescue";
  }
  return "job";
}
function stripLogPrefix(line) {
  return line.replace(/^\[[^\]]+\]\s*/, "").trim();
}
function isProgressBlockTitle(line) {
  return ["Final output", "Assistant message", "Reasoning summary", "Review output"].includes(line);
}
function readJobProgressPreview(logFile, maxLines = DEFAULT_MAX_PROGRESS_LINES) {
  if (!logFile || !fs7.existsSync(logFile)) {
    return [];
  }
  const lines = fs7.readFileSync(logFile, "utf8").split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).filter((line) => line.startsWith("[")).map(stripLogPrefix).filter((line) => line && !isProgressBlockTitle(line));
  return lines.slice(-maxLines);
}
function formatElapsedDuration(startValue, endValue = null) {
  const start = Date.parse(startValue ?? "");
  if (!Number.isFinite(start)) {
    return null;
  }
  const end = endValue ? Date.parse(endValue) : Date.now();
  if (!Number.isFinite(end) || end < start) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.round((end - start) / 1e3));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
function inferJobPhase(job) {
  switch (job.status) {
    case "queued":
      return "queued";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "completed":
      return "done";
    default:
      return job.jobClass === "review" ? "reviewing" : "running";
  }
}
function enrichJob(job, options = {}) {
  const maxProgressLines = options.maxProgressLines ?? DEFAULT_MAX_PROGRESS_LINES;
  const enriched = {
    ...job,
    kindLabel: getJobTypeLabel(job),
    progressPreview: job.status === "queued" || job.status === "running" || job.status === "failed" ? readJobProgressPreview(job.logFile, maxProgressLines) : [],
    elapsed: formatElapsedDuration(job.startedAt ?? job.createdAt, job.completedAt ?? null),
    duration: job.status === "completed" || job.status === "failed" || job.status === "cancelled" ? formatElapsedDuration(job.startedAt ?? job.createdAt, job.completedAt ?? job.updatedAt ?? null) : null
  };
  return {
    ...enriched,
    phase: typeof enriched.phase === "string" && enriched.phase ? enriched.phase : inferJobPhase(enriched)
  };
}
function readStoredJob(workspaceRoot, jobId) {
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs7.existsSync(jobFile)) {
    return null;
  }
  return readJobFile(jobFile);
}
function matchJobReference(jobs, reference, predicate = () => true) {
  const filtered = jobs.filter(predicate);
  if (!reference) {
    return filtered[0] ?? null;
  }
  const exact = filtered.find((job) => job.id === reference);
  if (exact) {
    return exact;
  }
  const prefixMatches = filtered.filter((job) => job.id.startsWith(reference));
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }
  if (prefixMatches.length > 1) {
    throw new Error(`Job reference "${reference}" is ambiguous. Use a longer job id.`);
  }
  throw new Error(`No job found for "${reference}". Run /mimo:status to list known jobs.`);
}
function buildStatusSnapshot(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);
  const jobs = sortJobsNewestFirst(filterJobsForCurrentSession(listJobs(workspaceRoot), options));
  const maxJobs = options.maxJobs ?? DEFAULT_MAX_STATUS_JOBS;
  const maxProgressLines = options.maxProgressLines ?? DEFAULT_MAX_PROGRESS_LINES;
  const running = jobs.filter((job) => job.status === "queued" || job.status === "running").map((job) => enrichJob(job, { maxProgressLines }));
  const latestFinishedRaw = jobs.find((job) => job.status !== "queued" && job.status !== "running") ?? null;
  const latestFinished = latestFinishedRaw ? enrichJob(latestFinishedRaw, { maxProgressLines }) : null;
  const recent = (options.all ? jobs : jobs.slice(0, maxJobs)).filter((job) => job.status !== "queued" && job.status !== "running" && job.id !== latestFinished?.id).map((job) => enrichJob(job, { maxProgressLines }));
  return {
    workspaceRoot,
    config,
    sessionRuntime: getSessionRuntimeStatus(process.env, workspaceRoot),
    running,
    latestFinished,
    recent,
    needsReview: Boolean(config.stopReviewGate)
  };
}
function buildSingleJobSnapshot(cwd, reference, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const selected = matchJobReference(jobs, reference);
  if (!selected) {
    throw new Error(`No job found for "${reference}". Run /mimo:status to inspect known jobs.`);
  }
  return {
    workspaceRoot,
    job: enrichJob(selected, { maxProgressLines: options.maxProgressLines })
  };
}
function resolveResultJob(cwd, reference) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(reference ? listJobs(workspaceRoot) : filterJobsForCurrentSession(listJobs(workspaceRoot)));
  const selected = matchJobReference(
    jobs,
    reference,
    (job) => job.status === "completed" || job.status === "failed" || job.status === "cancelled"
  );
  if (selected) {
    return { workspaceRoot, job: selected };
  }
  const active = matchJobReference(jobs, reference, (job) => job.status === "queued" || job.status === "running");
  if (active) {
    throw new Error(`Job ${active.id} is still ${active.status}. Check /mimo:status and try again once it finishes.`);
  }
  if (reference) {
    throw new Error(`No finished job found for "${reference}". Run /mimo:status to inspect active jobs.`);
  }
  throw new Error("No finished MiMo jobs found for this repository yet.");
}
function resolveCancelableJob(cwd, reference, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
  if (reference) {
    const selected = matchJobReference(activeJobs, reference);
    if (!selected) {
      throw new Error(`No active job found for "${reference}".`);
    }
    return { workspaceRoot, job: selected };
  }
  const sessionScopedActiveJobs = filterJobsForCurrentSession(activeJobs, options);
  if (sessionScopedActiveJobs.length === 1) {
    return { workspaceRoot, job: sessionScopedActiveJobs[0] };
  }
  if (sessionScopedActiveJobs.length > 1) {
    throw new Error("Multiple MiMo jobs are active. Pass a job id to /mimo:cancel.");
  }
  if (getCurrentSessionId(options)) {
    throw new Error("No active MiMo jobs to cancel for this session.");
  }
  throw new Error("No active MiMo jobs to cancel.");
}

// src/lib/render.ts
function severityRank(severity) {
  switch (severity) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    default:
      return 3;
  }
}
function formatLineRange(finding) {
  if (!finding.line_start) {
    return "";
  }
  if (!finding.line_end || finding.line_end === finding.line_start) {
    return `:${finding.line_start}`;
  }
  return `:${finding.line_start}-${finding.line_end}`;
}
function validateReviewResultShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Expected a top-level JSON object.";
  }
  if (typeof data.verdict !== "string" || !data.verdict.trim()) {
    return "Missing string `verdict`.";
  }
  if (typeof data.summary !== "string" || !data.summary.trim()) {
    return "Missing string `summary`.";
  }
  if (!Array.isArray(data.findings)) {
    return "Missing array `findings`.";
  }
  if (!Array.isArray(data.next_steps)) {
    return "Missing array `next_steps`.";
  }
  return null;
}
function normalizeReviewFinding(finding, index) {
  const source = finding && typeof finding === "object" && !Array.isArray(finding) ? finding : {};
  const lineStart = Number.isInteger(source.line_start) && source.line_start > 0 ? source.line_start : null;
  const lineEnd = Number.isInteger(source.line_end) && source.line_end > 0 && (!lineStart || source.line_end >= lineStart) ? source.line_end : lineStart;
  return {
    severity: typeof source.severity === "string" && source.severity.trim() ? source.severity.trim() : "low",
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : `Finding ${index + 1}`,
    body: typeof source.body === "string" && source.body.trim() ? source.body.trim() : "No details provided.",
    file: typeof source.file === "string" && source.file.trim() ? source.file.trim() : "unknown",
    line_start: lineStart,
    line_end: lineEnd,
    recommendation: typeof source.recommendation === "string" ? source.recommendation.trim() : ""
  };
}
function normalizeReviewResultData(data) {
  return {
    verdict: data.verdict.trim(),
    summary: data.summary.trim(),
    findings: data.findings.map((finding, index) => normalizeReviewFinding(finding, index)),
    next_steps: data.next_steps.filter((step) => typeof step === "string" && step.trim()).map((step) => step.trim())
  };
}
function isStructuredReviewStoredResult(storedJob) {
  const result = storedJob?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(result, "result") || Object.prototype.hasOwnProperty.call(result, "parseError");
}
function formatJobLine(job) {
  const parts = [job.id, `${job.status || "unknown"}`];
  if (job.kindLabel) {
    parts.push(job.kindLabel);
  }
  if (job.title) {
    parts.push(job.title);
  }
  return parts.join(" | ");
}
function escapeMarkdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}
function appendActiveJobsTable(lines, jobs) {
  lines.push("Active jobs:");
  lines.push("| Job | Kind | Status | Phase | Elapsed | MiMo Session ID | Summary | Actions |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const job of jobs) {
    const actions = [`/mimo:status ${job.id}`];
    if (job.status === "queued" || job.status === "running") {
      actions.push(`/mimo:cancel ${job.id}`);
    }
    lines.push(
      `| ${escapeMarkdownCell(job.id)} | ${escapeMarkdownCell(job.kindLabel)} | ${escapeMarkdownCell(job.status)} | ${escapeMarkdownCell(job.phase ?? "")} | ${escapeMarkdownCell(job.elapsed ?? "")} | ${escapeMarkdownCell(job.mimoSessionID ?? "")} | ${escapeMarkdownCell(job.summary ?? "")} | ${actions.map((action) => `\`${action}\``).join("<br>")} |`
    );
  }
}
function pushJobDetails(lines, job, options = {}) {
  lines.push(`- ${formatJobLine(job)}`);
  if (job.summary) {
    lines.push(`  Summary: ${job.summary}`);
  }
  if (job.phase) {
    lines.push(`  Phase: ${job.phase}`);
  }
  if (options.showElapsed && job.elapsed) {
    lines.push(`  Elapsed: ${job.elapsed}`);
  }
  if (options.showDuration && job.duration) {
    lines.push(`  Duration: ${job.duration}`);
  }
  if (job.mimoSessionID) {
    lines.push(`  MiMo session ID: ${job.mimoSessionID}`);
  }
  if (job.logFile && options.showLog) {
    lines.push(`  Log: ${job.logFile}`);
  }
  if ((job.status === "queued" || job.status === "running") && options.showCancelHint) {
    lines.push(`  Cancel: /mimo:cancel ${job.id}`);
  }
  if (job.status !== "queued" && job.status !== "running" && options.showResultHint) {
    lines.push(`  Result: /mimo:result ${job.id}`);
  }
  if (job.status !== "queued" && job.status !== "running" && job.jobClass === "task" && job.write && options.showReviewHint) {
    lines.push("  Review changes: /mimo:review --wait");
    lines.push("  Stricter review: /mimo:adversarial-review --wait");
  }
  if (job.progressPreview?.length) {
    lines.push("  Progress:");
    for (const line of job.progressPreview) {
      lines.push(`    ${line}`);
    }
  }
}
function renderSetupReport(report) {
  const lines = [
    "# MiMo Setup",
    "",
    `Status: ${report.ready ? "ready" : "needs attention"}`,
    "",
    "Checks:",
    `- node: ${report.node.detail}`,
    `- mimo: ${report.mimo.detail}`,
    `- server: ${report.server.detail}`,
    ...report.server.providerHint ? [`  Provider: ${report.server.providerHint}`] : [],
    `- session runtime: ${report.sessionRuntime.label}`,
    `- review gate: ${report.reviewGateEnabled ? "enabled" : "disabled"}`,
    ""
  ];
  if (report.actionsTaken.length > 0) {
    lines.push("Actions taken:");
    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }
  if (report.nextSteps.length > 0) {
    lines.push("Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }
  return `${lines.join("\n").trimEnd()}
`;
}
function renderReviewResult(parsedResult, meta) {
  if (!parsedResult.parsed) {
    const lines2 = [
      `# MiMo ${meta.reviewLabel}`,
      "",
      "MiMo did not return valid structured JSON.",
      "",
      `- Parse error: ${parsedResult.parseError}`
    ];
    if (parsedResult.rawOutput) {
      lines2.push("", "Raw final message:", "", "```text", parsedResult.rawOutput, "```");
    }
    return `${lines2.join("\n").trimEnd()}
`;
  }
  const validationError = validateReviewResultShape(parsedResult.parsed);
  if (validationError) {
    const lines2 = [
      `# MiMo ${meta.reviewLabel}`,
      "",
      `Target: ${meta.targetLabel}`,
      "MiMo returned JSON with an unexpected review shape.",
      "",
      `- Validation error: ${validationError}`
    ];
    if (parsedResult.rawOutput) {
      lines2.push("", "Raw final message:", "", "```text", parsedResult.rawOutput, "```");
    }
    return `${lines2.join("\n").trimEnd()}
`;
  }
  const data = normalizeReviewResultData(parsedResult.parsed);
  const findings = [...data.findings].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const lines = [
    `# MiMo ${meta.reviewLabel}`,
    "",
    `Target: ${meta.targetLabel}`,
    `Verdict: ${data.verdict}`,
    "",
    data.summary,
    ""
  ];
  if (findings.length === 0) {
    lines.push("No material findings.");
  } else {
    lines.push("Findings:");
    for (const finding of findings) {
      const lineSuffix = formatLineRange(finding);
      lines.push(`- [${finding.severity}] ${finding.title} (${finding.file}${lineSuffix})`);
      lines.push(`  ${finding.body}`);
      if (finding.recommendation) {
        lines.push(`  Recommendation: ${finding.recommendation}`);
      }
    }
  }
  if (data.next_steps.length > 0) {
    lines.push("", "Next steps:");
    for (const step of data.next_steps) {
      lines.push(`- ${step}`);
    }
  }
  return `${lines.join("\n").trimEnd()}
`;
}
function renderTaskResult(parsedResult) {
  const rawOutput = typeof parsedResult?.rawOutput === "string" ? parsedResult.rawOutput : "";
  if (rawOutput) {
    return rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}
`;
  }
  const message = String(parsedResult?.failureMessage ?? "").trim() || "MiMo did not return a final message.";
  return `${message}
`;
}
function renderStatusReport(report) {
  const lines = [
    "# MiMo Status",
    "",
    `Session runtime: ${report.sessionRuntime.label}`,
    `Review gate: ${report.config.stopReviewGate ? "enabled" : "disabled"}`,
    ""
  ];
  if (report.running.length > 0) {
    appendActiveJobsTable(lines, report.running);
    lines.push("");
    lines.push("Live details:");
    for (const job of report.running) {
      pushJobDetails(lines, job, {
        showElapsed: true,
        showLog: true
      });
    }
    lines.push("");
  }
  if (report.latestFinished) {
    lines.push("Latest finished:");
    pushJobDetails(lines, report.latestFinished, {
      showDuration: true,
      showLog: report.latestFinished.status === "failed"
    });
    lines.push("");
  }
  if (report.recent.length > 0) {
    lines.push("Recent jobs:");
    for (const job of report.recent) {
      pushJobDetails(lines, job, {
        showDuration: true,
        showLog: job.status === "failed"
      });
    }
    lines.push("");
  } else if (report.running.length === 0 && !report.latestFinished) {
    lines.push("No jobs recorded yet.", "");
  }
  if (report.needsReview) {
    lines.push("The stop-time review gate is enabled.");
    lines.push("Ending the session will trigger a fresh MiMo review and block if it finds issues.");
  }
  return `${lines.join("\n").trimEnd()}
`;
}
function renderJobStatusReport(job) {
  const lines = ["# MiMo Job Status", ""];
  pushJobDetails(lines, job, {
    showElapsed: job.status === "queued" || job.status === "running",
    showDuration: job.status !== "queued" && job.status !== "running",
    showLog: true,
    showCancelHint: true,
    showResultHint: true,
    showReviewHint: true
  });
  return `${lines.join("\n").trimEnd()}
`;
}
function renderStoredJobResult(job, storedJob) {
  const mimoSessionID = storedJob?.mimoSessionID ?? job.mimoSessionID ?? null;
  const sessionSuffix = mimoSessionID ? `
MiMo session ID: ${mimoSessionID}
` : "";
  if (isStructuredReviewStoredResult(storedJob) && storedJob?.rendered) {
    const output = storedJob.rendered.endsWith("\n") ? storedJob.rendered : `${storedJob.rendered}
`;
    return mimoSessionID ? `${output}${sessionSuffix}` : output;
  }
  const result = storedJob?.result;
  const rawOutput = typeof result?.rawOutput === "string" && result.rawOutput || "";
  if (rawOutput) {
    const output = rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}
`;
    return mimoSessionID ? `${output}${sessionSuffix}` : output;
  }
  if (storedJob?.rendered) {
    const output = storedJob.rendered.endsWith("\n") ? storedJob.rendered : `${storedJob.rendered}
`;
    return mimoSessionID ? `${output}${sessionSuffix}` : output;
  }
  const lines = [
    `# ${job.title ?? "MiMo Result"}`,
    "",
    `Job: ${job.id}`,
    `Status: ${job.status}`
  ];
  if (mimoSessionID) {
    lines.push(`MiMo session ID: ${mimoSessionID}`);
  }
  if (job.summary) {
    lines.push(`Summary: ${job.summary}`);
  }
  if (job.errorMessage) {
    lines.push("", job.errorMessage);
  } else if (storedJob?.errorMessage) {
    lines.push("", storedJob.errorMessage);
  } else {
    lines.push("", "No captured result payload was stored for this job.");
  }
  return `${lines.join("\n").trimEnd()}
`;
}
function renderCancelReport(job) {
  const lines = [
    "# MiMo Cancel",
    "",
    `Cancelled ${job.id}.`,
    ""
  ];
  if (job.title) {
    lines.push(`- Title: ${job.title}`);
  }
  if (job.summary) {
    lines.push(`- Summary: ${job.summary}`);
  }
  lines.push("- Check `/mimo:status` for the updated queue.");
  return `${lines.join("\n").trimEnd()}
`;
}

// src/mimo-companion.ts
var ROOT_DIR = path5.resolve(fileURLToPath(new URL("..", import.meta.url)));
var REVIEW_SCHEMA = path5.join(ROOT_DIR, "schemas", "review-output.schema.json");
var DEFAULT_STATUS_WAIT_TIMEOUT_MS = 24e4;
var DEFAULT_STATUS_POLL_INTERVAL_MS = 2e3;
var STOP_REVIEW_TASK_MARKER = "Run a stop-gate review of the previous Claude turn.";
function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/mimo-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  node scripts/mimo-companion.mjs review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [focus text]",
      "  node scripts/mimo-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [focus text]",
      "  node scripts/mimo-companion.mjs task [--background] [--write] [--resume-last|--resume|--fresh] [--model <ref>] [prompt]",
      "  node scripts/mimo-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/mimo-companion.mjs result [job-id] [--json]",
      "  node scripts/mimo-companion.mjs cancel [job-id] [--json]"
    ].join("\n")
  );
}
function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process7.stdout.write(String(value));
  }
}
function outputCommandResult(payload, rendered, asJson) {
  outputResult(asJson ? payload : rendered, asJson);
}
function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}
function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...config.aliasMap ?? {}
    }
  });
}
function resolveCommandCwd(options = {}) {
  return typeof options.cwd === "string" && options.cwd ? path5.resolve(process7.cwd(), options.cwd) : process7.cwd();
}
function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}
function sleep2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function shorten2(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}
function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "").split(/\r?\n/).map((value) => value.trim()).find(Boolean);
  return line ?? fallback;
}
async function checkServerReachable(cwd) {
  try {
    const client = await connectMiMo(cwd);
    let providerHint;
    try {
      const response = await client.fetchImpl(`${client.baseUrl}/config/providers`, {
        headers: buildHeaders(client)
      });
      if (response.ok) {
        const providers = await response.json();
        const defaults = providers?.default ?? providers?.defaultProvider ?? null;
        const providerList = Array.isArray(providers?.providers) ? providers.providers.map((p) => String(p.id ?? p.name ?? "")) : [];
        const defaultKeys = typeof defaults === "object" && defaults !== null && !Array.isArray(defaults) ? Object.keys(defaults) : [];
        const configuredProviders = [.../* @__PURE__ */ new Set([...providerList, ...defaultKeys])].filter(Boolean);
        providerHint = configuredProviders.length > 0 ? `provider configured: ${configuredProviders.join(", ")}` : "no default provider detected \u2014 set an API key (e.g. OPENAI_API_KEY) before using MiMo for prompts.";
      }
    } catch {
    }
    return { ok: true, detail: `reachable at ${client.baseUrl}`, providerHint };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
async function buildSetupReport(cwd, actionsTaken = []) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const mimoStatus = getMiMoAvailability(cwd);
  const serverStatus = mimoStatus.available ? await checkServerReachable(cwd) : { ok: false, detail: "skipped (mimo unavailable)", providerHint: void 0 };
  const config = getConfig(workspaceRoot);
  const nextSteps = [];
  if (!mimoStatus.available) {
    nextSteps.push("Install MiMo (e.g. `npm install -g @mimo-ai/cli`), then rerun `/mimo:setup`.");
  } else if (!serverStatus.ok) {
    nextSteps.push("The MiMo server failed to start. Check the server log mentioned above and rerun `/mimo:setup`.");
  } else if (serverStatus.providerHint?.includes("no default provider")) {
    nextSteps.push("MiMo is installed and the server is running, but no AI provider is configured. Set your API key environment variable (e.g. OPENAI_API_KEY or ANTHROPIC_API_KEY) in your shell profile, then restart `mimo serve`.");
  }
  if (!config.stopReviewGate) {
    nextSteps.push("Optional: run `/mimo:setup --enable-review-gate` to require a fresh review before stop.");
  }
  return {
    ready: nodeStatus.available && mimoStatus.available && serverStatus.ok && !serverStatus.providerHint?.includes("no default provider"),
    node: nodeStatus,
    mimo: mimoStatus,
    server: { detail: serverStatus.detail, providerHint: serverStatus.providerHint },
    sessionRuntime: getSessionRuntimeStatus(process7.env, workspaceRoot),
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken,
    nextSteps
  };
}
async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"]
  });
  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate.");
  }
  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken = [];
  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actionsTaken.push(`Enabled the stop-time review gate for ${workspaceRoot}.`);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actionsTaken.push(`Disabled the stop-time review gate for ${workspaceRoot}.`);
  }
  const finalReport = await buildSetupReport(cwd, actionsTaken);
  outputResult(options.json ? finalReport : renderSetupReport(finalReport), Boolean(options.json));
}
function buildReviewPrompt(templateName, reviewKind, context, focusText) {
  const template = loadPromptTemplate(ROOT_DIR, templateName);
  return interpolateTemplate(template, {
    REVIEW_KIND: reviewKind,
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: context.content
  });
}
function isActiveJobStatus(status) {
  return status === "queued" || status === "running";
}
function getCurrentClaudeSessionId() {
  return process7.env[SESSION_ID_ENV] ?? null;
}
function filterJobsForCurrentClaudeSession(jobs) {
  const sessionId = getCurrentClaudeSessionId();
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}
function findLatestResumableTaskJob(jobs) {
  return jobs.find(
    (job) => job.jobClass === "task" && job.mimoSessionID && job.status !== "queued" && job.status !== "running"
  ) ?? null;
}
async function waitForSingleJobSnapshot(cwd, reference, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || DEFAULT_STATUS_WAIT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || DEFAULT_STATUS_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  let snapshot = buildSingleJobSnapshot(cwd, reference);
  while (isActiveJobStatus(snapshot.job.status) && Date.now() < deadline) {
    await sleep2(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    snapshot = buildSingleJobSnapshot(cwd, reference);
  }
  return {
    ...snapshot,
    waitTimedOut: isActiveJobStatus(snapshot.job.status),
    timeoutMs
  };
}
async function resolveLatestTrackedTaskSession(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const sessionId = getCurrentClaudeSessionId();
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot)).filter((job) => job.id !== options.excludeJobId);
  const visibleJobs = filterJobsForCurrentClaudeSession(jobs);
  const activeTask = visibleJobs.find((job) => job.jobClass === "task" && (job.status === "queued" || job.status === "running"));
  if (activeTask) {
    throw new Error(`Task ${activeTask.id} is still running. Use /mimo:status before continuing it.`);
  }
  const trackedTask = findLatestResumableTaskJob(visibleJobs);
  if (trackedTask) {
    return { id: trackedTask.mimoSessionID };
  }
  if (sessionId) {
    return null;
  }
  return findLatestTaskSession(workspaceRoot);
}
async function executeReviewRun(request2) {
  ensureMiMoReady(request2.cwd);
  ensureGitRepository(request2.cwd);
  const target = resolveReviewTarget(request2.cwd, {
    base: request2.base,
    scope: request2.scope
  });
  const focusText = request2.focusText?.trim() ?? "";
  const context = collectReviewContext(request2.cwd, target);
  const prompt = buildReviewPrompt(request2.promptTemplate, request2.reviewName, context, focusText);
  const result = await runMiMoTurn(context.repoRoot, {
    prompt,
    write: false,
    sessionTitle: `MiMo ${request2.reviewName}`,
    modelRef: request2.modelRef,
    outputSchema: readJsonFile(REVIEW_SCHEMA),
    onProgress: request2.onProgress
  });
  const parsed = result.raw ? parseStructuredResult(result.raw, result.errorMessage ?? void 0) : { parsed: null, parseError: result.errorMessage ?? "MiMo did not return a response.", rawOutput: "" };
  const payload = {
    review: request2.reviewName,
    target,
    mimoSessionID: result.mimoSessionID,
    context: {
      repoRoot: context.repoRoot,
      branch: context.branch,
      summary: context.summary
    },
    mimo: {
      status: result.status,
      stdout: result.finalMessage,
      errorMessage: result.errorMessage
    },
    result: parsed.parsed,
    rawOutput: parsed.rawOutput,
    parseError: parsed.parseError
  };
  const parsedSummary = parsed.parsed && typeof parsed.parsed === "object" && "summary" in parsed.parsed ? String(parsed.parsed.summary) : null;
  return {
    exitStatus: result.status,
    mimoSessionID: result.mimoSessionID,
    messageID: result.messageID,
    payload,
    rendered: renderReviewResult(parsed, {
      reviewLabel: request2.reviewName,
      targetLabel: context.target.label
    }),
    summary: parsedSummary ?? parsed.parseError ?? firstMeaningfulLine(result.finalMessage, `${request2.reviewName} finished.`),
    jobTitle: `MiMo ${request2.reviewName}`,
    jobClass: "review",
    targetLabel: context.target.label
  };
}
async function executeTaskRun(request2) {
  const workspaceRoot = resolveWorkspaceRoot(request2.cwd);
  ensureMiMoReady(request2.cwd);
  const taskMetadata = buildTaskRunMetadata({
    prompt: request2.prompt,
    resumeLast: Boolean(request2.resumeLast)
  });
  let resumeSessionID = null;
  if (request2.resumeLast) {
    const latestSession = await resolveLatestTrackedTaskSession(workspaceRoot, {
      excludeJobId: request2.jobId
    });
    if (!latestSession) {
      throw new Error("No previous MiMo task session was found for this repository.");
    }
    resumeSessionID = latestSession.id;
  }
  if (!request2.prompt && !resumeSessionID) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume-last.");
  }
  const result = await runMiMoTurn(workspaceRoot, {
    resumeSessionID,
    prompt: request2.prompt,
    defaultPrompt: resumeSessionID ? DEFAULT_CONTINUE_PROMPT : "",
    modelRef: request2.modelRef,
    write: Boolean(request2.write),
    sessionTitle: resumeSessionID ? null : buildTaskSessionTitle(request2.prompt || DEFAULT_CONTINUE_PROMPT),
    onProgress: request2.onProgress
  });
  const rawOutput = result.finalMessage;
  const failureMessage = result.errorMessage ?? "";
  const rendered = renderTaskResult({ rawOutput, failureMessage });
  const payload = {
    status: result.status,
    mimoSessionID: result.mimoSessionID,
    rawOutput,
    touchedFiles: result.touchedFiles
  };
  return {
    exitStatus: result.status,
    mimoSessionID: result.mimoSessionID,
    messageID: result.messageID,
    payload,
    rendered,
    summary: firstMeaningfulLine(rawOutput, firstMeaningfulLine(failureMessage, `${taskMetadata.title} finished.`)),
    jobTitle: taskMetadata.title,
    jobClass: "task",
    write: Boolean(request2.write)
  };
}
function buildReviewJobMetadata(reviewName, target) {
  return {
    kind: reviewName === "Adversarial Review" ? "adversarial-review" : "review",
    title: `MiMo ${reviewName}`,
    summary: `${reviewName} ${target.label}`
  };
}
function buildTaskRunMetadata({ prompt, resumeLast = false }) {
  if (!resumeLast && String(prompt ?? "").includes(STOP_REVIEW_TASK_MARKER)) {
    return {
      title: "MiMo Stop Gate Review",
      summary: "Stop-gate review of previous Claude turn"
    };
  }
  const title = resumeLast ? "MiMo Resume" : "MiMo Task";
  const fallbackSummary = resumeLast ? DEFAULT_CONTINUE_PROMPT : "Task";
  return {
    title,
    summary: shorten2(prompt || fallbackSummary)
  };
}
function renderQueuedTaskLaunch(payload) {
  return `${payload.title} started in the background as ${payload.jobId}. Check /mimo:status ${payload.jobId} for progress.
`;
}
function getJobKindLabel(kind, jobClass) {
  if (kind === "adversarial-review") {
    return "adversarial-review";
  }
  return jobClass === "review" ? "review" : "rescue";
}
function createCompanionJob({
  prefix,
  kind,
  title,
  workspaceRoot,
  jobClass,
  summary,
  write = false
}) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: getJobKindLabel(kind, jobClass),
    title,
    workspaceRoot,
    jobClass,
    summary,
    write
  });
}
function createTrackedProgress(job, options = {}) {
  const logFile = options.logFile ?? createJobLogFile(job.workspaceRoot, job.id, job.title);
  return {
    logFile,
    progress: createProgressReporter({
      stderr: Boolean(options.stderr),
      logFile,
      onEvent: createJobProgressUpdater(job.workspaceRoot, job.id)
    })
  };
}
function buildTaskJob(workspaceRoot, taskMetadata, write) {
  return createCompanionJob({
    prefix: "task",
    kind: "task",
    title: taskMetadata.title,
    workspaceRoot,
    jobClass: "task",
    summary: taskMetadata.summary,
    write
  });
}
function readTaskPrompt(cwd, options, positionals) {
  if (typeof options["prompt-file"] === "string") {
    return fs8.readFileSync(path5.resolve(cwd, options["prompt-file"]), "utf8");
  }
  const positionalPrompt = positionals.join(" ");
  return positionalPrompt || readStdinIfPiped();
}
function requireTaskRequest(prompt, resumeLast) {
  if (!prompt && !resumeLast) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume-last.");
  }
}
async function runForegroundCommand(job, runner, options = {}) {
  const { logFile, progress } = createTrackedProgress(job, {
    logFile: options.logFile,
    stderr: !options.json
  });
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process7.exitCode = execution.exitStatus;
  }
  return execution;
}
function spawnDetachedTaskWorker(cwd, jobId) {
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawn2(process7.execPath, [scriptPath, "task-worker", "--cwd", cwd, "--job-id", jobId], {
    cwd,
    env: process7.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child;
}
function enqueueBackgroundTask(cwd, job, request2) {
  const { logFile } = createTrackedProgress(job);
  appendLogLine(logFile, "Queued for background execution.");
  const child = spawnDetachedTaskWorker(cwd, job.id);
  const queuedRecord = {
    ...job,
    status: "queued",
    phase: "queued",
    pid: child.pid ?? null,
    logFile,
    request: request2
  };
  writeJobFile(job.workspaceRoot, job.id, queuedRecord);
  upsertJob(job.workspaceRoot, queuedRecord);
  return {
    payload: {
      jobId: job.id,
      status: "queued",
      title: job.title ?? "",
      summary: job.summary,
      logFile
    },
    logFile
  };
}
async function handleReviewCommand(argv, config) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd"],
    booleanOptions: ["json", "background", "wait"],
    aliasMap: {
      m: "model"
    }
  });
  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();
  const target = resolveReviewTarget(cwd, {
    base: typeof options.base === "string" ? options.base : null,
    scope: typeof options.scope === "string" ? options.scope : void 0
  });
  const metadata = buildReviewJobMetadata(config.reviewName, target);
  const job = createCompanionJob({
    prefix: "review",
    kind: metadata.kind,
    title: metadata.title,
    workspaceRoot,
    jobClass: "review",
    summary: metadata.summary
  });
  await runForegroundCommand(
    job,
    (progress) => executeReviewRun({
      cwd,
      base: typeof options.base === "string" ? options.base : null,
      scope: typeof options.scope === "string" ? options.scope : void 0,
      modelRef: typeof options.model === "string" ? options.model : void 0,
      focusText,
      reviewName: config.reviewName,
      promptTemplate: config.promptTemplate,
      onProgress: progress
    }),
    { json: Boolean(options.json) }
  );
}
async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "cwd", "prompt-file"],
    booleanOptions: ["json", "write", "resume-last", "resume", "fresh", "background"],
    aliasMap: {
      m: "model"
    }
  });
  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const modelRef = typeof options.model === "string" ? options.model : void 0;
  const prompt = readTaskPrompt(cwd, options, positionals);
  const resumeLast = Boolean(options["resume-last"] || options.resume);
  const fresh = Boolean(options.fresh);
  if (resumeLast && fresh) {
    throw new Error("Choose either --resume/--resume-last or --fresh.");
  }
  const write = Boolean(options.write);
  const taskMetadata = buildTaskRunMetadata({
    prompt,
    resumeLast
  });
  if (options.background) {
    ensureMiMoReady(cwd);
    requireTaskRequest(prompt, resumeLast);
    const job2 = buildTaskJob(workspaceRoot, taskMetadata, write);
    const request2 = {
      cwd,
      modelRef,
      prompt,
      write,
      resumeLast,
      jobId: job2.id
    };
    const { payload } = enqueueBackgroundTask(cwd, job2, request2);
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), Boolean(options.json));
    return;
  }
  const job = buildTaskJob(workspaceRoot, taskMetadata, write);
  await runForegroundCommand(
    job,
    (progress) => executeTaskRun({
      cwd,
      modelRef,
      prompt,
      write,
      resumeLast,
      jobId: job.id,
      onProgress: progress
    }),
    { json: Boolean(options.json) }
  );
}
async function handleTaskWorker(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "job-id"]
  });
  if (typeof options["job-id"] !== "string") {
    throw new Error("Missing required --job-id for task-worker.");
  }
  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const storedJob = readStoredJob(workspaceRoot, options["job-id"]);
  if (!storedJob) {
    throw new Error(`No stored job found for ${options["job-id"]}.`);
  }
  const request2 = storedJob.request;
  if (!request2 || typeof request2 !== "object") {
    throw new Error(`Stored job ${options["job-id"]} is missing its task request payload.`);
  }
  const { logFile, progress } = createTrackedProgress(
    {
      ...storedJob,
      workspaceRoot
    },
    {
      logFile: storedJob.logFile ?? null
    }
  );
  await runTrackedJob(
    {
      ...storedJob,
      workspaceRoot,
      logFile
    },
    () => executeTaskRun({
      ...request2,
      onProgress: progress
    }),
    { logFile }
  );
}
async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"],
    booleanOptions: ["json", "all", "wait"]
  });
  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  if (reference) {
    const snapshot = options.wait ? await waitForSingleJobSnapshot(cwd, reference, {
      timeoutMs: options["timeout-ms"],
      pollIntervalMs: options["poll-interval-ms"]
    }) : buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), Boolean(options.json));
    return;
  }
  if (options.wait) {
    throw new Error("`status --wait` requires a job id.");
  }
  const report = buildStatusSnapshot(cwd, { all: Boolean(options.all) });
  outputResult(options.json ? report : renderStatusReport(report), Boolean(options.json));
}
function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  const payload = {
    job,
    storedJob
  };
  outputCommandResult(payload, renderStoredJobResult(job, storedJob), Boolean(options.json));
}
function handleTaskResumeCandidate(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const sessionId = getCurrentClaudeSessionId();
  const jobs = filterJobsForCurrentClaudeSession(sortJobsNewestFirst(listJobs(workspaceRoot)));
  const candidate = findLatestResumableTaskJob(jobs);
  const payload = {
    available: Boolean(candidate),
    sessionId,
    candidate: candidate == null ? null : {
      id: candidate.id,
      status: candidate.status,
      title: candidate.title ?? null,
      summary: candidate.summary ?? null,
      mimoSessionID: candidate.mimoSessionID,
      completedAt: candidate.completedAt ?? null,
      updatedAt: candidate.updatedAt ?? null
    }
  };
  const rendered = candidate ? `Resumable task found: ${candidate.id} (${candidate.status}).
` : "No resumable task found for this session.\n";
  outputCommandResult(payload, rendered, Boolean(options.json));
}
async function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference, { env: process7.env });
  const existing = readStoredJob(workspaceRoot, job.id) ?? {};
  const mimoSessionID = existing.mimoSessionID ?? job.mimoSessionID ?? null;
  const interrupt = await interruptMiMoSession(cwd, mimoSessionID);
  if (interrupt.attempted) {
    appendLogLine(
      job.logFile,
      interrupt.interrupted ? `Requested MiMo abort for session ${mimoSessionID}.` : `MiMo abort failed${interrupt.detail ? `: ${interrupt.detail}` : "."}`
    );
  }
  terminateProcessTree(job.pid ?? Number.NaN);
  appendLogLine(job.logFile, "Cancelled by user.");
  const completedAt = nowIso2();
  const nextJob = {
    ...job,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt,
    errorMessage: "Cancelled by user."
  };
  writeJobFile(workspaceRoot, job.id, {
    ...existing,
    ...nextJob,
    cancelledAt: completedAt
  });
  upsertJob(workspaceRoot, {
    id: job.id,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    errorMessage: "Cancelled by user.",
    completedAt
  });
  const payload = {
    jobId: job.id,
    status: "cancelled",
    title: job.title,
    abortAttempted: interrupt.attempted,
    aborted: interrupt.interrupted
  };
  outputCommandResult(payload, renderCancelReport(nextJob), Boolean(options.json));
}
async function main() {
  const [subcommand, ...argv] = process7.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }
  switch (subcommand) {
    case "setup":
      await handleSetup(argv);
      break;
    case "review":
      await handleReviewCommand(argv, { reviewName: "Review", promptTemplate: "review" });
      break;
    case "adversarial-review":
      await handleReviewCommand(argv, { reviewName: "Adversarial Review", promptTemplate: "adversarial-review" });
      break;
    case "task":
      await handleTask(argv);
      break;
    case "task-worker":
      await handleTaskWorker(argv);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "task-resume-candidate":
      handleTaskResumeCandidate(argv);
      break;
    case "cancel":
      await handleCancel(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process7.stderr.write(`${message}
`);
  process7.exitCode = 1;
});
