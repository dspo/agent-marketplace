#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

import { terminateProcessTree } from "./lib/process.ts";
import { shutdownServerIfUnreferenced } from "./lib/server-lifecycle.ts";
import { loadState, resolveStateDir, resolveStateFile, saveState } from "./lib/state.ts";
import { SESSION_ID_ENV } from "./lib/tracked-jobs.ts";
import { resolveWorkspaceRoot } from "./lib/workspace.ts";

const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";

type HookInput = {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
};

function readHookInput(): HookInput {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function shellEscape(value: string): string {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function appendEnvVar(name: string, value: string | undefined): void {
  if (!process.env.CLAUDE_ENV_FILE || value == null || value === "") {
    return;
  }
  fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export ${name}=${shellEscape(value)}\n`, "utf8");
}

function cleanupSessionJobs(cwd: string, sessionId: string | undefined): void {
  if (!cwd || !sessionId) {
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateFile = resolveStateFile(workspaceRoot);
  if (!fs.existsSync(stateFile)) {
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
      // Ignore teardown failures during session shutdown.
    }
  }

  saveState(workspaceRoot, {
    ...state,
    jobs: state.jobs.filter((job) => job.sessionId !== sessionId)
  });
}

function handleSessionStart(input: HookInput): void {
  appendEnvVar(SESSION_ID_ENV, input.session_id);
  appendEnvVar(PLUGIN_DATA_ENV, process.env[PLUGIN_DATA_ENV]);
}

function handleSessionEnd(input: HookInput): void {
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || process.env[SESSION_ID_ENV] || "";

  cleanupSessionJobs(cwd, sessionId);

  // The server is shared per-workspace across Claude sessions; only the last
  // referencing session shuts it down. A sessionId-less call still removes
  // nothing and leaves the server alive for other sessions.
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  shutdownServerIfUnreferenced(resolveStateDir(workspaceRoot), sessionId);
}

function main(): void {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";

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
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
