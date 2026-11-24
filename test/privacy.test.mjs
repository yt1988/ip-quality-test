import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// The probes' host names are deployment details. A visitor reads 「本站的检测服务器」, never the host, so the
// strings, the generated pages and the READMEs must not name them (the code and the CSP still do).
const BAD = /probe\.(?:1ms\.dog|dog\.1msapp\.com)/;

function files() {
  const out = ["README.md", "README.zh-CN.md"];
  for (const f of readdirSync("src/i18n")) if (f.endsWith(".mjs")) out.push(`src/i18n/${f}`);
  for (const f of ["src/page.html", "src/batch.html"]) out.push(f);
  for (const f of readdirSync("public", { recursive: true })) {
    if (/\.(?:html|txt|xml)$/.test(f)) out.push(`public/${f}`);
  }
  return out;
}

test("no probe host where a visitor can read it", () => {
  const hits = [];
  for (const f of files()) {
    const m = readFileSync(f, "utf8").match(BAD);
    if (m) hits.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(hits, []);
});
