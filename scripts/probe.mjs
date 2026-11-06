#!/usr/bin/env node
// The measurement in src/probe.mjs, read: per source, how often it answered the visitor's browser and the Worker
// (sampled), in the last N days (default 7), overall and for visitors in mainland China.
// Needs CLOUDFLARE_API_TOKEN with "Account Analytics: Read" (1ms-shell's .env has one):
//   node --env-file=../1ms-shell/.env scripts/probe.mjs [days]   (or npm run probe)
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) { console.error("CLOUDFLARE_API_TOKEN missing"); process.exit(1); }
const days = Math.max(1, Math.min(90, +process.argv[2] || 7));
const headers = { Authorization: `Bearer ${token}` };
let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) {
  const r = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers }).then(r => r.json());
  account = r.result && r.result[0] && r.result[0].id;
}
const sql = `SELECT blob1 AS id, blob2 AS by, blob3 AS res, blob4 = 'CN' AS cn, SUM(_sample_interval) AS n, SUM(_sample_interval * double2) AS ms
  FROM ipqs_probe WHERE timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY id, by, res, cn FORMAT JSON`;
const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, { method: "POST", headers, body: sql });
if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }
const rows = (await res.json()).data || [];
const T = {};
for (const r of rows) {
  const k = T[r.id] ||= {};
  for (const scope of ["all", r.cn ? "cn" : null].filter(Boolean)) {
    const c = k[r.by + ":" + scope] ||= { ok: 0, n: 0, ms: 0 };
    c.n += +r.n; if (r.res === "ok") { c.ok += +r.n; c.ms += +r.ms; }
  }
}
const pct = c => c && c.n ? `${Math.round(100 * c.ok / c.n)}% of ${c.n}${c.ok ? `, ${Math.round(c.ms / c.ok)} ms` : ""}` : "–";
console.log(`last ${days} days: answered / asked (median-ish time of answers)\n`);
console.log("source".padEnd(12), "browser".padEnd(26), "browser, CN".padEnd(26), "server".padEnd(26));
for (const id of Object.keys(T).sort()) {
  const k = T[id];
  console.log(id.padEnd(12), pct(k["browser:all"]).padEnd(26), pct(k["browser:cn"]).padEnd(26), pct(k["server:all"]).padEnd(26));
}
