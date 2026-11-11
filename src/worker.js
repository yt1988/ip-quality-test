// ipqs Worker. Pages and assets are static files (public/, served without running this script); this script answers
//   GET /api/check            the visitor's own address
//   GET /api/check?ip=<addr>  any public IPv4 or IPv6 address
//   GET /api/check?format=json  the same answers and score as one JSON document (instead of the NDJSON stream)
// by asking every source in src/sources.mjs and the DNS blocklists at once, streaming each answer as it arrives, then
// scoring them all (src/score.mjs), and
//   GET /api/resolve?host=<name>  the first public address a hostname resolves to (Cloudflare's DoH)
//   GET [/<lang>]/r/<code>    a shared result (src/share.mjs): the language page with the grade in its link preview
//   GET  /api/turnstile       the Turnstile site key for the page's human-check test
//   POST /api/turnstile       {token}: verifies a token the page's Turnstile widget handed back (siteverify)
// Answers are cached per address for CACHE_TTL seconds, so a busy address costs the sources one lookup.
import { family, canon, isPublic, reverse } from "./ip.mjs";
import { SOURCES, DNSBL, ELSEWHERE } from "./sources.mjs";
import { assess } from "./score.mjs";
import { decode, unpackResults, SHARE_PATH } from "./share.mjs";
import * as I18N from "./langs.mjs";

const CACHE_TTL = 6 * 3600;
const CACHE_VER = "v1";
// The fresh-lookup limit the LIMIT binding enforces (wrangler.toml): said in the headers and the JSON, so scripts
// can read the policy instead of guessing. Keep the two in step when the binding changes.
const RATE_LIMIT = 20, RATE_WINDOW = 60;
const rateLimit = env => env.LIMIT ? { limit: RATE_LIMIT, window: RATE_WINDOW, fresh_only: true } : null;
const rateHeaders = env => env.LIMIT ? { "X-RateLimit-Limit": String(RATE_LIMIT), "X-RateLimit-Window": String(RATE_WINDOW) } : {};

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
    let listed = null, codes;
    try {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${rev}.${b.zone}&type=A`, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(3500) });
      const j = await r.json();
      if (j.Status === 3) listed = false;
      else if (j.Status === 0) {
        const a = (j.Answer || []).filter(x => x.type === 1).map(x => x.data);
        if (!a.length) listed = false;
        else if (a.some(x => /^127\.255\.255\./.test(x))) listed = null;     // the list refused the resolver
        else { listed = a.some(x => /^127\./.test(x)); if (listed) codes = a.filter(x => /^127\./.test(x)); }
      }
    } catch (e) {}
    return { id: b.id, name: b.name, site: b.site(ip), listed, codes };
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
  if (s.id === "lists" && !env.SEG) return "off";
  if (!enabled(s, env)) return "key";
  if (s.browser === "only" && !(s.opt || []).some(k => env[k])) return "browser";   // asked by the page itself
  if (family(ip) === 6 && s.v6 === false) return "v4";
  if (s.own && !self) return "own";
  return null;
}

// The answer is NDJSON, one line per event, so the page fills each source's row the moment it answers:
//   {"t":"start", ip, v, self, skip: {id: why}, bl: [ids], n}  what will answer (n sources), before any answer
//   {"t":"src", id, ok, ms, d | err}                          one source
//   {"t":"bl", id, listed, codes?}                            one blocklist
//   {"t":"done", score, grade, parts, notes, uses, summary, at, cached, elsewhere}
//
// One round of answers, shared by the stream and by ?format=json: the cache, the sources, the blocklists and the score.
// send() is the stream's writer, or a no-op for JSON.
async function collect({ request, env, ctx, ip, self, v, hit, skip, send }) {
  const cache = caches.default, key = new Request(`https://ipqs.cache/${CACHE_VER}/${ip}`);
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
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(raw), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` } })));
  }
  const sources = own ? [await own, ...raw.sources] : raw.sources;
  const result = assess(sources.filter(s => s.ok).map(s => ({ id: s.id, data: s.d })), raw.dnsbl);
  return { sources, dnsbl: raw.dnsbl, at: raw.at, cached, result };
}

async function check(request, env, ctx) {
  const url = new URL(request.url);
  const me = canon(request.headers.get("CF-Connecting-IP") || "");
  const asked = (url.searchParams.get("ip") || "").trim();
  const ip = asked ? canon(asked) : me;
  if (!ip) return json({ error: "bad_ip" }, 400);
  if (!isPublic(ip)) return json({ error: "private", ip }, 400);
  const self = ip === me, v = family(ip);
  // ?fresh=1 skips the cached answer: the page's own "check fresh" button, for when the visitor wants a new reading
  const fresh = url.searchParams.get("fresh") === "1";

  const cache = caches.default, key = new Request(`https://ipqs.cache/${CACHE_VER}/${ip}`);
  const hit = fresh ? null : await cache.match(key);
  // a fresh lookup spends the sources' free quotas: limited per visitor when the binding exists
  if (!hit && env.LIMIT && me) {
    const { success } = await env.LIMIT.limit({ key: me });
    if (!success) return json({ error: "rate", limit: RATE_LIMIT, window: RATE_WINDOW }, 429, { "Retry-After": String(RATE_WINDOW), ...rateHeaders(env) });
  }
  const skip = Object.fromEntries(SOURCES.map(s => [s.id, skipOf(s, ip, self, env)]).filter(([, why]) => why));
  const blIds = v === 4 ? DNSBL.map(b => b.id) : [];

  // ?format=json: the same answers and score as one JSON document, for scripts (no stream, so it waits for the slowest
  // source). CORS is open: there is nothing to authenticate and the answer is public.
  if (url.searchParams.get("format") === "json") {
    const { sources, dnsbl: bl, at, cached, result } = await collect({ request, env, ctx, ip, self, v, hit, skip, send: async () => {} });
    return json({ ip, version: v, self, at, cached, rate_limit: rateLimit(env), elsewhere: ELSEWHERE.map(([name, f]) => [name, f(ip)]), sources, dnsbl: bl, ...result },
      200, { "Access-Control-Allow-Origin": "*", ...rateHeaders(env) });
  }

  const { readable, writable } = new TransformStream();
  const w = writable.getWriter(), enc = new TextEncoder();
  const send = o => w.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});

  ctx.waitUntil((async () => {
    try {
      await send({ t: "start", ip, v, self, skip, bl: blIds, n: SOURCES.filter(s => !skip[s.id]).length });
      const { at, cached, result } = await collect({ request, env, ctx, ip, self, v, hit, skip, send });
      await send({ t: "done", ...result, at, cached, elsewhere: ELSEWHERE.map(([name, f]) => [name, f(ip)]) });
    } catch (e) {
      await send({ t: "error", error: "internal" });
    } finally {
      await w.close().catch(() => {});
    }
  })());
  return new Response(readable, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...rateHeaders(env) } });
}

// A hostname the visitor typed: Cloudflare's DoH (A, else AAAA), the first public address, cached for six hours.
// Only names are accepted, and only public answers come back: this never reaches a private address.
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$/i;
async function resolveHost(host, ctx) {
  const key = new Request("https://ipqs.cache/host/" + host);
  const hit = await caches.default.match(key);
  if (hit) { const j = await hit.json(); return j.ip || null; }
  const put = (body, ms) => ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ms}` },
  })));
  for (const type of ["A", "AAAA"]) {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (!r || !r.ok) continue;
    const j = await r.json().catch(() => null);
    const ips = ((j && j.Answer) || []).filter(x => x.type === 1 || x.type === 28).map(x => canon(x.data)).filter(x => x && isPublic(x));
    if (ips.length) { put({ ip: ips[0] }, 21600); return ips[0]; }
  }
  // a name with no public address is not asked again and again; five minutes, so a name that starts resolving is seen
  put({}, 300);
  return null;
}

// A shared result: the language page as it is, with its link preview naming the grade and score (the page itself
// reads the result from its address). A link this code can't read gets the plain page.
async function shared(request, env, m) {
  const url = new URL(request.url), slug = m[1] || "", lang = I18N.BY_SLUG[slug];
  if (lang === undefined || !env.ASSETS) return null;
  // a result code that can't be read is a dead link: 404, as any unknown path (the shell shows the site's page)
  // (the Worker can decompress any link; should that ever fail, the page is served as it is, without the preview)
  let P;
  try { P = await decode(m[2]); } catch (e) { return null; }
  const d = I18N.LANG[lang];
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

// The API's own description, for scripts: GET /api lists the endpoints and GET /openapi.json is the OpenAPI document.
// Both are static, CORS-open and cached: API documentation is in English, as OpenAPI documents are.
const API_VERSION = "1.0";
function apiIndex() {
  return {
    name: "1ms.dog IP quality check", version: API_VERSION, openapi: "/openapi.json",
    about: "Every answer is public and needs no key. A fresh check is limited per visitor address per minute; a cached answer (six hours) does not count.",
    endpoints: [
      { method: "GET", path: "/api/check", format: "application/x-ndjson", params: ["ip", "fresh"],
        about: "One address, every source, streamed as it answers, then scored. No ip: the caller's own address." },
      { method: "GET", path: "/api/check", format: "application/json", params: ["ip", "fresh", "format=json"],
        about: "The same answers and score as one document, after every source has answered." },
      { method: "GET", path: "/api/resolve", format: "application/json", params: ["host"], about: "The first public address a hostname resolves to." },
      { method: "GET", path: "/api/turnstile", format: "application/json", about: "The Turnstile site key, when this deployment has one (404 otherwise)." },
      { method: "POST", path: "/api/turnstile", format: "application/json", about: "Verifies a Turnstile token: body {token}." },
      { method: "GET", path: "/r/{code}", format: "text/html", about: "A shared result page, with the grade in its link preview." },
    ],
  };
}
const ipParam = { name: "ip", in: "query", required: false, schema: { type: "string" }, description: "An IPv4 or IPv6 address. Left out, the caller's own address." };
const noteSchema = { type: "object", properties: { lv: { enum: ["good", "info", "warn", "bad"] }, k: { type: "string", description: "i18n key" }, p: { type: "object" } } };
const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "1ms.dog IP quality check", version: API_VERSION, description: apiIndex().about },
  servers: [{ url: "https://ipqs.1ms.dog" }],
  paths: {
    "/api/check": {
      get: {
        summary: "Check one address",
        parameters: [ipParam, { name: "fresh", in: "query", schema: { enum: ["1"] }, description: "Skip the six-hour cache." },
          { name: "format", in: "query", schema: { enum: ["json"] }, description: "Return one JSON document instead of the NDJSON stream." }],
        responses: {
          200: { description: "The stream (start, src and bl lines, then done) or the JSON document", content: { "application/json": { schema: { $ref: "#/components/schemas/Result" } } } },
          400: { description: "bad_ip or private", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          429: { description: "Too many fresh checks from this address in a minute; X-RateLimit-Limit and X-RateLimit-Window say the policy, Retry-After when to try again", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          500: { description: "internal", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/resolve": {
      get: { summary: "Resolve a hostname to its first public address", parameters: [{ name: "host", in: "query", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "{ip, version}" }, 400: { description: "bad_host" }, 404: { description: "no_host" }, 502: { description: "internal" } } },
    },
    "/api/turnstile": {
      get: { summary: "The site key", responses: { 200: { description: "{sitekey}" }, 404: { description: "not configured" } } },
      post: { summary: "Verify a token", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["token"], properties: { token: { type: "string" } } } } } },
        responses: { 200: { description: "{success, codes}" }, 404: { description: "not configured" } } },
    },
  },
  components: {
    schemas: {
      Error: { type: "object", properties: { error: { type: "string", enum: ["bad_ip", "private", "rate", "internal", "not_found", "bad_host", "no_host", "method", "bad_token"] } } },
      Result: { type: "object", properties: {
        ip: { type: "string" }, version: { type: "integer", enum: [4, 6] }, self: { type: "boolean" },
        at: { type: "string", format: "date-time" }, cached: { type: "boolean" },
        rate_limit: { type: ["object", "null"], properties: { limit: { type: "integer" }, window: { type: "integer", description: "seconds" }, fresh_only: { type: "boolean" } } },
        score: { type: "integer", minimum: 0, maximum: 100 }, grade: { enum: ["A", "B", "C", "D", "F"] },
        parts: { type: "array", items: { type: "object", properties: { k: { type: "string" }, pts: { type: "integer" }, p: { type: "object" } } } },
        notes: { type: "array", items: noteSchema },
        uses: { type: "object", additionalProperties: { type: "object", properties: { lv: { enum: ["good", "warn", "bad"] }, why: { type: "string" } } } },
        confidence: { type: "object", properties: { level: { enum: ["low", "mid", "high"] }, sources: { type: "integer" }, riskSources: { type: "integer" } } },
        summary: { type: "object", description: "What was found: location, network, flags, lists, cloud, /24 neighbours, routing, OTX, DNSBL counts" },
        sources: { type: "array", items: { type: "object", properties: { id: { type: "string" }, ok: { type: "boolean" }, ms: { type: "integer" }, d: { type: "object" }, err: { type: "string" } } } },
        dnsbl: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, listed: { type: ["boolean", "null"] }, codes: { type: "array", items: { type: "string" } } } } },
        elsewhere: { type: "array", description: "[name, url] pairs for looking the address up by hand" },
      } },
    },
  },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname === "/openapi.json") {
      if (request.method !== "GET") return json({ error: "method" }, 405, { Allow: "GET" });
      const body = url.pathname === "/api" ? apiIndex() : OPENAPI;
      const r = json(body, 200, { "Access-Control-Allow-Origin": "*" });
      r.headers.set("Cache-Control", "public, max-age=3600");
      return r;
    }
    if (url.pathname === "/api/check") {
      if (request.method !== "GET") return json({ error: "method" }, 405, { Allow: "GET" });
      try { return await check(request, env, ctx); }
      catch (e) { return json({ error: "internal" }, 500); }
    }
    if (url.pathname === "/api/turnstile") {
      try { return await turnstile(request, env); }
      catch (e) { return json({ error: "internal" }, 502); }
    }
    // a hostname the page's box accepts: resolved here (Cloudflare's DoH), never in the visitor's browser
    if (url.pathname === "/api/resolve") {
      if (request.method !== "GET") return json({ error: "method" }, 405, { Allow: "GET" });
      const host = (url.searchParams.get("host") || "").trim().toLowerCase().replace(/\.$/, "");
      if (!HOST_RE.test(host)) return json({ error: "bad_host" }, 400);
      try {
        const ip = await resolveHost(host, ctx);
        if (!ip) return json({ error: "no_host" }, 404);
        return json({ ip, version: family(ip) }, 200, { "Access-Control-Allow-Origin": "*" });
      } catch (e) { return json({ error: "internal" }, 502); }
    }
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
