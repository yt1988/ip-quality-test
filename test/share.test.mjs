// A shared link scores the same as the check it came from, and leaves the address out unless asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pack, encode, decode, unpackResults, SHARE_PATH, CF_OF } from "../src/share.mjs";
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
    assert.match(code, /^2\.z[A-Za-z0-9_-]+$/);
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

test("Cloudflare's human check rides along when it was run, and older links simply lack it", async () => {
  for (const cf of ["pass", "click", "fail"]) assert.equal(CF_OF[(await decode(await encode(pack({ ...snap, cf })))).c], cf);
  assert.equal((await decode(await encode(pack(snap)))).c, undefined);
  assert.equal(pack({ ...snap, cf: "maybe" }).c, undefined);
});

// links from before format 2: the bare deflate, as the old encode wrote it
const oldEncode = async P => {
  const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify(P)]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return "1." + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
test("format 2 through the shared codec; format 1 links still open; an uncompressed link reads too", async () => {
  const P = pack(snap);
  const code = await encode(P);
  assert.match(code, /^2\.z[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decode(code), JSON.parse(JSON.stringify(P)));
  assert.deepEqual(await decode(await oldEncode(P)), JSON.parse(JSON.stringify(P)));
  // what a browser without CompressionStream writes: "u" + the plain JSON
  const plain = "2.u" + Buffer.from(JSON.stringify(P)).toString("base64url");
  assert.deepEqual(await decode(plain), JSON.parse(JSON.stringify(P)));
  for (const c of ["3." + code.slice(2), "2.x" + code.slice(3), "2.zAAAAAAAAAAAA"]) assert.equal(await decode(c), null);
});
