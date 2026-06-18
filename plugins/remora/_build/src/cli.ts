import { loadConfig } from "./config.ts";
import { formatSessionDumpText } from "./session-dump-format.ts";
import { formatSessionHistoryMarkdown } from "./session-history-format.ts";
import { listSessions } from "./session-listing.ts";
import { loadAllMessages, openOrCreateSession, type ResumeMode } from "./session.ts";
import { runTurn } from "./runtime.ts";

/** The structured task, authored by the calling agent (see SKILL.md). */
interface Task {
	prompt: string;
	problem?: string;
	files?: string[];
	attempted?: string;
	expected?: string;
}

interface CliArgs {
	command: string;
	write: boolean;
	resumeMode: ResumeMode;
	resumeId?: string;
	model?: string;
}

/**
 * Parse resume flags Claude Code style:
 *   `-c`/`--continue`         → reopen the most-recent session for this cwd
 *   `-r`/`--resume <id>`       → reopen a specific session by id
 *   (neither)                  → start a fresh session
 *
 * `--resume` with no following id sets `resumeMode: "id"` but leaves `resumeId`
 * unset — main() rejects that combo. This keeps `ResumeMode` a pure union (no
 * sentinel value leaks into the type). `--session`/the old `default` id are gone.
 */
function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = { command: argv[0] ?? "", write: false, resumeMode: "new" };
	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--write") args.write = true;
		else if (a === "-c" || a === "--continue") args.resumeMode = "continue";
		else if (a === "-r" || a === "--resume") {
			args.resumeMode = "id";
			const id = argv[i + 1];
			if (id && !id.startsWith("-")) {
				args.resumeId = id;
				i++;
			}
		} else if (a === "--model") args.model = argv[++i];
	}
	return args;
}

/**
 * Read the whole of stdin as UTF-8. The task JSON is piped in this way.
 * Fails fast on a TTY: with no pipe, stdin never reaches EOF and the process
 * would hang forever waiting for input.
 */
async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) {
		emit(process.stderr, { type: "error", message: "stdin is a TTY — pipe a JSON task object, e.g. `task <<'EOF' … EOF`" });
		process.exit(2);
	}
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

/** Compose the system prompt from the structured task fields. */
function buildSystemPrompt(task: Task): string {
	const lines = [
		"You are remora, a focused task agent invoked to make progress on a problem the primary agent is stuck on.",
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

/**
 * `sessions list`: enumerate this cwd's sessions newest-first, each with its
 * derived lifecycle status (complete/interrupted/aborted/error/pending) and
 * auto-title. For discovering what to `--resume`.
 */
async function runSessions(subcommand?: string): Promise<void> {
	if (subcommand !== "list" && subcommand !== undefined) {
		emit(process.stderr, { type: "error", message: `unknown sessions subcommand: ${subcommand} (expected: list)` });
		process.exit(2);
	}
	const items = await listSessions(process.cwd());
	if (items.length === 0) {
		process.stdout.write("(no sessions in this cwd)\n");
		process.exit(0);
	}
	for (const item of items) {
		const when = item.createdAt.replace(/\.\d{3}.*$/, "").replace("T", " ");
		const title = item.title ? ` ${item.title}` : "";
		process.stdout.write(`${when}  [${item.status.padEnd(11)}]  ${item.id}${title}\n`);
	}
	process.exit(0);
}

/**
 * `dump <id>`: render a session's transcript as markdown for review.
 * Default: concise transcript (tool calls one-lined). `--verbose`: full dump
 * (system prompt / config / tool inventory / per-message blocks).
 */
async function runDump(id: string, verbose: boolean): Promise<void> {
	const { session } = await openOrCreateSession(process.cwd(), "id", id);
	const messages = await loadAllMessages(session);
	const text = verbose
		? formatSessionDumpText({ messages })
		: formatSessionHistoryMarkdown(messages);
	process.stdout.write(`${text}\n`);
	process.exit(0);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (args.command === "setup") {
		await runSetup();
		return;
	}
	if (args.command === "sessions") {
		await runSessions(process.argv[3]);
		return;
	}
	if (args.command === "dump") {
		const id = process.argv[3];
		const verbose = process.argv.slice(4).includes("--verbose");
		if (!id) {
			emit(process.stderr, { type: "error", message: "dump needs a session id: `dump <id> [--verbose]`" });
			process.exit(2);
		}
		await runDump(id, verbose);
		return;
	}
	if (args.command !== "task") {
		emit(process.stderr, { type: "error", message: `unknown command: ${args.command || "(none)"}` });
		process.exit(2);
	}

	const raw = await readStdin();
	if (!raw.trim()) {
		emit(process.stderr, { type: "error", message: "no task on stdin: pipe a JSON task object to `task`" });
		process.exit(2);
	}

	let task: Task;
	try {
		task = JSON.parse(raw) as Task;
	} catch (err) {
		emit(process.stderr, { type: "error", message: `task on stdin is not valid JSON: ${(err as Error).message}` });
		process.exit(2);
	}
	if (typeof task.prompt !== "string" || !task.prompt.trim()) {
		emit(process.stderr, { type: "error", message: "task is missing a non-empty string 'prompt' field" });
		process.exit(2);
	}

	if (args.resumeMode === "id" && !args.resumeId) {
		emit(process.stderr, { type: "error", message: "--resume needs a session id: use `--resume <id>` or `--continue`" });
		process.exit(2);
	}

	try {
		const result = await runTurn(process.cwd(), {
			prompt: task.prompt,
			system: buildSystemPrompt(task),
			write: args.write,
			resumeMode: args.resumeMode,
			resumeId: args.resumeId,
			model: args.model,
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
