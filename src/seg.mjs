// The /24 portrait, read: what the 1ms.dog server (server/, GET /v1/seg) found for the /24 an IPv4 address is in,
// turned into six findings, each { lv, k (the short answer's key), p (its numbers), why: [[key, params]...] }.
// Pure, shared by the page and the tests; the page words it.

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

// j: the server's answer; type: what the IP's own check found its network type to be (summary.type)
export function readSeg(j, type) {
  const r = j.rdns, L = j.lists || {}, out = {};
  const k = kindOf(r, L.dc || 0);
  const kw = [k.byList ? ["sg_kw_dc", {}] : ["sg_kw_" + k.kind, { n: k.n, named: r.named }]];
  if (!k.byList && k.kind === "hosting" && L.dc >= 128) kw.push(["sg_kw_dc", {}]);
  // the IP's databases call it a home or mobile line, but the /24 around it is servers
  const home = type === "residential" || type === "mobile";
  if (home && k.kind === "hosting") kw.push(["sg_kw_vs", { type }]);
  out.kind = { lv: home && k.kind === "hosting" ? "bad" : LV[k.kind], k: "sg_k_" + k.kind, p: {}, why: kw };

  const rw = [r.dead ? ["sg_rw_dead", {}] : r.named ? ["sg_rw", { named: r.named, list: (r.domains || []).slice(0, 3).map(d => `${d.d} (${d.n})`) }] : ["sg_rw_none", {}]];
  if ((r.samples || []).length) rw.push(["sg_rw_ex", { list: r.samples.slice(0, 3) }]);
  // (the server keeps a sweep for a week from 240 answers; below that it says so)
  if (r.answered < 240 && !r.dead) rw.push(["sg_rw_part", { n: r.answered }]);
  out.rdns = { lv: "info", k: "", p: { named: r.named, top: r.domains && r.domains[0] ? r.domains[0].d : "" }, why: rw };

  // open proxies and VPN providers' ranges
  if (L.proxy == null && L.vpn == null) out.anon = { lv: "none", k: "sg_none", p: {}, why: [["sg_aw_down", {}]] };
  else {
    const px = L.proxy || 0, vpn = L.vpn || 0, why = [];
    if (px) why.push(["sg_aw_proxy", { n: px }]);
    if (vpn) why.push(["sg_aw_vpn", { n: vpn }]);
    if (!px && !vpn) why.push(["sg_aw_none", {}]);
    if (L.proxy == null) why.push(["sg_aw_noproxy", {}]);
    out.anon = { lv: px >= 32 || vpn >= 128 ? "bad" : px || vpn ? "warn" : "ok", k: px ? "sg_a_proxy" : vpn ? "sg_a_vpn" : "sg_a_none", p: { n: px }, why };
  }

  // blocklists: IPsum's addresses, Spamhaus DROP's ranges
  if (L.bad == null && L.drop == null) out.bad = { lv: "none", k: "sg_none", p: {}, why: [["sg_bw_down", {}]] };
  else {
    const b = L.bad || 0, d = L.drop || 0, why = [];
    if (d) why.push(["sg_bw_drop", {}]);
    if (b) why.push(["sg_bw_n", { n: b, max: L.badMax }]);
    if (!b && !d) why.push(["sg_bw_none", {}]);
    out.bad = { lv: d || b >= 32 ? "bad" : b ? "warn" : "ok", k: d ? "sg_b_drop" : b ? "sg_b_n" : "sg_b_none", p: { n: b }, why };
  }

  if (L.tor == null) out.tor = { lv: "none", k: "sg_none", p: {}, why: [["sg_tw_down", {}]] };
  else out.tor = { lv: L.tor ? "warn" : "ok", k: L.tor ? "sg_t_n" : "sg_t_none", p: { n: L.tor }, why: [[L.tor ? "sg_tw_n" : "sg_tw_none", { n: L.tor }]] };

  const px = j.prefix;
  out.prefix = !px ? { lv: "none", k: "sg_none", p: {}, why: [["sg_pw_down", {}]] }
    : !px.prefix ? { lv: "warn", k: "sg_p_none", p: {}, why: [["sg_pw_none", {}]] }
    : { lv: "info", k: "", p: { prefix: px.prefix, asns: px.asns || [] }, why: [["sg_pw", { prefix: px.prefix, as: (px.asns || []).map(a => "AS" + a) }]] };
  return out;
}
