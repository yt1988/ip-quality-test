#!/usr/bin/env node
// Builds the static site in public/ from src/:
//   index.html, <lang>/index.html              the page per language
//   assets/app.<hash>.js, assets/app.<hash>.css the page's code and styles, shared by every language
//   assets/l.<lang>.<hash>.js                    the strings the browser code needs, per language
//   sitemap.xml, robots.txt, llms.txt, _headers  SEO and security headers (CSP)
// The Worker (src/worker.js) is deployed from source by wrangler; it isn't built here.
// Usage: node scripts/build.mjs          write the files
//        node scripts/build.mjs --check  exit 1 if anything in public/ is out of date (CI)
import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build as bundle, transform } from "esbuild";
import { SOURCES, DNSBL } from "../src/sources.mjs";

const SITE = (process.env.SITE_URL || "https://ipqs.1ms.dog").replace(/\/+$/, "");
const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url);
// language, URL folder, og:locale; the first is the root
export const LANGS = [["en", "", "en_US"], ["zh-CN", "zh-cn", "zh_CN"], ["zh-TW", "zh-tw", "zh_TW"], ["ja", "ja", "ja_JP"], ["ko", "ko", "ko_KR"],
  ["es", "es", "es_ES"], ["fr", "fr", "fr_FR"], ["de", "de", "de_DE"], ["pt", "pt", "pt_BR"], ["ru", "ru", "ru_RU"]];
// the other 1ms.dog tools (names, icons and tints as the site's top bar shows them)
const TOOLS = [
  { id: "home", host: "1ms.dog", name: "1ms.dog", tint: "#ffb63f", icon: '<circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13M8 1.5c2 2 2.8 4 2.8 6.5S10 12.5 8 14.5C6 12.5 5.2 10.5 5.2 8S6 3.5 8 1.5z"/>' },
  { id: "egress", host: "egress.1ms.dog", name: { en: "EgressLens", "zh-CN": "出口照妖镜", "zh-TW": "出口照妖鏡", ja: "出口照魔鏡", ko: "출구 IP 돋보기", es: "Lupa IP", fr: "Loupe IP", de: "IP-Lupe", pt: "Lupa de IP", ru: "IP-лупа" }, tint: "#06b6d4", icon: '<circle cx="7" cy="7" r="5"/><path d="M10.6 10.6 14.5 14.5M7 4.5v5M4.5 7h5"/>' },
  { id: "m2c", host: "m2c.1ms.dog", name: "Me2Cloud", tint: "#3b82f6", icon: '<path d="M1.5 8.5h2.8l1.6-4.5 3.2 8 1.6-3.5h3.8"/>' },
  { id: "v2c", host: "v2c.1ms.dog", name: "VPS2Cloud", tint: "#10b981", icon: '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M4.5 6.5l2 1.5-2 1.5M8.5 10h3"/>' },
  { id: "ls", host: "ls.1ms.dog", name: "Lightsail Cost Saver", tint: "#f59e0b", icon: '<rect x="3" y="1.5" width="10" height="13" rx="2"/><path d="M5.5 4.5h5M5.5 8h0M8 8h0M10.5 8h0M5.5 11h0M8 11h0M10.5 11h0"/>' },
];
// each tool's page per language, where it differs from this site's folders
const TOOL_PATH = { ls: { "zh-CN": "/zh/" } };
const toolHome = (id, lang, slug) => (TOOL_PATH[id] || {})[lang] || (slug ? "/" + slug + "/" : "/");
// the questions the sources table answers, one row each (src/app.js fills them)
// the findings column: what the address is, then what it is good for (src/score.mjs decides each)
export const FINDS = ["type", "native", "anon", "tor", "risk", "abuse", "dnsbl", "stream", "ai", "captcha", "account", "mail"];
// the source groups of the second card, in the order the rows are drawn
const nameOf = id => (SOURCES.find(s => s.id === id) || DNSBL.find(s => s.id === id)).name;
export const GROUPS = [
  ["intel", ["cloudflare", "ipapi", "proxycheck", "ipquery", "ipapiis", "ip2location", "ipinfo", "ipqs", "abuseipdb", "scamalytics", "ipdata"]],
  ["reg", ["rdap", "ipguide", "shodan", "tor"]],
  ["dnsbl", DNSBL.map(x => x.id)],
].map(([g, ids]) => [g, ids.map(id => [id, nameOf(id)])]);

// Runs before first paint: apply the saved theme. On the English root, send visitors to their language's page
// (a saved choice first, then the browser languages); crawlers and English readers stay. Keeps ?ip=.
const PREPAINT = `(function(){var d=document.documentElement,th=null,s=null;try{th=localStorage.getItem("ipqs:theme");s=localStorage.getItem("ipqs:lang")}catch(e){}if(th==="light"||th==="dark")d.setAttribute("data-theme",th);if(!d.hasAttribute("data-root"))return;var P=JSON.parse(d.getAttribute("data-paths")||"{}"),l=null;try{var q=new URLSearchParams(location.search).get("lang");if(P[q])l=q}catch(e){}if(!l&&P[s])l=s;for(var ls=navigator.languages||[navigator.language||"en"],i=0;!l&&!s&&i<ls.length;i++){var x=String(ls[i]).toLowerCase(),b=x.split("-")[0];l=b==="zh"?(/tw|hk|mo|hant/.test(x)?"zh-TW":"zh-CN"):P[b]?b:null}if(l&&l!=="en")location.replace(P[l]+location.search+location.hash)})();`;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (s, v) => { for (const k in v) s = s.split("{" + k + "}").join(v[k]); return s; };
const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 10);
const sha = s => createHash("sha256").update(s).digest("base64");

async function loadI18n() {
  const out = {};
  for (const f of (await readdir(new URL("i18n/", src))).filter(f => f.endsWith(".mjs")))
    out[f.slice(0, -4)] = (await import(new URL("i18n/" + f, src).href + "?" + Date.now())).default;
  return out;
}

// Strings only the build uses (the page already shows them); everything else goes to the browser
const BUILD_ONLY = new Set(["name", "seo_title", "seo_desc", "seo_kw", "og_sub", "h1", "app_name", "docs", "tools_h", "lang_label", "faq_h"]);

export async function build({ check = false } = {}) {
  const I = await loadI18n(), en = I.en;
  const langs = LANGS.filter(([l]) => I[l]);
  for (const [l] of langs) for (const k of Object.keys(en)) if (!(k in I[l])) throw new Error(`i18n/${l}.mjs is missing "${k}"`);
  const tpl = await readFile(new URL("page.html", src), "utf8");

  const root = fileURLToPath(new URL("..", import.meta.url));
  const js = (await bundle({ entryPoints: [fileURLToPath(new URL("app.js", src))], bundle: true, minify: true, format: "iife", target: "es2020",
    legalComments: "none", write: false, absWorkingDir: root })).outputFiles[0].text;
  const cssFull = (await Promise.all(["fonts.css", "base.css", "style.css"].map(f => readFile(new URL(f, src), "utf8")))).join("\n");
  const css = (await transform(cssFull, { loader: "css", minify: true, legalComments: "none" })).code;
  const jsName = `app.${hash(js)}.js`, cssName = `app.${hash(css)}.css`;
  const files = { ["assets/" + jsName]: js, ["assets/" + cssName]: css };

  const path = slug => "/" + (slug ? slug + "/" : "");
  for (const [lang, slug, locale] of langs) {
    const d = I[lang], T = k => d[k] ?? en[k] ?? k;
    const strings = Object.fromEntries(Object.keys(en).filter(k => !BUILD_ONLY.has(k)).map(k => [k, T(k)]));
    const sjs = `window.L1MS=${JSON.stringify(strings).replace(/</g, "\\u003c")};\n`;
    const sName = `l.${lang.toLowerCase()}.${hash(sjs)}.js`;
    files["assets/" + sName] = sjs;

    const url = SITE + path(slug), docs = d.docs || en.docs;
    const alts = langs.map(([l, sl]) => `<link rel="alternate" hreflang="${l}" href="${SITE + path(sl)}">`).join("\n") + `\n<link rel="alternate" hreflang="x-default" href="${SITE}/">`;
    const graph = [
      { "@type": "WebApplication", name: "IPQS · 1ms.dog", url, applicationCategory: "UtilitiesApplication", operatingSystem: "Any",
        browserRequirements: "Requires JavaScript", description: T("seo_desc"), inLanguage: lang, isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
      { "@type": "FAQPage", mainEntity: docs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a.replace(/\n+/g, " ") } })) },
    ];
    const head = [
      `<title>${esc(T("seo_title"))}</title>`,
      `<meta name="description" content="${esc(T("seo_desc"))}">`,
      `<meta name="keywords" content="${esc(T("seo_kw"))}">`,
      ...(lang === "zh-CN" ? [`<meta http-equiv="Cache-Control" content="no-transform">`, `<meta http-equiv="Cache-Control" content="no-siteapp">`, `<meta name="applicable-device" content="pc,mobile">`] : []),
      `<meta name="robots" content="index, follow, max-image-preview:large">`,
      `<meta name="application-name" content="${esc(T("app_name"))}">`,
      `<meta name="theme-color" content="#f6f6f7" media="(prefers-color-scheme: light)">`,
      `<meta name="theme-color" content="#1c1c1c" media="(prefers-color-scheme: dark)">`,
      `<link rel="canonical" href="${url}">`, alts,
      `<link rel="icon" href="/favicon.ico" sizes="any">`, `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`, `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
      `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="1ms.dog">`,
      `<meta property="og:title" content="${esc(T("seo_title"))}">`, `<meta property="og:description" content="${esc(T("og_sub"))}">`, `<meta property="og:url" content="${url}">`,
      `<meta property="og:locale" content="${locale}">`, `<meta name="twitter:card" content="summary">`,
      `<meta name="twitter:title" content="${esc(T("seo_title"))}">`, `<meta name="twitter:description" content="${esc(T("og_sub"))}">`,
      `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c")}</script>`,
    ].join("\n");

    // every source and blocklist has its row from the start; answers fill them in place
    const skel = '<span class="sk-l" style="display:inline-block;width:38px;min-height:12px"></span>';
    // the findings: one row each, drawn now and filled when every source is in
    const finds = FINDS.map(f => `<li class="fr" data-f="${f}"><i class="st"></i><span class="fr-l">${esc(T("fl_" + f))}</span><span class="fr-v"><span class="skl"></span></span><span class="fr-p"></span></li>`).join("");
    // every source has its row from the start, grouped as on EgressLens; answers fill them as they arrive
    const groups = GROUPS.map(([g, ids]) => `<div class="pg" data-g="${g}"><h3>${esc(T("g_" + g))}<span class="pg-n" id="n-${g}"></span></h3>` +
      ids.map(([id, name]) => `<div class="pr wait" data-s="${id}"><span class="pn">${esc(name)}</span><span class="pa">…</span><span class="pk"></span><span class="pms"></span></div>`).join("") + "</div>").join("");
    const tools = TOOLS.map(x => `<a class="tool" href="https://${x.host}${toolHome(x.id, lang, slug)}" style="--tint:${x.tint}"><b><svg viewBox="0 0 16 16" aria-hidden="true">${x.icon}</svg>${esc(typeof x.name === "string" ? x.name : x.name[lang] || x.name.en)}</b><span>${esc(T("tool_" + x.id))}</span></a>`).join("");
    const helpNav = docs.map(([q], i) => `<button type="button" role="tab" data-hq="${i}" aria-selected="${i === 0}">${esc(q)}</button>`).join("");
    const helpC = docs.map(([q, a], i) => `<article data-hqb="${i}"${i ? " hidden" : ""}><h3>${esc(q)}</h3>${a.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join("")}</article>`).join("");
    const langOpts = langs.map(([l]) => `<option value="${l}"${l === lang ? " selected" : ""}>${esc(I[l].name)}</option>`).join("");
    const paths = Object.fromEntries(langs.map(([l, sl]) => [l, path(sl)]));
    const data = { lang, paths };

    const html = tpl
      .replace(/(<(\w+)\b[^>]*\sdata-i="(\w+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, k, inner, close) => open + esc(T(k)) + close)
      .replace("{{lang}}", lang).replace("{{pathsAttr}}", esc(JSON.stringify(paths))).replace("{{rootAttr}}", slug ? "" : " data-root")
      .replace("{{prepaint}}", PREPAINT).replace("{{head}}", head).replace("{{css}}", cssName).replace("{{js}}", jsName).replace("{{strings}}", sName)
      .split("{{homeHref}}").join(path(slug)).replace("{{langOpts}}", langOpts).replace("{{h1}}", esc(T("h1")))
      .replace("{{finds}}", finds).replace("{{groups}}", groups).replace("{{tools}}", tools)
      .replace("{{helpNav}}", helpNav).replace("{{helpC}}", helpC).replace("{{data}}", JSON.stringify(data).replace(/</g, "\\u003c"));
    if (/\{\{\w+\}\}/.test(html)) throw new Error("unfilled placeholder in " + path(slug) + ": " + /\{\{\w+\}\}/.exec(html)[0]);
    files[(slug ? slug + "/" : "") + "index.html"] = html;
  }

  files["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    langs.map(([, s]) => `  <url>\n    <loc>${SITE + path(s)}</loc>\n` + langs.map(([l, s2]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE + path(s2)}"/>`).join("\n") +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>\n  </url>`).join("\n") + "\n</urlset>\n";
  files["robots.txt"] = `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`;
  files["llms.txt"] = `# IPQS · 1ms.dog

> Free IP quality check. Asks up to ${SOURCES.length} IP intelligence sources (${SOURCES.map(s => s.name).join(", ")}) and
> ${DNSBL.length} DNS blocklists about an address, then gives a 0–100 score (A–F), whether it is residential or data
> center, native or broadcast (registered country vs. location), VPN/proxy/Tor flags, and what that means for
> streaming, AI services, CAPTCHAs, sign-ups and sending mail. Each source's answer is shown with a link to check it.

- Page: ${SITE}/ (also ${langs.slice(1).map(([, s]) => "/" + s + "/").join(", ")})
- Any address: ${SITE}/?ip=8.8.8.8
- API (NDJSON stream, one line per source, then the score): ${SITE}/api/check?ip=8.8.8.8
- Source code: https://github.com/yt1988/ipqs

## Other 1ms.dog tools
${TOOLS.map(x => `- ${typeof x.name === "string" ? x.name : x.name.en}: https://${x.host}/ (${en["tool_" + x.id]})`).join("\n")}
`;
  // The only inline script is the pre-paint snippet, identical on every page: one hash covers the site.
  const csp = ["default-src 'self'", `script-src 'self' 'sha256-${sha(PREPAINT)}'`, "style-src 'self' 'unsafe-inline'", "font-src 'self'", "img-src 'self' data:",
    // the exit checks (as on EgressLens) and IPinfo, which the browser asks directly
    "connect-src 'self' https://ipv4-check-perf.radar.cloudflare.com https://ipv6-check-perf.radar.cloudflare.com https://myip.ipip.net https://api.ipify.cn https://api.ip.sb https://ipinfo.io https://chatgpt.com https://claude.ai",
    "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
  files["_headers"] = `# Generated by scripts/build.mjs
/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
/assets/*
  Cache-Control: public, max-age=604800
/assets/app.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/l.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/fonts/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/flags/*
  Cache-Control: public, max-age=2592000
/llms.txt
  Access-Control-Allow-Origin: *
  Content-Type: text/plain; charset=utf-8
`;

  // generated files that are no longer produced (old hashes) are stale too
  const gen = async () => (await readdir(new URL("assets/", pub))).filter(f => /^(app|l)\..+\.(js|css)$/.test(f)).map(f => "assets/" + f);
  const stale = [];
  for (const [f, body] of Object.entries(files)) {
    let cur = null; try { cur = await readFile(new URL(f, pub), "utf8"); } catch (e) {}
    if (cur !== body) stale.push(f);
  }
  const orphans = (await gen()).filter(f => !(f in files));
  if (check) return [...stale, ...orphans];
  for (const f of stale) { await mkdir(new URL(".", new URL(f, pub)), { recursive: true }); await writeFile(new URL(f, pub), files[f]); }
  for (const f of orphans) await rm(new URL(f, pub));
  return [...stale, ...orphans];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const changed = await build({ check });
  if (check && changed.length) { console.error("public/ is out of date: " + changed.join(", ") + "\nRun npm run build and commit public/."); process.exit(1); }
  console.log(check ? "public/ is up to date" : changed.length ? "wrote " + changed.join(", ") : "nothing to do");
}
