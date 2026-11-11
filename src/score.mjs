// Turns what the sources said (src/sources.mjs) into one score, a verdict per use, and notes worth reading.
// Pure: the Worker runs it, the tests import it. Text is left to the page: notes carry a key and parameters.

// Where OpenAI and Anthropic don't offer their services (both companies' published lists agree on these)
export const AI_BLOCKED = ["CN", "HK", "MO", "RU", "BY", "IR", "KP", "SY", "CU"];

// How much a source's risk score counts in the average: dedicated fraud scores weigh more than coarse ones
const RISK_W = { ipqs: 2, scamalytics: 2, abuseipdb: 2, proxycheck: 1.5, ipdata: 1, ipapiis: 1, ipquery: 0.5 };
// Preferred sources for the city, when several agree on the country
const GEO_PREF = ["ipinfo", "cloudflare", "ipqs", "ipapi", "ip2location", "proxycheck", "ipquery", "ipapiis", "ipdata"];

export const GRADES = [[85, "A"], [70, "B"], [50, "C"], [30, "D"], [0, "F"]];
export const gradeOf = s => GRADES.find(([min]) => s >= min)[1];
const ORDER = GRADES.map(([, g]) => g);
const worse = (a, b) => ORDER[Math.max(ORDER.indexOf(a), ORDER.indexOf(b))];

// A mail blocklist's weight in the score: UCEPROTECT L1 flags whole ranges for one neighbour, so it counts half
export const BL_W = { uceprotect: 0.5 };
// A finding only one source made counts half: one source's mistake shouldn't cost the whole deduction
const HALF = of => of > 1 ? 1 : 0.5;
// The fields that make a source a "risk source": it said something about reputation, not just where the address is
const RISK_KEYS = ["risk", "proxy", "vpn", "tor", "relay", "abuser"];

const count = (list, f) => { const m = new Map(); for (const x of list) { const k = f(x); if (k != null) m.set(k, (m.get(k) || 0) + 1); } return m; };
const top = m => [...m.entries()].sort((a, b) => b[1] - a[1])[0];

// results: [{ id, data }] for the sources that answered; dnsbl: [{ id, name, listed: true|false|null }]
export function assess(results, dnsbl = []) {
  const by = Object.fromEntries(results.map(r => [r.id, r.data]));
  const geo = results.filter(r => r.data.cc);
  // Our own daily lists read for this address, RIPE's routing data, and the PTR reading
  const L = (by.lists && by.lists.lists) || {};
  const routing = by.routing || {}, ptr = by.ptr || {};
  const listBad = +L.bad || 0, listDrop = L.drop === true, listAsn = L.asndrop === true;
  const listRelay = L.relay === true, listTorRelay = L.torrelay === true;
  // the provider's own cloud/CDN range, the /24's list counts, the bogon flag and the OTX pulses: facts the page
  // shows beside the score (an edge is shared infrastructure, so it does not take the hosting deduction)
  const cloud = by.lists?.cloud || null, region = by.lists?.region || null;
  const edge = by.lists?.edge === true, bogon = by.lists?.bogon === true, near = by.lists?.near || null;
  const route = { firstSeen: routing.firstSeen || null, seen: +routing.seen || 0, of: +routing.of || 0,
    moas: routing.moas === true, asns: +routing.asns || 0 };
  const otx = by.otx?.otx || null;

  // country: the one most sources agree on; city and network from the most trusted source that agrees
  const ccVotes = count(geo, r => r.data.cc), cc = ccVotes.size ? top(ccVotes)[0] : null;
  const ccs = [...ccVotes.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => ({ cc: c, by: geo.filter(r => r.data.cc === c).map(r => r.id) }));
  const pref = r => { const i = GEO_PREF.indexOf(r.id); return i < 0 ? 99 : i; };
  const geoMain = geo.filter(r => r.data.cc === cc).sort((a, b) => pref(a) - pref(b));
  const city = (geoMain.find(r => r.data.city) || {}).data?.city || null;
  // every city the databases gave, most agreed on first (the one shown is the most trusted source's, as before)
  const cityMap = new Map();
  for (const r of geo) if (r.data.city) {
    const k = String(r.data.city).toLowerCase().trim();
    const e = cityMap.get(k) || { city: r.data.city, by: [] };
    e.by.push(r.id); cityMap.set(k, e);
  }
  const cities = [...cityMap.values()].sort((a, b) => b.by.length - a.by.length);
  const asnVotes = count(results, r => r.data.asn), asn = asnVotes.size ? top(asnVotes)[0] : null;
  const org = (["ipguide", "ipinfo", "cloudflare", "ipapiis", "proxycheck", "ipapi"].map(id => by[id]).find(d => d && d.org && (!asn || d.asn === asn)) || {}).org ||
    (results.find(r => r.data.org) || {}).data?.org || null;
  const host = (["ipapi", "ipinfo", "proxycheck", "shodan", "ipqs", "abuseipdb"].map(id => by[id]).find(d => d && d.host) || {}).host || null;

  // registered country: the RIR record, or else the autonomous system's
  const regCc = by.rdap?.regCc || by.ipguide?.asCc || null, regFrom = by.rdap?.regCc ? "rir" : regCc ? "asn" : null;
  const native = regCc && cc ? regCc === cc : null;

  // network use: a vote per source that says
  const typed = results.filter(r => r.data.type), tv = count(typed, r => r.data.type);
  const share = t => typed.length ? (tv.get(t) || 0) / typed.length : 0;
  // residential is the fallback: sources only flag hosting/mobile, so "not hosting" from them counts for residential
  const notHosting = ["ipapi", "ipquery"].filter(id => by[id] && !by[id].type).length;
  const typeVotes = typed.length + notHosting;
  const hostShare = typeVotes ? (tv.get("hosting") || 0) / typeVotes : 0;
  let type = tv.size ? top(tv)[0] : null;
  if (type === "hosting" && hostShare < 0.5) type = (tv.get("mobile") ? "mobile" : null);
  if (!type && typeVotes) type = "residential";

  // yes/no flags: how many of the sources that say anything say yes
  const flag = k => { const s = results.filter(r => typeof r.data[k] === "boolean"); const y = s.filter(r => r.data[k]); return { yes: y.length, of: s.length, by: y.map(r => r.id) }; };
  const flags = { proxy: flag("proxy"), vpn: flag("vpn"), tor: flag("tor"), relay: flag("relay"), abuser: flag("abuser") };
  const rate = f => f.of ? f.yes / f.of * HALF(f.of) : 0;
  const torListed = by.tor?.tor === true;
  const anyFlag = flags.proxy.yes || flags.vpn.yes || flags.tor.yes;

  const risks = results.filter(r => typeof r.data.risk === "number").map(r => ({ id: r.id, v: r.data.risk, w: RISK_W[r.id] || 1 }));
  const wsum = risks.reduce((a, r) => a + r.w, 0);
  const risk = wsum ? Math.round(risks.reduce((a, r) => a + r.v * r.w, 0) / wsum) : null;
  // sources that said anything about reputation (not just location): the basis of the confidence below. The public
  // lists count when they name the address, and an invalid RPKI record is a finding too.
  const riskSources = results.filter(r => RISK_KEYS.some(k => r.data[k] !== undefined) ||
    (r.id === "lists" && (listBad || listDrop || listAsn || listRelay)) || r.data.rpki === "invalid").length;

  // mail blocklists: a listed address takes 6 points each, UCEPROTECT (whole ranges for one neighbour) half
  const bl = dnsbl.filter(d => d.listed === true), blChecked = dnsbl.filter(d => d.listed !== null).length;
  const blW = bl.reduce((a, d) => a + (BL_W[d.id] ?? 1), 0);
  const ports = by.shodan?.ports || [], tags = by.shodan?.tags || [];

  // ---- the score: start at 100, take off for each finding (each part is shown on the page)
  const parts = [];
  const take = (k, pts, p) => { pts = Math.round(pts); if (pts > 0) parts.push({ k, pts, p }); };
  // a data-center majority takes the full 20: a clean server address tops out at B, never "residential-looking" A.
  // A CDN edge is shared infrastructure, not a host someone rented, so it does not take this deduction.
  if (!edge) take("p_hosting", (type === "hosting" ? 20 : 20 * hostShare) * HALF(typeVotes), { n: tv.get("hosting") || 0, of: typeVotes });
  if (type !== "hosting") take("p_business", 5 * share("business") * HALF(typed.length), {});
  take("p_proxy", 20 * rate(flags.proxy), { n: flags.proxy.yes, of: flags.proxy.of });
  take("p_vpn", 15 * rate(flags.vpn), { n: flags.vpn.yes, of: flags.vpn.of });
  take("p_tor", torListed ? 75 : 75 * rate(flags.tor), { n: flags.tor.yes, of: flags.tor.of });
  take("p_abuser", 10 * rate(flags.abuser), { n: flags.abuser.yes, of: flags.abuser.of });
  if (risk !== null) take("p_risk", 0.35 * risk * HALF(risks.length), { v: risk });
  take("p_dnsbl", Math.min(24, 6 * blW), { n: bl.length });
  // the public lists: a source that already names the address keeps IPsum from counting the same thing twice;
  // DROP and ASN-DROP are range-wide findings, so they always count (ASN-DROP at half, like UCEPROTECT)
  if (listBad && !(anyFlag || flags.abuser.yes || torListed)) take("p_lists", listBad >= 3 ? 8 : 4, { v: listBad });
  if (listDrop) take("p_drop", 15, {});
  if (listAsn) take("p_asndrop", 3, {});
  if (flags.relay.of) take("p_relay", 5 * rate(flags.relay), { n: flags.relay.yes, of: flags.relay.of });
  const score = Math.max(0, 100 - parts.reduce((a, p) => a + p.pts, 0));

  // ---- the grade: the score's own, capped by what no A (or B) may carry
  //   on a mail blocklist → at most B; on two or more (UCEPROTECT half) → at most C; too few risk sources → at most B
  //   (a Tor exit reaches F by its own 75 points, so score and grade still agree)
  const natural = gradeOf(score);
  let grade = natural;
  const caps = [];
  const listHits = (listBad ? 1 : 0) + (listDrop ? 1 : 0) + (listAsn ? 0.5 : 0);
  if (blW >= 1) caps.push({ g: blW >= 2 ? "C" : "B", k: "n_cap_bl", p: { n: bl.length } });
  if (listHits > 0) caps.push({ g: listHits >= 2 ? "C" : "B", k: "n_cap_lists", p: { n: [listBad > 0, listDrop, listAsn].filter(Boolean).length } });
  if (riskSources < 2) caps.push({ g: "B", k: "n_cap_conf", p: {} });
  for (const c of caps) grade = worse(grade, c.g);
  const cap = grade !== natural ? caps.sort((a, b) => ORDER.indexOf(b.g) - ORDER.indexOf(a.g)).find(c => ORDER.indexOf(c.g) > ORDER.indexOf(natural)) : null;

  // ---- notes: what the findings mean, most important first
  const notes = [];
  const note = (lv, k, p = {}) => notes.push({ lv, k, p });
  if (torListed || rate(flags.tor) >= 0.5) note("bad", "n_tor");
  else if (flags.vpn.yes || flags.proxy.yes) note(rate(flags.vpn) + rate(flags.proxy) >= 0.5 ? "bad" : "warn", "n_anon", { n: new Set([...flags.vpn.by, ...flags.proxy.by]).size });
  else if (typeVotes && !flags.relay.yes) note("good", "n_noanon");
  if (type) note(type === "hosting" ? "warn" : type === "residential" || type === "mobile" ? "good" : "info", "n_type_" + type);
  if (type === "mobile") note("info", "n_cgnat");
  if (native === true) note("good", "n_native", { reg: regCc });
  else if (native === false) note("warn", regFrom === "rir" ? "n_broadcast" : "n_broadcast_as", { reg: regCc, cc });
  if (ccs.length > 1) note("warn", "n_geo_split", { list: ccs.map(c => c.cc) });
  if (risk !== null) note(risk >= 70 ? "bad" : risk >= 35 ? "warn" : "good", risk >= 70 ? "n_risk_high" : risk >= 35 ? "n_risk_mid" : "n_risk_low", { v: risk, n: risks.length });
  if (flags.abuser.yes) note("bad", "n_abuser", { n: flags.abuser.yes });
  if (bl.length) note("bad", "n_dnsbl", { n: bl.length, of: blChecked, list: bl.map(d => d.name) });
  else if (blChecked) note("good", "n_dnsbl_ok", { of: blChecked });
  if (listBad) note(listBad >= 3 ? "bad" : "warn", "n_lists", { v: listBad });
  if (listDrop) note("bad", "n_drop");
  if (listAsn) note("bad", "n_asndrop");
  if (listTorRelay) note("info", "n_torrelay");
  if (routing.announced === false) note("warn", "n_unannounced", { prefix: routing.prefix || "" });
  if (routing.rpki === "invalid") note("bad", "n_rpki_invalid", {});
  if (ptr.fcrdns === false && ptr.host) note("info", "n_fcrdns_no");
  if (cap) note("warn", cap.k, { ...cap.p, g: grade });
  if (flags.relay.yes) note("info", "n_relay");
  if (bogon) note("bad", "n_bogon");
  if (edge) note("info", "n_edge", { p: cloud || "" });
  else if (cloud) note("info", "n_cloud", { p: cloud + (region ? " · " + region : "") });
  if (near && near.listed) note("warn", "n_near", { n: near.listed, of: near.of || 256, bad: near.bad || 0 });
  if (route.of && route.seen / route.of < 0.1) note("warn", "n_route_low", { seen: route.seen, of: route.of });
  if (route.moas) note("info", "n_route_moas", { n: route.asns });
  if (otx && otx.white) note("good", "n_otx_white");
  else if (otx && otx.pulses >= 3) note("warn", "n_otx", { n: otx.pulses });
  else if (otx && otx.pulses) note("info", "n_otx_some", { n: otx.pulses });
  if (by.ipinfo?.anycast) note("info", "n_anycast");
  if (tags.length && tags.some(t => ["vpn", "proxy", "tor"].includes(t))) note("warn", "n_scan_tags", { list: tags });
  if (ports.length) note("info", "n_ports", { list: ports.slice(0, 8) });
  const risky = ports.filter(p => [23, 445, 3389, 135, 139, 5900, 6379, 27017, 9200, 2375, 11211].includes(p));
  if (risky.length) note("warn", "n_risky_ports", { list: risky.slice(0, 8) });

  // ---- by use: good / warn / bad
  const hosting = type === "hosting";
  const uses = {};
  const set = (k, lv, why) => { uses[k] = { lv, why }; };
  // streaming: catalogs follow the location; VPN and data-center detection is what blocks
  if (torListed || rate(flags.vpn) + rate(flags.proxy) >= 0.5) set("stream", "bad", "u_stream_vpn");
  else if (hosting || anyFlag) set("stream", "warn", hosting ? "u_stream_dc" : "u_stream_flag");
  else if (native === false || ccs.length > 1) set("stream", "warn", "u_stream_geo");
  else set("stream", "good", "u_stream_ok");
  // AI services: region first, then reputation
  if (cc && AI_BLOCKED.includes(cc)) set("ai", "bad", "u_ai_region");
  else if (torListed || (risk !== null && risk >= 70)) set("ai", "bad", "u_ai_risk");
  else if (hosting && (anyFlag || (risk !== null && risk >= 35))) set("ai", "warn", "u_ai_dc");
  else set("ai", "good", "u_ai_ok");
  // search engines and Cloudflare-protected sites: CAPTCHAs follow reputation
  if (torListed || (risk !== null && risk >= 75) || bl.length >= 2) set("captcha", "bad", "u_captcha_bad");
  else if ((risk !== null && risk >= 40) || (hosting && anyFlag) || bl.length) set("captcha", "warn", "u_captcha_some");
  else set("captcha", "good", "u_captcha_ok");
  // sign-ups and payments: fraud checks weigh risk scores, anonymizers and data centers
  if (torListed || (risk !== null && risk >= 70) || flags.abuser.yes >= 2) set("account", "bad", "u_account_bad");
  else if ((risk !== null && risk >= 35) || anyFlag || hosting || flags.abuser.yes) set("account", "warn", "u_account_some");
  else set("account", "good", "u_account_ok");
  // sending mail directly: blocklists, and home connections are refused by policy
  if (bl.length) set("mail", "bad", "u_mail_listed");
  else if (type === "residential" || type === "mobile") set("mail", "warn", "u_mail_home");
  else if (!host) set("mail", "warn", "u_mail_rdns");
  else if (ptr.fcrdns === false) set("mail", "warn", "u_mail_fcrdns");
  else set("mail", "good", "u_mail_ok");

  // ---- how much the verdict rests on: the sources that answered, the ones that said anything about risk, and
  // whether they disagreed. A single-source flag or a split makes it "mid"; very few sources or risk readings, "low".
  const split = ["proxy", "vpn", "tor", "abuser"].some(k => flags[k].of > 1 && flags[k].yes > 0 && flags[k].yes < flags[k].of);
  const single = ["proxy", "vpn", "tor", "abuser"].some(k => flags[k].of === 1 && flags[k].yes > 0);
  const answered = results.length;
  const level = answered < 3 || riskSources < 2 ? "low" : split || single ? "mid" : "high";
  const confidence = { level, sources: answered, riskSources };

  return {
    score, grade, parts, notes, uses, confidence,
    summary: { cc, city, cities, ccs, asn, org, host, type, hostShare: Math.round(hostShare * 100) / 100, regCc, regFrom, native, risk, risks, flags, torListed,
      ports, tags, regName: by.rdap?.regName || null, regDate: by.rdap?.regDate || null, rir: by.rdap?.rir || by.ipguide?.rir || by.ipapiis?.rir || null,
      riskSources, dnsbl: { listed: bl.length, checked: blChecked, weighted: Math.round(blW * 10) / 10 }, cap: cap ? cap.k : null,
      lists: { bad: listBad, drop: listDrop, asndrop: listAsn, relay: listRelay, torrelay: listTorRelay, proxy: L.proxy === true, vpn: L.vpn === true,
        dc: L.dc === true, at: L.at || null },
      cloud, region, edge, bogon, near, route, otx, abuse: routing.abuse || null,
      routing: { announced: typeof routing.announced === "boolean" ? routing.announced : null, rpki: routing.rpki || null, prefix: routing.prefix || null,
        firstSeen: route.firstSeen, seen: route.seen, of: route.of, moas: route.moas, asns: route.asns },
      ptr: { host: ptr.host || null, fcrdns: typeof ptr.fcrdns === "boolean" ? ptr.fcrdns : null, type: ptr.ptrType || null },
    },
  };
}
