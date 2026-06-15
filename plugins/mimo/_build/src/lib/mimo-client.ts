import process from "node:process";

import { binaryAvailable, type AvailabilityStatus } from "./process.ts";
import { resolveMimoBin } from "./server-lifecycle.ts";

const SERVER_PASSWORD_ENV = "MIMOCODE_SERVER_PASSWORD";
const SERVER_USERNAME_ENV = "MIMOCODE_SERVER_USERNAME";

export type MiMoClient = {
  baseUrl: string;
  directory: string;
  fetchImpl: typeof fetch;
  authHeader: string | null;
};

export type PermissionRule = {
  permission: string;
  pattern: string;
  action: "allow" | "deny" | "ask";
};

// Read-only ruleset: deny anything that mutates the workspace, allow the rest.
// Evaluation is last-match-wins in MiMo (packages/opencode/src/permission/evaluate.ts),
// so the deny rules must come after the catch-all allow.
export const READ_ONLY_RULESET: PermissionRule[] = [
  { permission: "*", pattern: "*", action: "allow" },
  { permission: "edit", pattern: "*", action: "deny" },
  { permission: "write", pattern: "*", action: "deny" },
  { permission: "apply_patch", pattern: "*", action: "deny" },
  { permission: "multiedit", pattern: "*", action: "deny" },
  { permission: "external_directory", pattern: "*", action: "deny" }
];

// Write-capable ruleset: allow everything explicitly so nothing falls back to
// the implicit default of "ask", which would hang an unattended job.
export const WRITE_RULESET: PermissionRule[] = [{ permission: "*", pattern: "*", action: "allow" }];

export class MiMoHttpError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "MiMoHttpError";
    this.status = status;
    this.body = body;
  }
}

function buildAuthHeader(env: NodeJS.ProcessEnv): string | null {
  const password = env[SERVER_PASSWORD_ENV];
  if (!password) {
    return null;
  }
  const username = env[SERVER_USERNAME_ENV] || "mimocode";
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

export function createMiMoClient(baseUrl: string, directory: string, options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): MiMoClient {
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    directory,
    fetchImpl: options.fetchImpl ?? fetch,
    authHeader: buildAuthHeader(options.env ?? process.env)
  };
}

export function ensureMiMoAvailable(cwd?: string): AvailabilityStatus {
  return binaryAvailable(resolveMimoBin(), ["--version"], { cwd });
}

export function buildHeaders(client: MiMoClient, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "x-mimocode-directory": client.directory,
    ...extra
  };
  if (client.authHeader) {
    headers["authorization"] = client.authHeader;
  }
  return headers;
}

async function request(client: MiMoClient, method: string, pathName: string, body?: unknown, init: RequestInit = {}): Promise<Response> {
  const response = await client.fetchImpl(`${client.baseUrl}${pathName}`, {
    method,
    headers: buildHeaders(client, body === undefined ? {} : { "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
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

export type MiMoSessionInfo = {
  id: string;
  title: string;
  directory: string;
  [key: string]: unknown;
};

export async function createSession(
  client: MiMoClient,
  options: { title?: string; permission?: PermissionRule[] } = {}
): Promise<MiMoSessionInfo> {
  const response = await request(client, "POST", "/session", {
    ...(options.title ? { title: options.title } : {}),
    ...(options.permission ? { permission: options.permission } : {})
  });
  return (await response.json()) as MiMoSessionInfo;
}

export async function getSession(client: MiMoClient, sessionID: string): Promise<MiMoSessionInfo | null> {
  try {
    const response = await request(client, "GET", `/session/${encodeURIComponent(sessionID)}`);
    return (await response.json()) as MiMoSessionInfo;
  } catch (error) {
    if (error instanceof MiMoHttpError && (error.status === 404 || error.status === 400)) {
      return null;
    }
    throw error;
  }
}

export async function setSessionPermission(client: MiMoClient, sessionID: string, permission: PermissionRule[]): Promise<void> {
  await request(client, "PATCH", `/session/${encodeURIComponent(sessionID)}`, { permission });
}

export type PromptResult = {
  info: {
    id: string;
    structured?: unknown;
    error?: { name?: string; data?: { message?: string } } | null;
    [key: string]: unknown;
  };
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
};

export type SendPromptOptions = {
  prompt: string;
  system?: string;
  model?: { providerID: string; modelID: string };
  modelRef?: string;
  format?: { type: "json_schema"; schema: Record<string, unknown>; retryCount: number };
  signal?: AbortSignal;
};

export async function sendPrompt(client: MiMoClient, sessionID: string, options: SendPromptOptions): Promise<PromptResult> {
  const body: Record<string, unknown> = {
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
    return JSON.parse(text) as PromptResult;
  } catch {
    throw new Error(`MiMo returned a non-JSON prompt response: ${text.slice(0, 500)}`);
  }
}

export async function abortSession(client: MiMoClient, sessionID: string): Promise<boolean> {
  try {
    await request(client, "POST", `/session/${encodeURIComponent(sessionID)}/abort`, {});
    return true;
  } catch {
    return false;
  }
}

export type FileDiff = {
  file?: string;
  path?: string;
  [key: string]: unknown;
};

export async function getSessionDiff(client: MiMoClient, sessionID: string, messageID?: string): Promise<FileDiff[]> {
  const query = messageID ? `?messageID=${encodeURIComponent(messageID)}` : "";
  const response = await request(client, "GET", `/session/${encodeURIComponent(sessionID)}/diff${query}`);
  return (await response.json()) as FileDiff[];
}

export async function listSessions(client: MiMoClient, options: { limit?: number } = {}): Promise<MiMoSessionInfo[]> {
  const params = new URLSearchParams();
  params.set("directory", client.directory);
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  const response = await request(client, "GET", `/session?${params.toString()}`);
  return (await response.json()) as MiMoSessionInfo[];
}

export async function rejectQuestion(client: MiMoClient, requestID: string): Promise<void> {
  await request(client, "POST", `/question/${encodeURIComponent(requestID)}/reject`, {});
}

export async function rejectPermission(client: MiMoClient, sessionID: string, permissionID: string): Promise<void> {
  await request(client, "POST", `/session/${encodeURIComponent(sessionID)}/permissions/${encodeURIComponent(permissionID)}`, {
    response: "reject"
  });
}

export type MiMoEvent = {
  type: string;
  properties: Record<string, any>;
};

export type EventSubscription = {
  close: () => void;
  done: Promise<void>;
};

// Subscribes to the global /event SSE stream. Events are best-effort progress
// signals; callers must not depend on this for correctness. onEvent receives
// every event — filtering by sessionID is the caller's job.
export function subscribeEvents(
  client: MiMoClient,
  onEvent: (event: MiMoEvent) => void,
  options: { signal?: AbortSignal } = {}
): EventSubscription {
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

    for (;;) {
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
              onEvent(event as MiMoEvent);
            }
          } catch {
            // Ignore malformed event payloads; the stream is advisory only.
          }
        }
      }
    }
  })().catch((error: unknown) => {
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

export function extractFinalText(result: PromptResult): string {
  const texts = result.parts
    .filter((part) => part.type === "text" && typeof part.text === "string" && !(part as { synthetic?: boolean }).synthetic)
    .map((part) => part.text as string)
    .filter(Boolean);
  return texts.join("\n\n").trim();
}

export type StructuredParseResult = {
  parsed: unknown;
  parseError: string | null;
  rawOutput: string;
};

// Prefer the server-validated `info.structured` payload; fall back to parsing
// JSON out of the final text part when it is absent.
export function parseStructuredResult(result: PromptResult, fallbackMessage?: string): StructuredParseResult {
  const rawOutput = extractFinalText(result);

  if (result.info.structured !== undefined && result.info.structured !== null) {
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
        // Fall through to the error below.
      }
    }
    return { parsed: null, parseError: "The final message was not valid JSON.", rawOutput };
  }
}
