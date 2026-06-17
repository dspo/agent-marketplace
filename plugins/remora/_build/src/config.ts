import { readFileSync } from "node:fs";
import { homedir } from "node:os";
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
	apiKeyEnv?: string;
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

	const apiKey = resolveApiKey(file.apiKeyEnv);
	if (!apiKey) {
		const hint = file.apiKeyEnv ? ` or $${file.apiKeyEnv}` : "";
		throw new Error(`missing api key: set $REMORA_API_KEY${hint}`);
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

function resolveApiKey(apiKeyEnv?: string): string | undefined {
	const candidates = ["REMORA_API_KEY", apiKeyEnv, "DASHSCOPE_API_KEY"].filter(Boolean) as string[];
	for (const name of candidates) {
		const v = process.env[name];
		if (v) return v;
	}
	return undefined;
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
