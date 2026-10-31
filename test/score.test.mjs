import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, gradeOf } from "../src/score.mjs";
import { mapType } from "../src/sources.mjs";

const r = (id, data) => ({ id, data });
const bl = n => Array.from({ length: 8 }, (_, i) => ({ id: "b" + i, name: "B" + i, listed: i < n }));

test("a clean home connection gets an A", () => {
  const a = assess([
    r("ipapi", { cc: "DE", city: "Berlin", asn: 3320, proxy: false }),
    r("ipquery", { cc: "DE", asn: 3320, proxy: false, vpn: false, tor: false, risk: 0 }),
    r("proxycheck", { cc: "DE", type: "residential", proxy: false, vpn: false, tor: false, risk: 0 }),
    r("rdap", { regCc: "DE", rir: "RIPE" }),
    r("tor", { tor: false }),
  ], bl(0));
  assert.equal(a.grade, "A");
  assert.equal(a.summary.type, "residential");
  assert.equal(a.summary.native, true);
  assert.equal(a.uses.stream.lv, "good");
  assert.equal(a.uses.mail.lv, "warn");          // home connections are refused by mail servers
});

test("a clean data-center address tops out at B", () => {
  const a = assess([
    r("ipapi", { cc: "US", type: "hosting", proxy: false, host: "x.example" }),
    r("ipquery", { cc: "US", type: "hosting", proxy: false, vpn: false, tor: false, risk: 20 }),
    r("proxycheck", { cc: "US", type: "hosting", risk: 0 }),
  ], bl(0));
  assert.equal(a.summary.type, "hosting");
  assert.ok(a.score < 85 && a.score >= 70, String(a.score));
  assert.equal(a.uses.stream.lv, "warn");
  assert.equal(a.uses.mail.lv, "good");
});

test("a Tor exit fails everything and the breakdown adds up", () => {
  const a = assess([
    r("proxycheck", { cc: "DE", type: "hosting", proxy: true, vpn: false, tor: true, risk: 100, abuser: true }),
    r("ipquery", { cc: "DE", tor: true, risk: 100 }),
    r("tor", { tor: true }),
  ], bl(2));
  assert.equal(a.grade, "F");
  assert.equal(a.score, Math.max(0, 100 - a.parts.reduce((s, p) => s + p.pts, 0)));
  assert.equal(a.notes[0].k, "n_tor");
  for (const k of ["stream", "ai", "captcha", "account", "mail"]) assert.equal(a.uses[k].lv, "bad", k);
});

test("broadcast IP, split geolocation and unsupported AI regions", () => {
  const a = assess([r("ipapi", { cc: "HK" }), r("ipinfo", { cc: "HK" }), r("proxycheck", { cc: "US" }), r("rdap", { regCc: "US" })]);
  assert.equal(a.summary.cc, "HK");
  assert.equal(a.summary.native, false);
  assert.ok(a.notes.some(n => n.k === "n_broadcast"));
  assert.ok(a.notes.some(n => n.k === "n_geo_split"));
  assert.equal(a.uses.ai.lv, "bad");
  // no RIR country: fall back to the network's, and say so
  const b = assess([r("ipapi", { cc: "JP" }), r("ipguide", { asCc: "US" })]);
  assert.ok(b.notes.some(n => n.k === "n_broadcast_as"));
});

test("one source out of many takes off only part of a flag's points", () => {
  const one = assess([r("a", { vpn: true }), r("b", { vpn: false }), r("c", { vpn: false }), r("d", { vpn: false })]);
  const all = assess([r("a", { vpn: true }), r("b", { vpn: true })]);
  const pts = a => (a.parts.find(p => p.k === "p_vpn") || { pts: 0 }).pts;
  assert.ok(pts(one) > 0 && pts(one) < pts(all));
});

test("grades and type names", () => {
  assert.deepEqual([100, 85, 84, 70, 50, 30, 29, 0].map(gradeOf), ["A", "A", "B", "B", "C", "D", "F", "F"]);
  assert.equal(mapType("Data Center/Web Hosting/Transit"), "hosting");
  assert.equal(mapType("Fixed Line ISP"), "residential");
  assert.equal(mapType("Mobile ISP"), "mobile");
  assert.equal(mapType("Wireless"), "mobile");
  assert.equal(mapType("University/College/School"), "education");
  assert.equal(mapType("Commercial"), "business");
  assert.equal(mapType(""), undefined);
});
