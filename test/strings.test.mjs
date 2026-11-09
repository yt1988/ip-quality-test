// Every string the page shows comes from the language files, in every language: a missing key would show its name
// (or, worse, English) instead. Collects the keys the page script asks for, literal and built from parts, and the
// keys the scoring and sources hand to it, and checks each language has them all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LANGS, FINDS } from "../scripts/build.mjs";
import { GRADES } from "../src/score.mjs";

const read = f => readFile(new URL("../" + f, import.meta.url), "utf8");
const all = (s, re) => [...s.matchAll(re)].map(m => m[1]);

test("every key the page uses exists in every language", async () => {
  const [app, report, score, sources, page] = await Promise.all(["src/app.js", "src/report.mjs", "src/score.mjs", "src/sources.mjs", "src/page.html"].map(read));
  const types = ["hosting", "residential", "mobile", "business", "education", "government"];
  const parts = all(score, /take\("p_(\w+)"/g);
  const keys = new Set([
    ...all(app, /\bt\("(\w+)"/g).filter(k => !k.endsWith("_")),   // t("key"); t("prefix_" + x) is expanded below
    ...all(report, /\bt\("(\w+)"/g).filter(k => !k.endsWith("_")),   // the report dialog's line and picks
    ...all(app, /"(err_\w+)"/g),                          // the error messages picked by name
    ...all(score, /"((?:n|u)_\w+)"/g).filter(k => !k.endsWith("_")),   // notes and verdict reasons from the scoring
    ...all(score, /"(n_type_)" \+/g).flatMap(() => types.map(x => "n_type_" + x)),
    ...all(sources, /\["(x_\w+)"/g),                      // extra facts from the sources
    ...all(page, /data-i="(\w+)"/g), ...all(page, /\{\{a:(\w+)\}\}/g),
    ...parts.flatMap(p => ["p_" + p, "pp_" + p]),
    ...types.map(x => "t_" + x),
    ...["good", "warn", "bad"].map(x => "lv_" + x),
    ...GRADES.flatMap(([, g]) => ["g_" + g, "d_" + g]),
    ...FINDS.map(f => "fl_" + f),
    ...["v4", "own"].map(x => "skip_" + x),
    ...["system", "light", "dark"].map(x => "th_" + x),
  ]);
  assert.ok(keys.size > 100, "found " + keys.size + " keys");
  for (const [lang] of LANGS) {
    const d = (await import(`../src/i18n/${lang}.mjs`)).default;
    const missing = [...keys].filter(k => !(k in d));
    assert.deepEqual(missing, [], `${lang} lacks ${missing.join(", ")}`);
  }
});

test("no English fallback in the page script or the build", async () => {
  const [app, report, build] = await Promise.all(["src/app.js", "src/report.mjs", "scripts/build.mjs"].map(read));
  for (const [name, s] of [["src/app.js", app], ["src/report.mjs", report], ["scripts/build.mjs", build]]) {
    assert.ok(!/\|\|\s*\w+(\.name)?\.en\b|\?\?\s*en\[/.test(s), name + " falls back to English");
  }
});
