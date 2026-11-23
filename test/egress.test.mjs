import test from "node:test";
import assert from "node:assert/strict";
import { VERSION, groupExits } from "../src/egress.js";

test("the vendored egress component is the contract's version", () => {
  assert.equal(VERSION, "5");
});

test("groupExits: addresses without an ASN group by /16, and keep every probe that saw them", () => {
  const exits = groupExits([
    { id: "ipip", group: "cn", ip: "1.2.3.4" },
    { id: "radar4", group: "web", ip: "1.2.9.9" },
    { id: "claude", group: "ai", ip: "5.6.7.8" },
  ]);
  assert.equal(exits.length, 2);
  assert.equal(exits[0].key, "1.2./16");
  assert.deepEqual([...exits[0].seenBy].sort(), ["ipip", "radar4"]);
  assert.equal(exits[0].ip, "1.2.3.4");
  assert.equal(exits[1].ip, "5.6.7.8");
});
