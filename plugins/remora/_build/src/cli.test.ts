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
function run(argv: string[], stdin: string | null): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [CLI, ...argv], { stdio: ["pipe", "ignore", "pipe"] });
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
