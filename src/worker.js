// ipqs Worker. Pages and assets are static files (public/, served without running this script); this script answers
//   GET /api/check            the visitor's own address
//   GET /api/check?ip=<addr>  any public IPv4 or IPv6 address
// by asking every source in src/sources.mjs and the DNS blocklists at once, streaming each answer as it arrives, then
// scoring them all (src/score.mjs).
// Answers are cached per address for CACHE_TTL seconds, so a busy address costs the sources one lookup.
import { family, canon, isPublic, reverse } from "./ip.mjs";
import { SOURCES, DNSBL, ELSEWHERE } from "./sources.mjs";
import { assess } from "./score.mjs";

const CACHE_TTL = 6 * 3600;
const CACHE_VER = "v1";

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
});

// The Tor Project's exit list, kept per isolate for an hour (and in Cloudflare's cache between isolates)
let TOR = { at: 0, set: null };
async function torList() {
  if (TOR.set && Date.now() - TOR.at < 3600e3) return TOR.set;
  const r = await fetch("https://check.torproject.org/torbulkexitlist", { cf: { cacheTtl: 3600, cacheEverything: true }, signal: AbortSignal.timeout(4500) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  TOR = { at: Date.now(), set: new Set((await r.text()).split(/\s+/).filter(Boolean)) };
  return TOR.set;
}

async function dnsbl(ip, each = () => {}) {
  if (family(ip) !== 4) return [];          // the lists here only carry IPv4
  const rev = reverse(ip);
  return Promise.all(DNSBL.map(b => (async () => {
    let listed = null;
    try {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${rev}.${b.zone}&type=A`, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(3500) });
      const j = await r.json();
      if (j.Status === 3) listed = false;
      else if (j.Status === 0) {
        const a = (j.Answer || []).filter(x => x.type === 1).map(x => x.data);
        if (!a.length) listed = false;
        else if (a.some(x => /^127\.255\.255\./.test(x))) listed = null;     // the list refused the resolver
        else listed = a.some(x => /^127\./.test(x));
      }
    } catch (e) {}
    return { id: b.id, name: b.name, site: b.site(ip), listed };
  })().then(r => { each(r); return r; })));
}

// keyed: does this deployment have the secrets a source needs?
const enabled = (s, env) => !s.key || s.key.every(k => env[k]);

async function runSource(s, ip, ctx) {
  const t0 = Date.now();
  try {
    const d = await s.run(ip, ctx);
    for (const k in d) if (d[k] === undefined || d[k] === null || d[k] === "") delete d[k];
    return { id: s.id, name: s.name, site: s.site(ip), ok: true, ms: Date.now() - t0, d };
  } catch (e) {
    return { id: s.id, name: s.name, site: s.site(ip), ok: false, ms: Date.now() - t0, err: String(e && e.message || e).slice(0, 80) };
  }
}

// Why a source is skipped for this address: needs secrets this deployment lacks, IPv4 only, or the visitor's own address only
function skipOf(s, ip, self, env) {
  if (!enabled(s, env)) return "key";
  if (family(ip) === 6 && s.v6 === false) return "v4";
  if (s.own && !self) return "own";
  return null;
}

// The answer is NDJSON, one line per event, so the page fills each source's row the moment it answers:
//   {"t":"start", ip, v, self, skip: {id: why}, bl: [ids], n}  what will answer (n sources), before any answer
//   {"t":"src", id, ok, ms, d | err}                          one source
//   {"t":"bl", id, listed}                                    one blocklist
//   {"t":"done", score, grade, parts, notes, uses, summary, at, cached, elsewhere}
async function check(request, env, ctx) {
  const url = new URL(request.url);
  const me = canon(request.headers.get("CF-Connecting-IP") || "");
  const asked = (url.searchParams.get("ip") || "").trim();
  const ip = asked ? canon(asked) : me;
  if (!ip) return json({ error: "bad_ip" }, 400);
  if (!isPublic(ip)) return json({ error: "private", ip }, 400);
  const self = ip === me, v = family(ip);

  const cache = caches.default, key = new Request(`https://ipqs.cache/${CACHE_VER}/${ip}`);
  const hit = await cache.match(key);
  // a fresh lookup spends the sources' free quotas: limited per visitor when the binding exists
  if (!hit && env.LIMIT && me) {
    const { success } = await env.LIMIT.limit({ key: me });
    if (!success) return json({ error: "rate" }, 429, { "Retry-After": "60" });
  }

  const { readable, writable } = new TransformStream();
  const w = writable.getWriter(), enc = new TextEncoder();
  const send = o => w.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});
  const skip = Object.fromEntries(SOURCES.map(s => [s.id, skipOf(s, ip, self, env)]).filter(([, why]) => why));
  const blIds = v === 4 ? DNSBL.map(b => b.id) : [];

  ctx.waitUntil((async () => {
    try {
      await send({ t: "start", ip, v, self, skip, bl: blIds, n: SOURCES.filter(s => !skip[s.id]).length });
      let raw, cached = false;
      // what Cloudflare sees for this very request: the visitor's own address only, never cached
      const own = !skip.cloudflare ? runSource(SOURCES.find(s => s.own), ip, { env, cf: request.cf }).then(r => { send({ t: "src", ...r }); return r; }) : null;
      if (hit) {
        raw = await hit.json(); cached = true;
        // a source that failed last time (rate limit, timeout) is asked again rather than served as a failure
        const ctx2 = { env, torList };
        raw.sources = await Promise.all(raw.sources.map(r => {
          const s = SOURCES.find(x => x.id === r.id);
          return r.ok || !s ? r : runSource(s, ip, ctx2);
        }));
        for (const r of raw.sources) await send({ t: "src", ...r });
        for (const b of raw.dnsbl) await send({ t: "bl", ...b });
      } else {
        const ctx2 = { env, torList };
        const list = SOURCES.filter(s => !s.own && !skip[s.id]);
        const [sources, bl] = await Promise.all([
          Promise.all(list.map(s => runSource(s, ip, ctx2).then(r => { send({ t: "src", ...r }); return r; }))),
          dnsbl(ip, b => send({ t: "bl", ...b })),
        ]);
        raw = { at: new Date().toISOString(), sources, dnsbl: bl };
        ctx.waitUntil(cache.put(key, new Response(JSON.stringify(raw), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` } })));
      }
      const sources = own ? [await own, ...raw.sources] : raw.sources;
      const result = assess(sources.filter(s => s.ok).map(s => ({ id: s.id, data: s.d })), raw.dnsbl);
      await send({ t: "done", ...result, at: raw.at, cached, elsewhere: ELSEWHERE.map(([name, f]) => [name, f(ip)]) });
    } catch (e) {
      await send({ t: "error", error: "internal" });
    } finally {
      await w.close().catch(() => {});
    }
  })());
  return new Response(readable, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/check") {
      if (request.method !== "GET") return json({ error: "method" }, 405, { Allow: "GET" });
      try { return await check(request, env, ctx); }
      catch (e) { return json({ error: "internal" }, 500); }
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    // anything else is a static file; an unknown path is a plain 404 (the site's shell shows its own page for it)
    if (env.ASSETS) {
      const r = await env.ASSETS.fetch(request);
      if (r.status !== 404) return r;
    }
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
};
