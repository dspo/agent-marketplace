import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMiMoClient,
  createSession,
  extractFinalText,
  getSession,
  parseStructuredResult,
  sendPrompt,
  subscribeEvents,
  MiMoHttpError,
  READ_ONLY_RULESET
} from "./.build/mimo-client.mjs";
import { startFakeMiMoServer } from "./fake-mimo-fixture.mjs";

test("createSession sends directory header and permission ruleset", async (t) => {
  const fake = await startFakeMiMoServer();
  t.after(() => fake.close());

  const client = createMiMoClient(fake.baseUrl, "/tmp/example-project");
  const session = await createSession(client, { title: "Test Session", permission: READ_ONLY_RULESET });

  assert.ok(session.id.startsWith("ses_fake"));
  const stored = fake.sessions.get(session.id);
  assert.equal(stored.directory, "/tmp/example-project");
  assert.equal(stored.title, "Test Session");
  assert.deepEqual(stored.permission, READ_ONLY_RULESET);
});

test("sendPrompt returns parsed prompt result with final text", async (t) => {
  const fake = await startFakeMiMoServer({ finalText: "hello from mimo" });
  t.after(() => fake.close());

  const client = createMiMoClient(fake.baseUrl, "/tmp/p");
  const session = await createSession(client, {});
  const result = await sendPrompt(client, session.id, { prompt: "do something" });

  assert.equal(extractFinalText(result), "hello from mimo");
  assert.equal(fake.prompts.length, 1);
  assert.equal(fake.prompts[0].body.parts[0].text, "do something");
  assert.equal(fake.prompts[0].directory, "/tmp/p");
});

test("sendPrompt passes json_schema format and surfaces structured output", async (t) => {
  const structured = { verdict: "approve", summary: "ok", findings: [], next_steps: [] };
  const fake = await startFakeMiMoServer({ structured });
  t.after(() => fake.close());

  const client = createMiMoClient(fake.baseUrl, "/tmp/p");
  const session = await createSession(client, {});
  const result = await sendPrompt(client, session.id, {
    prompt: "review this",
    format: { type: "json_schema", schema: { type: "object" }, retryCount: 2 }
  });

  const parsed = parseStructuredResult(result);
  assert.equal(parsed.parseError, null);
  assert.deepEqual(parsed.parsed, structured);
});

test("sendPrompt surfaces 409 busy as a dedicated error", async (t) => {
  const fake = await startFakeMiMoServer();
  t.after(() => fake.close());

  const client = createMiMoClient(fake.baseUrl, "/tmp/p");
  const session = await createSession(client, {});
  fake.behavior.busySessions.add(session.id);

  await assert.rejects(
    () => sendPrompt(client, session.id, { prompt: "x" }),
    (error) => error instanceof MiMoHttpError && error.status === 409
  );
});

test("getSession returns null for unknown sessions", async (t) => {
  const fake = await startFakeMiMoServer();
  t.after(() => fake.close());

  const client = createMiMoClient(fake.baseUrl, "/tmp/p");
  assert.equal(await getSession(client, "ses_doesnotexist"), null);
});

test("parseStructuredResult falls back to text JSON, fenced JSON, then errors", () => {
  const base = { info: { id: "m1" }, parts: [] };

  const direct = parseStructuredResult({ ...base, parts: [{ type: "text", text: '{"verdict":"approve"}' }] });
  assert.equal(direct.parseError, null);
  assert.deepEqual(direct.parsed, { verdict: "approve" });

  const fenced = parseStructuredResult({
    ...base,
    parts: [{ type: "text", text: 'Here you go:\n```json\n{"verdict":"approve"}\n```' }]
  });
  assert.equal(fenced.parseError, null);
  assert.deepEqual(fenced.parsed, { verdict: "approve" });

  const invalid = parseStructuredResult({ ...base, parts: [{ type: "text", text: "not json at all" }] });
  assert.equal(invalid.parsed, null);
  assert.ok(invalid.parseError);

  const empty = parseStructuredResult(base, "fallback message");
  assert.equal(empty.parsed, null);
  assert.equal(empty.parseError, "fallback message");
});

test("subscribeEvents receives session events and stops on close", async (t) => {
  const fake = await startFakeMiMoServer();
  t.after(() => fake.close());

  const client = createMiMoClient(fake.baseUrl, "/tmp/p");
  const received = [];
  const connected = new Promise((resolve) => {
    const subscription = subscribeEvents(client, (event) => {
      received.push(event);
      if (event.type === "server.connected") {
        resolve(subscription);
      }
    });
  });

  const subscription = await connected;
  fake.emitEvent({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  subscription.close();

  assert.ok(received.some((event) => event.type === "session.status"));
});
