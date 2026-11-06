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
    $("#sharedNote").hidden = true; $("#ask").hidden = false;
    start(ips);
    const parts = [over && t("b_cut", { n: MAX, over }), skipped && t("b_skip", { n: skipped })].filter(Boolean);
    hint.textContent = parts.length ? parts.join(" ") : t("b_hint", { n: MAX });
  };

  /* ---------- sharing: the rows go in the link's #fragment, so the server never sees them ---------- */
  // the button itself says the link is copied (a tick, for two seconds), where the visitor is looking
  const shareBtn = $("#shareBtn"), shareLabel = shareBtn.querySelector("span"), SHARE_T = shareLabel.textContent;
  let flashT = 0;
  const flash = () => {
    shareBtn.classList.add("done"); shareLabel.textContent = t("b_copied_b");
    clearTimeout(flashT); flashT = setTimeout(() => { shareBtn.classList.remove("done"); shareLabel.textContent = SHARE_T; }, 2000);
  };
  shareBtn.onclick = async () => {
    const url = location.origin + SELF + "#b=" + packRows(rows, { at, withIp: $("#withIp").checked });
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ title: document.title, url });
      else { await navigator.clipboard.writeText(url); flash(); }
    } catch (e) {
      if (e && e.name === "AbortError") return;
      window.prompt(t("b_share"), url);
    }
  };

  // a shared link: the rows it carries, read only; the form stays for checking a list of one's own
  const m = /^#b=([\w-]+)$/.exec(location.hash);
  if (m) {
    const P = unpackRows(m[1]);
    if (P && P.rows.length) {
      shared = true; at = P.at; rows = P.rows;
      $("#sharedNote").hidden = false;
      let when = "";
      try { when = P.at ? new Date(P.at).toLocaleString(LANG, { dateStyle: "medium", timeStyle: "short" }) : ""; } catch (e) {}
      $("#sharedT").textContent = t(when ? "b_shared_at" : "b_shared", { at: when });
      $("#sharedGo").href = SELF;
      $("#res").hidden = false; $(".bt-acts").hidden = true; $("#ask").hidden = true;
      draw();
    }
  }
})();
