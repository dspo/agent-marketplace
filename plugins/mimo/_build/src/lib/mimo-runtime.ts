import process from "node:process";

import {
  abortSession,
  createMiMoClient,
  createSession,
  ensureMiMoAvailable,
  extractFinalText,
  getSession,
  getSessionDiff,
  listSessions,
  rejectPermission,
  rejectQuestion,
  sendPrompt,
  setSessionPermission,
  subscribeEvents,
  READ_ONLY_RULESET,
  WRITE_RULESET,
  type FileDiff,
  type MiMoClient,
  type MiMoEvent,
  type PromptResult
} from "./mimo-client.ts";
import { addServerRef, ensureServer, getServerRuntimeStatus, type ServerLifecycleOptions } from "./server-lifecycle.ts";
import { resolveStateDir } from "./state.ts";
import { SESSION_ID_ENV, type ProgressReporter } from "./tracked-jobs.ts";

const TASK_SESSION_PREFIX = "MiMo Companion Task";
export const DEFAULT_CONTINUE_PROMPT =
  "Continue from the current session state. Pick the next highest-value step and follow through until the task is resolved.";

function shorten(text: string, limit = 72): string {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

export function buildTaskSessionTitle(prompt: string): string {
  const excerpt = shorten(prompt, 56);
  return excerpt ? `${TASK_SESSION_PREFIX}: ${excerpt}` : TASK_SESSION_PREFIX;
}

export function getMiMoAvailability(cwd?: string): { available: boolean; detail: string } {
  return ensureMiMoAvailable(cwd);
}

export function ensureMiMoReady(cwd?: string): void {
  const availability = getMiMoAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      "MiMo CLI is not installed or not working. Install it (e.g. `npm install -g @mimo-ai/cli`), then rerun `/mimo:setup`."
    );
  }
}

export async function connectMiMo(cwd: string, options: ServerLifecycleOptions = {}): Promise<MiMoClient> {
  const stateDir = resolveStateDir(cwd);
  const server = await ensureServer(stateDir, options);
  // Register the current Claude session as a server reference so SessionEnd
  // only shuts the shared server down once the last session is gone.
  const sessionId = (options.env ?? process.env)[SESSION_ID_ENV];
  if (sessionId) {
    addServerRef(stateDir, sessionId);
  }
  return createMiMoClient(server.baseUrl, cwd, { env: options.env, fetchImpl: options.fetchImpl });
}

function emitProgress(onProgress: ProgressReporter | null | undefined, message: string, phase: string | null = null, extra: Record<string, unknown> = {}): void {
  if (!onProgress || !message) {
    return;
  }
  onProgress({ message, phase, ...extra });
}

function describeEventPhase(event: MiMoEvent): { message: string; phase: string | null } | null {
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

// Watches the global event stream during a prompt for two purposes:
// progress phases for /mimo:status, and auto-rejecting ask-style
// question/permission requests so an unattended job can never hang.
function watchSessionEvents(
  client: MiMoClient,
  sessionID: string,
  onProgress: ProgressReporter | null | undefined,
  signal: AbortSignal
): void {
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
            void rejectQuestion(client, String(requestID)).catch(() => {});
          }
          return;
        }

        if (event.type === "permission.asked") {
          const permissionID = event.properties?.id ?? null;
          emitProgress(onProgress, "MiMo asked for permission; auto-rejecting to keep the unattended run moving.", null);
          if (permissionID) {
            void rejectPermission(client, sessionID, String(permissionID)).catch(() => {});
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
      // The event stream is advisory; never fail the job because of it.
    });
  } catch {
    // Same: progress degradation is acceptable.
  }
}

export type TurnResult = {
  status: number;
  mimoSessionID: string;
  messageID: string | null;
  finalMessage: string;
  structured: unknown;
  errorMessage: string | null;
  touchedFiles: string[];
  diffs: FileDiff[];
  raw: PromptResult | null;
};

export type RunTurnOptions = {
  prompt: string;
  resumeSessionID?: string | null;
  defaultPrompt?: string;
  write?: boolean;
  sessionTitle?: string | null;
  system?: string;
  modelRef?: string;
  outputSchema?: Record<string, unknown> | null;
  onProgress?: ProgressReporter | null;
  serverOptions?: ServerLifecycleOptions;
};

export async function runMiMoTurn(cwd: string, options: RunTurnOptions): Promise<TurnResult> {
  ensureMiMoReady(cwd);

  emitProgress(options.onProgress, "Connecting to the MiMo server.", "starting");
  const client = await connectMiMo(cwd, options.serverOptions ?? {});

  const ruleset = options.write ? WRITE_RULESET : READ_ONLY_RULESET;
  let sessionID: string;

  if (options.resumeSessionID) {
    const existing = await getSession(client, options.resumeSessionID);
    if (existing) {
      sessionID = options.resumeSessionID;
      // Re-assert the permission ruleset: the resumed session may have been
      // created with different write settings.
      await setSessionPermission(client, sessionID, ruleset).catch(() => {});
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
      format: options.outputSchema
        ? { type: "json_schema", schema: options.outputSchema, retryCount: 2 }
        : undefined
    });

    const finalMessage = extractFinalText(result);
    const rawError = result.info.error
      ? result.info.error.data?.message || result.info.error.name || "MiMo reported an error."
      : null;

    // Augment common MiMo errors with actionable guidance so the user sees
    // a clear next step instead of a raw HTTP error string.
    let errorMessage = rawError;
    if (rawError && /api key/i.test(rawError)) {
      errorMessage = `MiMo provider authentication failed: ${rawError}. Run /mimo:setup to check your provider configuration, or set the required API key environment variable (e.g. OPENAI_API_KEY or ANTHROPIC_API_KEY) and restart \`mimo serve\`.`;
    }

    let diffs: FileDiff[] = [];
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

export async function interruptMiMoSession(cwd: string, mimoSessionID: string | null): Promise<{ attempted: boolean; interrupted: boolean; detail: string }> {
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

export async function findLatestTaskSession(cwd: string): Promise<{ id: string } | null> {
  ensureMiMoReady(cwd);
  const client = await connectMiMo(cwd);
  const sessions = await listSessions(client, { limit: 20 });
  const match = sessions.find((session) => typeof session.title === "string" && session.title.startsWith(TASK_SESSION_PREFIX));
  return match ? { id: match.id } : null;
}

export function getSessionRuntimeStatus(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): { mode: string; label: string; detail: string } {
  return getServerRuntimeStatus(cwd);
}

export { TASK_SESSION_PREFIX };
