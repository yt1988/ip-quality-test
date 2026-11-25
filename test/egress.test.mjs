import test from "node:test";
import assert from "node:assert/strict";
import { VERSION, endpoints, groupExits, readAnchors } from "../src/egress.js";

test("the vendored egress component is the contract's version", () => {
  assert.equal(VERSION, "7");
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

test("readAnchors: no injected meta means no anchors, so a self-hosted page asks nothing", () => {
  assert.deepEqual(readAnchors({ querySelector: () => null }), { cn: "", intl: "" });
});

test("readAnchors: the Worker's ms-anchors meta is read as two base URLs", () => {
  const doc = {
    querySelector: sel => sel === 'meta[name="ms-anchors"]'
      ? { getAttribute: () => "cn=https://cn.example;intl=https://intl.example" }
      : null,
  };
  assert.deepEqual(readAnchors(doc), { cn: "https://cn.example", intl: "https://intl.example" });
});

test("endpoints: ms-servers without dns is empty, so the DNS-leak cell is unavailable", () => {
  assert.deepEqual(endpoints("ms-servers", { querySelector: () => null }), {});
  const doc = { querySelector: sel => sel === 'meta[name="ms-servers"]'
    ? { getAttribute: () => "reach=https://reach.example;dns=https://dns.example:2053" }
    : null };
  assert.equal(endpoints("ms-servers", doc).dns, "https://dns.example:2053");
});
