// A measurement, for deciding whether the sources should be asked from the visitor's browser instead of the Worker
// (1ms-shell#80 follow-up): how often each source answers when the browser asks it directly, next to how often it
// answers the Worker. Counts only, kept in Workers Analytics Engine (binding PROBE, dataset ipqs_probe): the source,
// answered or not, how long it took, who asked (browser or server) and the asker's country. No address, no identifier.
// `npm run probe` reads them. Remove this file, its two callers and the binding when the question is settled.

// the sources the browser could ask itself (they answer CORS), and one blocklist query through Cloudflare's DoH JSON
export const PROBE = ["ipquery", "ipapiis", "iplocation", "geojs", "ipguide", "shodan", "rdap", "ipwho", "ipsb", "ipinfo", "doh"];
// how many of the visitors' own checks run the browser probe, and how many fresh lookups the Worker counts
export const BROWSER_RATE = 0.2, SERVER_RATE = 0.05;
// a blocklist's test entry: 127.0.0.2 is listed on every DNSBL, so an answer means the query got through
export const DOH_TEST = "https://cloudflare-dns.com/dns-query?name=2.0.0.127.bl.spamcop.net&type=A&ct=application/dns-json";

// the beacon the page sends: { r: [[id, ok (1/0), ms], ...] } → the data points to write, or null when malformed
export function readBeacon(body) {
  let j;
  try { j = JSON.parse(body); } catch (e) { return null; }
  if (!j || !Array.isArray(j.r) || j.r.length > PROBE.length) return null;
  const out = [];
  for (const x of j.r) {
    if (!Array.isArray(x) || !PROBE.includes(x[0]) || (x[1] !== 0 && x[1] !== 1) || !Number.isFinite(x[2])) return null;
    out.push({ id: x[0], ok: !!x[1], ms: Math.max(0, Math.min(30000, Math.round(x[2]))) });
  }
  return out;
}
