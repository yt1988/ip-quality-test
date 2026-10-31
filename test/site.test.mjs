// The built pages keep the 1ms.dog tool contract (1ms-shell docs/tool-contract.md) and render every row up front.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LANGS, FINDS, GROUPS } from "../scripts/build.mjs";
import { SOURCES, DNSBL } from "../src/sources.mjs";

const page = slug => readFile(new URL(`../public/${slug ? slug + "/" : ""}index.html`, import.meta.url), "utf8");

test("every language page keeps the shell contract", async () => {
  for (const [lang, slug] of LANGS) {
    const h = await page(slug);
    assert.match(h, new RegExp(`<html lang="${lang}"`), lang);
    assert.match(h, /<head>\r?\n<meta charset="utf-8">\r?\n<script>/, lang + ": charset first, then the pre-paint script");
    assert.match(h, /id="helpBtn"[^>]*aria-haspopup="dialog"/, lang + ": help button");
    assert.match(h, /<div class="scrim" id="help" hidden>/, lang + ": help dialog hidden by default");
    assert.match(h, /class="logo-light" src="\/assets\/logo-light.svg" width="90" height="36"/);
    assert.ok(!/\{\{\w+\}\}/.test(h), lang + ": unfilled placeholder");
    assert.ok(h.length < 60000, lang + ": page is " + h.length + " bytes");
    assert.equal((h.match(/<script>/g) || []).length, 1, lang + ": the only inline script is the pre-paint one");
  }
});

test("every finding and every source has its row before any answer", async () => {
  const h = await page("");
  assert.equal((h.match(/<li class="fr" data-f="/g) || []).length, FINDS.length);
  assert.equal((h.match(/<div class="pr wait" data-s="/g) || []).length, SOURCES.length + DNSBL.length);
  assert.deepEqual(GROUPS.flatMap(([, l]) => l.map(([id]) => id)).sort(), [...SOURCES, ...DNSBL].map(x => x.id).sort());
});

test("every language has every string, with the same placeholders", async () => {
  const en = (await import("../src/i18n/en.mjs")).default;
  const vars = s => (s.match(/\{\w+\}/g) || []).sort().filter((x, i, a) => a.indexOf(x) === i).join();
  for (const [lang] of LANGS) {
    const d = (await import(`../src/i18n/${lang}.mjs`)).default;
    for (const k of Object.keys(en)) assert.ok(k in d, `${lang}: ${k}`);
    assert.equal(d.docs.length, en.docs.length, lang + ": help entries");
    for (const k of Object.keys(en)) if (typeof en[k] === "string") assert.equal(vars(d[k]), vars(en[k]), `${lang}: ${k} placeholders`);
  }
});

test("source ids are unique and every source links somewhere", () => {
  const ids = [...SOURCES, ...DNSBL].map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of SOURCES) assert.match(s.site("1.2.3.4"), /^https:\/\//, s.id);
});
