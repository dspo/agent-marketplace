import { readFileSync } from "node:fs";

import { loadConfig } from "./config.ts";
import { runTurn } from "./runtime.ts";

/** The structured rescue task, authored by the calling agent (see SKILL.md). */
interface TaskFile {
	prompt: string;
	problem?: string;
	files?: string[];
	attempted?: string;
	expected?: string;
}

interface CliArgs {
	command: string;
	taskFile?: string;
	write: boolean;
	resume: boolean;
	model?: string;
	sessionId: string;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = { command: argv[0] ?? "", write: false, resume: false, sessionId: "default" };
	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--write") args.write = true;
		else if (a === "--resume") args.resume = true;
		else if (a === "--task-file") args.taskFile = argv[++i];
		else if (a === "--model") args.model = argv[++i];
		else if (a === "--session") args.sessionId = argv[++i] ?? "default";
	}
	return args;
}

/** Compose the system prompt from the structured task fields. */
function buildSystemPrompt(task: TaskFile): string {
	const lines = [
		"You are remora, a focused rescue agent invoked to make progress on a problem the primary agent is stuck on.",
		"You operate in a read-only investigation mode unless told otherwise: read code, search, and reason.",
		"Be concrete. Diagnose the root cause, then state the smallest correct fix. Cite files as path:line.",
		"Return a direct, self-contained answer — your final message is the entire deliverable.",
	];
	if (task.problem) lines.push(`\n## Problem\n${task.problem}`);
	if (task.files?.length) lines.push(`\n## Relevant files\n${task.files.map((f) => `- ${f}`).join("\n")}`);
	if (task.attempted) lines.push(`\n## Already attempted\n${task.attempted}`);
	if (task.expected) lines.push(`\n## Expected outcome\n${task.expected}`);
	return lines.join("\n");
}

function emit(stream: NodeJS.WriteStream, obj: unknown): void {
	stream.write(`${JSON.stringify(obj)}\n`);
}

/** Minimum Node version required by the pi base. */
const MIN_NODE = [22, 19, 0];

function nodeVersionOk(): boolean {
	const parts = process.versions.node.split(".").map((n) => Number.parseInt(n, 10));
	for (let i = 0; i < MIN_NODE.length; i++) {
		const cur = parts[i] ?? 0;
		if (cur > MIN_NODE[i]) return true;
		if (cur < MIN_NODE[i]) return false;
	}
	return true;
}

/**
 * `setup`: verify Node version + config loads + the endpoint answers a minimal
 * completion. Writes a single JSON report to stdout. Always exits 0/1 cleanly.
 */
async function runSetup(): Promise<void> {
	const report: Record<string, unknown> = {
		node: process.versions.node,
		nodeOk: nodeVersionOk(),
	};

	if (!report.nodeOk) {
		report.ready = false;
		report.message = `Node ${process.versions.node} is below the required >=22.19.0`;
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		process.exit(1);
	}

	let cfg: ReturnType<typeof loadConfig>;
	try {
		cfg = loadConfig(process.cwd());
	} catch (err) {
		report.ready = false;
		report.message = `config error: ${(err as Error).message}`;
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		process.exit(1);
		return;
	}
	report.baseUrl = cfg.baseUrl;
	report.model = cfg.model;
	report.provider = cfg.provider;

	try {
		const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
			body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
		});
		report.ready = res.ok;
		report.httpStatus = res.status;
		if (!res.ok) report.message = `endpoint returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
		else report.message = "remora is ready";
	} catch (err) {
		report.ready = false;
		report.message = `cannot reach endpoint: ${(err as Error).message}`;
	}

	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	process.exit(report.ready ? 0 : 1);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (args.command === "setup") {
		await runSetup();
		return;
	}
	if (args.command !== "rescue") {
		emit(process.stderr, { type: "error", message: `unknown command: ${args.command || "(none)"}` });
		process.exit(2);
	}
	if (!args.taskFile) {
		emit(process.stderr, { type: "error", message: "missing --task-file" });
		process.exit(2);
	}

	let task: TaskFile;
	try {
		task = JSON.parse(readFileSync(args.taskFile, "utf8")) as TaskFile;
	} catch (err) {
		emit(process.stderr, { type: "error", message: `cannot read task-file: ${(err as Error).message}` });
		process.exit(2);
		return;
	}
	if (!task.prompt) {
		emit(process.stderr, { type: "error", message: "task-file is missing the required 'prompt' field" });
		process.exit(2);
	}

	try {
		const result = await runTurn(process.cwd(), {
			prompt: task.prompt,
			system: buildSystemPrompt(task),
			write: args.write,
			resume: args.resume,
			model: args.model,
			sessionId: args.sessionId,
			onProgress: (ev) => emit(process.stderr, ev),
		});
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		process.exit(result.status);
	} catch (err) {
		const message = (err as Error).message ?? String(err);
		emit(process.stderr, { type: "error", message });
		process.stdout.write(`${JSON.stringify({ status: 1, errorMessage: message }, null, 2)}\n`);
		process.exit(1);
	}
}

void main();
