import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_BIN = path.join(TESTS_DIR, "fake-mimo-bin.mjs");
const COMPANION = path.join(TESTS_DIR, "..", "..", "scripts", "mimo-companion.mjs");

function killWorkspaceServers(dir) {
  // t.after hooks run in registration order; kill any server recorded under
  // the plugin data dir before the rmSync below deletes server.json.
  const stateRoot = path.join(dir, ".plugin-data", "state");
  if (!fs.existsSync(stateRoot)) {
    return;
  }
  for (const entry of fs.readdirSync(stateRoot)) {
    const serverFile = path.join(stateRoot, entry, "server.json");
    if (!fs.existsSync(serverFile)) {
      continue;
    }
    try {
      const { pid } = JSON.parse(fs.readFileSync(serverFile, "utf8"));
      if (Number.isFinite(pid)) {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          try {
            process.kill(pid, "SIGTERM");
          } catch {
            // Already gone.
          }
        }
      }
    } catch {
      // Malformed server.json; nothing to kill.
    }
  }
}

function makeGitWorkspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimo-runtime-test-"));
  t.after(() => {
    killWorkspaceServers(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
  return dir;
}

function makeFakeBinWrapper(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimo-fake-bin-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wrapper = path.join(dir, "mimo");
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_BIN}" "$@"\n`, { mode: 0o755 });
  return wrapper;
}

function runCompanion(args, { cwd, env = {}, input } = {}) {
  return spawnSync(process.execPath, [COMPANION, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    input,
    timeout: 30000
  });
}

function shutdownWorkspaceServer(cwd, env) {
  // SessionEnd with no refSessions registered -> always shuts down.
  const hook = path.join(TESTS_DIR, "..", "..", "scripts", "session-lifecycle-hook.mjs");
  spawnSync(process.execPath, [hook, "SessionEnd"], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    input: JSON.stringify({ cwd, session_id: "" })
  });
}

test("task runs end-to-end against the fake mimo server", (t) => {
  const cwd = makeGitWorkspace(t);
  const mimoBin = makeFakeBinWrapper(t);
  const env = {
    MIMO_COMPANION_BIN: mimoBin,
    CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data"),
    FAKE_MIMO_FINAL_TEXT: "task complete: nothing else to do"
  };
  t.after(() => shutdownWorkspaceServer(cwd, env));

  const result = runCompanion(["task", "--json", "say hi"], { cwd, env });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 0);
  assert.equal(payload.rawOutput, "task complete: nothing else to do");
  assert.ok(payload.mimoSessionID.startsWith("ses_fake"));
});

test("status reflects the completed task and result returns its output", (t) => {
  const cwd = makeGitWorkspace(t);
  const mimoBin = makeFakeBinWrapper(t);
  const env = {
    MIMO_COMPANION_BIN: mimoBin,
    CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data"),
    FAKE_MIMO_FINAL_TEXT: "the stored answer"
  };
  t.after(() => shutdownWorkspaceServer(cwd, env));

  const task = runCompanion(["task", "--json", "do a thing"], { cwd, env });
  assert.equal(task.status, 0, task.stderr);
  const jobless = JSON.parse(task.stdout);
  assert.equal(jobless.status, 0);

  const status = runCompanion(["status", "--json"], { cwd, env });
  assert.equal(status.status, 0, status.stderr);
  const report = JSON.parse(status.stdout);
  assert.ok(report.latestFinished, "expected a finished job");
  assert.equal(report.latestFinished.status, "completed");

  const result = runCompanion(["result", "--json"], { cwd, env });
  assert.equal(result.status, 0, result.stderr);
  const stored = JSON.parse(result.stdout);
  assert.equal(stored.storedJob.result.rawOutput, "the stored answer");
});

test("review parses structured output from the fake server", (t) => {
  const cwd = makeGitWorkspace(t);
  fs.writeFileSync(path.join(cwd, "newfile.ts"), "export const x = 1\n");
  const mimoBin = makeFakeBinWrapper(t);
  const structured = {
    verdict: "needs-attention",
    summary: "One issue found.",
    findings: [
      {
        severity: "high",
        title: "Bad thing",
        body: "Details.",
        file: "newfile.ts",
        line_start: 1,
        line_end: 1,
        confidence: 0.8,
        recommendation: "Fix it."
      }
    ],
    next_steps: ["Fix the bad thing."]
  };
  const env = {
    MIMO_COMPANION_BIN: mimoBin,
    CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data"),
    FAKE_MIMO_STRUCTURED: JSON.stringify(structured)
  };
  t.after(() => shutdownWorkspaceServer(cwd, env));

  const review = runCompanion(["review", "--json"], { cwd, env });
  assert.equal(review.status, 0, review.stderr);
  const payload = JSON.parse(review.stdout);
  assert.equal(payload.parseError, null);
  assert.equal(payload.result.verdict, "needs-attention");
  assert.equal(payload.result.findings.length, 1);

  const rendered = runCompanion(["result"], { cwd, env });
  assert.match(rendered.stdout, /Verdict: needs-attention/);
  assert.match(rendered.stdout, /\[high\] Bad thing \(newfile\.ts:1\)/);
});

test("setup reports ready with the fake binary and toggles the review gate", (t) => {
  const cwd = makeGitWorkspace(t);
  const mimoBin = makeFakeBinWrapper(t);
  const env = {
    MIMO_COMPANION_BIN: mimoBin,
    CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data")
  };
  t.after(() => shutdownWorkspaceServer(cwd, env));

  const setup = runCompanion(["setup", "--json", "--enable-review-gate"], { cwd, env });
  assert.equal(setup.status, 0, setup.stderr);
  const report = JSON.parse(setup.stdout);
  assert.equal(report.ready, true);
  assert.equal(report.reviewGateEnabled, true);

  const disable = runCompanion(["setup", "--json", "--disable-review-gate"], { cwd, env });
  const report2 = JSON.parse(disable.stdout);
  assert.equal(report2.reviewGateEnabled, false);
});

test("setup reports not ready when mimo is missing", (t) => {
  const cwd = makeGitWorkspace(t);
  const env = {
    MIMO_COMPANION_BIN: "/definitely/not/mimo",
    CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data")
  };

  const setup = runCompanion(["setup", "--json"], { cwd, env });
  assert.equal(setup.status, 0, setup.stderr);
  const report = JSON.parse(setup.stdout);
  assert.equal(report.ready, false);
  assert.ok(report.nextSteps.some((step) => step.includes("Install MiMo")));
});

test("background task completes via the detached worker", async (t) => {
  const cwd = makeGitWorkspace(t);
  const mimoBin = makeFakeBinWrapper(t);
  const env = {
    MIMO_COMPANION_BIN: mimoBin,
    CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data"),
    FAKE_MIMO_FINAL_TEXT: "background done"
  };
  t.after(() => shutdownWorkspaceServer(cwd, env));

  const launch = runCompanion(["task", "--background", "--json", "long thing"], { cwd, env });
  assert.equal(launch.status, 0, launch.stderr);
  const queued = JSON.parse(launch.stdout);
  assert.equal(queued.status, "queued");

  const deadline = Date.now() + 25000;
  let finished = null;
  while (Date.now() < deadline) {
    const status = runCompanion(["status", queued.jobId, "--json"], { cwd, env });
    const snapshot = JSON.parse(status.stdout);
    if (snapshot.job.status === "completed" || snapshot.job.status === "failed") {
      finished = snapshot.job;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  assert.ok(finished, "background job did not finish in time");
  assert.equal(finished.status, "completed");

  const result = runCompanion(["result", queued.jobId, "--json"], { cwd, env });
  const stored = JSON.parse(result.stdout);
  assert.equal(stored.storedJob.result.rawOutput, "background done");
});

test("stop-review-gate hook fails open when the gate is disabled", (t) => {
  const cwd = makeGitWorkspace(t);
  const env = { CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data") };
  const hook = path.join(TESTS_DIR, "..", "..", "scripts", "stop-review-gate-hook.mjs");

  const result = spawnSync(process.execPath, [hook], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    input: JSON.stringify({ cwd, session_id: "s1" })
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "");
});

test("stop-review-gate hook fails open when mimo is missing even with the gate enabled", (t) => {
  const cwd = makeGitWorkspace(t);
  const env = {
    CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data"),
    MIMO_COMPANION_BIN: "/definitely/not/mimo"
  };

  const enable = runCompanion(["setup", "--json", "--enable-review-gate"], { cwd, env });
  assert.equal(enable.status, 0, enable.stderr);

  const hook = path.join(TESTS_DIR, "..", "..", "scripts", "stop-review-gate-hook.mjs");
  const result = spawnSync(process.execPath, [hook], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    input: JSON.stringify({ cwd, session_id: "s1" })
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "", "gate must not emit a block decision when mimo is unavailable");
  assert.match(result.stderr, /not set up/);
});

test("stop-review-gate hook blocks when the review answers BLOCK", (t) => {
  const cwd = makeGitWorkspace(t);
  const mimoBin = makeFakeBinWrapper(t);
  const env = {
    MIMO_COMPANION_BIN: mimoBin,
    CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data"),
    FAKE_MIMO_FINAL_TEXT: "BLOCK: the change is broken"
  };
  t.after(() => shutdownWorkspaceServer(cwd, env));

  const enable = runCompanion(["setup", "--json", "--enable-review-gate"], { cwd, env });
  assert.equal(enable.status, 0, enable.stderr);

  const hook = path.join(TESTS_DIR, "..", "..", "scripts", "stop-review-gate-hook.mjs");
  const result = spawnSync(process.execPath, [hook], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    input: JSON.stringify({ cwd, session_id: "s1", last_assistant_message: "I edited code." }),
    timeout: 30000
  });

  assert.equal(result.status, 0);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.decision, "block");
  assert.match(decision.reason, /the change is broken/);
});

test("stop-review-gate hook allows when the review answers ALLOW", (t) => {
  const cwd = makeGitWorkspace(t);
  const mimoBin = makeFakeBinWrapper(t);
  const env = {
    MIMO_COMPANION_BIN: mimoBin,
    CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data"),
    FAKE_MIMO_FINAL_TEXT: "ALLOW: no code changes in the previous turn"
  };
  t.after(() => shutdownWorkspaceServer(cwd, env));

  const enable = runCompanion(["setup", "--json", "--enable-review-gate"], { cwd, env });
  assert.equal(enable.status, 0, enable.stderr);

  const hook = path.join(TESTS_DIR, "..", "..", "scripts", "stop-review-gate-hook.mjs");
  const result = spawnSync(process.execPath, [hook], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    input: JSON.stringify({ cwd, session_id: "s1" }),
    timeout: 30000
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "");
});

test("cancel marks a running background job cancelled", async (t) => {
  const cwd = makeGitWorkspace(t);
  const mimoBin = makeFakeBinWrapper(t);
  const env = {
    MIMO_COMPANION_BIN: mimoBin,
    CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data"),
    // No delay knob through the bin wrapper; cancel immediately after queueing
    FAKE_MIMO_FINAL_TEXT: "should be cancelled"
  };
  t.after(() => shutdownWorkspaceServer(cwd, env));

  const launch = runCompanion(["task", "--background", "--json", "cancel me"], { cwd, env });
  assert.equal(launch.status, 0, launch.stderr);
  const queued = JSON.parse(launch.stdout);

  const cancel = runCompanion(["cancel", queued.jobId, "--json"], { cwd, env });
  // The job may have already completed if the worker was fast; both are
  // acceptable terminal outcomes, but cancel must not crash.
  if (cancel.status === 0) {
    const payload = JSON.parse(cancel.stdout);
    assert.equal(payload.status, "cancelled");
  } else {
    assert.match(cancel.stderr, /No active|still/);
  }
});
