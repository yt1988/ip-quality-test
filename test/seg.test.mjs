// The /24 portrait: what the server's answer reads as (answers as the local server gave them, 2026-11-05).
import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf, readSeg } from "../src/seg.mjs";

const lists = (o = {}) => ({ proxy: 0, bad: 0, badMax: 0, tor: 0, vpn: 0, dc: 0, drop: 0, at: "2026-11-05T08:15:19Z", ...o });
const hetzner = {
  seg: "95.216.1.0/24",
  rdns: { asked: 256, answered: 255, named: 255, kinds: { anon: 2, hosting: 208, mail: 7, other: 38 }, domains: [{ d: "your-server.de", n: 204 }], samples: ["static.0.1.216.95.clients.your-server.de"] },
  prefix: { prefix: "95.216.0.0/16", asns: [24940] }, lists: lists({ dc: 256 }),
};

test("kindOf: the largest kind over half the names; the data-centre list when names are few", () => {
  assert.deepEqual(kindOf(hetzner.rdns, 256), { kind: "hosting", n: 208 });
  assert.equal(kindOf({ named: 200, kinds: { dynamic: 150, other: 50 } }, 0).kind, "dynamic");
  assert.equal(kindOf({ named: 100, kinds: { dynamic: 40, hosting: 30, other: 30 } }, 0).kind, "mixed");
  assert.equal(kindOf({ named: 0, kinds: {} }, 256).byList, true);
  assert.equal(kindOf({ named: 3, kinds: { other: 3 } }, 0).kind, "unknown");
});

test("readSeg: a hosting /24 is a warning, and a bad one when the IP's databases call it a home line", () => {
  const r = readSeg(hetzner, "hosting");
  assert.equal(r.kind.lv, "warn"); assert.equal(r.kind.k, "sg_k_hosting");
  assert.ok(r.kind.why.some(([k]) => k === "sg_kw_dc"));
  const home = readSeg(hetzner, "residential");
  assert.equal(home.kind.lv, "bad");
  assert.ok(home.kind.why.some(([k]) => k === "sg_kw_vs"));
});

test("readSeg: the lists: clean, a few listed, the whole /24 listed, DROP", () => {
  assert.equal(readSeg(hetzner, "hosting").bad.lv, "ok");
  const ipsum = readSeg({ ...hetzner, lists: lists({ bad: 256, badMax: 11 }) }, "hosting").bad;
  assert.equal(ipsum.lv, "bad"); assert.equal(ipsum.k, "sg_b_n");
  assert.deepEqual(ipsum.why[0], ["sg_bw_n", { n: 256, max: 11 }]);
  assert.equal(readSeg({ ...hetzner, lists: lists({ bad: 1, badMax: 2 }) }, "hosting").bad.lv, "warn");
  assert.equal(readSeg({ ...hetzner, lists: lists({ drop: 256 }) }, "hosting").bad.k, "sg_b_drop");
  assert.equal(readSeg({ ...hetzner, lists: lists({ proxy: 40 }) }, "hosting").anon.lv, "bad");
  assert.equal(readSeg({ ...hetzner, lists: lists({ vpn: 256 }) }, "hosting").anon.k, "sg_a_vpn");
  assert.equal(readSeg({ ...hetzner, lists: lists({ tor: 3 }) }, "hosting").tor.lv, "warn");
});

test("readSeg: a list never fetched says so instead of 'none'", () => {
  const r = readSeg({ ...hetzner, lists: lists({ proxy: null }) }, "hosting");
  assert.equal(r.anon.lv, "ok");
  assert.ok(r.anon.why.some(([k]) => k === "sg_aw_noproxy"));
  const none = readSeg({ ...hetzner, lists: { proxy: null, vpn: null, bad: null, drop: null, tor: null } }, "hosting");
  assert.equal(none.anon.lv, "none"); assert.equal(none.bad.lv, "none"); assert.equal(none.tor.lv, "none");
});

test("readSeg: a partial sweep, no prefix, RIPEstat down", () => {
  assert.ok(!readSeg(hetzner, "hosting").rdns.why.some(([k]) => k === "sg_rw_part"));
  const part = readSeg({ ...hetzner, rdns: { ...hetzner.rdns, answered: 114 } }, "hosting");
  assert.equal(readSeg({ ...hetzner, rdns: { asked: 256, answered: 256, named: 0, kinds: {}, domains: [], samples: [] } }, "hosting").rdns.why[0][0], "sg_rw_none");
  assert.ok(part.rdns.why.some(([k, p]) => k === "sg_rw_part" && p.n === 114));
  assert.equal(readSeg({ ...hetzner, prefix: { prefix: "", asns: [] } }, "hosting").prefix.k, "sg_p_none");
  assert.equal(readSeg({ ...hetzner, prefix: null }, "hosting").prefix.lv, "none");
});

test("readSeg: a /24 whose reverse servers are down says so, not that answers were late", () => {
  const r = readSeg({ ...hetzner, rdns: { asked: 256, answered: 32, dead: true, named: 0, kinds: {}, domains: [], samples: [] } }, "residential").rdns;
  assert.equal(r.why[0][0], "sg_rw_dead");
  assert.ok(!r.why.some(([k]) => k === "sg_rw_part"));
});
