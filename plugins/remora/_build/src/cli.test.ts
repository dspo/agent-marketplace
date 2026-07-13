import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const CLI = fileURLToPath(new URL("../../scripts/remora.mjs", import.meta.url));

interface RunResult {
	code: number | null;
	stderr: string;
}

/** Spawn the bundled CLI with `argv`, write `stdin`, and capture exit + stderr. */
function run(argv: string[], stdin: string | null, env?: NodeJS.ProcessEnv): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [CLI, ...argv], {
			stdio: ["pipe", "ignore", "pipe"],
			env: env ? { ...process.env, ...env } : undefined,
		});
		let stderr = "";
		child.stderr.on("data", (d) => {
			stderr += String(d);
		});
		child.on("close", (code) => resolve({ code, stderr }));
		if (stdin === null) child.stdin.end();
		else child.stdin.end(stdin);
	});
}

/** Parse the last NDJSON error line emitted on stderr. */
function lastError(stderr: string): { type: string; message: string } | null {
	const lines = stderr.trim().split("\n").filter(Boolean);
	for (let i = lines.length - 1; i >= 0; i--) {
		try {
			return JSON.parse(lines[i]) as { type: string; message: string };
		} catch {
			/* not JSON, keep scanning */
		}
	}
	return null;
}

describe("task stdin contract", () => {
	it("exits 2 on empty stdin", async () => {
		const r = await run(["task"], "");
		assert.equal(r.code, 2);
		assert.match(lastError(r.stderr)?.message ?? "", /no task on stdin/);
	});

	it("exits 2 on invalid JSON", async () => {
		const r = await run(["task"], "not json");
		assert.equal(r.code, 2);
		assert.match(lastError(r.stderr)?.message ?? "", /not valid JSON/);
	});

	it("exits 2 when prompt is missing", async () => {
		const r = await run(["task"], JSON.stringify({ files: ["x"] }));
		assert.equal(r.code, 2);
		assert.match(lastError(r.stderr)?.message ?? "", /'prompt'/);
	});

	it("exits 2 when prompt is not a string", async () => {
		const r = await run(["task"], JSON.stringify({ prompt: 123 }));
		assert.equal(r.code, 2);
		assert.match(lastError(r.stderr)?.message ?? "", /'prompt'/);
	});

	it("exits 2 on an unknown command", async () => {
		const r = await run(["frobnicate"], "");
		assert.equal(r.code, 2);
		assert.match(lastError(r.stderr)?.message ?? "", /unknown command/);
	});
});

describe("--cwd routing", () => {
	it("exits 2 when --cwd points at a non-directory", async () => {
		const r = await run(["--cwd", "/no/such/dir/remora-cwd-test", "task"], "");
		assert.equal(r.code, 2);
		assert.match(lastError(r.stderr)?.message ?? "", /--cwd is not a directory/);
	});

	it("exits 2 when --cwd has no value (trailing flag)", async () => {
		const r = await run(["--cwd"], "");
		assert.equal(r.code, 2);
		assert.match(lastError(r.stderr)?.message ?? "", /--cwd needs a path/);
	});

	it("accepts a valid --cwd and proceeds to the task stdin contract", async () => {
		// --cwd resolves; cwd validation passes, so the next gate is the task on
		// stdin — empty stdin must surface the `no task on stdin` error, proving
		// --cwd parsing did not short-circuit the normal task flow.
		const r = await run(["--cwd", "/tmp", "task"], "");
		assert.equal(r.code, 2);
		assert.match(lastError(r.stderr)?.message ?? "", /no task on stdin/);
	});

	it("accepts --cwd after the subcommand (global position)", async () => {
		const r = await run(["task", "--cwd", "/no/such/dir/remora-cwd-test"], "");
		assert.equal(r.code, 2);
		assert.match(lastError(r.stderr)?.message ?? "", /--cwd is not a directory/);
	});
});

describe("resume routing", () => {
	it("gives --resume <id> precedence over --continue when both are passed", async () => {
		// Stub env so loadConfig succeeds without a real endpoint; the observable
		// is then openOrCreateSession: mode="id" with a missing id throws "session
		// not found" before any endpoint call, whereas mode="continue" with no
		// sessions would create a new session and proceed to the endpoint. If the
		// parser regressed to last-wins (--continue clobbering --resume), this test
		// would either hang on the endpoint or surface a config/endpoint error
		// instead of "session not found".
		const r = await run(
			["--cwd", "/tmp", "--resume", "definitely-nonexistent-id", "--continue", "task"],
			JSON.stringify({ prompt: "probe" }),
			{ REMORA_BASE_URL: "http://127.0.0.1:9", REMORA_MODEL: "probe", REMORA_API_KEY: "probe" },
		);
		assert.equal(r.code, 1);
		assert.match(lastError(r.stderr)?.message ?? "", /session not found/);
	});
});

describe("version", () => {
	// `--version` / `version` short-circuit before --cwd validation and stdin
	// reading; both must exit 0 so a stale-bundle check never depends on a valid
	// workspace. The harness ignores stdout, so we assert the exit code only.
	it("exits 0 on --version flag", async () => {
		const r = await run(["--version"], null);
		assert.equal(r.code, 0);
	});

	it("exits 0 on version subcommand", async () => {
		const r = await run(["version"], null);
		assert.equal(r.code, 0);
	});
});
