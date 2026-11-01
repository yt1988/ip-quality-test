#!/usr/bin/env node
// Renders the link-preview images with resvg (dev dependency), 1200 × 630, from the page's strings:
//   public/og/<lang folder or "en">.png         the page's own preview: the headline beside a score ring
//   public/og/<lang folder or "en">-<grade>.png  a shared result's preview, one per grade (src/worker.js picks it)
// Run when the headline, the grade texts or the look change, and commit the output. Uses system fonts for the text
// (Windows: Segoe UI, Microsoft YaHei, Microsoft JhengHei, Yu Gothic UI, Malgun Gothic).
// Usage: node scripts/og.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import { LANGS, LANG } from "../src/langs.mjs";
import { GRADES } from "../src/score.mjs";

const pub = new URL("../public/", import.meta.url);
const render = svg => new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" } }).render().asPng();
const logo = Buffer.from(await readFile(new URL("assets/logo-dark.svg", pub))).toString("base64");
const FONTS = { "zh-CN": "Microsoft YaHei", "zh-TW": "Microsoft JhengHei", ja: "Yu Gothic UI", ko: "Malgun Gothic" };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// the dark theme's colors (src/base.css, src/style.css)
const INK = "#a78bfa", BG = "#1c1c1c", FG = "#ededed", MU = "#a0a0a0", SOFT = "#2e2e2e";
const GC = { A: "#3ecf8e", B: "#9fd356", C: "#f5c524", D: "#f59e42", F: "#f56565" };
const PART = { hosting: "#f59e0b", proxy: "#ef4444", vpn: "#a855f7", risk: "#ec4899", dnsbl: "#0ea5e9" };
// a sample result for each grade: the score and the deductions the ring shows after it
const SAMPLE = { A: [94, ["risk", 6]], B: [78, ["hosting", 20], ["risk", 2]], C: [58, ["hosting", 20], ["vpn", 15], ["risk", 7]],
  D: [41, ["hosting", 20], ["proxy", 20], ["risk", 19]], F: [12, ["hosting", 20], ["proxy", 20], ["vpn", 15], ["risk", 25], ["dnsbl", 8]] };

const cjkOf = s => /[　-鿿가-힯]/.test(s);
// splits text into lines that fit `max` characters (a CJK character counts double), at spaces or anywhere in CJK
function lines(text, max, n) {
  const w = s => [...s].reduce((a, c) => a + (cjkOf(c) ? 2 : 1), 0);
  const toks = cjkOf(text) ? text.match(/[A-Za-z0-9.+/-]+\s*|\s+|./g) : text.split(/(?<=\s)/);
  const out = []; let cur = "";
  for (const t of toks) { if (w(cur + t) > max && cur.trim()) { out.push(cur.trim()); cur = t.trimStart(); } else cur += t; }
  if (cur.trim()) out.push(cur.trim());
  return out.length > n ? [...out.slice(0, n - 1), out.slice(n - 1).join(" ").slice(0, max - 1) + "…"] : out;
}

// the score ring: the score in the grade's color, each deduction after it in its own color
function ring(cx, cy, r, grade, label, sub) {
  const [score, ...parts] = SAMPLE[grade];
  const pt = v => { const a = (v / 100) * 2 * Math.PI - Math.PI / 2; return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`; };
  const arc = (from, len, color, cap) => `<path d="M${pt(from)}A${r} ${r} 0 ${len > 50 ? 1 : 0} 1 ${pt(from + len)}" fill="none" stroke="${color}" stroke-width="30" stroke-linecap="${cap || "butt"}"/>`;
  let at = score, segs = "";
  for (const [k, pts] of parts) { segs += arc(at + .7, Math.max(0, Math.min(pts, 100 - at) - 1.4), PART[k]); at += pts; }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${SOFT}" stroke-width="30"/>${segs}${arc(0, score - .7, GC[grade])}
  <text x="${cx}" y="${cy + 30}" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="110" font-weight="800" fill="${FG}">${esc(label)}</text>
  <text x="${cx}" y="${cy + 82}" text-anchor="middle" font-family="${sub[1]}" font-size="30" font-weight="700" fill="${GC[grade]}">${esc(sub[0])}</text>`;
}

function card(lang, d, grade) {
  const ff = `${FONTS[lang] ? `'${FONTS[lang]}', ` : ""}'Segoe UI', 'Microsoft YaHei', sans-serif`;
  const chip = grade ? d.card_title : d.og_sub, chipC = grade ? GC[grade] : INK;
  const cjk = cjkOf(d.h1);
  // the page: the search words of its headline in large type, the question after the colon under them; a result: the
  // grade's verdict and what it means
  let head, sub;
  if (grade) { head = [d["g_" + grade]]; sub = lines(d["d_" + grade], cjk ? 30 : 38, 3); }
  else {
    const [kw, q] = d.h1.split(/\s*[:：]\s*/);
    head = lines(kw, cjk ? 18 : 22, 2); sub = q ? lines(q.charAt(0).toUpperCase() + q.slice(1), cjk ? 34 : 40, 2) : [];
  }
  const hw = Math.max(...head.map(l => [...l].reduce((a, c) => a + (cjkOf(c) ? 2 : 1.05), 0)));
  const size = grade ? 84 : Math.min(84, Math.floor(1240 / Math.max(hw, 12)));
  const chipW = Math.min(620, 44 + [...chip].reduce((a, c) => a + (cjkOf(c) ? 23 : 13), 0));
  const y0 = 300, subY = y0 + (head.length - 1) * (size + 8) + 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><radialGradient id="g" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(0 0) scale(900 700)">
    <stop offset="0" stop-color="${chipC}" stop-opacity=".16"/><stop offset="1" stop-color="${chipC}" stop-opacity="0"/></radialGradient></defs>
  <rect width="1200" height="630" fill="${BG}"/><rect width="1200" height="630" fill="url(#g)"/>
  <image href="data:image/svg+xml;base64,${logo}" x="80" y="64" width="150" height="60"/>
  <rect x="80" y="170" width="${chipW}" height="44" rx="22" fill="${chipC}" fill-opacity=".14"/>
  <circle cx="104" cy="192" r="6" fill="${chipC}"/>
  <text x="122" y="200" font-family="${ff}" font-size="22" font-weight="600" fill="${chipC}">${esc(chip)}</text>
  ${head.map((l, i) => `<text x="80" y="${y0 + i * (size + 8)}" font-family="${ff}" font-size="${size}" font-weight="800" fill="${grade ? GC[grade] : FG}" letter-spacing="-1">${esc(l)}</text>`).join("")}
  ${sub.map((l, i) => `<text x="80" y="${subY + i * (grade ? 42 : 46)}" font-family="${ff}" font-size="${grade ? 29 : 34}" fill="${MU}">${esc(l)}</text>`).join("")}
  <text x="80" y="566" font-family="${ff}" font-size="24" font-weight="600" fill="${INK}">${esc(grade ? d.card_cta + "  →  ipqs.1ms.dog" : "ipqs.1ms.dog")}</text>
  ${ring(960, 320, 150, grade || "A", grade || String(SAMPLE.A[0]), [d.grade.replace("{g}", grade || "A"), ff])}
</svg>`;
}

const out = new URL("og/", pub);
await mkdir(out, { recursive: true });
for (const [lang, slug] of LANGS) {
  const d = LANG[lang], name = slug || "en";
  await writeFile(new URL(name + ".png", out), render(card(lang, d)));
  for (const [, g] of GRADES) await writeFile(new URL(`${name}-${g.toLowerCase()}.png`, out), render(card(lang, d, g)));
  console.log(`og/${name}.png, og/${name}-[a-f].png`);
}
