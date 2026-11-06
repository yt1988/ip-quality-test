// The batch page, read: the list a visitor pastes, one table row per address from the API's `done` event, and the
// shared link's payload. Pure, shared by the page (src/batch.js) and the tests.
import { canon, isPublic, family, v6words } from "./ip.mjs";

// one batch: as many fresh lookups as the Worker allows one visitor a minute (wrangler.toml, LIMIT)
export const MAX = 20;

// An IPv6 prefix: the network in short form and the one address that stands for it (the network's first host).
// The sources key IPv6 by block (a /48, a /32, the whole AS), so every address in it reads the same; checking one
// tells the block. → { net: "2001:db8:1::/48", ip } or null
export function v6net(addr, bits) {
  const w = v6words(addr);
  if (!w || !(bits >= 0 && bits <= 128)) return null;
  const m = w.map((x, i) => { const keep = Math.max(0, Math.min(16, bits - 16 * i)); return keep === 16 ? x : x & ((0xffff << (16 - keep)) & 0xffff); });
  const str = a => canon(a.map(x => x.toString(16)).join(":"));
  const host = m.slice(); if (bits < 128) host[7] |= 1;
  return { net: str(m) + "/" + bits, ip: str(host) };
}

// how many /24s one list compares (a /22 is four)
export const SEGS = 4;

// The /24s an IPv4 prefix covers, as their .0 addresses: one for a /24 or longer (the /24 it is in), two for a /23,
// four for a /22; null for anything wider
export function v4segs(addr, bits) {
  if (family(addr) !== 4 || !(bits >= 22 && bits <= 32)) return null;
  const o = addr.split(".").map(Number), n = (o[0] << 16) | (o[1] << 8) | o[2];
  const keep = Math.min(24, bits), first = n & ~((1 << (24 - keep)) - 1);
  return Array.from({ length: 1 << (24 - keep) }, (_, i) => { const x = first + i; return `${x >>> 16 & 255}.${x >>> 8 & 255}.${x & 255}.0`; });
}

// An IPv4 range of a /24 or narrower, as the batch page compares it: the /24 it is in (its portrait is read whole,
// for the neighbours), and which of the 256 addresses are the range: { base: "a.b.c.0", lo, bits, n }
export function v4range(addr, bits) {
  const base = v4segs(addr, bits)[0], n = 2 ** (32 - Math.max(24, bits)), last = +addr.split(".")[3];
  return { base, lo: bits > 24 ? last - (last % n) : 0, bits: Math.max(24, bits), n };
}
export const rangeLabel = g => g.base.replace(/\.0$/, "." + g.lo) + "/" + g.bits;
export const inRange = (g, k) => k >= g.lo && k < g.lo + g.n;

// The pasted list: split on spaces, commas, semicolons and new lines (CJK ones too). Each piece is
//   an address, with any port or brackets taken off (1.2.3.4:443, [2001:db8::1]:443): a row;
//   an IPv4 range, a /22 to a /31: a /24 portrait each, up to SEGS of them (a /23 or /22 is two or four /24s; a
//     narrower range is its own addresses inside its /24, as v4range);
//   an IPv6 prefix: a row for the one address that stands for it;
// in canonical form, once each, public ones only.
// → { items: [{ ip, net? }], ips, segs: [v4range ranges], segMore: [ranges past SEGS, as "a.b.c.d/n"],
//     big (IPv4 prefixes wider than a /22), skipped (how many were left out, and as `skip` which ones and why:
//     { priv: [...] private or reserved, with no public data; dup: [...] repeats; bad: [...] not an address }),
//     over (rows past MAX) }
export function parseList(text) {
  const items = [], seen = new Set(), big = [], skip = { priv: [], dup: [], bad: [] }, segs = [], segMore = [];
  let over = 0;
  const add = (tok, ip, net) => {
    if (!ip) { skip.bad.push(tok); return; }
    if (!isPublic(ip)) { skip.priv.push(tok); return; }
    if (seen.has(net || ip)) { skip.dup.push(tok); return; }
    seen.add(net || ip);
    if (items.length >= MAX) { over++; return; }
    items.push(net ? { ip, net } : { ip });
  };
  for (let tok of String(text || "").split(/[\s,;，；、]+/)) {
    if (!tok) continue;
    const p = /^(.+)\/(\d{1,3})$/.exec(tok);
    if (p) {
      const bits = +p[2], f = family(p[1]);
      if (f === 4 && bits <= 32) {
        if (bits === 32) add(tok, p[1]);
        else if (bits < 22) big.push(tok);
        else {
          const ranges = bits > 24 ? [v4range(p[1], bits)] : v4segs(p[1], bits).map(base => ({ base, lo: 0, bits: 24, n: 256 }));
          // a range already there, or inside a whole /24 already there, is a repeat
          const have = g => [...segs.map(rangeLabel), ...segMore].some(l => l === rangeLabel(g) || l === g.base + "/24");
          const fresh = ranges.filter(g => !have(g));
          if (!ranges.some(g => isPublic(g.base))) skip.priv.push(tok);
          else if (!fresh.length) skip.dup.push(tok);
          else for (const g of fresh) { if (!isPublic(g.base)) continue; if (segs.length < SEGS) segs.push(g); else segMore.push(rangeLabel(g)); }
        }
      } else if (f === 6 && bits <= 128) {
        if (bits === 128) add(tok, canon(p[1]));
        else { const n = v6net(p[1], bits); if (n) add(tok, n.ip, n.net); else skip.bad.push(tok); }
      } else skip.bad.push(tok);
      continue;
    }
    const t0 = tok;
    tok = tok.replace(/^\[([0-9a-f:.]+)\](?::\d+)?$/i, "$1").replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1");
    add(t0, canon(tok));
  }
  const skipped = skip.priv.length + skip.dup.length + skip.bad.length;
  return { items, ips: items.map(x => x.ip), segs, segMore, big, skipped, skip, over };
}

// What one row shows, from the `done` event: score and grade, where, the network type, native or broadcast, the
// anonymity flags any source raised, and the verdicts for AI services and streaming
export function rowOf(done) {
  const s = done.summary || {}, f = s.flags || {}, u = done.uses || {};
  const anon = [];
  if (s.torListed || (f.tor && f.tor.yes)) anon.push("tor");
  if (f.vpn && f.vpn.yes) anon.push("vpn");
  if (f.proxy && f.proxy.yes) anon.push("proxy");
  return {
    score: done.score, grade: done.grade, cc: s.cc || null, type: s.type || null,
    native: typeof s.native === "boolean" ? s.native : null, regCc: s.regCc || null, anon,
    ai: u.ai ? u.ai.lv : null, aiWhy: u.ai ? u.ai.why : null, stream: u.stream ? u.stream.lv : null, streamWhy: u.stream ? u.stream.why : null,
  };
}

// The shared link: the rows in a compact form after #b= (never sent to the server), the addresses only when the
// visitor asked for them
const TYPES = ["hosting", "residential", "mobile", "business", "education", "government"];
const LV = ["good", "warn", "bad"];
const ANON = ["tor", "vpn", "proxy"];
const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
const idx = (a, v) => (v == null ? -1 : a.indexOf(v));

// The /24's portrait travels as its 256 statuses (an index into ST each), run-length coded: [[status, count]...];
// its range only with the addresses
const SEG_ST = ["bad", "proxy", "tor", "vpn", "ok"];
export function packSeg(sts) {
  const out = [];
  for (const s of sts) { const k = SEG_ST.indexOf(s); if (out.length && out[out.length - 1][0] === k) out[out.length - 1][1]++; else out.push([k, 1]); }
  return out;
}
export function unpackSeg(runs) {
  if (!Array.isArray(runs) || runs.length > 256) return null;
  const sts = [];
  for (const x of runs) {
    if (!Array.isArray(x) || !Number.isInteger(x[0]) || !SEG_ST[x[0]] || !Number.isInteger(x[1]) || x[1] < 1 || sts.length + x[1] > 256) return null;
    for (let i = 0; i < x[1]; i++) sts.push(SEG_ST[x[0]]);
  }
  return sts.length === 256 ? sts : null;
}

// segs: [{ base: "1.2.3.0", sts: [256 statuses], kind, prefix: { prefix, asns } | null }] for the list's /24s. Each
// travels as its colours and its kind; its range, prefix and AS only with the addresses
const KINDS = ["hosting", "dynamic", "static", "mixed", "unknown"];
export function packRows(rows, { at, withIp = false, segs = [] } = {}) {
  const R = rows.filter(r => r.r).map(({ ip, net, r }) => [r.score, r.cc || "", idx(TYPES, r.type), r.native == null ? -1 : +r.native, r.regCc || "",
    r.anon.reduce((m, a) => m | (1 << ANON.indexOf(a)), 0), idx(LV, r.ai), idx(LV, r.stream), r.aiWhy || "", r.streamWhy || "", ...(withIp ? [ip, net || ""] : [])]);
  const S = segs.map(g => ({ r: packSeg(g.sts), k: idx(KINDS, g.kind), ...(g.bits > 24 ? { l: g.lo, m: g.bits } : {}),
    ...(withIp ? { b: g.base, ...(g.prefix && g.prefix.prefix ? { p: g.prefix.prefix, a: (g.prefix.asns || []).slice(0, 3) } : {}) } : {}) }));
  return b64u(JSON.stringify({ v: 1, at, R, ...(S.length ? { S } : {}) }));
}

export function unpackRows(code) {
  let P;
  try { P = JSON.parse(unb64u(code)); } catch (e) { return null; }
  if (!P || P.v !== 1 || !Array.isArray(P.R)) return null;
  const grade = s => (s >= 85 ? "A" : s >= 70 ? "B" : s >= 50 ? "C" : s >= 30 ? "D" : "F");
  const ok = s => typeof s === "string" && s.length < 80;
  const rows = P.R.slice(0, MAX).map((x, i) => {
    if (!Array.isArray(x) || !Number.isInteger(x[0]) || x[0] < 0 || x[0] > 100) return null;
    const cc = /^[A-Z]{2}$/.test(x[1]) ? x[1] : null, reg = /^[A-Z]{2}$/.test(x[4]) ? x[4] : null;
    const ip = typeof x[10] === "string" ? canon(x[10]) : null;
    const net = typeof x[11] === "string" && /^[0-9a-f:]+\/\d{1,3}$/.test(x[11]) ? x[11] : null;
    return { i, ip: ip && isPublic(ip) ? ip : null, ...(net && ip ? { net } : {}), st: "ok", r: {
      score: x[0], grade: grade(x[0]), cc, type: TYPES[x[2]] || null, native: x[3] === 1 ? true : x[3] === 0 ? false : null, regCc: reg,
      anon: ANON.filter((a, k) => x[5] & (1 << k)), ai: LV[x[6]] || null, stream: LV[x[7]] || null,
      aiWhy: ok(x[8]) && /^u_ai_\w+$/.test(x[8]) ? x[8] : null, streamWhy: ok(x[9]) && /^u_stream_\w+$/.test(x[9]) ? x[9] : null,
    } };
  });
  if (rows.some(r => !r)) return null;
  // the /24s (a link from before there could be several carries one, as an object)
  const segs = [];
  for (const g of (Array.isArray(P.S) ? P.S : P.S ? [P.S] : []).slice(0, SEGS)) {
    const sts = g && unpackSeg(g.r);
    if (!sts) return null;
    const b = typeof g.b === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.0$/.test(g.b) && isPublic(g.b) ? g.b : null;
    const p = b && typeof g.p === "string" && /^[\d.]+\/\d{1,2}$/.test(g.p) ? { prefix: g.p, asns: (Array.isArray(g.a) ? g.a : []).filter(Number.isInteger).slice(0, 3) } : null;
    // a range narrower than its /24: where it starts and its prefix length, aligned
    const m = Number.isInteger(g.m) && g.m > 24 && g.m <= 31 ? g.m : 24, n = 2 ** (32 - m);
    const lo = m > 24 && Number.isInteger(g.l) && g.l >= 0 && g.l < 256 && g.l % n === 0 ? g.l : 0;
    segs.push({ base: b, sts, kind: KINDS[g.k] || "unknown", prefix: p, lo, bits: m, n });
  }
  if (!rows.length && !segs.length) return null;
  return { at: typeof P.at === "string" ? P.at : null, rows, segs };
}

// sort keys: the column's value as a number (unknown last whichever way), the row's place to break ties
const ORDER = { type: TYPES, ai: LV, stream: LV };
export function sortKey(row, col) {
  const r = row.r;
  if (col === "i") return row.i;
  if (!r) return null;
  if (col === "score") return r.score;
  if (col === "ip") return row.ip;
  if (col === "cc") return r.cc;
  if (col === "native") return r.native == null ? null : +r.native;
  if (col === "anon") return r.anon.length;
  const o = ORDER[col], v = o ? o.indexOf(r[col]) : -1;
  return v < 0 ? null : v;
}
export function sortRows(rows, col, dir) {
  return [...rows].sort((a, b) => {
    const x = sortKey(a, col), y = sortKey(b, col);
    if (x == null && y == null) return a.i - b.i;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "string" ? x.localeCompare(y) : x - y;
    return (c || a.i - b.i) * (c ? dir : 1);
  });
}
