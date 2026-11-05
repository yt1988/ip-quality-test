// The /24 portrait: what the server's answer reads as (shapes as the live server gives them, 2026-11-05).
import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf, readSeg, statusOf, addrLines, F } from "../src/seg.mjs";

const lists = (o = {}) => ({ proxy: 0, bad: 0, badMax: 0, tor: 0, vpn: 0, dc: 256, drop: 0, at: "2026-11-05T08:29:08Z", ...o });
const names = Array.from({ length: 256 }, (_, i) => i < 254 ? `static.${i}.1.216.95.clients.your-server.de` : "");
const flags = Array(256).fill(F.dc), score = Array(256).fill(0);
flags[7] |= F.proxy; flags[9] |= F.bad; score[9] = 4; flags[12] |= F.drop | F.proxy; flags[30] |= F.tor; flags[40] |= F.vpn;
const hetzner = {
  seg: "95.216.1.0/24",
  rdns: { asked: 256, answered: 255, dead: false, named: 254, kinds: { hosting: 207, mail: 7, other: 40 }, domains: [{ d: "your-server.de", n: 203 }], samples: [] },
  prefix: { prefix: "95.216.0.0/16", asns: [24940] }, lists: lists({ proxy: 2, bad: 1, badMax: 4, tor: 1, vpn: 1, drop: 1 }),
  names, kinds: "h".repeat(254) + "--", flags, score,
};

test("kindOf: the largest kind over half the names; the data-centre list when names are few", () => {
  assert.deepEqual(kindOf(hetzner.rdns, 256), { kind: "hosting", n: 207 });
  assert.equal(kindOf({ named: 200, kinds: { dynamic: 150, other: 50 } }, 0).kind, "dynamic");
  assert.equal(kindOf({ named: 100, kinds: { dynamic: 40, hosting: 30, other: 30 } }, 0).kind, "mixed");
  assert.equal(kindOf({ named: 0, kinds: {} }, 256).byList, true);
  assert.equal(kindOf({ named: 3, kinds: { other: 3 } }, 0).kind, "unknown");
});

test("statusOf: the worst listing wins; a name tells in use from idle", () => {
  assert.equal(statusOf(F.proxy | F.drop, true), "bad");
  assert.equal(statusOf(F.tor | F.vpn, true), "tor");
  assert.equal(statusOf(F.dc, true), "ok");
  assert.equal(statusOf(F.dc, false), "idle");
});

test("readSeg: one cell per address, counted by status, the checked one marked", () => {
  const r = readSeg(hetzner, "hosting", "95.216.1.9");
  assert.equal(r.cells.length, 256);
  assert.equal(r.cells[9].me, true); assert.equal(r.cells[9].st, "bad"); assert.equal(r.cells[9].score, 4);
  assert.equal(r.cells[12].st, "bad"); assert.equal(r.cells[7].st, "proxy"); assert.equal(r.cells[30].st, "tor"); assert.equal(r.cells[40].st, "vpn");
  assert.deepEqual(r.count, { bad: 2, proxy: 1, tor: 1, vpn: 1, ok: 249, idle: 2 });
  assert.equal(Object.values(r.count).reduce((a, b) => a + b), 256);
  assert.equal(r.cells[0].kind, "hosting"); assert.equal(r.cells[255].kind, "");
  assert.deepEqual(addrLines(r.cells[12]).map(([k]) => k), ["sg_a_drop", "sg_a_px"]);
  assert.deepEqual(addrLines(r.cells[0]).map(([k]) => k), ["sg_a_clean"]);
});

test("readSeg: the summary says the kind, the names, the prefix; a home IP in a hosting /24 is flagged", () => {
  const r = readSeg(hetzner, "hosting", "95.216.1.2");
  assert.equal(r.kind.kind, "hosting"); assert.equal(r.kind.lv, "warn"); assert.equal(r.vs, null);
  assert.deepEqual(r.sum.map(([k]) => k), ["sg_kw_hosting"]);
  assert.deepEqual(r.prefix, { prefix: "95.216.0.0/16", asns: [24940] }); assert.equal(r.domains[0].d, "your-server.de");
  const home = readSeg(hetzner, "residential", "95.216.1.2");
  assert.equal(home.kind.lv, "bad"); assert.equal(home.vs[0], "sg_kw_vs");
});

test("readSeg: dead reverse servers, a partial sweep, no prefix, a list never fetched", () => {
  const dead = readSeg({ ...hetzner, rdns: { asked: 256, answered: 32, dead: true, named: 0, kinds: {}, domains: [] }, names: [] }, "residential", "73.1.2.3");
  assert.ok(dead.sum.some(([k]) => k === "sg_rw_dead")); assert.ok(!dead.sum.some(([k]) => k === "sg_rw_part"));
  const part = readSeg({ ...hetzner, rdns: { ...hetzner.rdns, answered: 114 } }, "hosting", "");
  assert.ok(part.sum.some(([k, p]) => k === "sg_rw_part" && p.n === 114));
  assert.deepEqual(readSeg({ ...hetzner, prefix: { prefix: "", asns: [] } }, "hosting", "").prefix, { none: true });
  assert.equal(readSeg({ ...hetzner, prefix: null }, "hosting", "").prefix, null);
  assert.deepEqual(dead.domains, []);
  assert.equal(readSeg({ ...hetzner, lists: lists({ proxy: null }) }, "hosting", "").lists.proxy, false);
});
