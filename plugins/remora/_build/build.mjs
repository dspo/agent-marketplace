#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const ROOT = dirname(fileURLToPath(import.meta.url));

// ESM output needs `require`/`__dirname` defined for transitive deps that call
// `require("process")` etc. — without this the bundle throws "Dynamic require
// of X is not supported" at runtime.
const banner = [
	"import { createRequire as __cr } from 'node:module';",
	"import { fileURLToPath as __f } from 'node:url';",
	"import { dirname as __d } from 'node:path';",
	"const require = __cr(import.meta.url);",
	"const __filename = __f(import.meta.url);",
	"const __dirname = __d(__filename);",
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
