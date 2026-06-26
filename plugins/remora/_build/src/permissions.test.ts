import assert from "node:assert/strict";
import { homedir } from "node:os";
import { sep } from "node:path";
import { describe, it } from "node:test";

import { escapesRoot } from "./permissions.ts";

describe("escapesRoot", () => {
	const root = `${sep}home${sep}user${sep}project`;

	it("blocks parent traversal", () => assert.equal(escapesRoot("../../etc/passwd", root), true));
	it("blocks absolute path outside root", () => assert.equal(escapesRoot(`${sep}etc${sep}passwd`, root), true));
	it("blocks a sibling sharing a name prefix", () => assert.equal(escapesRoot("../project-evil", root), true));
	it("allows a normal relative path", () => assert.equal(escapesRoot("src/x.ts", root), false));
	it("allows a nested relative path", () => assert.equal(escapesRoot("a/b/c.ts", root), false));
	it("allows the root itself", () => assert.equal(escapesRoot(".", root), false));

	// Tilde expansion — pi's resolveToCwd expands `~` to homedir; the gate must
	// mirror that or `~`-prefixed paths slip past a lexical prefix check.
	it("blocks ~ (homedir is outside a non-home root)", () => assert.equal(escapesRoot("~", root), true));
	it("blocks ~/.ssh/id_rsa", () => assert.equal(escapesRoot("~/.ssh/id_rsa", root), true));
	it("blocks ~/foo (expanded to homedir, outside root)", () => assert.equal(escapesRoot("~/foo", root), true));
	it("allows a ~ path that legitimately resolves inside root", () => {
		// root IS under homedir; ~/project/... must be allowed.
		const home = homedir();
		const rootUnderHome = `${home}${sep}project`;
		assert.equal(escapesRoot("~/project/src/x.ts", rootUnderHome), false);
		assert.equal(escapesRoot("~/outside", rootUnderHome), true);
	});
});
