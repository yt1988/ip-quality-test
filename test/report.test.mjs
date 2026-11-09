// The shell's "report a problem" dialog asks the page for what the visitor saw (1ms-shell docs/tool-contract.md
// section 4): one line, a JSON to reproduce the result, and short readings to pick from. These check its limits, the
// masked address, and that the JSON keeps nothing a shared link hides by default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskIp, reportOf, MAX_SUMMARY, MAX_DATA, MAX_PICKS, MAX_PICK } from "../src/report.mjs";
import { assess } from "../src/score.mjs";
import { unpackResults } from "../src/share.mjs";

const L = (await import("../src/i18n/en.mjs")).default;
const t = (k, v) => { let s = L[k] != null ? L[k] : k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
const country = cc => { try { return new Intl.DisplayNames(["en"], { type: "region" }).of(cc); } catch (e) { return cc; } };

// a result like a real check of a Hetzner address: every source answered with its whole record
const res = [
  { id: "ipapi", data: { cc: "DE", city: "Frankfurt", asn: 24940, org: "Hetzner Online GmbH", type: "hosting", proxy: false, host: "static.95.216.1.2.clients.your-server.de" } },
  { id: "ipquery", data: { cc: "DE", type: "hosting", vpn: false, proxy: false, tor: false, risk: 60 } },
  { id: "proxycheck", data: { cc: "DE", type: "hosting", proxy: false, vpn: true, risk: 75 } },
  { id: "ipinfo", data: { cc: "DE", host: "static.95.216.1.2.clients.your-server.de" } },
  { id: "rdap", data: { regCc: "FI", rir: "RIPE", regName: "HETZNER-REG", range: "95.216.0.0 - 95.216.255.255" } },
  { id: "shodan", data: { ports: [22, 80, 443], tags: ["vpn"], host: "static.95.216.1.2.clients.your-server.de" } },
  { id: "tor", data: { tor: false } },
];
const bl = [{ id: "spamcop", listed: false, name: "SpamCop" }, { id: "psbl", listed: true, name: "PSBL" }, { id: "barracuda", listed: null, name: "Barracuda" }];
const snap = { at: "2026-11-01T04:00:00.000Z", v: 4, ip: "95.216.1.2", res, fails: ["ipwho"], skip: { cloudflare: "own" }, bl, cf: "click", r: assess(res, bl) };

test("maskIp: an IPv4 keeps its /24 and an IPv6 its /64, and nothing else passes", () => {
  assert.equal(maskIp("95.216.1.2"), "95.216.1.x/24");
  assert.equal(maskIp("240e:1:2:3:4:5:6:7"), "240e:1:2:3::/64");
  assert.equal(maskIp("240e:1::9"), "240e:1:0:0::/64");
  for (const s of ["", "nope", "::1", "192.168.1.1", "192.168.1.1.nope"]) assert.equal(maskIp(s), "", s);
});

test("no result yet, or a failed check: nothing to report", () => {
  assert.equal(reportOf({ snap: null, lang: "en", t, country }), null);
  assert.equal(reportOf({ snap: { at: 0, v: 4, ip: "95.216.1.2", res, bl }, lang: "en", t, country }), null);
});

test("the line says what was checked and what it said, in the dialog's 300 characters", async () => {
  const { summary } = reportOf({ snap, lang: "en", t, country });
  assert.ok(summary.length <= MAX_SUMMARY, String(summary.length));
  for (const s of ["IP Quality Test", "95.216.1.x/24", snap.r.score + "/100", t("grade", { g: snap.r.grade }), t("g_" + snap.r.grade), "Germany", "Data center", "1 of 2"]) {
    assert.ok(summary.includes(s), s + " in " + summary);
  }
  // Chinese runs the same readings together with a full-width colon
  const zh = (await import("../src/i18n/zh-CN.mjs")).default;
  const tz = (k, v) => { let s = zh[k] != null ? zh[k] : k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
  const zhSummary = reportOf({ snap, lang: "zh-CN", t: tz, country: cc => cc }).summary;
  assert.match(zhSummary, /：/);
  assert.ok(zhSummary.length <= MAX_SUMMARY);
});

test("the JSON reproduces the score and keeps the address, city and network names out", () => {
  const { data } = reportOf({ snap, lang: "en", t, country });
  const json = JSON.stringify(data);
  assert.equal(data.ip, "95.216.1.x/24");
  assert.equal(data.score, snap.r.score);
  assert.equal(data.grade, snap.r.grade);
  assert.equal(data.cf, "click");
  // what the visitor's own screen says: masked to the network, and no address, city, network or reverse DNS name
  for (const s of ["95.216.1.2", "Frankfurt", "Hetzner", "HETZNER", "24940", "your-server.de"]) assert.ok(!json.includes(s), s);
  // the score, scored again from the answers it carries (as the Worker would)
  const u = unpackResults(data.src), again = assess(u.res, u.bl);
  assert.equal(again.score, data.score);
  assert.equal(again.grade, data.grade);
  assert.deepEqual(again.uses, snap.r.uses);
  // and the dialog sends it as it is: under its 6 KB
  assert.ok(Buffer.byteLength(json, "utf8") <= MAX_DATA, String(Buffer.byteLength(json, "utf8")));
});

test("a shared result with the address hidden says so and sends no address", () => {
  const shared = { ...snap, ip: null, r: assess(res, bl) };
  const { summary, data } = reportOf({ snap: shared, lang: "en", t, country });
  assert.equal(data.ip, null);
  assert.ok(summary.includes(t("r_hidden")), summary);
});

test("the picks are the readings a visitor most often says are wrong, at most 8 of 60 characters", async () => {
  const { picks } = reportOf({ snap, lang: "en", t, country });
  assert.ok(picks.length <= MAX_PICKS && picks.length === 8, String(picks.length));
  for (const p of picks) assert.ok(p.length <= MAX_PICK, p);
  for (const label of ["r_loc", "fl_type", "fl_native", "fl_anon", "fl_risk", "fl_dnsbl", "fl_stream", "fl_ai"]) {
    assert.ok(picks.some(p => p.startsWith(t(label) + ": ")), label + " in " + picks.join(" | "));
  }
  // in the page's language too
  const de = (await import("../src/i18n/de.mjs")).default;
  const td = (k, v) => { let s = de[k] != null ? de[k] : k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
  const dp = reportOf({ snap, lang: "de", t: td, country }).picks;
  assert.ok(dp.length <= MAX_PICKS);
  for (const p of dp) assert.ok(p.length <= MAX_PICK, p);
});
