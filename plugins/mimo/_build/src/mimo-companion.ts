#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString, type ParseArgsConfig, type ParsedArgs } from "./lib/args.ts";
import { readJsonFile, readStdinIfPiped } from "./lib/fs.ts";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget, type ReviewTarget } from "./lib/git.ts";
import {
  buildTaskSessionTitle,
  DEFAULT_CONTINUE_PROMPT,
  ensureMiMoReady,
  findLatestTaskSession,
  getMiMoAvailability,
  getSessionRuntimeStatus,
  interruptMiMoSession,
  runMiMoTurn
} from "./lib/mimo-runtime.ts";
import { buildHeaders, parseStructuredResult } from "./lib/mimo-client.ts";
import { connectMiMo } from "./lib/mimo-runtime.ts";
import { binaryAvailable, terminateProcessTree } from "./lib/process.ts";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.ts";
import { generateJobId, getConfig, listJobs, setConfig, upsertJob, writeJobFile, type JobRecord } from "./lib/state.ts";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "./lib/job-control.ts";
import {
  appendLogLine,
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  nowIso,
  runTrackedJob,
  SESSION_ID_ENV,
  type JobExecution,
  type ProgressReporter
} from "./lib/tracked-jobs.ts";
import { resolveWorkspaceRoot } from "./lib/workspace.ts";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult,
  type SetupReport
} from "./lib/render.ts";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_SCHEMA = path.join(ROOT_DIR, "schemas", "review-output.schema.json");
const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;
const STOP_REVIEW_TASK_MARKER = "Run a stop-gate review of the previous Claude turn.";

function printUsage(): void {
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

function outputResult(value: unknown, asJson: boolean | undefined): void {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(String(value));
  }
}

function outputCommandResult(payload: unknown, rendered: string, asJson: boolean | undefined): void {
  outputResult(asJson ? payload : rendered, asJson);
}

function normalizeArgv(argv: string[]): string[] {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv: string[], config: ParseArgsConfig = {}): ParsedArgs {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

type CommandOptions = Record<string, string | boolean>;

function resolveCommandCwd(options: CommandOptions = {}): string {
  return typeof options.cwd === "string" && options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options: CommandOptions = {}): string {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shorten(text: string, limit = 96): string {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function firstMeaningfulLine(text: string, fallback: string): string {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

async function checkServerReachable(cwd: string): Promise<{ detail: string; ok: boolean; providerHint?: string }> {
  try {
    const client = await connectMiMo(cwd);
    // Check that a provider is configured by reading /config/providers.
    let providerHint: string | undefined;
    try {
      const response = await client.fetchImpl(`${client.baseUrl}/config/providers`, {
        headers: buildHeaders(client)
      });
      if (response.ok) {
        const providers = await response.json() as Record<string, any>;
        // The MiMo server returns `default` as a per-provider default-model
        // mapping (e.g. {dashscope:"qwen3.7-plus", mimo:"mimo-auto"}), not a
        // single provider string. Extract the configured providers from this
        // mapping and from the top-level `providers` array.
        const defaults = providers?.default ?? providers?.defaultProvider ?? null;
        const providerList: string[] = Array.isArray(providers?.providers)
          ? (providers.providers as Array<Record<string, any>>).map((p) => String(p.id ?? p.name ?? ""))
          : [];
        // Per-provider default model mapping keys are provider IDs.
        const defaultKeys: string[] = typeof defaults === "object" && defaults !== null && !Array.isArray(defaults)
          ? Object.keys(defaults)
          : [];
        const configuredProviders = [...new Set([...providerList, ...defaultKeys])].filter(Boolean);
        providerHint = configuredProviders.length > 0
          ? `provider configured: ${configuredProviders.join(", ")}`
          : "no default provider detected — set an API key (e.g. OPENAI_API_KEY) before using MiMo for prompts.";
      }
    } catch {
      // Provider check is advisory; don't block setup on it.
    }
    return { ok: true, detail: `reachable at ${client.baseUrl}`, providerHint };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function buildSetupReport(cwd: string, actionsTaken: string[] = []): Promise<SetupReport> {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const mimoStatus = getMiMoAvailability(cwd);
  const serverStatus = mimoStatus.available ? await checkServerReachable(cwd) : { ok: false, detail: "skipped (mimo unavailable)", providerHint: undefined };
  const config = getConfig(workspaceRoot);

  const nextSteps: string[] = [];
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
    sessionRuntime: getSessionRuntimeStatus(process.env, workspaceRoot),
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken,
    nextSteps
  };
}

async function handleSetup(argv: string[]): Promise<void> {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"]
  });

  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken: string[] = [];

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

function buildReviewPrompt(templateName: string, reviewKind: string, context: ReturnType<typeof collectReviewContext>, focusText: string): string {
  const template = loadPromptTemplate(ROOT_DIR, templateName);
  return interpolateTemplate(template, {
    REVIEW_KIND: reviewKind,
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: context.content
  });
}

function isActiveJobStatus(status: string | undefined): boolean {
  return status === "queued" || status === "running";
}

function getCurrentClaudeSessionId(): string | null {
  return process.env[SESSION_ID_ENV] ?? null;
}

function filterJobsForCurrentClaudeSession(jobs: JobRecord[]): JobRecord[] {
  const sessionId = getCurrentClaudeSessionId();
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

function findLatestResumableTaskJob(jobs: JobRecord[]): JobRecord | null {
  return (
    jobs.find(
      (job) =>
        job.jobClass === "task" &&
        job.mimoSessionID &&
        job.status !== "queued" &&
        job.status !== "running"
    ) ?? null
  );
}

async function waitForSingleJobSnapshot(cwd: string, reference: string, options: { timeoutMs?: unknown; pollIntervalMs?: unknown } = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || DEFAULT_STATUS_WAIT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || DEFAULT_STATUS_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  let snapshot = buildSingleJobSnapshot(cwd, reference);

  while (isActiveJobStatus(snapshot.job.status) && Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    snapshot = buildSingleJobSnapshot(cwd, reference);
  }

  return {
    ...snapshot,
    waitTimedOut: isActiveJobStatus(snapshot.job.status),
    timeoutMs
  };
}

async function resolveLatestTrackedTaskSession(cwd: string, options: { excludeJobId?: string } = {}): Promise<{ id: string } | null> {
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
    return { id: trackedTask.mimoSessionID as string };
  }

  if (sessionId) {
    return null;
  }

  return findLatestTaskSession(workspaceRoot);
}

type ReviewRequest = {
  cwd: string;
  base?: string | null;
  scope?: string;
  modelRef?: string;
  focusText?: string;
  reviewName: string;
  promptTemplate: string;
  onProgress?: ProgressReporter | null;
};

async function executeReviewRun(request: ReviewRequest): Promise<JobExecution> {
  ensureMiMoReady(request.cwd);
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });
  const focusText = request.focusText?.trim() ?? "";
  const context = collectReviewContext(request.cwd, target);
  const prompt = buildReviewPrompt(request.promptTemplate, request.reviewName, context, focusText);

  const result = await runMiMoTurn(context.repoRoot, {
    prompt,
    write: false,
    sessionTitle: `MiMo ${request.reviewName}`,
    modelRef: request.modelRef,
    outputSchema: readJsonFile(REVIEW_SCHEMA),
    onProgress: request.onProgress
  });

  const parsed = result.raw
    ? parseStructuredResult(result.raw, result.errorMessage ?? undefined)
    : { parsed: null, parseError: result.errorMessage ?? "MiMo did not return a response.", rawOutput: "" };

  const payload = {
    review: request.reviewName,
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

  const parsedSummary =
    parsed.parsed && typeof parsed.parsed === "object" && "summary" in (parsed.parsed as Record<string, unknown>)
      ? String((parsed.parsed as Record<string, unknown>).summary)
      : null;

  return {
    exitStatus: result.status,
    mimoSessionID: result.mimoSessionID,
    messageID: result.messageID,
    payload,
    rendered: renderReviewResult(parsed, {
      reviewLabel: request.reviewName,
      targetLabel: context.target.label
    }),
    summary: parsedSummary ?? parsed.parseError ?? firstMeaningfulLine(result.finalMessage, `${request.reviewName} finished.`),
    jobTitle: `MiMo ${request.reviewName}`,
    jobClass: "review",
    targetLabel: context.target.label
  };
}

type TaskRequest = {
  cwd: string;
  modelRef?: string;
  prompt: string;
  write?: boolean;
  resumeLast?: boolean;
  jobId?: string;
  onProgress?: ProgressReporter | null;
};

async function executeTaskRun(request: TaskRequest): Promise<JobExecution> {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);
  ensureMiMoReady(request.cwd);

  const taskMetadata = buildTaskRunMetadata({
    prompt: request.prompt,
    resumeLast: Boolean(request.resumeLast)
  });

  let resumeSessionID: string | null = null;
  if (request.resumeLast) {
    const latestSession = await resolveLatestTrackedTaskSession(workspaceRoot, {
      excludeJobId: request.jobId
    });
    if (!latestSession) {
      throw new Error("No previous MiMo task session was found for this repository.");
    }
    resumeSessionID = latestSession.id;
  }

  if (!request.prompt && !resumeSessionID) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume-last.");
  }

  const result = await runMiMoTurn(workspaceRoot, {
    resumeSessionID,
    prompt: request.prompt,
    defaultPrompt: resumeSessionID ? DEFAULT_CONTINUE_PROMPT : "",
    modelRef: request.modelRef,
    write: Boolean(request.write),
    sessionTitle: resumeSessionID ? null : buildTaskSessionTitle(request.prompt || DEFAULT_CONTINUE_PROMPT),
    onProgress: request.onProgress
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
    write: Boolean(request.write)
  };
}

function buildReviewJobMetadata(reviewName: string, target: ReviewTarget) {
  return {
    kind: reviewName === "Adversarial Review" ? "adversarial-review" : "review",
    title: `MiMo ${reviewName}`,
    summary: `${reviewName} ${target.label}`
  };
}

function buildTaskRunMetadata({ prompt, resumeLast = false }: { prompt: string; resumeLast?: boolean }) {
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
    summary: shorten(prompt || fallbackSummary)
  };
}

function renderQueuedTaskLaunch(payload: { title: string; jobId: string }): string {
  return `${payload.title} started in the background as ${payload.jobId}. Check /mimo:status ${payload.jobId} for progress.\n`;
}

function getJobKindLabel(kind: string, jobClass: string): string {
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
}: {
  prefix: string;
  kind: string;
  title: string;
  workspaceRoot: string;
  jobClass: "review" | "task";
  summary: string;
  write?: boolean;
}): JobRecord & { workspaceRoot: string } {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: getJobKindLabel(kind, jobClass),
    title,
    workspaceRoot,
    jobClass,
    summary,
    write
  }) as JobRecord & { workspaceRoot: string };
}

function createTrackedProgress(job: JobRecord & { workspaceRoot: string }, options: { logFile?: string | null; stderr?: boolean } = {}) {
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

function buildTaskJob(workspaceRoot: string, taskMetadata: { title: string; summary: string }, write: boolean) {
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

function readTaskPrompt(cwd: string, options: CommandOptions, positionals: string[]): string {
  if (typeof options["prompt-file"] === "string") {
    return fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8");
  }

  const positionalPrompt = positionals.join(" ");
  return positionalPrompt || readStdinIfPiped();
}

function requireTaskRequest(prompt: string, resumeLast: boolean): void {
  if (!prompt && !resumeLast) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume-last.");
  }
}

async function runForegroundCommand(
  job: JobRecord & { workspaceRoot: string },
  runner: (progress: ProgressReporter | null) => Promise<JobExecution>,
  options: { json?: boolean; logFile?: string | null } = {}
): Promise<JobExecution> {
  const { logFile, progress } = createTrackedProgress(job, {
    logFile: options.logFile,
    stderr: !options.json
  });
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
  return execution;
}

function spawnDetachedTaskWorker(cwd: string, jobId: string) {
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [scriptPath, "task-worker", "--cwd", cwd, "--job-id", jobId], {
    cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child;
}

function enqueueBackgroundTask(cwd: string, job: JobRecord & { workspaceRoot: string }, request: Record<string, unknown>) {
  const { logFile } = createTrackedProgress(job);
  appendLogLine(logFile, "Queued for background execution.");

  const child = spawnDetachedTaskWorker(cwd, job.id);
  const queuedRecord: JobRecord = {
    ...job,
    status: "queued",
    phase: "queued",
    pid: child.pid ?? null,
    logFile,
    request
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

async function handleReviewCommand(argv: string[], config: { reviewName: string; promptTemplate: string }): Promise<void> {
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
    scope: typeof options.scope === "string" ? options.scope : undefined
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
    (progress) =>
      executeReviewRun({
        cwd,
        base: typeof options.base === "string" ? options.base : null,
        scope: typeof options.scope === "string" ? options.scope : undefined,
        modelRef: typeof options.model === "string" ? options.model : undefined,
        focusText,
        reviewName: config.reviewName,
        promptTemplate: config.promptTemplate,
        onProgress: progress
      }),
    { json: Boolean(options.json) }
  );
}

async function handleTask(argv: string[]): Promise<void> {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "cwd", "prompt-file"],
    booleanOptions: ["json", "write", "resume-last", "resume", "fresh", "background"],
    aliasMap: {
      m: "model"
    }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const modelRef = typeof options.model === "string" ? options.model : undefined;
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

    const job = buildTaskJob(workspaceRoot, taskMetadata, write);
    const request = {
      cwd,
      modelRef,
      prompt,
      write,
      resumeLast,
      jobId: job.id
    };
    const { payload } = enqueueBackgroundTask(cwd, job, request);
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), Boolean(options.json));
    return;
  }

  const job = buildTaskJob(workspaceRoot, taskMetadata, write);
  await runForegroundCommand(
    job,
    (progress) =>
      executeTaskRun({
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

async function handleTaskWorker(argv: string[]): Promise<void> {
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

  const request = storedJob.request;
  if (!request || typeof request !== "object") {
    throw new Error(`Stored job ${options["job-id"]} is missing its task request payload.`);
  }

  const { logFile, progress } = createTrackedProgress(
    {
      ...storedJob,
      workspaceRoot
    } as JobRecord & { workspaceRoot: string },
    {
      logFile: storedJob.logFile ?? null
    }
  );
  await runTrackedJob(
    {
      ...storedJob,
      workspaceRoot,
      logFile
    } as JobRecord & { workspaceRoot: string },
    () =>
      executeTaskRun({
        ...(request as unknown as TaskRequest),
        onProgress: progress
      }),
    { logFile }
  );
}

async function handleStatus(argv: string[]): Promise<void> {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"],
    booleanOptions: ["json", "all", "wait"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  if (reference) {
    const snapshot = options.wait
      ? await waitForSingleJobSnapshot(cwd, reference, {
          timeoutMs: options["timeout-ms"],
          pollIntervalMs: options["poll-interval-ms"]
        })
      : buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), Boolean(options.json));
    return;
  }

  if (options.wait) {
    throw new Error("`status --wait` requires a job id.");
  }

  const report = buildStatusSnapshot(cwd, { all: Boolean(options.all) });
  outputResult(options.json ? report : renderStatusReport(report), Boolean(options.json));
}

function handleResult(argv: string[]): void {
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

function handleTaskResumeCandidate(argv: string[]): void {
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
    candidate:
      candidate == null
        ? null
        : {
            id: candidate.id,
            status: candidate.status,
            title: candidate.title ?? null,
            summary: candidate.summary ?? null,
            mimoSessionID: candidate.mimoSessionID,
            completedAt: candidate.completedAt ?? null,
            updatedAt: candidate.updatedAt ?? null
          }
  };

  const rendered = candidate
    ? `Resumable task found: ${candidate.id} (${candidate.status}).\n`
    : "No resumable task found for this session.\n";
  outputCommandResult(payload, rendered, Boolean(options.json));
}

async function handleCancel(argv: string[]): Promise<void> {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference, { env: process.env });
  const existing: Partial<JobRecord> = readStoredJob(workspaceRoot, job.id) ?? {};
  const mimoSessionID = (existing.mimoSessionID ?? job.mimoSessionID ?? null) as string | null;

  const interrupt = await interruptMiMoSession(cwd, mimoSessionID);
  if (interrupt.attempted) {
    appendLogLine(
      job.logFile,
      interrupt.interrupted
        ? `Requested MiMo abort for session ${mimoSessionID}.`
        : `MiMo abort failed${interrupt.detail ? `: ${interrupt.detail}` : "."}`
    );
  }

  terminateProcessTree(job.pid ?? Number.NaN);
  appendLogLine(job.logFile, "Cancelled by user.");

  const completedAt = nowIso();
  const nextJob: JobRecord = {
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

async function main(): Promise<void> {
  const [subcommand, ...argv] = process.argv.slice(2);
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
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
