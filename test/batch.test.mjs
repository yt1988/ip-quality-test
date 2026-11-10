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

test("a capped grade (a blocklist ceiling) survives the shared link", () => {
  const row = { i: 0, ip: "8.8.8.8", st: "ok", r: { ...rowOf(done), score: 88, grade: "C" } };
  const back = unpackRows(packRows([row], { at: "2026-11-06T00:00:00.000Z" }));
  assert.equal(back.rows[0].r.grade, "C");
  assert.equal(back.rows[0].r.score, 88);
});

test("format 1 batch links (shared before grades travelled) still open, their grade from the score", () => {
  // v1 rows had no grade: [score, cc, type, native, regCc, anon, ai, stream, aiWhy, streamWhy, ip?, net?]
  const v1 = Buffer.from(JSON.stringify({ v: 1, at: "2026-11-06T00:00:00.000Z", R: [[91, "US", -1, -1, "", 1, -1, -1, "", "", "8.8.8.8", ""]] })).toString("base64url");
  const p = unpackRows(v1);
  assert.equal(p.rows[0].ip, "8.8.8.8");
  assert.equal(p.rows[0].r.grade, "A");
});

test("sortRows: by score high first, unknown last, ties by place", () => {
  const mk = (i, score) => ({ i, ip: "8.8.8." + i, st: score == null ? "err" : "ok", r: score == null ? null : { ...rowOf(done), score } });
  const rows = [mk(0, 40), mk(1, null), mk(2, 90), mk(3, 40)];
  assert.deepEqual(sortRows(rows, "score", -1).map(r => r.i), [2, 0, 3, 1]);
  assert.deepEqual(sortRows(rows, "score", 1).map(r => r.i), [0, 3, 2, 1]);
  assert.deepEqual(sortRows(rows, "i", -1).map(r => r.i), [3, 2, 1, 0]);
});

import { parseList as parse2, v6net, v4segs, rangeLabel, inRange } from "../src/batch.mjs";
test("parseList: /24s (longer prefixes as their /24, a /23 or /22 as two or four) up to SEGS, wider ones refused, IPv6 prefixes one row each", () => {
  const r = parse2("95.216.1.0/24 95.216.1.128/25 8.8.8.0/24 1.0.0.0/16 2400:cb00:2049:1::/64 2400:cb00:2049:1::5/64 1.1.1.1/32 10.0.0.0/24 4.2.2.0/23 9.9.9.0/24");
  assert.deepEqual(r.segs.map(rangeLabel), ["95.216.1.0/24", "8.8.8.0/24", "4.2.2.0/24", "4.2.3.0/24"]);
  assert.deepEqual(r.segMore, ["9.9.9.0/24"]);
  assert.deepEqual(r.big, ["1.0.0.0/16"]);
  assert.deepEqual(r.items, [{ ip: "2400:cb00:2049:1::1", net: "2400:cb00:2049:1::/64" }, { ip: "1.1.1.1" }]);
  // a /25 inside a /24 already there is a repeat
  assert.deepEqual(r.skip.dup, ["95.216.1.128/25", "2400:cb00:2049:1::5/64"]);
  assert.deepEqual(r.skip.priv, ["10.0.0.0/24"]);
});
test("parseList: a range narrower than a /24 is its own addresses, aligned", () => {
  const r = parse2("4.2.2.1/28 4.2.2.20/28 4.2.2.1/28");
  assert.deepEqual(r.segs, [{ base: "4.2.2.0", lo: 0, bits: 28, n: 16 }, { base: "4.2.2.0", lo: 16, bits: 28, n: 16 }]);
  assert.deepEqual(r.skip.dup, ["4.2.2.1/28"]);
  assert.equal(inRange(r.segs[1], 31), true);
  assert.equal(inRange(r.segs[1], 32), false);
});
test("v4segs: the /24s a prefix covers", () => {
  assert.deepEqual(v4segs("1.2.3.77", 26), ["1.2.3.0"]);
  assert.deepEqual(v4segs("1.2.5.9", 22), ["1.2.4.0", "1.2.5.0", "1.2.6.0", "1.2.7.0"]);
  assert.deepEqual(v4segs("1.2.255.0", 23), ["1.2.254.0", "1.2.255.0"]);
  assert.equal(v4segs("1.2.0.0", 21), null);
});
test("v6net: masks to the prefix, the first host stands for it", () => {
  assert.deepEqual(v6net("2001:4860:4860::8888", 48), { net: "2001:4860:4860::/48", ip: "2001:4860:4860::1" });
  assert.deepEqual(v6net("2001:4860:4861:ffff::1", 47), { net: "2001:4860:4860::/47", ip: "2001:4860:4860::1" });
});

test("parseList: says which entries were left out and why", () => {
  const r = parse2("2001:db8::/48 10.0.0.1 8.8.8.8 8.8.8.8 nope 192.168.1.0/24");
  assert.deepEqual(r.skip, { priv: ["2001:db8::/48", "10.0.0.1", "192.168.1.0/24"], dup: ["8.8.8.8"], bad: ["nope"] });
  assert.equal(r.skipped, 5);
});

import { packSeg, unpackSeg } from "../src/batch.mjs";
test("the /24 in a shared link: run-length coded colours, the range only with the addresses", () => {
  const sts = Array(256).fill("ok"); sts[20] = "proxy"; sts[21] = "proxy"; sts[200] = "bad";
  assert.deepEqual(unpackSeg(packSeg(sts)), sts);
  assert.equal(packSeg(sts).length, 5);
  const rows = [{ i: 0, ip: "8.8.8.8", st: "ok", r: rowOf(done) }];
  const S = [{ base: "95.216.1.0", lo: 0, bits: 24, sts, kind: "hosting", prefix: { prefix: "95.216.0.0/16", asns: [24940] } }, { base: "8.8.8.0", lo: 16, bits: 28, sts, kind: "unknown", prefix: null }];
  const a = unpackRows(packRows(rows, { segs: S }));
  assert.deepEqual(a.segs[0], { base: null, sts, kind: "hosting", prefix: null, lo: 0, bits: 24, n: 256 });
  assert.deepEqual([a.segs[1].lo, a.segs[1].bits, a.segs[1].n], [16, 28, 16]);
  assert.equal(a.segs.length, 2);
  const b = unpackRows(packRows(rows, { withIp: true, segs: S }));
  assert.deepEqual([b.segs[0].base, b.segs[0].prefix], ["95.216.1.0", { prefix: "95.216.0.0/16", asns: [24940] }]);
  assert.equal(unpackRows(packRows([], { segs: S })).rows.length, 0);
  assert.equal(unpackSeg([[4, 255]]), null);
});
