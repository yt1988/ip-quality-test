// The batch page, read: the list a visitor pastes, one table row per address from the API's `done` event, and the
// shared link's payload. Pure, shared by the page (src/batch.js) and the tests.
import { canon, isPublic } from "./ip.mjs";

// one batch: as many fresh lookups as the Worker allows one visitor a minute (wrangler.toml, LIMIT)
export const MAX = 20;

// The addresses in a pasted list: split on spaces, commas, semicolons and new lines (CJK ones too), each with any
// port or brackets taken off (1.2.3.4:443, [2001:db8::1]:443), in canonical form, once each, public ones only.
// → { ips, skipped (not an address, private or a repeat), over (public addresses past MAX, left out) }
export function parseList(text) {
  const ips = [], seen = new Set();
  let skipped = 0, over = 0;
  for (let tok of String(text || "").split(/[\s,;，；、]+/)) {
    if (!tok) continue;
    tok = tok.replace(/^\[([0-9a-f:.]+)\](?::\d+)?$/i, "$1").replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1");
    const ip = canon(tok);
    if (!ip || !isPublic(ip) || seen.has(ip)) { skipped++; continue; }
    seen.add(ip);
    if (ips.length >= MAX) { over++; continue; }
    ips.push(ip);
  }
  return { ips, skipped, over };
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

export function packRows(rows, { at, withIp = false } = {}) {
  const R = rows.filter(r => r.r).map(({ ip, r }) => [r.score, r.cc || "", idx(TYPES, r.type), r.native == null ? -1 : +r.native, r.regCc || "",
    r.anon.reduce((m, a) => m | (1 << ANON.indexOf(a)), 0), idx(LV, r.ai), idx(LV, r.stream), r.aiWhy || "", r.streamWhy || "", ...(withIp ? [ip] : [])]);
  return b64u(JSON.stringify({ v: 1, at, R }));
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
    return { i, ip: ip && isPublic(ip) ? ip : null, st: "ok", r: {
      score: x[0], grade: grade(x[0]), cc, type: TYPES[x[2]] || null, native: x[3] === 1 ? true : x[3] === 0 ? false : null, regCc: reg,
      anon: ANON.filter((a, k) => x[5] & (1 << k)), ai: LV[x[6]] || null, stream: LV[x[7]] || null,
      aiWhy: ok(x[8]) && /^u_ai_\w+$/.test(x[8]) ? x[8] : null, streamWhy: ok(x[9]) && /^u_stream_\w+$/.test(x[9]) ? x[9] : null,
    } };
  });
  if (rows.some(r => !r)) return null;
  return { at: typeof P.at === "string" ? P.at : null, rows };
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
