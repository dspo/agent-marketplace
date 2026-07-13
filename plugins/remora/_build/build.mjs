#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const ROOT = dirname(fileURLToPath(import.meta.url));

// Build identity stamped into the bundle so a stale cached bundle can be
// detected: `remora.mjs version` prints this, and `setup` surfaces it. `rev`
// falls back to "unknown" when built outside a git checkout (e.g. a tarball).
function buildIdentity() {
	let rev = "unknown";
	try {
		rev = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		// not in a git checkout — leave "unknown"
	}
	const version = JSON.parse(readFileSync(join(ROOT, "..", "plugin.json"), "utf8")).version ?? "unknown";
	return { rev, date: new Date().toISOString(), version };
}

const REMORA_BUILD = buildIdentity();

// ESM output needs `require`/`__dirname` defined for transitive deps that call
// `require("process")` etc. — without this the bundle throws "Dynamic require
// of X is not supported" at runtime. `REMORA_BUILD` is the stamped identity.
const banner = [
	"import { createRequire as __cr } from 'node:module';",
	"import { fileURLToPath as __f } from 'node:url';",
	"import { dirname as __d } from 'node:path';",
	"const require = __cr(import.meta.url);",
	"const __filename = __f(import.meta.url);",
	"const __dirname = __d(__filename);",
	`const REMORA_BUILD = ${JSON.stringify(REMORA_BUILD)};`,
].join("\n");

await esbuild.build({
	entryPoints: [join(ROOT, "src/cli.ts")],
	outfile: join(ROOT, "../scripts/remora.mjs"),
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	minify: true,
	banner: { js: banner },
	external: ["node:*"],
	logLevel: "info",
});
