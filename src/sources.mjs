// The databases an address is checked against. Each source turns its own answer into one shape, so the score
// (src/score.mjs) and the page can compare them field by field:
//
//   cc, city, asn, org, host        where it is and who runs it (host: reverse DNS)
//   type                            hosting | residential | mobile | business | education | government
//   proxy, vpn, tor, relay, abuser  true / false; missing when the source doesn't say
//   risk                            0–100, higher is worse (each source's own fraud or abuse score)
//   regCc, regName, regDate, rir    what the regional internet registry has on file (RDAP)
//   ports, tags                     open ports and labels seen by internet-wide scans (Shodan)
//   extra                           a few more facts worth showing, as [label key, value] pairs
//
// key:  the Worker secrets a source needs (all of them); a source without its secrets is skipped
// v6:   false when the source has nothing on IPv6 addresses
// browser: "only" for sources that limit Cloudflare's shared addresses (the page asks them from the visitor's browser
//       instead, on the visitor's own quota); "retry" for sources the page asks again from the browser when the server
//       got no answer. Both need the source to answer CORS.
// site: the source's own page for the address, so a visitor can check the answer at the source

const UA = "ipqs (+https://github.com/yt1988/ip-quality-test)";

export async function getJSON(url, { headers = {}, ms = 4500 } = {}) {
  // a browser sends its own User-Agent (setting one would also make the request need a CORS preflight)
  const h = typeof window === "undefined" ? { "User-Agent": UA, Accept: "application/json", ...headers } : { Accept: "application/json", ...headers };
  const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// The many ways sources name a network's use, mapped to ours
export function mapType(s) {
  const t = String(s || "").toLowerCase();
  if (!t) return undefined;
  if (/hosting|data ?cent|datacenter|\bdch\b|cdn|content delivery|transit|server|cloud/.test(t)) return "hosting";
  if (/mobile|wireless|cellular|\bmob\b/.test(t)) return "mobile";
  if (/residential|fixed line|\bisp\b|broadband|dsl|cable|home/.test(t)) return "residential";
  if (/educat|universit|college|school|\bedu\b/.test(t)) return "education";
  if (/government|\bgov\b|military|\bmil\b/.test(t)) return "government";
  if (/business|commercial|corporate|organi[sz]ation|\bcom\b|search engine|library/.test(t)) return "business";
  return undefined;
}
const asnOf = v => { const m = /(\d+)/.exec(String(v ?? "")); return m ? +m[1] : undefined; };
const bool = v => v === true || v === "yes" || v === 1 ? true : v === false || v === "no" || v === 0 ? false : undefined;
const num = v => Number.isFinite(+v) && v !== null && v !== "" ? Math.max(0, Math.min(100, Math.round(+v))) : undefined;
const upper = s => /^[a-z]{2}$/i.test(s || "") ? s.toUpperCase() : undefined;
// English country name → code, for sources that only give the name (ipapi.is without a key)
let CC_OF;
export function ccOfName(name) {
  if (!name) return undefined;
  if (!CC_OF) {
    CC_OF = new Map();
    try {
      const dn = new Intl.DisplayNames(["en"], { type: "region" }), A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      for (const a of A) for (const b of A) { const n = dn.of(a + b); if (n && n !== a + b) CC_OF.set(n.toLowerCase(), a + b); }
    } catch (e) {}
    // names the sources use that differ from the standard short names
    for (const [n, c] of [["hong kong", "HK"], ["macau", "MO"], ["macao", "MO"], ["taiwan", "TW"], ["czech republic", "CZ"], ["turkey", "TR"],
      ["united states of america", "US"], ["russian federation", "RU"], ["republic of korea", "KR"], ["viet nam", "VN"]]) CC_OF.set(n, c);
  }
  return CC_OF.get(String(name).toLowerCase());
}

export const SOURCES = [
  {
    // Only for the visitor's own address: what Cloudflare's edge sees for this very request
    id: "cloudflare", name: "Cloudflare", own: true,
    site: () => "https://radar.cloudflare.com/ip",
    async run(ip, { cf }) {
      if (!cf || !cf.country) throw new Error("no cf");
      return { cc: upper(cf.country), city: cf.city, asn: asnOf(cf.asn), org: cf.asOrganization };
    },
  },
  {
    id: "ipapi", name: "ip-api.com",
    site: ip => "https://ip-api.com/#" + ip,
    async run(ip) {
      // the free endpoint is HTTP only (requests leave from the Worker, never the visitor's browser)
      const j = await getJSON(`http://ip-api.com/json/${ip}?fields=status,message,countryCode,city,isp,org,as,reverse,mobile,proxy,hosting`);
      if (j.status !== "success") throw new Error(j.message || "fail");
      return { cc: upper(j.countryCode), city: j.city, asn: asnOf(j.as), org: j.org || j.isp, host: j.reverse || undefined,
        type: j.hosting ? "hosting" : j.mobile ? "mobile" : undefined, proxy: bool(j.proxy), mobile: bool(j.mobile) };
    },
  },
  {
    // refuses Cloudflare's shared addresses without a key, so it runs only with one
    id: "proxycheck", name: "proxycheck.io", key: ["PROXYCHECK_KEY"],
    site: ip => "https://proxycheck.io/threats/" + ip,
    async run(ip, { env }) {
      const k = "?key=" + encodeURIComponent(env.PROXYCHECK_KEY);
      const j = await getJSON(`https://proxycheck.io/v3/${ip}${k}`);
      const d = j[ip] || Object.values(j).find(v => v && typeof v === "object" && v.network);
      if (j.status === "error" || j.status === "denied" || !d) throw new Error(j.message || j.status || "fail");
      const n = d.network || {}, x = d.detections || {}, l = d.location || {};
      const extra = [];
      if (d.operator && d.operator.name) extra.push(["x_operator", d.operator.name]);
      if (d.device_estimate) extra.push(["x_devices", `${d.device_estimate.address ?? "?"} / ${d.device_estimate.subnet ?? "?"}`]);
      if (x.last_seen && (x.proxy || x.vpn)) extra.push(["x_last_seen", String(x.last_seen).slice(0, 10)]);
      return { cc: upper(l.country_code), city: l.city_name, asn: asnOf(n.asn), org: n.organisation || n.provider, host: n.hostname || undefined,
        type: mapType(n.type), proxy: bool(x.proxy), vpn: bool(x.vpn), tor: bool(x.tor), abuser: x.compromised ? true : undefined,
        risk: num(x.risk), extra };
    },
  },
  {
    id: "ipquery", name: "IPQuery", browser: "retry",
    site: ip => "https://ipquery.io/?ip=" + ip,
    async run(ip) {
      const j = await getJSON(`https://api.ipquery.io/${ip}`);
      const r = j.risk || {}, isp = j.isp || {}, l = j.location || {};
      return { cc: upper(l.country_code), city: l.city, asn: asnOf(isp.asn), org: isp.org || isp.isp,
        type: r.is_datacenter ? "hosting" : r.is_mobile ? "mobile" : undefined,
        proxy: bool(r.is_proxy), vpn: bool(r.is_vpn), tor: bool(r.is_tor), risk: num(r.risk_score) };
    },
  },
  {
    id: "ipapiis", name: "ipapi.is", opt: ["IPAPI_IS_KEY"], browser: "retry",
    site: ip => "https://ipapi.is/?q=" + ip,
    async run(ip, { env }) {
      const k = env.IPAPI_IS_KEY ? "&key=" + encodeURIComponent(env.IPAPI_IS_KEY) : "";
      const j = await getJSON(`https://api.ipapi.is/?q=${ip}${k}`);
      if (j.error) throw new Error(String(j.error));
      // Without a key the answer is cut down to location and network names
      const a = typeof j.asn === "object" && j.asn ? j.asn : {}, c = typeof j.company === "object" && j.company ? j.company : {};
      const loc = j.location || {};
      const label = String(c.abuser_score || a.abuser_score || "");
      const LV = { "very low": 3, "low": 10, "elevated": 40, "high": 70, "very high": 90 };
      const lv = (/\(([^)]+)\)/.exec(label) || [])[1];
      // Workers have no Intl.DisplayNames: when the name can't be mapped here, it travels as cname and the page maps it
      const cc = upper(loc.country_code) || ccOfName(j.country);
      return { cc, cname: cc ? undefined : j.country, city: loc.city || j.city, asn: a.asn || asnOf(j.asn),
        org: c.name || (typeof j.company === "string" ? j.company : undefined) || a.org,
        type: j.is_datacenter ? "hosting" : j.is_mobile ? "mobile" : mapType(c.type || a.type),
        proxy: bool(j.is_proxy), vpn: bool(j.is_vpn), tor: bool(j.is_tor), abuser: bool(j.is_abuser),
        risk: lv ? LV[lv.toLowerCase()] : undefined,
        rir: a.rir, extra: lv ? [["x_net_abuse", lv]] : [] };
    },
  },
  {
    // rate-limits Cloudflare's shared addresses without a key, so it runs only with one
    id: "ip2location", name: "IP2Location", key: ["IP2LOCATION_KEY"],
    site: ip => "https://www.ip2location.io/" + ip,
    async run(ip, { env }) {
      const k = "&key=" + encodeURIComponent(env.IP2LOCATION_KEY);
      const j = await getJSON(`https://api.ip2location.io/?ip=${ip}${k}`);
      if (j.error) throw new Error(j.error.error_message || "fail");
      return { cc: upper(j.country_code), city: j.city_name, asn: asnOf(j.asn), org: j.as, proxy: bool(j.is_proxy) };
    },
  },
  {
    id: "ipinfo", name: "IPinfo", opt: ["IPINFO_TOKEN"], browser: "only",
    site: ip => "https://ipinfo.io/" + ip,
    async run(ip, { env }) {
      const k = env.IPINFO_TOKEN ? "?token=" + encodeURIComponent(env.IPINFO_TOKEN) : "";
      const j = await getJSON(`https://ipinfo.io/${ip}/json${k}`);
      if (j.error || j.bogon) throw new Error("fail");
      return { cc: upper(j.country), city: j.city, asn: asnOf(j.org), org: String(j.org || "").replace(/^AS\d+\s*/, "") || undefined,
        host: j.hostname, anycast: j.anycast === true ? true : undefined };
    },
  },
  // geolocation databases: where the address is and whose network it is (more votes for the country)
  {
    id: "ipwho", name: "ipwho.is", browser: "only",
    site: ip => "https://ipwho.is/" + ip,
    async run(ip) {
      const j = await getJSON(`https://ipwho.is/${ip}`);
      if (!j.success) throw new Error(j.message || "fail");
      const c = j.connection || {};
      return { cc: upper(j.country_code), city: j.city, asn: asnOf(c.asn), org: c.org || c.isp };
    },
  },
  {
    // answers Cloudflare's shared addresses with 429 every time, so only the browser asks it
    id: "ipsb", name: "IP.SB", browser: "only",
    site: ip => "https://ip.sb/ip/" + ip,
    async run(ip) {
      const j = await getJSON(`https://api.ip.sb/geoip/${ip}`);
      return { cc: upper(j.country_code), city: j.city, asn: asnOf(j.asn), org: j.asn_organization || j.isp };
    },
  },
  {
    id: "iplocation", name: "iplocation.net",
    site: ip => "https://www.iplocation.net/ip-lookup?query=" + ip,
    async run(ip) {
      const j = await getJSON(`https://api.iplocation.net/?ip=${ip}`);
      if (String(j.response_code) !== "200") throw new Error(j.response_message || "fail");
      return { cc: upper(j.country_code2), org: j.isp };
    },
  },
  {
    id: "geojs", name: "GeoJS", browser: "retry",
    site: ip => "https://www.geojs.io/",
    async run(ip) {
      const j = await getJSON(`https://get.geojs.io/v1/ip/geo/${ip}.json`);
      return { cc: upper(j.country_code), city: j.city, asn: asnOf(j.asn), org: j.organization_name };
    },
  },
  {
    // The regional internet registry's record: who the block is registered to, and in which country
    id: "rdap", name: "RDAP (RIR)", browser: "retry",
    site: ip => "https://client.rdap.org/?type=ip&object=" + ip,
    async run(ip) {
      // ARIN's server redirects to the registry that holds the block; rdap.org (behind Cloudflare, which a Worker
      // can't always reach) is the fallback
      const opt = { headers: { Accept: "application/rdap+json, application/json" }, ms: 5000 };
      const j = await getJSON(`https://rdap.arin.net/registry/ip/${ip}`, opt).catch(() => getJSON(`https://rdap.org/ip/${ip}`, opt));
      const rir = ((j.port43 || "").match(/whois\.(\w+)\./) || [])[1] ||
        ((j.notices || []).flatMap(n => n.description || []).join(" ").match(/\b(APNIC|RIPE|ARIN|LACNIC|AFRINIC)\b/i) || [])[1];
      const reg = (j.events || []).find(e => e.eventAction === "registration");
      const range = j.startAddress && j.endAddress ? j.startAddress + " – " + j.endAddress : undefined;
      const extra = [];
      if (j.name) extra.push(["x_netname", j.name]);
      if (range) extra.push(["x_range", range]);
      return { regCc: upper(j.country), regName: j.name, regDate: reg ? String(reg.eventDate).slice(0, 10) : undefined,
        rir: rir ? rir.toUpperCase() : undefined, extra };
    },
  },
  {
    // The autonomous system's registered country, for blocks whose RDAP record has none (ARIN's)
    id: "ipguide", name: "ip.guide",
    site: ip => "https://ip.guide/" + ip,
    async run(ip) {
      const j = await getJSON(`https://ip.guide/${ip}`);
      const as = (j.network || {}).autonomous_system || {}, l = j.location || {};
      return { asn: as.asn, org: as.organization || as.name, asCc: upper(as.country), rir: as.rir,
        extra: (j.network || {}).cidr ? [["x_prefix", j.network.cidr]] : [] };
    },
  },
  {
    // Internet-wide scans: open ports and tags such as "vpn", "proxy", "tor", "compromised"
    id: "shodan", name: "Shodan InternetDB", v6: false,
    site: ip => "https://www.shodan.io/host/" + ip,
    async run(ip) {
      const r = await fetch(`https://internetdb.shodan.io/${ip}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(4500) });
      if (r.status === 404) return { ports: [], tags: [] };            // never seen by a scan: nothing open
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const tags = j.tags || [];
      return { ports: (j.ports || []).slice(0, 30), tags, host: (j.hostnames || [])[0],
        vpn: tags.includes("vpn") || undefined, proxy: tags.includes("proxy") || undefined, tor: tags.includes("tor") || undefined,
        abuser: tags.some(t => ["compromised", "malware", "c2", "botnet"].includes(t)) || undefined,
        extra: j.vulns && j.vulns.length ? [["x_vulns", String(j.vulns.length)]] : [] };
    },
  },
  {
    // The Tor Project's own list of exit relays (refreshed hourly, cached by the Worker)
    id: "tor", name: "Tor Project", v6: false,
    site: () => "https://metrics.torproject.org/exonerator.html",
    async run(ip, { torList }) {
      const set = await torList();
      return { tor: set.has(ip) };
    },
  },

  /* ---- sources that need a free API key (set as Worker secrets; skipped without them) ---- */
  {
    id: "ipqs", name: "IPQualityScore", key: ["IPQS_KEY"],
    site: ip => "https://www.ipqualityscore.com/free-ip-lookup-proxy-vpn-test/lookup/" + ip,
    async run(ip, { env }) {
      const j = await getJSON(`https://ipqualityscore.com/api/json/ip/${encodeURIComponent(env.IPQS_KEY)}/${ip}?strictness=1&allow_public_access_points=true`);
      if (!j.success) throw new Error(j.message || "fail");
      const extra = [];
      if (j.abuse_velocity && j.abuse_velocity !== "none" && !/premium/i.test(j.abuse_velocity)) extra.push(["x_abuse_velocity", j.abuse_velocity]);
      if (j.bot_status) extra.push(["x_bot", "yes"]);
      return { cc: upper(j.country_code), city: j.city, asn: asnOf(j.ASN), org: j.ISP || j.organization, host: j.host && j.host !== ip ? j.host : undefined,
        type: mapType(j.connection_type), proxy: bool(j.proxy), vpn: bool(j.vpn) || bool(j.active_vpn), tor: bool(j.tor) || bool(j.active_tor),
        abuser: bool(j.recent_abuse), risk: num(j.fraud_score), extra };
    },
  },
  {
    id: "abuseipdb", name: "AbuseIPDB", key: ["ABUSEIPDB_KEY"],
    site: ip => "https://www.abuseipdb.com/check/" + ip,
    async run(ip, { env }) {
      const j = await getJSON(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`, { headers: { Key: env.ABUSEIPDB_KEY } });
      const d = j.data;
      if (!d) throw new Error("fail");
      const extra = [["x_reports", `${d.totalReports ?? 0} / ${d.numDistinctUsers ?? 0}`]];
      if (d.lastReportedAt) extra.push(["x_last_report", String(d.lastReportedAt).slice(0, 10)]);
      return { cc: upper(d.countryCode), org: d.isp, host: (d.hostnames || [])[0], type: mapType(d.usageType),
        tor: bool(d.isTor), abuser: d.totalReports > 0 && d.abuseConfidenceScore >= 25 ? true : d.totalReports === 0 ? false : undefined,
        risk: num(d.abuseConfidenceScore), extra };
    },
  },
  {
    // the endpoint's host comes with the account (api11, api12…): SCAMALYTICS_URL overrides the default
    id: "scamalytics", name: "Scamalytics", key: ["SCAMALYTICS_USER", "SCAMALYTICS_KEY"],
    site: ip => "https://scamalytics.com/ip/" + ip,
    async run(ip, { env }) {
      const base = (env.SCAMALYTICS_URL || "https://api11.scamalytics.com/v3/").replace(/\/*$/, "/");
      const j = await getJSON(`${base}${encodeURIComponent(env.SCAMALYTICS_USER)}/?key=${encodeURIComponent(env.SCAMALYTICS_KEY)}&ip=${ip}`);
      const s = j.scamalytics || j;
      if (s.status && s.status !== "ok") throw new Error(s.error || s.status);
      const p = s.scamalytics_proxy || {};
      return { org: s.scamalytics_isp, type: p.is_datacenter ? "hosting" : undefined, vpn: bool(p.is_vpn),
        relay: bool(p.is_apple_icloud_private_relay), risk: num(s.scamalytics_score),
        extra: s.scamalytics_risk ? [["x_risk_level", s.scamalytics_risk]] : [] };
    },
  },
  {
    id: "ipdata", name: "ipdata", key: ["IPDATA_KEY"],
    site: ip => "https://ipdata.co/?ip=" + ip,
    async run(ip, { env }) {
      const j = await getJSON(`https://api.ipdata.co/${ip}?api-key=${encodeURIComponent(env.IPDATA_KEY)}`);
      const t = j.threat || {}, a = j.asn || {}, sc = t.scores || {};
      return { cc: upper(j.country_code), city: j.city, asn: asnOf(a.asn), org: a.name,
        type: t.is_datacenter ? "hosting" : mapType(a.type), proxy: bool(t.is_proxy), vpn: t.is_anonymous && !t.is_proxy && !t.is_tor ? true : undefined,
        tor: bool(t.is_tor), relay: bool(t.is_icloud_relay), abuser: t.is_known_abuser || t.is_known_attacker ? true : bool(t.is_threat),
        risk: num(sc.threat_score) };
    },
  },
];

// DNS blocklists that answer through a public DoH resolver (Spamhaus, SORBS and others refuse public resolvers, so
// they aren't here). An answer in 127.0.0.0/8 means listed; 127.255.255.x is a refusal, not a listing.
export const DNSBL = [
  { id: "spamcop", name: "SpamCop", zone: "bl.spamcop.net", site: () => "https://www.spamcop.net/bl.shtml" },
  { id: "barracuda", name: "Barracuda", zone: "b.barracudacentral.org", site: () => "https://www.barracudacentral.org/lookups" },
  { id: "psbl", name: "PSBL", zone: "psbl.surriel.com", site: ip => "https://psbl.org/listing?ip=" + ip },
  { id: "mailspike", name: "Mailspike", zone: "bl.mailspike.net", site: () => "https://mailspike.org/iplookup.html" },
  { id: "uceprotect", name: "UCEPROTECT L1", zone: "dnsbl-1.uceprotect.net", site: ip => "https://www.uceprotect.net/en/rblcheck.php?ipr=" + ip },
  { id: "gbudb", name: "GBUdb", zone: "truncate.gbudb.net", site: ip => "https://www.gbudb.com/truncate/" },
  { id: "blocklistde", name: "blocklist.de", zone: "bl.blocklist.de", site: ip => "https://www.blocklist.de/en/search.html?ip=" + ip },
  { id: "anonmails", name: "Anonmails", zone: "spam.dnsbl.anonmails.de", site: () => "https://anonmails.de/dnsbl.php" },
];

// Places to look an address up by hand: shown as links whatever is configured
export const ELSEWHERE = [
  ["Scamalytics", ip => "https://scamalytics.com/ip/" + ip],
  ["IPQualityScore", ip => "https://www.ipqualityscore.com/free-ip-lookup-proxy-vpn-test/lookup/" + ip],
  ["AbuseIPDB", ip => "https://www.abuseipdb.com/check/" + ip],
  ["Spur", ip => "https://spur.us/context/" + ip],
  ["ping0", ip => "https://ping0.cc/ip/" + ip],
  ["IPinfo", ip => "https://ipinfo.io/" + ip],
  ["bgp.tools", ip => "https://bgp.tools/prefix/" + ip],
  ["Cisco Talos", ip => "https://talosintelligence.com/reputation_center/lookup?search=" + ip],
  ["VirusTotal", ip => "https://www.virustotal.com/gui/ip-address/" + ip],
];
