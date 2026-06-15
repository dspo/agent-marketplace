import fs from "node:fs";

import { getSessionRuntimeStatus } from "./mimo-runtime.ts";
import { getConfig, listJobs, readJobFile, resolveJobFile, type CompanionConfig, type JobRecord } from "./state.ts";
import { SESSION_ID_ENV } from "./tracked-jobs.ts";
import { resolveWorkspaceRoot } from "./workspace.ts";

export const DEFAULT_MAX_STATUS_JOBS = 8;
export const DEFAULT_MAX_PROGRESS_LINES = 4;

export function sortJobsNewestFirst(jobs: JobRecord[]): JobRecord[] {
  return [...jobs].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
}

type SessionOptions = { env?: NodeJS.ProcessEnv };

function getCurrentSessionId(options: SessionOptions = {}): string | null {
  return options.env?.[SESSION_ID_ENV] ?? process.env[SESSION_ID_ENV] ?? null;
}

function filterJobsForCurrentSession(jobs: JobRecord[], options: SessionOptions = {}): JobRecord[] {
  const sessionId = getCurrentSessionId(options);
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

function getJobTypeLabel(job: JobRecord): string {
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

function stripLogPrefix(line: string): string {
  return line.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function isProgressBlockTitle(line: string): boolean {
  return ["Final output", "Assistant message", "Reasoning summary", "Review output"].includes(line);
}

export function readJobProgressPreview(logFile: string | null | undefined, maxLines = DEFAULT_MAX_PROGRESS_LINES): string[] {
  if (!logFile || !fs.existsSync(logFile)) {
    return [];
  }

  const lines = fs
    .readFileSync(logFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => line.startsWith("["))
    .map(stripLogPrefix)
    .filter((line) => line && !isProgressBlockTitle(line));

  return lines.slice(-maxLines);
}

function formatElapsedDuration(startValue: string | null | undefined, endValue: string | null = null): string | null {
  const start = Date.parse(startValue ?? "");
  if (!Number.isFinite(start)) {
    return null;
  }

  const end = endValue ? Date.parse(endValue) : Date.now();
  if (!Number.isFinite(end) || end < start) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function inferJobPhase(job: JobRecord): string {
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

export type EnrichedJob = JobRecord & {
  kindLabel: string;
  progressPreview: string[];
  elapsed: string | null;
  duration: string | null;
  phase: string;
};

export function enrichJob(job: JobRecord, options: { maxProgressLines?: number } = {}): EnrichedJob {
  const maxProgressLines = options.maxProgressLines ?? DEFAULT_MAX_PROGRESS_LINES;
  const enriched = {
    ...job,
    kindLabel: getJobTypeLabel(job),
    progressPreview:
      job.status === "queued" || job.status === "running" || job.status === "failed"
        ? readJobProgressPreview(job.logFile, maxProgressLines)
        : [],
    elapsed: formatElapsedDuration(job.startedAt ?? job.createdAt, job.completedAt ?? null),
    duration:
      job.status === "completed" || job.status === "failed" || job.status === "cancelled"
        ? formatElapsedDuration(job.startedAt ?? job.createdAt, job.completedAt ?? job.updatedAt ?? null)
        : null
  };

  return {
    ...enriched,
    phase: typeof enriched.phase === "string" && enriched.phase ? enriched.phase : inferJobPhase(enriched)
  };
}

export function readStoredJob(workspaceRoot: string, jobId: string): JobRecord | null {
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) {
    return null;
  }
  return readJobFile(jobFile);
}

function matchJobReference(jobs: JobRecord[], reference: string, predicate: (job: JobRecord) => boolean = () => true): JobRecord | null {
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

export type StatusSnapshot = {
  workspaceRoot: string;
  config: CompanionConfig;
  sessionRuntime: { mode: string; label: string; detail: string };
  running: EnrichedJob[];
  latestFinished: EnrichedJob | null;
  recent: EnrichedJob[];
  needsReview: boolean;
};

export function buildStatusSnapshot(cwd: string, options: SessionOptions & { all?: boolean; maxJobs?: number; maxProgressLines?: number } = {}): StatusSnapshot {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);
  const jobs = sortJobsNewestFirst(filterJobsForCurrentSession(listJobs(workspaceRoot), options));
  const maxJobs = options.maxJobs ?? DEFAULT_MAX_STATUS_JOBS;
  const maxProgressLines = options.maxProgressLines ?? DEFAULT_MAX_PROGRESS_LINES;

  const running = jobs
    .filter((job) => job.status === "queued" || job.status === "running")
    .map((job) => enrichJob(job, { maxProgressLines }));

  const latestFinishedRaw = jobs.find((job) => job.status !== "queued" && job.status !== "running") ?? null;
  const latestFinished = latestFinishedRaw ? enrichJob(latestFinishedRaw, { maxProgressLines }) : null;

  const recent = (options.all ? jobs : jobs.slice(0, maxJobs))
    .filter((job) => job.status !== "queued" && job.status !== "running" && job.id !== latestFinished?.id)
    .map((job) => enrichJob(job, { maxProgressLines }));

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

export function buildSingleJobSnapshot(cwd: string, reference: string, options: { maxProgressLines?: number } = {}): { workspaceRoot: string; job: EnrichedJob } {
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

export function resolveResultJob(cwd: string, reference: string): { workspaceRoot: string; job: JobRecord } {
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

export function resolveCancelableJob(cwd: string, reference: string, options: SessionOptions = {}): { workspaceRoot: string; job: JobRecord } {
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
