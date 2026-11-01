// A shared link scores the same as the check it came from, and leaves the address out unless asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pack, encode, decode, unpackResults, SHARE_PATH } from "../src/share.mjs";
import { assess } from "../src/score.mjs";

const res = [
  { id: "ipapi", data: { cc: "DE", city: "Frankfurt", asn: 24940, org: "Hetzner", type: "hosting", proxy: false, host: "static.example.de" } },
  { id: "ipquery", data: { cc: "DE", type: "hosting", vpn: true, proxy: false, tor: false, risk: 60 } },
  { id: "rdap", data: { regCc: "FI", rir: "RIPE", regName: "HETZNER-NET", range: "95.216.0.0 - 95.216.255.255" } },
  { id: "shodan", data: { ports: [22, 443], tags: ["vpn"], host: "static.example.de" } },
];
const bl = [{ id: "spamcop", listed: false }, { id: "psbl", listed: true }, { id: "barracuda", listed: null }];
const snap = { at: "2026-11-01T04:00:00.000Z", v: 4, ip: "95.216.1.2", res, fails: ["ipwho"], skip: { cloudflare: "own" }, bl };

test("a link scores as the check did", async () => {
  for (const details of [false, true]) {
    const code = await encode(pack({ ...snap, details }));
    assert.match(code, /^1\.[A-Za-z0-9_-]+$/);
    const P = await decode(code);
    const u = unpackResults(P), a = assess(u.res, u.bl), b = assess(res, bl.map(x => ({ ...x, name: x.id })));
    assert.equal(a.score, b.score); assert.equal(a.grade, b.grade);
    assert.deepEqual(a.uses, b.uses);
    assert.equal(P.t * 60000, Date.parse(snap.at));
    assert.deepEqual(P.x, ["ipwho"]); assert.deepEqual(P.k, { cloudflare: "own" });
  }
});

test("without details the link has no address, city, network or registry record", async () => {
  const text = JSON.stringify(await decode(await encode(pack(snap))));
  for (const s of ["95.216", "Frankfurt", "Hetzner", "HETZNER", "24940", "example.de"]) assert.ok(!text.includes(s), s);
  const full = JSON.stringify(await decode(await encode(pack({ ...snap, details: true }))));
  for (const s of ["95.216.1.2", "Frankfurt", "Hetzner"]) assert.ok(full.includes(s), s);
});

test("links this code can't read come back null", async () => {
  for (const c of ["", "1.", "2.abcdefghij", "1.!!!!!!!!!!", "1.abcdefghijkl"]) assert.equal(await decode(c), null);
});

test("the share path is found after a language folder or at the root", () => {
  assert.deepEqual(SHARE_PATH.exec("/r/1.abc").slice(1), [undefined, "1.abc"]);
  assert.deepEqual(SHARE_PATH.exec("/zh-cn/r/1.abc").slice(1), ["zh-cn", "1.abc"]);
  assert.equal(SHARE_PATH.exec("/zh-cn/"), null);
});
