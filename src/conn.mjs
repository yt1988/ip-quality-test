// The visitor's connection as the 1ms.dog servers saw it, read against the exit the check scored:
// - DNS: which resolvers asked dns's authoritative server (l.1ms.dog) for the random names the page looked up;
// - TCP: the handshake who's probe read (probe.1ms.dog/conn): MSS (how much room the path leaves) and TTL (whose
//   network stack opened the connection).
// Pure functions, shared by the page and the tests: they say what they see, the page words it.
import { family, v6words, canon } from "./ip.mjs";

const bitsOf = ip => family(ip) === 4
  ? ip.split(".").map(o => (+o).toString(2).padStart(8, "0")).join("")
  : (v6words(ip) || []).map(w => w.toString(2).padStart(16, "0")).join("");
// is the address inside the block ("203.0.113.0/24", "2001:db8:1::/56")?
export function inCidr(ip, cidr) {
  const [net, len] = String(cidr || "").split("/"), n = Number(len);
  const f = family(ip);
  if (!f || f !== family(net) || !Number.isInteger(n) || n < 0 || n > (f === 4 ? 32 : 128)) return false;
  return bitsOf(ip).slice(0, n) === bitsOf(net).slice(0, n);
}

// Anycast public resolvers: the address they ask from is wherever their nearest node is, so it says nothing about the
// visitor (and the databases often place it in the operator's home country)
export const PUBLIC_DNS = { 15169: "Google", 13335: "Cloudflare", 19281: "Quad9", 36692: "OpenDNS" };

// hits: the dns server's rows for one token ({ip, asn, org, cc, ecs, n, ...}, one per resolver and query kind).
// exit: the address the check scored and what it found ({ip, asn, cc}), and every exit the page found (ips).
// Each resolver gets a kind:
//   own     in the exit's own network (the ISP's, or the VPN's own resolver): the DNS goes with the traffic
//   public  an anycast public resolver: says nothing about where the visitor is
//   same    another network in the exit's country
//   leak    another country than the exit: sites that place visitors by their resolver (CDNs, some streaming) see it
//   unknown no country for it
// and ecsOff when it passed on a client subnet (ECS) that holds none of the visitor's exits: that subnet is where the
// visitor really is. → null when no resolver asked, else { lv: "ok" | "warn" | "info", rs: resolvers, groups: the
// resolvers by network and verdict (each with ips), both worst first }.
export function readDns(hits, exit) {
  const by = new Map(), ips = [exit.ip, ...(exit.ips || [])].filter(Boolean);
  for (const h of hits || []) {
    if (!h || !family(h.ip)) continue;
    const ip = canon(h.ip), r = by.get(ip) || { ip, asn: h.asn || 0, org: h.org || "", cc: h.cc || "", ecs: "", n: 0 };
    r.n += h.n || 1;
    if (h.ecs && !r.ecs) r.ecs = h.ecs;
    by.set(ip, r);
  }
  const rs = [...by.values()];
  if (!rs.length) return null;
  for (const r of rs) {
    r.pub = PUBLIC_DNS[r.asn] || "";
    r.kind = exit.asn && r.asn === exit.asn ? "own" : r.pub ? "public" : !r.cc || !exit.cc ? "unknown" : r.cc === exit.cc ? "same" : "leak";
    r.ecsOff = !!r.ecs && !ips.some(ip => inCidr(ip, r.ecs));
  }
  const RANK = { leak: 0, unknown: 1, same: 2, public: 3, own: 4 };
  rs.sort((a, b) => (b.ecsOff - a.ecsOff) || RANK[a.kind] - RANK[b.kind] || b.n - a.n);
  const lv = rs.some(r => r.kind === "leak" || r.ecsOff) ? "warn" : rs.every(r => r.kind === "unknown") ? "info" : "ok";
  // a resolver pool asks from many addresses, often of several networks of one ISP: one group per verdict and
  // country (or public service), with its addresses and network names, worst first
  const gs = new Map();
  for (const r of rs) {
    const k = [r.kind, r.pub || r.cc, r.ecsOff ? r.ecs : ""].join("|");
    const g = gs.get(k) || { ...r, ips: [], orgs: [] };
    g.ips.push(r.ip);
    if (r.org && !g.orgs.includes(r.org)) g.orgs.push(r.org);
    gs.set(k, g);
  }
  return { lv, rs, groups: [...gs.values()] };
}

// The browser's own system, in the probe's words (who reads the system from the SYN: windows, apple, linux, unix, other)
const uaOs = ua => /Windows/.test(ua) ? "windows" : /Mac OS X|iPhone|iPad/.test(ua) ? "apple" : /Android|Linux|CrOS/.test(ua) ? "linux" : "";
// without the probe's system, the initial TTL only tells Windows (128) from the rest (64)
const ttlOs = init => init === 128 ? "windows" : init === 64 ? "notwin" : "";

// fp: who's probe.1ms.dog/fp ({ip, tcp: {mss, mtu, ttl, initial_ttl, os, ...}}; no tcp when the SYN wasn't read);
// exit as above (and its type); ua: the browser's user agent. → null when there is no reading, else
// { lv, kind, mss, mtu, os, ua, other, ip }. The lines match who's connection check (MTU 1420 or less is a tunnel
// sign; a TCP system that isn't the browser's is a proxy). kind:
//   jumbo   more than 1500: only inside one cloud's network (jumbo frames), so a cloud server opened it (a proxy
//           in the probe's cloud; the probe is on AWS in Tokyo)
//   plain   a full-size path (MTU 1500): nothing in the way
//   pppoe   1480–1499: PPPoE broadband (it takes 8 bytes), not a tunnel
//   narrow  1421–1479: smaller than usual, but more room than a VPN leaves (some ISPs and mobile networks)
//   tunnel  1420 or less: the room a VPN or tunnel header takes (WireGuard's MTU 1420, OpenVPN and IPsec around 1400)
//   small   as tunnel, on a mobile network, whose own paths are often that small too
//   proxy   the connection came from another system than the browser runs on: a proxy server opened it for the
//           visitor (a VPN carries the visitor's own packets, so their system)
// other: the probe was reached through another exit than the one checked (a proxy that routes by destination).
export function readConn(fp, exit, ua) {
  const c = fp && fp.tcp;
  if (!c || !family(fp.ip) || !(c.mss > 0)) return null;
  const ip = canon(fp.ip), mtu = c.mtu > 0 ? c.mtu : c.mss + (family(ip) === 6 ? 60 : 40);
  const os = /^(windows|apple|linux)$/.test(c.os) ? c.os : ttlOs(c.initial_ttl), mine = uaOs(ua || "");
  const proxy = !!(os && mine && (os === "notwin" ? mine === "windows" : os !== mine));
  const kind = proxy ? "proxy" : mtu > 1500 ? "jumbo" : mtu === 1500 ? "plain" : mtu >= 1480 ? "pppoe" : mtu > 1420 ? "narrow" : exit.type === "mobile" ? "small" : "tunnel";
  const lv = kind === "proxy" || kind === "tunnel" || kind === "jumbo" ? "warn" : kind === "small" ? "info" : "ok";
  return { lv, kind, mss: c.mss, mtu, os: os === "notwin" ? "" : os, ua: mine, other: !!(exit.ip && ip !== canon(exit.ip)), ip };
}
