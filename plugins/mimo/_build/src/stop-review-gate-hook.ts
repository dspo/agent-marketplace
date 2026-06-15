#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getMiMoAvailability } from "./lib/mimo-runtime.ts";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.ts";
import { getConfig, listJobs } from "./lib/state.ts";
import { sortJobsNewestFirst } from "./lib/job-control.ts";
import { SESSION_ID_ENV } from "./lib/tracked-jobs.ts";
import { resolveWorkspaceRoot } from "./lib/workspace.ts";

const STOP_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");

type HookInput = {
  session_id?: string;
  cwd?: string;
  last_assistant_message?: string;
};

function readHookInput(): HookInput {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function emitDecision(payload: { decision: string; reason: string }): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function logNote(message: string | null): void {
  if (!message) {
    return;
  }
  process.stderr.write(`${message}\n`);
}

function filterJobsForCurrentSession<T extends { sessionId?: string }>(jobs: T[], input: HookInput = {}): T[] {
  const sessionId = input.session_id || process.env[SESSION_ID_ENV] || null;
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

function buildStopReviewPrompt(input: HookInput = {}): string {
  const lastAssistantMessage = String(input.last_assistant_message ?? "").trim();
  const template = loadPromptTemplate(ROOT_DIR, "stop-review-gate");
  const claudeResponseBlock = lastAssistantMessage
    ? ["Previous Claude response:", lastAssistantMessage].join("\n")
    : "";
  return interpolateTemplate(template, {
    CLAUDE_RESPONSE_BLOCK: claudeResponseBlock
  });
}

function buildSetupNote(cwd: string): string | null {
  const availability = getMiMoAvailability(cwd);
  if (availability.available) {
    return null;
  }

  const detail = availability.detail ? ` ${availability.detail}.` : "";
  return `MiMo is not set up for the review gate.${detail} Run /mimo:setup.`;
}

type ReviewVerdict = { ok: boolean; reason: string | null };

function parseStopReviewOutput(rawOutput: unknown): ReviewVerdict {
  const text = String(rawOutput ?? "").trim();
  if (!text) {
    return {
      ok: false,
      reason:
        "The stop-time MiMo review task returned no final output. Run /mimo:review --wait manually or bypass the gate."
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
    reason:
      "The stop-time MiMo review task returned an unexpected answer. Run /mimo:review --wait manually or bypass the gate."
  };
}

function runStopReview(cwd: string, input: HookInput = {}): ReviewVerdict {
  const scriptPath = path.join(SCRIPT_DIR, "mimo-companion.mjs");
  const prompt = buildStopReviewPrompt(input);
  const childEnv = {
    ...process.env,
    ...(input.session_id ? { [SESSION_ID_ENV]: input.session_id } : {})
  };
  const result = spawnSync(process.execPath, [scriptPath, "task", "--json", prompt], {
    cwd,
    env: childEnv,
    encoding: "utf8",
    timeout: STOP_REVIEW_TIMEOUT_MS
  });

  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    return {
      ok: false,
      reason:
        "The stop-time MiMo review task timed out after 15 minutes. Run /mimo:review --wait manually or bypass the gate."
    };
  }

  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      reason: detail
        ? `The stop-time MiMo review task failed: ${detail}`
        : "The stop-time MiMo review task failed. Run /mimo:review --wait manually or bypass the gate."
    };
  }

  try {
    const payload = JSON.parse(result.stdout);
    return parseStopReviewOutput(payload?.rawOutput);
  } catch {
    return {
      ok: false,
      reason:
        "The stop-time MiMo review task returned invalid JSON. Run /mimo:review --wait manually or bypass the gate."
    };
  }
}

function main(): void {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);

  const jobs = sortJobsNewestFirst(filterJobsForCurrentSession(listJobs(workspaceRoot), input));
  const runningJob = jobs.find((job) => job.status === "queued" || job.status === "running");
  const runningTaskNote = runningJob
    ? `MiMo task ${runningJob.id} is still running. Check /mimo:status and use /mimo:cancel ${runningJob.id} if you want to stop it before ending the session.`
    : null;

  if (!config.stopReviewGate) {
    logNote(runningTaskNote);
    return;
  }

  // Fail open whenever the gate itself cannot run: a broken gate must never
  // deadlock the Claude session.
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
  // Fail open: log and exit zero so an unexpected crash can't block Stop.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 0;
}
