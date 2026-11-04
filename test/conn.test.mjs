// The connection readings: which resolvers count as a DNS leak, and what MSS and TTL say about the path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inCidr, readDns, readConn } from "../src/conn.mjs";

test("inCidr: IPv4 and IPv6 blocks, mismatched families never match", () => {
  assert.equal(inCidr("203.0.113.9", "203.0.113.0/24"), true);
  assert.equal(inCidr("203.0.114.9", "203.0.113.0/24"), false);
  assert.equal(inCidr("2001:db8:1:2::5", "2001:db8:1::/48"), true);
  assert.equal(inCidr("2001:db8:2::5", "2001:db8:1::/48"), false);
  assert.equal(inCidr("203.0.113.9", "2001:db8::/32"), false);
  assert.equal(inCidr("203.0.113.9", "junk"), false);
});

const jp = { ip: "45.76.1.2", asn: 20473, cc: "JP", ips: ["45.76.1.2", "240e:1::9"] };

test("readDns: the exit's own resolver and a public one are fine", () => {
  const r = readDns([{ ip: "45.76.0.53", asn: 20473, org: "Vultr", cc: "JP", n: 2 }, { ip: "172.253.1.1", asn: 15169, org: "Google", cc: "US" }], jp);
  assert.equal(r.lv, "ok");
  assert.deepEqual(r.rs.map(x => x.kind).sort(), ["own", "public"]);
});

test("readDns: a resolver in another country than the exit is a leak, and comes first", () => {
  const r = readDns([{ ip: "172.253.1.1", asn: 15169, cc: "US" }, { ip: "202.96.128.86", asn: 4134, org: "Chinanet", cc: "CN" }], jp);
  assert.equal(r.lv, "warn");
  assert.equal(r.rs[0].kind, "leak");
  assert.equal(r.rs[0].org, "Chinanet");
});

test("readDns: a client subnet outside every exit is a leak; one holding any exit is not", () => {
  assert.equal(readDns([{ ip: "172.253.1.1", asn: 15169, cc: "US", ecs: "113.110.0.0/24" }], jp).lv, "warn");
  // a dual-stack visitor: the resolver passes on their IPv6 /56, which is one of their exits
  assert.equal(readDns([{ ip: "172.253.1.1", asn: 15169, cc: "US", ecs: "240e:1::/56" }], jp).lv, "ok");
});

test("readDns: a resolver pool in one network is one group", () => {
  // one ISP, several of its networks (Beijing, Guangdong, the backbone)
  const pool = [["111.206.4.200", 4808, "Unicom Beijing"], ["111.206.4.139", 4808, "Unicom Beijing"], ["157.255.7.71", 17816, "Unicom Guangdong"]]
    .map(([ip, asn, org]) => ({ ip, asn, org, cc: "CN" }));
  const r = readDns([...pool, { ip: "8.8.4.4", asn: 15169, cc: "US" }], jp);
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groups[0].ips, ["111.206.4.200", "111.206.4.139", "157.255.7.71"]);
  assert.deepEqual(r.groups[0].orgs, ["Unicom Beijing", "Unicom Guangdong"]);
});

test("readDns: the same resolver over A and AAAA is one; nothing asked is null", () => {
  const r = readDns([{ ip: "8.8.4.4", asn: 15169, qtype: "A", n: 1 }, { ip: "8.8.4.4", asn: 15169, qtype: "AAAA", n: 1 }], jp);
  assert.equal(r.rs.length, 1); assert.equal(r.rs[0].n, 2);
  assert.equal(readDns([], jp), null);
});

const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";

// the probe's /fp: the address, and what the SYN said
const fp = (ip, tcp) => ({ ip, proto: "HTTP/2", tcp });

test("readConn: MTU sorts plain, PPPoE, narrow and tunnel paths, on the lines who's check uses", () => {
  assert.equal(readConn(fp("45.76.1.2", { mss: 1460, mtu: 1500, os: "apple" }), jp, MAC).kind, "plain");
  assert.equal(readConn(fp("45.76.1.2", { mss: 1452, mtu: 1492, os: "apple" }), jp, MAC).kind, "pppoe");
  // jumbo frames: only within one cloud, so a server there opened it
  assert.equal(readConn(fp("2406:da14::1", { mss: 8941, mtu: 9001, os: "other" }), jp, MAC).kind, "jumbo");
  assert.equal(readConn(fp("45.76.1.2", { mss: 1400, mtu: 1440, os: "apple" }), jp, MAC).kind, "narrow");
  const w = readConn(fp("45.76.1.2", { mss: 1380, mtu: 1420, os: "apple" }), jp, MAC);
  assert.equal(w.kind, "tunnel"); assert.equal(w.lv, "warn");
  // without the probe's MTU, IPv6 headers count 20 bytes more
  assert.equal(readConn(fp("240e:1::9", { mss: 1440 }), jp, MAC).mtu, 1500);
  assert.equal(readConn(fp("45.76.1.2", { mss: 1380, mtu: 1420 }), { ...jp, type: "mobile" }, MAC).kind, "small");
});

test("readConn: a TCP system that isn't the browser's is a proxy; a VPN keeps the visitor's system", () => {
  assert.equal(readConn(fp("45.76.1.2", { mss: 1460, mtu: 1500, os: "linux", initial_ttl: 64 }), jp, WIN).kind, "proxy");
  assert.equal(readConn(fp("45.76.1.2", { mss: 1460, mtu: 1500, os: "linux" }), jp, MAC).kind, "proxy");
  assert.equal(readConn(fp("45.76.1.2", { mss: 1380, mtu: 1420, os: "windows", initial_ttl: 128 }), jp, WIN).kind, "tunnel");
  // "other" or "unix": only the TTL, which tells Windows from the rest
  assert.equal(readConn(fp("45.76.1.2", { mss: 1460, mtu: 1500, os: "other", initial_ttl: 64 }), jp, WIN).kind, "proxy");
  assert.equal(readConn(fp("45.76.1.2", { mss: 1460, mtu: 1500, os: "other", initial_ttl: 64 }), jp, MAC).kind, "plain");
});

test("readConn: another exit is noted; no TCP reading is null", () => {
  assert.equal(readConn(fp("1.2.3.4", { mss: 1460, os: "apple" }), jp, MAC).other, true);
  assert.equal(readConn({ ip: "45.76.1.2", proto: "HTTP/2" }, jp, MAC), null);
  assert.equal(readConn(null, jp, MAC), null);
});
