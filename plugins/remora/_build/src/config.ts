import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

import type { Model } from "@earendil-works/pi-ai";

/** Resolved provider configuration for a single OpenAI-compatible endpoint. */
export interface ProviderConfig {
	baseUrl: string;
	model: string;
	provider: string;
	apiKey: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
}

interface ConfigFile {
	baseUrl?: string;
	model?: string;
	provider?: string;
	/** Legacy: env var name only. Prefer `apiKey` with a `keychain:`/`env:`/bare spec. */
	apiKeyEnv?: string;
	/** Key source spec: `keychain:SERVICE[:ACCOUNT]`, `env:VAR`, or a bare `VAR` (defaults to env). */
	apiKey?: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

function readJsonIfExists(path: string): ConfigFile | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as ConfigFile;
	} catch {
		return undefined;
	}
}

/**
 * Load provider config. Precedence (high → low):
 *   1. env (REMORA_BASE_URL / REMORA_MODEL / REMORA_API_KEY) + modelOverride
 *   2. workspace .remora/config.json
 *   3. global ~/.remora/config.json
 */
export function loadConfig(cwd: string, modelOverride?: string): ProviderConfig {
	const global = readJsonIfExists(join(homedir(), ".remora", "config.json"));
	const workspace = readJsonIfExists(join(cwd, ".remora", "config.json"));
	const file: ConfigFile = { ...global, ...workspace };

	const baseUrl = process.env.REMORA_BASE_URL ?? file.baseUrl;
	const model = modelOverride ?? process.env.REMORA_MODEL ?? file.model;
	if (!baseUrl) throw new Error("missing provider baseUrl: set REMORA_BASE_URL or .remora/config.json");
	if (!model) throw new Error("missing model: set REMORA_MODEL or .remora/config.json");

	const apiKey = resolveApiKey(file);
	if (!apiKey) {
		const spec = file.apiKey ?? file.apiKeyEnv;
		const hint = spec ? ` or set config apiKey="${spec}"` : "";
		throw new Error(`missing api key: set $REMORA_API_KEY${hint}, or use apiKey "keychain:SERVICE" / "env:VAR" in .remora/config.json`);
	}

	return {
		baseUrl,
		model,
		provider: file.provider ?? "custom",
		apiKey,
		reasoning: file.reasoning ?? false,
		contextWindow: file.contextWindow ?? 128000,
		maxTokens: file.maxTokens ?? 8192,
	};
}

/**
 * Resolve the API key for the provider. Precedence (high → low):
 *   1. `$REMORA_API_KEY` env var (always wins, skips specs)
 *   2. config `apiKey` spec (if set), else legacy `apiKeyEnv` (env-only)
 *   3. `$DASHSCOPE_API_KEY` env var (legacy default)
 *
 * A spec is one of:
 *   `env:VAR` / bare `VAR`       → read `process.env[VAR]`
 *   `keychain:SERVICE[:ACCOUNT]` → `security find-generic-password -s SERVICE [-a ACCOUNT] -w`
 * An unknown scheme (e.g. `foo:BAR`) throws so misconfiguration surfaces early.
 */
function resolveApiKey(file: ConfigFile): string | undefined {
	if (process.env.REMORA_API_KEY) return process.env.REMORA_API_KEY;

	const specs: string[] = [];
	if (file.apiKey) specs.push(file.apiKey);
	else if (file.apiKeyEnv) specs.push(`env:${file.apiKeyEnv}`);
	specs.push("env:DASHSCOPE_API_KEY");

	for (const spec of specs) {
		const v = resolveKeySpec(spec);
		if (v) return v;
	}
	return undefined;
}

export interface KeySpec {
	scheme: "env" | "keychain";
	/** env var name (env) or keychain service (keychain). */
	name: string;
	/** Optional keychain account; resolved to the current user if omitted. */
	account?: string;
}

/** Parse a `scheme:target` spec. A bare value (no `:`) defaults to the `env` scheme. */
export function parseKeySpec(spec: string): KeySpec {
	const colon = spec.indexOf(":");
	const scheme = colon === -1 ? "env" : spec.slice(0, colon);
	const rest = colon === -1 ? spec : spec.slice(colon + 1);
	if (!rest) throw new Error(`api key spec is empty after scheme "${scheme}:"`);
	switch (scheme) {
		case "env":
			return { scheme: "env", name: rest };
		case "keychain": {
			const sep = rest.indexOf(":");
			if (sep === -1) return { scheme: "keychain", name: rest };
			const account = rest.slice(sep + 1);
			return { scheme: "keychain", name: rest.slice(0, sep), account: account || undefined };
		}
		default:
			throw new Error(`unknown api key scheme "${scheme}": expected "env:" or "keychain:"`);
	}
}

/** Resolve a single spec to its secret value, or `undefined` if not found. */
export function resolveKeySpec(spec: string): string | undefined {
	const parsed = parseKeySpec(spec);
	if (parsed.scheme === "env") return process.env[parsed.name]?.trim() || undefined;
	return readKeychain(parsed.name, parsed.account);
}

/**
 * Read a generic-password from the macOS keychain. Account defaults to the
 * current macOS user when omitted. Non-darwin / `security` failures → undefined.
 */
function readKeychain(service: string, account?: string): string | undefined {
	if (process.platform !== "darwin") return undefined;
	const acct = account ?? userInfo().username ?? process.env.USER;
	if (!acct) return undefined;
	const r = spawnSync("security", ["find-generic-password", "-s", service, "-a", acct, "-w"], { encoding: "utf8" });
	if (r.status !== 0) return undefined;
	return r.stdout?.trim() || undefined;
}

/**
 * Build a pi-ai Model literal for a custom OpenAI-compatible endpoint.
 *
 * `getModel` is a typed registry lookup and rejects off-registry ids, so custom
 * endpoints must be expressed as a plain Model object. `streamSimple` dispatches
 * on `api` + `baseUrl`; the api key is injected via the Agent's `getApiKey` hook,
 * never stored on the model.
 */
export function resolveModel(cfg: ProviderConfig): Model<"openai-completions"> {
	return {
		id: cfg.model,
		name: cfg.model,
		api: "openai-completions",
		provider: cfg.provider,
		baseUrl: cfg.baseUrl,
		reasoning: cfg.reasoning,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: cfg.contextWindow,
		maxTokens: cfg.maxTokens,
	};
}
