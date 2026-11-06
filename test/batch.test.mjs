import { test } from "node:test";
import assert from "node:assert/strict";
import { parseList, rowOf, packRows, unpackRows, sortRows, MAX } from "../src/batch.mjs";

test("parseList: splits on any separator, drops ports, private and repeated addresses, caps at MAX", () => {
  const r = parseList("8.8.8.8, 1.1.1.1:443\n[2001:4860:4860::8888]:53；10.0.0.1 8.8.8.8 nope 192.168.1.1、9.9.9.9");
  assert.deepEqual(r.ips, ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "9.9.9.9"]);
  assert.equal(r.skipped, 4);
  assert.equal(r.over, 0);
  const many = parseList(Array.from({ length: MAX + 5 }, (_, i) => `8.8.${i}.1`).join("\n"));
  assert.equal(many.ips.length, MAX);
  assert.equal(many.over, 5);
  assert.deepEqual(parseList("  ").ips, []);
});

const done = {
  t: "done", score: 62, grade: "C",
  summary: { cc: "JP", type: "hosting", native: false, regCc: "US", torListed: false,
    flags: { tor: { yes: 0, of: 3 }, vpn: { yes: 2, of: 5 }, proxy: { yes: 1, of: 5 } } },
  uses: { ai: { lv: "warn", why: "u_ai_dc" }, stream: { lv: "bad", why: "u_stream_vpn" } },
};

test("rowOf: reads the done event", () => {
  assert.deepEqual(rowOf(done), { score: 62, grade: "C", cc: "JP", type: "hosting", native: false, regCc: "US", anon: ["vpn", "proxy"],
    ai: "warn", aiWhy: "u_ai_dc", stream: "bad", streamWhy: "u_stream_vpn" });
  assert.deepEqual(rowOf({ score: 100, grade: "A" }).anon, []);
});

test("packRows / unpackRows: round trip, with and without the addresses", () => {
  const rows = [{ i: 0, ip: "8.8.8.8", st: "ok", r: rowOf(done) }, { i: 1, ip: "1.1.1.1", st: "err", r: null }];
  const a = unpackRows(packRows(rows, { at: "2026-11-06T00:00:00.000Z" }));
  assert.equal(a.rows.length, 1);
  assert.equal(a.rows[0].ip, null);
  assert.deepEqual(a.rows[0].r, rowOf(done));
  assert.equal(a.at, "2026-11-06T00:00:00.000Z");
  const b = unpackRows(packRows(rows, { withIp: true }));
  assert.equal(b.rows[0].ip, "8.8.8.8");
  // anything that isn't a payload of ours is refused
  for (const bad of ["", "x", "eyJ2IjoyfQ", "eyJ2IjoxLCJSIjpbWzEwMV1dfQ"]) assert.equal(unpackRows(bad), null);
});

test("sortRows: by score high first, unknown last, ties by place", () => {
  const mk = (i, score) => ({ i, ip: "8.8.8." + i, st: score == null ? "err" : "ok", r: score == null ? null : { ...rowOf(done), score } });
  const rows = [mk(0, 40), mk(1, null), mk(2, 90), mk(3, 40)];
  assert.deepEqual(sortRows(rows, "score", -1).map(r => r.i), [2, 0, 3, 1]);
  assert.deepEqual(sortRows(rows, "score", 1).map(r => r.i), [0, 3, 2, 1]);
  assert.deepEqual(sortRows(rows, "i", -1).map(r => r.i), [3, 2, 1, 0]);
});

import { readBeacon, PROBE } from "../src/probe.mjs";
test("readBeacon: known sources, 0 or 1, a time; anything else is dropped", () => {
  assert.deepEqual(readBeacon(JSON.stringify({ r: [["geojs", 1, 120.4], ["doh", 0, 99999]] })), [{ id: "geojs", ok: true, ms: 120 }, { id: "doh", ok: false, ms: 30000 }]);
  for (const bad of ["x", "{}", JSON.stringify({ r: [["evil", 1, 1]] }), JSON.stringify({ r: [["geojs", 2, 1]] }), JSON.stringify({ r: Array(PROBE.length + 1).fill(["geojs", 1, 1]) })])
    assert.equal(readBeacon(bad), null);
});

import { parseList as parse2, v6net } from "../src/batch.mjs";
test("parseList: a /24 (or longer) becomes the portrait, wider ones are refused, IPv6 prefixes one row each", () => {
  const r = parse2("95.216.1.0/24 95.216.1.128/25 8.8.8.0/24 1.0.0.0/16 2400:cb00:2049:1::/64 2400:cb00:2049:1::5/64 1.1.1.1/32 10.0.0.0/24");
  assert.equal(r.seg, "95.216.1.0");
  assert.equal(r.segMore, 1);
  assert.deepEqual(r.big, ["1.0.0.0/16"]);
  assert.deepEqual(r.items, [{ ip: "2400:cb00:2049:1::1", net: "2400:cb00:2049:1::/64" }, { ip: "1.1.1.1" }]);
  assert.equal(r.skipped, 2);   // the repeated prefix, the private /24
});
test("v6net: masks to the prefix, the first host stands for it", () => {
  assert.deepEqual(v6net("2001:4860:4860::8888", 48), { net: "2001:4860:4860::/48", ip: "2001:4860:4860::1" });
  assert.deepEqual(v6net("2001:4860:4861:ffff::1", 47), { net: "2001:4860:4860::/47", ip: "2001:4860:4860::1" });
});
