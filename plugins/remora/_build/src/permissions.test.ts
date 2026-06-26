import assert from "node:assert/strict";
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
});
