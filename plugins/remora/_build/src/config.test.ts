import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { parseKeySpec, resolveKeySpec } from "./config.ts";

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
