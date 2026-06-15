import fs from "node:fs";
import process from "node:process";

import { readJobFile, resolveJobFile, resolveJobLogFile, upsertJob, writeJobFile, type JobRecord } from "./state.ts";

export const SESSION_ID_ENV = "MIMO_COMPANION_SESSION_ID";

export function nowIso(): string {
  return new Date().toISOString();
}

export type ProgressEvent = {
  message: string;
  phase: string | null;
  mimoSessionID: string | null;
  messageID: string | null;
  stderrMessage: string | null;
  logTitle: string | null;
  logBody: string | null;
};

export type ProgressInput =
  | string
  | {
      message?: string;
      phase?: string | null;
      mimoSessionID?: string | null;
      messageID?: string | null;
      stderrMessage?: string | null;
      logTitle?: string | null;
      logBody?: string | null;
    };

export type ProgressReporter = (event: ProgressInput) => void;

function normalizeProgressEvent(value: ProgressInput): ProgressEvent {
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

export function appendLogLine(logFile: string | null | undefined, message: string | null | undefined): void {
  const normalized = String(message ?? "").trim();
  if (!logFile || !normalized) {
    return;
  }
  fs.appendFileSync(logFile, `[${nowIso()}] ${normalized}\n`, "utf8");
}

export function appendLogBlock(logFile: string | null | undefined, title: string | null | undefined, body: string | null | undefined): void {
  if (!logFile || !body) {
    return;
  }
  fs.appendFileSync(logFile, `\n[${nowIso()}] ${title}\n${String(body).trimEnd()}\n`, "utf8");
}

export function createJobLogFile(workspaceRoot: string, jobId: string, title?: string): string {
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  fs.writeFileSync(logFile, "", "utf8");
  if (title) {
    appendLogLine(logFile, `Starting ${title}.`);
  }
  return logFile;
}

export function createJobRecord(base: JobRecord, options: { env?: NodeJS.ProcessEnv; sessionIdEnv?: string } = {}): JobRecord {
  const env = options.env ?? process.env;
  const sessionId = env[options.sessionIdEnv ?? SESSION_ID_ENV];
  return {
    ...base,
    createdAt: nowIso(),
    ...(sessionId ? { sessionId } : {})
  };
}

export function createJobProgressUpdater(workspaceRoot: string, jobId: string): (event: ProgressInput) => void {
  let lastPhase: string | null = null;
  let lastMimoSessionID: string | null = null;
  let lastMessageID: string | null = null;

  return (event) => {
    const normalized = normalizeProgressEvent(event);
    const patch: JobRecord = { id: jobId };
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
    if (!fs.existsSync(jobFile)) {
      return;
    }

    const storedJob = readJobFile(jobFile);
    writeJobFile(workspaceRoot, jobId, {
      ...storedJob,
      ...patch
    });
  };
}

export function createProgressReporter(
  { stderr = false, logFile = null, onEvent = null }: { stderr?: boolean; logFile?: string | null; onEvent?: ((event: ProgressEvent) => void) | null } = {}
): ProgressReporter | null {
  if (!stderr && !logFile && !onEvent) {
    return null;
  }

  return (eventOrMessage) => {
    const event = normalizeProgressEvent(eventOrMessage);
    const stderrMessage = event.stderrMessage ?? event.message;
    if (stderr && stderrMessage) {
      process.stderr.write(`[mimo] ${stderrMessage}\n`);
    }
    appendLogLine(logFile, event.message);
    appendLogBlock(logFile, event.logTitle, event.logBody);
    onEvent?.(event);
  };
}

function readStoredJobOrNull(workspaceRoot: string, jobId: string): JobRecord | null {
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) {
    return null;
  }
  return readJobFile(jobFile);
}

export type JobExecution = {
  exitStatus: number;
  mimoSessionID?: string | null;
  messageID?: string | null;
  payload: unknown;
  rendered: string;
  summary?: string;
  [key: string]: unknown;
};

export async function runTrackedJob(
  job: JobRecord & { workspaceRoot: string },
  runner: () => Promise<JobExecution>,
  options: { logFile?: string | null } = {}
): Promise<JobExecution> {
  const runningRecord: JobRecord = {
    ...job,
    status: "running",
    startedAt: nowIso(),
    phase: "starting",
    pid: process.pid,
    logFile: options.logFile ?? job.logFile ?? null
  };
  writeJobFile(job.workspaceRoot, job.id, runningRecord);
  upsertJob(job.workspaceRoot, runningRecord);

  try {
    const execution = await runner();
    const completionStatus: "completed" | "failed" = execution.exitStatus === 0 ? "completed" : "failed";
    const completedAt = nowIso();
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
    const completedAt = nowIso();
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
