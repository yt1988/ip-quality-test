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

// a clean home connection, and the same with mail blocklists set
const home = () => [
  r("ipapi", { cc: "DE", city: "Berlin", type: "residential", proxy: false }),
  r("ipquery", { cc: "DE", proxy: false, vpn: false, tor: false, risk: 0 }),
  r("tor", { tor: false }),
];
const noBl = () => Array.from({ length: 8 }, (_, i) => ({ id: "b" + i, name: "B" + i, listed: false }));

test("a mail blocklist caps the grade: one list at most B, two at most C; UCEPROTECT counts half", () => {
  const one = noBl(); one[0].listed = true;
  const two = noBl(); two[0].listed = two[1].listed = true;
  const uce = noBl(); uce[4].id = "uceprotect"; uce[4].listed = true;
  const a = assess(home(), noBl()), b = assess(home(), one), c = assess(home(), two), u = assess(home(), uce);
  assert.equal(a.grade, "A");
  assert.equal(b.grade, "B");
  assert.equal(b.summary.cap, "n_cap_bl");
  assert.equal(c.grade, "C");
  assert.ok(c.notes.some(n => n.k === "n_cap_bl" && n.p.g === "C"));
  // UCEPROTECT L1 alone: half a listing — 3 points, no ceiling
  assert.equal(u.grade, "A");
  assert.equal(u.score, a.score - 3);
  assert.equal(u.parts.find(p => p.k === "p_dnsbl").pts, 3);
});

test("a single-source finding counts half, and too few risk sources stop the grade at B", () => {
  const one = assess([r("ipapi", { cc: "DE", vpn: true })]);
  const two = assess([r("a", { vpn: true }), r("b", { vpn: true })]);
  const pts = x => (x.parts.find(p => p.k === "p_vpn") || { pts: 0 }).pts;
  assert.equal(pts(two), 15);
  assert.equal(pts(one), 8);          // one source, so half of 15, rounded
  // one source only said anything about risk: no A, whatever the score
  const gate = assess([r("ipapi", { cc: "DE", proxy: false })]);
  assert.equal(gate.score, 100);
  assert.equal(gate.grade, "B");
  assert.ok(gate.notes.some(n => n.k === "n_cap_conf"));
});

test("confidence: sources answered, sources with risk data, and disagreement", () => {
  const clean = assess([...home(), r("geojs", { cc: "DE" }), r("rdap", { regCc: "DE" })]);
  assert.equal(clean.confidence.level, "high");
  const split = assess([r("ipapi", { cc: "DE", proxy: true }), r("ipquery", { cc: "DE", proxy: false, risk: 0 }), r("tor", { tor: false }), r("geojs", { cc: "DE" }), r("rdap", { regCc: "DE" })]);
  assert.equal(split.confidence.level, "mid");        // proxy 1 of 2
  const few = assess([r("ipapi", { cc: "DE", proxy: false })]);
  assert.equal(few.confidence.level, "low");           // one source, one risk reading
  assert.equal(few.confidence.sources, 1);
});

test("cities: every database's city is kept, the most agreed on first", () => {
  const a = assess([r("ipapi", { cc: "US", city: "Ashburn" }), r("ipquery", { cc: "US", city: "Mountain View" }), r("ipapiis", { cc: "US", city: "Mountain View" })]);
  assert.equal(a.summary.city, "Ashburn");             // the most trusted source among those agreeing on the country
  assert.deepEqual(a.summary.cities.map(c => [c.city, c.by.length]), [["Mountain View", 2], ["Ashburn", 1]]);
});

test("a Tor exit is F by its own points", () => {
  const a = assess([r("tor", { tor: true })], noBl());
  assert.equal(a.grade, "F");
  assert.ok(a.score < 30, String(a.score));
});

test("the public lists: IPsum, DROP, ASN-DROP and Private Relay count, without double counting a flag", () => {
  const clean = assess(home(), noBl());
  const withLists = (L, top = {}) => assess([...home(), r("lists", { lists: L, ...top })], noBl());
  const pts = (x, k) => (x.parts.find(p => p.k === k) || { pts: 0 }).pts;
  const few = withLists({ bad: 2 });
  assert.equal(pts(few, "p_lists"), 4);
  assert.equal(pts(withLists({ bad: 3 }), "p_lists"), 8);
  assert.equal(few.grade, "B");                       // two IPsum lists: no A
  assert.ok(few.notes.some(n => n.k === "n_lists"));
  const drop = withLists({ bad: 0, drop: true });
  assert.equal(pts(drop, "p_drop"), 15);
  assert.ok(drop.notes.some(n => n.k === "n_drop"));
  const asn = withLists({ bad: 0, asndrop: true });
  assert.equal(pts(asn, "p_asndrop"), 3);
  assert.equal(asn.grade, "B");                       // a network on ASN-DROP: no A
  assert.ok(asn.notes.some(n => n.k === "n_asndrop"));
  // a source already flagged it: the lists don't count the same finding twice
  const flagged = assess([...home(), r("lists", { lists: { bad: 2 }, vpn: true }), r("ipqs", { vpn: true })], noBl());
  assert.equal(pts(flagged, "p_lists"), 0);
  assert.equal(pts(flagged, "p_vpn"), 10);            // two of the three sources that say: 15 × 2/3
  // a Private Relay exit is an anonymizer, and a Tor relay is noted but not punished
  const relay = withLists({ bad: 0, relay: true }, { relay: true });
  assert.equal(pts(relay, "p_relay"), 3);
  assert.ok(relay.notes.some(n => n.k === "n_relay"));
  const torrelay = withLists({ bad: 0, torrelay: true });
  assert.equal(pts(torrelay, "p_relay"), 0);
  assert.ok(torrelay.notes.some(n => n.k === "n_torrelay"));
  assert.equal(clean.score, 100);
});

test("routing and reverse DNS findings", () => {
  const a = assess([...home(), r("routing", { announced: false, rpki: "invalid", prefix: "192.0.2.0/24" }), r("ptr", { host: "h.example", fcrdns: false, ptrType: "dynamic" })], noBl());
  assert.ok(a.notes.some(n => n.k === "n_unannounced" && n.p.prefix === "192.0.2.0/24"));
  assert.ok(a.notes.some(n => n.k === "n_rpki_invalid"));
  assert.ok(a.notes.some(n => n.k === "n_fcrdns_no"));
  assert.equal(a.summary.routing.rpki, "invalid");
  assert.equal(a.summary.ptr.fcrdns, false);
  assert.equal(a.summary.ptr.type, "dynamic");
});
