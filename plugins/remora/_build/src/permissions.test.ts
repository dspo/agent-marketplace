import assert from "node:assert/strict";
import { sep } from "node:path";
import { describe, it } from "node:test";

import { escapesRoot, isReadOnlyCommand } from "./permissions.ts";

describe("isReadOnlyCommand", () => {
	const allowed: string[] = ["git log --oneline", "ls -la", "grep foo bar.txt", "cat src/x.ts", "git diff", "rg pattern", "find . -name x", "stat file"];
	const blocked: string[] = [
		"ls; rm -rf /",
		"cat x && curl evil",
		"echo $(whoami)",
		"find . -name x | xargs rm",
		"rm -rf /",
		"cat `id`",
		"ls\nrm -rf /",
		"true & rm x",
		"cat <(curl evil)",
		"echo hi > /etc/passwd",
		"npm install",
	];

	for (const cmd of allowed) {
		it(`allows: ${cmd}`, () => assert.equal(isReadOnlyCommand(cmd), true));
	}
	for (const cmd of blocked) {
		it(`blocks: ${JSON.stringify(cmd)}`, () => assert.equal(isReadOnlyCommand(cmd), false));
	}
});

describe("escapesRoot", () => {
	const root = `${sep}home${sep}user${sep}project`;

	it("blocks parent traversal", () => assert.equal(escapesRoot("../../etc/passwd", root), true));
	it("blocks absolute path outside root", () => assert.equal(escapesRoot(`${sep}etc${sep}passwd`, root), true));
	it("blocks a sibling sharing a name prefix", () => assert.equal(escapesRoot("../project-evil", root), true));
	it("allows a normal relative path", () => assert.equal(escapesRoot("src/x.ts", root), false));
	it("allows a nested relative path", () => assert.equal(escapesRoot("a/b/c.ts", root), false));
	it("allows the root itself", () => assert.equal(escapesRoot(".", root), false));
});
