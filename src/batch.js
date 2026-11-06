// ipqs batch page (/batch/): a pasted list of up to 20 addresses, each checked with the same /api/check the main page
// uses (a few at a time, answers the Worker has cached cost the sources nothing), drawn as one table: score and grade,
// location, network type, native or broadcast, anonymity flags, AI and streaming verdicts. Sortable by any column;
// a shared link carries the rows in its #fragment, without the addresses unless the visitor ticks the box.
// Strings: window.L1MS (the main page's, plus the b_* ones).
import { parseList, rowOf, packRows, unpackRows, sortRows, MAX } from "./batch.mjs";

(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const D = JSON.parse($("#data").textContent);
  const L = window.L1MS || {}, LANG = D.lang;
  const t = (k, v) => { let s = L[k] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const K = { theme: "ipqs:theme", lang: "ipqs:lang" };
  const TW = { "zh-CN": "中国台湾", "zh-TW": "中國台灣", en: "Taiwan, China", ja: "中国台湾", ko: "중국 대만", es: "Taiwán, China", fr: "Taïwan, Chine", de: "Taiwan, China", pt: "Taiwan, China", ru: "Тайвань, Китай" };
  const country = cc => { if (cc === "TW") return TW[LANG]; try { return new Intl.DisplayNames([LANG], { type: "region" }).of(cc); } catch (e) { return cc; } };
  const flag = cc => /^[A-Z]{2}$/.test(cc || "") ? `<img class="flag" src="/flags/${cc === "TW" ? "cn" : cc.toLowerCase()}.svg" alt="" width="20" height="15">` : "";
  const HOME = D.paths[LANG], SELF = HOME + "batch/";

  /* ---------- theme and language (as on the main page) ---------- */
  const thBtn = $("#theme"), TH = ["system", "light", "dark"];
  const applyTheme = th => {
    if (th === "light" || th === "dark") document.documentElement.setAttribute("data-theme", th); else document.documentElement.removeAttribute("data-theme");
    thBtn.dataset.th = th; thBtn.title = t("th_" + th); thBtn.setAttribute("aria-label", t("th_" + th));
  };
  applyTheme(TH.includes(store.get(K.theme)) ? store.get(K.theme) : "system");
  thBtn.onclick = () => { const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3]; store.set(K.theme, n); applyTheme(n); };
  $("#lang").onchange = e => { const l = e.target.value; store.set(K.lang, l); location.href = D.paths[l] + "batch/" + location.search + location.hash; };

  const box = $("#ips"), hint = $("#hint"), go = $("#go");
  box.placeholder = t("b_ph");
  const say = (k, v) => { hint.textContent = t(k, v); };
  say("b_hint", { n: MAX });
  // ?ips=1.1.1.1,8.8.8.8 fills the box (nothing is checked until the button is pressed)
  const pre = new URLSearchParams(location.search).get("ips");
  if (pre) box.value = pre.split(/[\s,]+/).filter(Boolean).join("\n");

  /* ---------- the table ---------- */
  let rows = [], sort = { col: "i", dir: 1 }, shared = false, at = null;
  const tag = (lv, why) => lv ? `<span class="tag ${lv}"${why ? ` data-why="${esc(t(why))}" title="${esc(t(why))}"` : ""}>${esc(t("lv_" + lv))}</span>` : "–";
  const ANON = { tor: () => "Tor", vpn: () => "VPN", proxy: () => t("tag_proxy") };
  function cells(row) {
    const r = row.r, ip = row.ip
      ? (shared ? `<span class="ip">${esc(row.ip)}</span>` : `<a class="ip" href="${HOME}?ip=${encodeURIComponent(row.ip)}" target="_blank" rel="noopener">${esc(row.ip)}</a>`)
      : `<span class="m">${esc(t("b_hidden"))}</span>`;
    const head = `<td class="n">${row.i + 1}</td><td class="ipc">${ip}</td>`;
    if (!r) {
      const st = row.st === "err" ? `<span class="tag bad">${esc(t("b_err"))}</span>` : `<span class="skl"></span>`;
      return head + `<td colspan="7" class="bt-st">${st}</td>`;
    }
    const native = r.native == null ? "–" : r.native ? esc(t("fs_native")) : `${flag(r.regCc)}${esc(t("fs_broadcast"))}${r.regCc ? ` <span class="m">${esc(r.regCc)}</span>` : ""}`;
    const anon = r.anon.length ? r.anon.map(a => `<span class="ft bad">${esc(ANON[a]())}</span>`).join(" ") : `<span class="m">${esc(t("fs_clean"))}</span>`;
    return head +
      `<td>${r.cc ? `<span class="pl" title="${esc(country(r.cc))}">${flag(r.cc)}${esc(r.cc)}</span>` : "–"}</td>` +
      `<td class="sc"><b class="bt-sc" data-g="${r.grade}">${r.score}</b><span class="bt-g" data-g="${r.grade}">${r.grade}</span></td>` +
      `<td>${r.type ? esc(t("t_" + r.type)) : "–"}</td><td>${native}</td><td>${anon}</td>` +
      `<td>${tag(r.ai, r.aiWhy)}</td><td>${tag(r.stream, r.streamWhy)}</td>`;
  }
  function draw() {
    $("#rows").innerHTML = sortRows(rows, sort.col, sort.dir).map(row => `<tr data-st="${row.st}">${cells(row)}</tr>`).join("");
    $$("th [data-sort]").forEach(b => { const on = b.dataset.sort === sort.col; b.parentElement.setAttribute("aria-sort", on ? (sort.dir > 0 ? "ascending" : "descending") : "none"); });
    const done = rows.filter(r => r.st === "ok" || r.st === "err").length;
    $("#prog").textContent = shared ? t("b_n", { n: rows.length }) : t("b_prog", { n: done, of: rows.length });
    $("#shareBtn").disabled = shared || !rows.length || done < rows.length || !rows.some(r => r.r);
  }
  $$("th [data-sort]").forEach(b => {
    b.onclick = () => {
      const c = b.dataset.sort;
      // a column picked for the first time sorts best first: highest score, most anonymity flags last
      sort = sort.col === c ? { col: c, dir: -sort.dir } : { col: c, dir: c === "score" || c === "native" ? -1 : 1 };
      draw();
    };
  });

  /* ---------- checking: a few at a time; a rate limit pauses every lane for as long as the Worker says ---------- */
  const LANES = 4;
  let run = 0, pauseUntil = 0;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function check(ip, me) {
    for (let tries = 0; tries < 4; tries++) {
      while (Date.now() < pauseUntil) { if (me !== run) return null; await sleep(500); }
      const res = await fetch("/api/check?ip=" + encodeURIComponent(ip), { credentials: "omit", signal: AbortSignal.timeout(30000) });
      if (res.status === 429) {
        const s = Math.max(5, Math.min(120, +res.headers.get("Retry-After") || 60));
        pauseUntil = Math.max(pauseUntil, Date.now() + s * 1000);
        say("b_wait", { s });
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const lines = (await res.text()).split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) { const e = JSON.parse(lines[i]); if (e.t === "done") return e; }
      throw new Error("no result");
    }
    throw new Error("rate");
  }
  async function start(ips) {
    const me = ++run;
    shared = false; at = new Date().toISOString();
    rows = ips.map((ip, i) => ({ i, ip, st: "wait", r: null }));
    sort = { col: "i", dir: 1 };
    $("#res").hidden = false; go.disabled = true;
    draw();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(LANES, rows.length) }, async () => {
      while (next < rows.length && me === run) {
        const row = rows[next++];
        row.st = "run";
        try { const e = await check(row.ip, me); if (me !== run) return; row.r = rowOf(e); row.st = "ok"; }
        catch (e) { if (me !== run) return; row.st = "err"; }
        draw();
      }
    }));
    if (me !== run) return;
    go.disabled = false;
    const bad = rows.filter(r => r.st === "err").length;
    if (bad) say("b_errs", { n: bad }); else say("b_done", { n: rows.length });
  }
  $("#ask").onsubmit = e => {
    e.preventDefault();
    const { ips, skipped, over } = parseList(box.value);
    if (!ips.length) { say("b_none"); box.focus(); return; }
    if (history.replaceState && location.hash) history.replaceState(null, "", SELF + location.search);
    start(ips);
    const parts = [over && t("b_cut", { n: MAX, over }), skipped && t("b_skip", { n: skipped })].filter(Boolean);
    hint.textContent = parts.length ? parts.join(" ") : t("b_hint", { n: MAX });
  };

  /* ---------- sharing: the 1ms.dog dialog (/assets/share/, copied from 1ms-shell), as on the main page ---------- */
  // The link carries the rows after #b= (never sent to the server); the dialog's box adds the addresses, to the link
  // and to the card alike. The card is the table, drawn in the page's theme.
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const stamp = () => new Date(at).toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const ROW = 56, HEAD = 150;
  const okRows = () => rows.filter(r => r.r);
  function drawCard(g, kit) {
    const { W, P } = kit, show = kit.show, R = sortRows(okRows(), sort.col, sort.dir);
    const C = { fg: cssVar("--fg"), mu: cssVar("--muted"), line: cssVar("--line") };
    const LV = { good: cssVar("--t1"), warn: cssVar("--t3"), bad: cssVar("--t5") };
    const GC = { A: cssVar("--t1"), B: cssVar("--t2"), C: cssVar("--t3"), D: cssVar("--t4"), F: cssVar("--t5") };
    const FF = cssVar("--f-ui") || kit.F, FN = cssVar("--f-num") || kit.M;
    const font = (wt, sz, mono) => { g.font = `${wt} ${sz}px ${mono ? FN : FF}`; };
    const text = (str, x, y, color) => { g.fillStyle = color; g.textAlign = "left"; g.fillText(str, x, y); };
    // the columns, by weight across the card's width; the address column only when the box is ticked
    const COLS = [["n", 0.5], ...(show ? [["ip", 3.4]] : []), ["cc", 1], ["score", 1.3], ["type", 1.3], ["native", 1.7], ["anon", 1.7], ["ai", 1.2], ["stream", 1.2]];
    const sum = COLS.reduce((a, [, w]) => a + w, 0), X = {}, Wd = {};
    let x = P;
    for (const [k, w] of COLS) { X[k] = x; Wd[k] = (W - 2 * P) * w / sum - 14; x += (W - 2 * P) * w / sum; }
    const HD = { n: "#", ip: t("b_c_ip"), cc: t("b_c_loc"), score: t("b_c_score"), type: t("b_c_type"), native: t("b_c_native"), anon: t("b_c_anon"), ai: t("b_c_ai"), stream: t("b_c_stream") };
    let y = kit.top + 56;
    font(700, 40); text(t("b_h1"), P, y, C.fg);
    font(500, 24); text(t("b_n", { n: R.length }), P, y + 42, C.mu);
    y = kit.top + HEAD;
    font(600, 20);
    for (const [k] of COLS) text(kit.clip(g, HD[k], Wd[k]), X[k], y, C.mu);
    g.fillStyle = C.line; g.fillRect(P, y + 16, W - 2 * P, 2);
    const pill = (lv, x0, y0) => {
      if (!lv) { font(500, 22); text("–", x0, y0, C.mu); return; }
      font(700, 20); const s = t("lv_" + lv), w = g.measureText(s).width + 20;
      g.globalAlpha = 0.16; g.fillStyle = LV[lv]; kit.roundRect(g, x0, y0 - 22, w, 32, 8); g.fill(); g.globalAlpha = 1;
      text(s, x0 + 10, y0, LV[lv]);
    };
    R.forEach((row, i) => {
      const r = row.r, yy = y + 18 + (i + 1) * ROW - 18;
      font(500, 22, true); text(String(row.i + 1), X.n, yy, C.mu);
      if (show) { font(600, 22, true); text(kit.clip(g, row.ip || t("b_hidden"), Wd.ip), X.ip, yy, row.ip ? C.fg : C.mu); }
      font(500, 22, true); text(r.cc || "–", X.cc, yy, C.fg);
      font(700, 26, true); const sc = String(r.score); text(sc, X.score, yy, GC[r.grade]);
      const sw = g.measureText(sc).width; font(700, 20); text(r.grade, X.score + sw + 8, yy, GC[r.grade]);
      font(500, 22); text(kit.clip(g, r.type ? t("t_" + r.type) : "–", Wd.type), X.type, yy, C.fg);
      text(kit.clip(g, r.native == null ? "–" : r.native ? t("fs_native") : t("fs_broadcast") + (r.regCc ? " " + r.regCc : ""), Wd.native), X.native, yy, C.fg);
      const an = r.anon.map(a => a === "proxy" ? t("tag_proxy") : a === "tor" ? "Tor" : "VPN").join(" · ");
      text(kit.clip(g, an || t("fs_clean"), Wd.anon), X.anon, yy, an ? LV.bad : C.mu);
      pill(r.ai, X.ai, yy); pill(r.stream, X.stream, yy);
      if (i < R.length - 1) { g.fillStyle = C.line; g.fillRect(P, yy + 20, W - 2 * P, 1); }
    });
  }
  $("#shareBtn").onclick = async () => {
    if (!okRows().length) return;
    const { share } = await import("/assets/share/share.js?v=8");
    const links = { false: location.origin + SELF + "#b=" + packRows(rows, { at }), true: location.origin + SELF + "#b=" + packRows(rows, { at, withIp: true }) };
    share({
      lang: LANG, name: t("app_name"), file: `ipqs-batch-${stamp()}`,
      // the addresses stay out of the link and the card unless the box is ticked
      show: ["ip"], canShow: true,
      link: show => links[!!show], home: location.origin + SELF,
      text: () => t("b_h1") + " · " + t("b_n", { n: okRows().length }),
      height: (m, kit) => kit.top + HEAD + okRows().length * ROW + 130,
      draw: drawCard,
      foot: () => [t("card_cta")],
      ts: Date.parse(at),
    }).open();
  };

  // a shared link: the rows it carries, read only, under the shared banner (whose button checks a list of one's own)
  const m = /^#b=([\w-]+)$/.exec(location.hash);
  if (m) {
    const P = unpackRows(m[1]);
    if (P && P.rows.length) {
      shared = true; at = P.at; rows = P.rows; document.documentElement.setAttribute("data-shared", "");
      $("#res").hidden = false; $(".bt-acts").hidden = true; $("#ask").hidden = true;
      draw();
      import("/assets/share/share.js?v=8").then(({ received }) =>
        received({ lang: LANG, ts: Date.parse(P.at) || Date.now(), at: $("#res"), test: () => { location.href = SELF; } }), () => {});
    }
  }
})();
