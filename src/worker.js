// ipqs Worker. Pages and assets are static files (public/, served without running this script); this script answers
//   GET /api/check            the visitor's own address
//   GET /api/check?ip=<addr>  any public IPv4 or IPv6 address
// by asking every source in src/sources.mjs and the DNS blocklists at once, streaming each answer as it arrives, then
// scoring them all (src/score.mjs), and
//   GET [/<lang>]/r/<code>    a shared result (src/share.mjs): the language page with the grade in its link preview
//   GET  /api/turnstile       the Turnstile site key for the page's human-check test
//   POST /api/turnstile       {token}: verifies a token the page's Turnstile widget handed back (siteverify)
// Answers are cached per address for CACHE_TTL seconds, so a busy address costs the sources one lookup.
import { family, canon, isPublic, reverse } from "./ip.mjs";
import { SOURCES, DNSBL, ELSEWHERE } from "./sources.mjs";
import { assess } from "./score.mjs";
import { decode, unpackResults, SHARE_PATH } from "./share.mjs";
import * as I18N from "./langs.mjs";
import { PROBE, SERVER_RATE, readBeacon } from "./probe.mjs";

// the measurement in src/probe.mjs: one data point per source asked (who asked, answered or not, how long, country)
const probePoint = (env, by, id, ok, ms, cc) => {
  try { env.PROBE.writeDataPoint({ blobs: [id, by, ok ? "ok" : "fail", cc || ""], doubles: [1, ms], indexes: [id] }); } catch (e) {}
};
async function probeBeacon(request, env) {
  const done = new Response(null, { status: 204 });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  // only the page itself sends this
  const origin = request.headers.get("origin");
  if (!env.PROBE || (origin && origin !== new URL(request.url).origin) || +(request.headers.get("content-length") || 0) > 600) return done;
  const r = readBeacon((await request.text()).slice(0, 600));
  if (r) for (const x of r) probePoint(env, "browser", x.id, x.ok, x.ms, request.cf && request.cf.country);
  return done;
}

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
  if (s.browser === "only" && !(s.opt || []).some(k => env[k])) return "browser";   // asked by the page itself
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
        // sources added since the answer was cached are asked now, and ones no longer used are dropped
        const missing = SOURCES.filter(s => !s.own && !skip[s.id] && !raw.sources.some(r => r.id === s.id));
        raw.sources = [...raw.sources.filter(r => SOURCES.some(s => s.id === r.id && !skip[s.id])), ...await Promise.all(missing.map(s => runSource(s, ip, ctx2)))];
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
        // the measurement (src/probe.mjs): the same sources, asked by the Worker, on a sample of fresh lookups
        if (env.PROBE && Math.random() < SERVER_RATE) {
          for (const r of sources) if (PROBE.includes(r.id)) probePoint(env, "server", r.id, r.ok, r.ms, request.cf && request.cf.country);
          if (bl.length) probePoint(env, "server", "doh", bl.some(b => b.listed !== null), 0, request.cf && request.cf.country);
        }
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

// A shared result: the language page as it is, with its link preview naming the grade and score (the page itself
// reads the result from its address). A link this code can't read gets the plain page.
async function shared(request, env, m) {
  const url = new URL(request.url), slug = m[1] || "", lang = I18N.BY_SLUG[slug];
  if (lang === undefined || !env.ASSETS) return null;
  // a result code that can't be read is a dead link: 404, as any unknown path (the shell shows the site's page)
  const P = await decode(m[2]), d = I18N.LANG[lang];
  if (!P) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const page = await env.ASSETS.fetch(new Request(new URL("/" + (slug ? slug + "/" : ""), url), { headers: request.headers }));
  if (!page.ok) return page;
  const res = new Response(page.body, page);
  res.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  res.headers.delete("ETag");
  const { res: results, bl } = unpackResults(P), r = assess(results, bl);
  const fill = (s, v) => { for (const k in v) s = s.split("{" + k + "}").join(v[k]); return s; };
  const title = fill(d.og_r_title, { g: r.grade, s: r.score, v: d["g_" + r.grade] }), desc = d["d_" + r.grade];
  const image = url.origin + "/og/" + (slug || "en") + "-" + r.grade.toLowerCase() + ".png";
  const set = v => ({ element(e) { e.setAttribute("content", v); } });
  return new HTMLRewriter()
    .on("html", { element(e) { e.setAttribute("data-shared", ""); } })
    .on("title", { element(e) { e.setInnerContent(title + " · " + d.app_name); } })
    .on('meta[name="description"]', set(desc))
    .on('meta[name="robots"]', set("noindex, follow"))
    .on('meta[property="og:title"], meta[name="twitter:title"]', set(title))
    .on('meta[property="og:description"], meta[name="twitter:description"]', set(desc))
    .on('meta[property="og:url"]', set(url.origin + url.pathname))
    .on('meta[property="og:image"], meta[name="twitter:image"]', set(image))
    .transform(res);
}

// Cloudflare's human check (Turnstile), measured on the page: GET names the site key, POST verifies the token the
// widget handed back. Both are 404 until TURNSTILE_SITEKEY and TURNSTILE_SECRET are set; the page then leaves the test out.
async function turnstile(request, env) {
  if (!env.TURNSTILE_SITEKEY || !env.TURNSTILE_SECRET) return json({ error: "not_found" }, 404);
  if (request.method === "GET") return json({ sitekey: env.TURNSTILE_SITEKEY });
  if (request.method !== "POST") return json({ error: "method" }, 405, { Allow: "GET, POST" });
  let token = "";
  try { token = String((await request.json()).token || ""); } catch (e) {}
  if (!token || token.length > 4096) return json({ error: "bad_token" }, 400);
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET); body.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  return json({ success: j.success === true, codes: j["error-codes"] || [] });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/check") {
      if (request.method !== "GET") return json({ error: "method" }, 405, { Allow: "GET" });
      try { return await check(request, env, ctx); }
      catch (e) { return json({ error: "internal" }, 500); }
    }
    if (url.pathname === "/api/turnstile") {
      try { return await turnstile(request, env); }
      catch (e) { return json({ error: "internal" }, 502); }
    }
    if (url.pathname === "/api/probe") return probeBeacon(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    const m = SHARE_PATH.exec(url.pathname);
    if (m && request.method === "GET") { const r = await shared(request, env, m); if (r) return r; }
    // anything else is a static file; an unknown path is a plain 404 (the site's shell shows its own page for it)
    if (env.ASSETS) {
      const r = await env.ASSETS.fetch(request);
      if (r.status !== 404) return r;
    }
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
};
