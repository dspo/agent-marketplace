#!/usr/bin/env node
// Fake `mimo` binary for tests. Supports:
//   fake-mimo-bin.mjs --version          -> prints a version
//   fake-mimo-bin.mjs serve --port 0 ... -> starts a fake REST server and
//                                           prints the real listening line
import { startFakeMiMoServer } from "./fake-mimo-fixture.mjs";

const [command] = process.argv.slice(2);

if (command === "--version") {
  console.log("fake-mimo 0.0.1");
  process.exit(0);
}

if (command === "serve") {
  const fake = await startFakeMiMoServer({
    finalText: process.env.FAKE_MIMO_FINAL_TEXT ?? "fake final answer",
    structured: process.env.FAKE_MIMO_STRUCTURED ? JSON.parse(process.env.FAKE_MIMO_STRUCTURED) : undefined
  });
  console.log(`mimocode server listening on http://127.0.0.1:${fake.port}`);
  // Keep running until killed, like the real `mimo serve`.
  await new Promise(() => {});
}

console.error(`fake-mimo: unknown command ${command}`);
process.exit(1);
