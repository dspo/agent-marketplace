import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { parseKeySpec, resolveKeySpec, parseSimpleYaml } from "./config.ts";

describe("parseKeySpec", () => {
	it("parses env:VAR", () => {
		assert.deepEqual(parseKeySpec("env:ANTHROPIC_API_KEY"), {
			scheme: "env",
			name: "ANTHROPIC_API_KEY",
		});
	});

	it("parses a bare value as env", () => {
		assert.deepEqual(parseKeySpec("ANTHROPIC_API_KEY"), {
			scheme: "env",
			name: "ANTHROPIC_API_KEY",
		});
	});

	it("parses keychain:SERVICE without account", () => {
		assert.deepEqual(parseKeySpec("keychain:DASHSCOPE_API_KEY"), {
			scheme: "keychain",
			name: "DASHSCOPE_API_KEY",
		});
	});

	it("parses keychain:SERVICE:ACCOUNT", () => {
		assert.deepEqual(parseKeySpec("keychain:DASHSCOPE_API_KEY:bot"), {
			scheme: "keychain",
			name: "DASHSCOPE_API_KEY",
			account: "bot",
		});
	});

	it("rejects an unknown scheme", () => {
		assert.throws(() => parseKeySpec("foobar:X"), /unknown api key scheme "foobar"/);
	});

	it("rejects an empty target", () => {
		assert.throws(() => parseKeySpec("env:"), /empty after scheme "env:"/);
	});
});

describe("resolveKeySpec", () => {
	const KEY = "sk-test-resolve-keyspec-1234";
	const stash: Record<string, string | undefined> = {};

	afterEach(() => {
		for (const [k, v] of Object.entries(stash)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
			delete stash[k];
		}
	});

	function setEnv(name: string, value: string | undefined): void {
		stash[name] = process.env[name];
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}

	it("reads an env:VAR spec", () => {
		setEnv("REMORA_TEST_KEY", KEY);
		assert.equal(resolveKeySpec("env:REMORA_TEST_KEY"), KEY);
	});

	it("treats a bare spec as env", () => {
		setEnv("REMORA_TEST_BARE", KEY);
		assert.equal(resolveKeySpec("REMORA_TEST_BARE"), KEY);
	});

	it("returns undefined when the env var is unset", () => {
		setEnv("REMORA_TEST_MISSING", undefined);
		assert.equal(resolveKeySpec("env:REMORA_TEST_MISSING"), undefined);
	});

	it("returns undefined for a missing keychain entry (darwin-only path)", () => {
		// On non-darwin, readKeychain short-circuits to undefined; on darwin the
		// entry won't exist either way. Either branch yields undefined.
		assert.equal(resolveKeySpec("keychain:remora-does-not-exist-xyz"), undefined);
	});
});

describe("parseSimpleYaml", () => {
	it("parses flat key-value pairs", () => {
		const result = parseSimpleYaml("baseUrl: https://example.com\nmodel: gpt-4");
		assert.deepEqual(result, {
			baseUrl: "https://example.com",
			model: "gpt-4",
		});
	});

	it("parses quoted string values", () => {
		const result = parseSimpleYaml('model: "deepseek-v4-pro"\nprovider: \'dashscope\'');
		assert.deepEqual(result, {
			model: "deepseek-v4-pro",
			provider: "dashscope",
		});
	});

	it("parses booleans and numbers", () => {
		const result = parseSimpleYaml("reasoning: true\ncontextWindow: 128000\nmaxTokens: 8192");
		assert.deepEqual(result, {
			reasoning: true,
			contextWindow: 128000,
			maxTokens: 8192,
		});
	});

	it("skips comments and blank lines", () => {
		const result = parseSimpleYaml("# this is a comment\n\nbaseUrl: https://example.com\n# another comment");
		assert.deepEqual(result, {
			baseUrl: "https://example.com",
		});
	});

	it("skips lines without a colon", () => {
		const result = parseSimpleYaml("just some text\nbaseUrl: https://example.com");
		assert.deepEqual(result, {
			baseUrl: "https://example.com",
		});
	});

	it("skips keys with empty values", () => {
		const result = parseSimpleYaml("model:\nbaseUrl: https://example.com");
		assert.deepEqual(result, {
			baseUrl: "https://example.com",
		});
	});

	it("parses a complete remora config", () => {
		const config = `# remora config
baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
model: "deepseek-v4-pro"
provider: "dashscope"
apiKey: "keychain:DASHSCOPE_API_KEY"
reasoning: false
contextWindow: 128000
maxTokens: 8192`;
		assert.deepEqual(parseSimpleYaml(config), {
			baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			model: "deepseek-v4-pro",
			provider: "dashscope",
			apiKey: "keychain:DASHSCOPE_API_KEY",
			reasoning: false,
			contextWindow: 128000,
			maxTokens: 8192,
		});
	});

	it("strips inline comments from unquoted values", () => {
		const result = parseSimpleYaml("baseUrl: https://example.com  # production endpoint");
		assert.equal(result.baseUrl, "https://example.com");
	});

	it("does not strip # from unquoted values when not preceded by whitespace", () => {
		// In YAML, # is only a comment when preceded by whitespace.
		// `https://example.com#section` has no space before # → it's part of the URL.
		const result = parseSimpleYaml("baseUrl: https://example.com#section");
		assert.equal(result.baseUrl, "https://example.com#section");
	});

	it("does not strip # inside quoted values", () => {
		const result = parseSimpleYaml('model: "foo#bar"  # this is a comment');
		assert.equal(result.model, "foo#bar");
	});

	it("strips inline comment after a quoted value", () => {
		const result = parseSimpleYaml('model: "deepseek-v4"  # best model');
		assert.equal(result.model, "deepseek-v4");
	});

	it("skips keys whose value is comment-only", () => {
		const result = parseSimpleYaml("model: # comment only\nbaseUrl: https://example.com");
		assert.deepEqual(result, {
			baseUrl: "https://example.com",
		});
	});

	it("parses null values", () => {
		assert.equal(parseSimpleYaml("model: null").model, null);
		assert.equal(parseSimpleYaml("model: ~").model, null);
		assert.equal(parseSimpleYaml("model: Null").model, null);
		assert.equal(parseSimpleYaml("model: NULL").model, null);
	});

	it("parses a config with inline comments and nulls", () => {
		const config = `# remora config
baseUrl: https://example.com/v1  # production
model: "deepseek-v4-pro"  # primary model
provider: dashscope
apiKey: null  # set via env instead
reasoning: false
contextWindow: 128000  # tokens
maxTokens: 8192`;
		assert.deepEqual(parseSimpleYaml(config), {
			baseUrl: "https://example.com/v1",
			model: "deepseek-v4-pro",
			provider: "dashscope",
			apiKey: null,
			reasoning: false,
			contextWindow: 128000,
			maxTokens: 8192,
		});
	});
});
