#!/usr/bin/env node
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const pluginEntryPoints = [
  "src/mimo-companion.ts",
  "src/session-lifecycle-hook.ts",
  "src/stop-review-gate-hook.ts"
];

// Each lib module is bundled standalone for the test suite. Duplicated code
// between bundles is fine: all shared state lives on disk, not in modules.
const testLibEntryPoints = [
  "src/lib/args.ts",
  "src/lib/state.ts",
  "src/lib/server-lifecycle.ts",
  "src/lib/mimo-client.ts",
  "src/lib/mimo-runtime.ts",
  "src/lib/git.ts",
  "src/lib/render.ts",
  "src/lib/job-control.ts",
  "src/lib/tracked-jobs.ts",
  "src/lib/process.ts"
];

const shared = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  outExtension: { ".js": ".mjs" },
  logLevel: "info"
};

// No banner: the entry sources already carry a shebang, which esbuild keeps.
await esbuild.build({
  ...shared,
  entryPoints: pluginEntryPoints.map((entry) => path.join(ROOT, entry)),
  outdir: path.join(ROOT, "..", "scripts")
});

await esbuild.build({
  ...shared,
  entryPoints: testLibEntryPoints.map((entry) => path.join(ROOT, entry)),
  outdir: path.join(ROOT, "tests", ".build"),
  logLevel: "silent"
});
