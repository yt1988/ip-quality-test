// The /24 portrait, read: what the 1ms.dog server (server/, GET /v1/seg) found for the /24 an IPv4 address is in.
// Every address gets one status, the worst the lists give it (the squares of the map), and the /24 a kind by what its
// reverse names say (the summary). Pure, shared by the page and the tests; the page words it.

// the server's per-address list flags
export const F = { proxy: 1, bad: 2, tor: 4, vpn: 8, dc: 16, drop: 32 };
// statuses, worst first: on a blocklist (IPsum or Spamhaus DROP), an open proxy, a Tor exit, in a VPN provider's
// range, named and on no list, no name and on no list
export const ST = ["bad", "proxy", "tor", "vpn", "ok", "idle"];

export function statusOf(flags, named) {
  if (flags & (F.bad | F.drop)) return "bad";
  if (flags & F.proxy) return "proxy";
  if (flags & F.tor) return "tor";
  if (flags & F.vpn) return "vpn";
  return named ? "ok" : "idle";
}

// A /24's kind by its reverse names (at least 32 named, the largest kind over half of them), or by the data-centre
// list when the names don't say
export function kindOf(r, dc) {
  const named = r.named || 0, k = r.kinds || {};
  const top = ["hosting", "dynamic", "static"].map(x => [x, k[x] || 0]).sort((a, b) => b[1] - a[1])[0];
  if (named >= 32 && top[1] * 2 > named) return { kind: top[0], n: top[1] };
  if (dc >= 128) return { kind: "hosting", n: 0, byList: true };
  if (named >= 32) return { kind: "mixed", n: 0 };
  return { kind: "unknown", n: 0 };
}

const LV = { hosting: "warn", dynamic: "ok", static: "info", mixed: "info", unknown: "none" };
const KIND = { h: "hosting", d: "dynamic", s: "static", a: "anon", m: "mail", o: "other" };

// j: the server's answer; type: what the IP's own check found its network type to be (summary.type); ip: the checked
// address. → { base, kind: {kind, lv}, sum: [[key, params]...] (the kind and anything odd about the names), vs,
// prefix: {prefix, asns} | {none: true} | null, domains: [{d, n}] (the most common three), cells: [{ip, name, kind,
// flags, score, st, me}], count: {status: n}, lists: which lists were read }
export function readSeg(j, type, ip) {
  const r = j.rdns, L = j.lists || {}, base = j.seg.replace(/\.0\/24$/, "");
  const k = kindOf(r, L.dc || 0);
  const sum = [k.byList ? ["sg_kw_dc", {}] : ["sg_kw_" + k.kind, { n: k.n, named: r.named }]];
  if (r.dead) sum.push(["sg_rw_dead", {}]);
  if (r.answered < 240 && !r.dead) sum.push(["sg_rw_part", { n: r.answered }]);
  const px = j.prefix;
  const prefix = px && px.prefix ? { prefix: px.prefix, asns: px.asns || [] } : px ? { none: true } : null;
  const domains = r.dead ? [] : (r.domains || []).slice(0, 3);
  // the IP's databases call it a home or mobile line, but the /24 around it is servers
  const vs = (type === "residential" || type === "mobile") && k.kind === "hosting" ? ["sg_kw_vs", { type }] : null;

  const names = j.names || [], kinds = j.kinds || "", flags = j.flags || [], score = j.score || [];
  const count = Object.fromEntries(ST.map(s => [s, 0]));
  const cells = [];
  for (let i = 0; i < 256; i++) {
    const a = `${base}.${i}`, f = flags[i] || 0, name = names[i] || "";
    const st = statusOf(f, !!name);
    count[st]++;
    cells.push({ ip: a, name, kind: KIND[kinds[i]] || "", flags: f, score: score[i] || 0, st, me: a === ip });
  }
  const lists = { proxy: L.proxy != null, bad: L.bad != null || L.drop != null, tor: L.tor != null, vpn: L.vpn != null };
  return { base, kind: { kind: k.kind, lv: vs ? "bad" : LV[k.kind] }, sum, vs, prefix, domains, cells, count, lists };
}

// what one address is, as [key, params] lines: its listings, worst first, or that it is on none
export function addrLines(c) {
  const out = [];
  if (c.flags & F.drop) out.push(["sg_a_drop", {}]);
  if (c.flags & F.bad) out.push(["sg_a_bad", { n: c.score }]);
  if (c.flags & F.proxy) out.push(["sg_a_px", {}]);
  if (c.flags & F.tor) out.push(["sg_a_tor", {}]);
  if (c.flags & F.vpn) out.push(["sg_a_vpn", {}]);
  if (!out.length) out.push(["sg_a_clean", {}]);
  return out;
}
