import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

import {
	createModels,
	createProvider,
	envApiKeyAuth,
	type Model,
	type Models,
	type ProviderStreams,
} from "@earendil-works/pi-ai";
import {
	stream as streamOpenAICompletions,
	streamSimple as streamSimpleOpenAICompletions,
} from "@earendil-works/pi-ai/api/openai-completions";

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

function readYamlIfExists(path: string): ConfigFile | undefined {
	try {
		const raw = readFileSync(path, "utf8");
		return parseSimpleYaml(raw) as ConfigFile;
	} catch {
		return undefined;
	}
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
 *   2. workspace .remora/config.json (legacy, still supported)
 *   3. global ~/.pi/remora.config.yaml (new unified location)
 *   4. global ~/.remora/config.json (legacy fallback)
 *
 * Spread order means later objects override earlier ones, so the effective
 * priority for any single field is: env > workspace > ~/.pi yaml > ~/.remora json.
 */
export function loadConfig(cwd: string, modelOverride?: string): ProviderConfig {
	const legacyGlobal = readJsonIfExists(join(homedir(), ".remora", "config.json"));
	const piYaml = readYamlIfExists(join(homedir(), ".pi", "remora.config.yaml"));
	const legacyWorkspace = readJsonIfExists(join(cwd, ".remora", "config.json"));
	const file: ConfigFile = { ...legacyGlobal, ...piYaml, ...legacyWorkspace };

	const baseUrl = process.env.REMORA_BASE_URL ?? file.baseUrl;
	const model = modelOverride ?? process.env.REMORA_MODEL ?? file.model;
	if (!baseUrl) throw new Error("missing provider baseUrl: set REMORA_BASE_URL or ~/.pi/remora.config.yaml");
	if (!model) throw new Error("missing model: set REMORA_MODEL or ~/.pi/remora.config.yaml");

	const apiKey = resolveApiKey(file);
	if (!apiKey) {
		const spec = file.apiKey ?? file.apiKeyEnv;
		const hint = spec ? ` or set config apiKey="${spec}"` : "";
		throw new Error(`missing api key: set $REMORA_API_KEY${hint}, or use apiKey "keychain:SERVICE" / "env:VAR" in ~/.pi/remora.config.yaml`);
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

/**
 * Build a pi-ai `Models` registry for the single OpenAI-compatible endpoint.
 *
 * `generateSummary` (compaction) takes a `Models` (not a bare `Model` + key) so
 * it can resolve auth and stream through the registry. We register one custom
 * provider with remora's resolved key (via `envApiKeyAuth`) and the public
 * openai-completions stream functions. The Agent itself still streams via its
 * own `model` + `getApiKey` path; this registry is for the compaction summary
 * call only.
 *
 * The key may have come from the keychain rather than env, so mirror it into
 * `REMORA_API_KEY` for `envApiKeyAuth` to find (process-local; remora owns the
 * process).
 */
export function buildModels(cfg: ProviderConfig, model: Model<"openai-completions">): Models {
	// `envApiKeyAuth` resolves from env, so a key that came from the keychain
	// (not env) must be mirrored into REMORA_API_KEY. Match loadConfig's `??`
	// semantics: only mirror when the env var is truly unset (undefined), not
	// when it's an empty string (which loadConfig would have rejected already).
	// process-local — remora is a short-lived CLI.
	if (cfg.apiKey && process.env.REMORA_API_KEY === undefined) process.env.REMORA_API_KEY = cfg.apiKey;
	const models = createModels();
	models.setProvider(
		createProvider({
			id: cfg.provider,
			baseUrl: cfg.baseUrl,
			auth: { apiKey: envApiKeyAuth("remora", ["REMORA_API_KEY"]) },
			models: [model],
			// `as ProviderStreams` is a defensive cast. `satisfies ProviderStreams`
			// also compiles today (TS 5.7 + pi-ai 0.80.2 — the Model<TApi> structure
			// isn't strictly contravariant on `api`), but the stream fns are
			// StreamFunction<"openai-completions"> while ProviderStreams.stream
			// expects Model<Api>; the cast insulates against future pi-ai type
			// tightening. Runtime dispatch is on model.api + baseUrl.
			api: {
				stream: streamOpenAICompletions,
				streamSimple: streamSimpleOpenAICompletions,
			} as ProviderStreams,
		}),
	);
	return models;
}

/**
 * Minimal flat YAML parser for remora config files. Supports:
 *   - `key: value` pairs (string, number, boolean, null)
 *   - quoted string values (`key: "value"`, `key: 'value'`)
 *   - `#` line comments and inline comments (`key: value  # comment`)
 *   - blank lines
 *
 * Does NOT support: nested mappings, sequences, multiline values, anchors,
 * tags, or any advanced YAML features. This is intentionally limited — remora's
 * config is a flat key-value file with ~6 fields.
 */
export function parseSimpleYaml(raw: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) continue;
		const key = trimmed.slice(0, colonIdx).trim();
		let rawValue = trimmed.slice(colonIdx + 1).trim();
		if (!rawValue) continue; // empty value → skip
		// Strip inline comments for unquoted values.
		// In YAML, `#` is a comment only when preceded by whitespace (or at line
		// start). Quoted values are exempt — `#` inside quotes is literal.
		if (!isQuotedScalar(rawValue)) {
			rawValue = stripInlineComment(rawValue).trim();
			if (!rawValue) continue; // value was comment-only, e.g. `key: # comment`
		}
		result[key] = parseYamlValue(rawValue);
	}
	return result;
}

/** Whether a value starts and ends with matching quotes (→ exempt from comment stripping). */
function isQuotedScalar(v: string): boolean {
	return v.length >= 2 && (
		(v.startsWith('"') && v.endsWith('"')) ||
		(v.startsWith("'") && v.endsWith("'"))
	);
}

/** Remove a trailing ` # comment` from an unquoted YAML scalar. */
function stripInlineComment(v: string): string {
	if (v.startsWith("#")) return ""; // comment-only value
	const match = v.search(/\s#/); // whitespace followed by #
	return match === -1 ? v : v.slice(0, match);
}

/** Parse a single YAML scalar value. */
function parseYamlValue(v: string): unknown {
	// Quoted strings: strip quotes, keep as-is (no unescaping needed for remora config)
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
		return v.slice(1, -1);
	}
	// null (YAML 1.2 null tokens)
	if (v === "null" || v === "~" || v === "Null" || v === "NULL") return null;
	// Booleans
	if (v === "true") return true;
	if (v === "false") return false;
	// Numbers (integers and decimals)
	if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
	if (/^-?\d+\.\d+$/.test(v)) return Number.parseFloat(v);
	// Unquoted string (the default YAML scalar)
	return v;
}
