// ipqs batch page (/batch/): a pasted list of up to 20 addresses, each checked with the same /api/check the main page
// uses (a few at a time, answers the Worker has cached cost the sources nothing), drawn as one table: score and grade,
// location, network type, native or broadcast, anonymity flags, AI and streaming verdicts. Sortable by any column;
// a shared link carries the rows in its #fragment, without the addresses unless the visitor ticks the box.
// Strings: window.L1MS (the main page's, plus the b_* ones).
import { parseList, rowOf, packRows, unpackRows, sortRows, MAX } from "./batch.mjs";
import { readSeg, addrLines, ST, verdictOf } from "./seg.mjs";

(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const D = JSON.parse($("#data").textContent);
  const L = window.L1MS || {}, LANG = D.lang;
  // a count of one picks the key_one sentence where there is one (as on the main page)
  const PLURAL = new Intl.PluralRules(LANG), plural = (k, v) => { const c = v && v.n, r = c != null && k + "_" + PLURAL.select(+c); return r && L[r] != null ? r : k; };
  const t = (k, v) => { let s = L[plural(k, v)] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
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
    // an IPv6 prefix shows the prefix, with the address that stands for it in the link
    const label = row.net || row.ip, r = row.r, ip = row.ip
      ? (shared ? `<span class="ip">${esc(label)}</span>` : `<a class="ip" href="${HOME}?ip=${encodeURIComponent(row.ip)}" target="_blank" rel="noopener"${row.net ? ` title="${esc(row.ip)}"` : ""}>${esc(label)}</a>`) +
        (row.net ? ` <span class="bt-rep" title="${esc(t("b_v6_rep_d", { ip: row.ip }))}">${esc(t("b_v6_rep"))}</span>` : "")
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
  let items = [], note = "";
  // the entries a note names: the first three, then how many more
  const names = a => a.slice(0, 3).join(t("v_join")) + (a.length > 3 ? t("b_more", { n: a.length - 3 }) : "");
  async function start(list) {
    const me = ++run;
    shared = false; at = new Date().toISOString(); items = list;
    rows = list.map((x, i) => ({ i, ip: x.ip, ...(x.net ? { net: x.net } : {}), st: "wait", r: null }));
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
    // what the list left out stays said after the result
    hint.textContent = t(bad ? "b_errs" : "b_done", { n: bad || rows.length }) + (note ? " " + note : "");
  }
  $("#ask").onsubmit = e => {
    e.preventDefault();
    const P = parseList(box.value);
    if (!P.items.length && !P.seg) { say(P.big.length ? "b_seg_big" : "b_none", { p: P.big[0] }); box.focus(); return; }
    if (history.replaceState && location.hash) history.replaceState(null, "", SELF + location.search);
    if (P.seg) segShow(P.seg); else { $("#seg").hidden = true; seg = null; }
    if (P.items.length) start(P.items); else { run++; items = []; rows = []; $("#res").hidden = true; go.disabled = false; }
    const parts = [P.over && t("b_cut", { n: MAX, over: P.over }), ...["priv", "dup", "bad"].map(k => P.skip[k].length && t("b_skip_" + k, { list: names(P.skip[k]) })),
      P.big.length && t("b_seg_big", { p: P.big[0] }), P.segMore && t("b_seg_more", { n: P.segMore })].filter(Boolean);
    note = parts.join(" ");
    hint.textContent = note || t(P.seg && !P.items.length ? "b_seg_hint" : "b_hint", { n: MAX });
  };

  /* ---------- a /24: its portrait from the 1ms.dog server (as on the main page), and picking addresses to score ---------- */
  // The portrait is one request for all 256 addresses (public lists and reverse names, read on the server: no source's
  // quota); the visitor picks the ones worth a full check, up to what the table has room for.
  let seg = null, picked = new Set();
  const inSeg = ip => !!seg && seg.cells.some(c => c.ip === ip);
  const room = () => MAX - items.filter(x => !inSeg(x.ip)).length;
  function segPickUi() {
    $$("#segMap i").forEach((el, i) => el.classList.toggle("on", picked.has(i)));
    $("#segPick").textContent = t("b_seg_pick", { n: picked.size, max: room() - picked.size });
    const go2 = $("#segGo"); go2.disabled = !picked.size; go2.textContent = t("b_seg_go", { n: picked.size });
    const listed = seg ? seg.cells.filter(c => c.st !== "ok").length : 0;
    const lb = $("#segListed"); lb.hidden = !listed; lb.textContent = t("b_seg_listed", { n: Math.min(listed, room()) });
  }
  const segSay = i => {
    const c = seg && seg.cells[i], el = $("#segInfo");
    if (!c) { el.textContent = t("sg_hint"); return; }
    // a shared portrait carries each address's colour only (and the addresses only when they were shared)
    if (c.flags == null) { el.innerHTML = `<span class="ip">${esc(c.ip || "#" + i)}</span><span class="st2"><i class="dot s-${c.st}"></i>${esc(t("sg_l_" + c.st))}</span>`; return; }
    el.innerHTML = `<span class="ip">${esc(c.ip)}</span><span class="st2"><i class="dot s-${c.st}"></i>${esc(addrLines(c).map(([k, q]) => t(k, q)).join(t("v_join")))}</span>` +
      `<span class="nm" title="${esc(c.name)}">${esc(c.name || t("sg_a_noname"))}</span>`;
  };
  // the verdict, the grid and the legend, for the portrait just read or one carried by a shared link
  function segDraw() {
    const v = $("#segV");
    v.className = "sg-verdict " + seg.verdict.lv;
    v.textContent = seg.verdict.listed ? t("sg_v_n", { n: seg.verdict.listed }) : t("sg_v_0");
    $("#segMap").innerHTML = seg.cells.map((c, i) => `<i class="s-${c.st}" data-c="${i}"${c.ip ? ` aria-label="${esc(c.ip)}"` : ""}></i>`).join("");
    $("#segLeg").innerHTML = ST.map(st => `<li${seg.count[st] ? "" : ' class="z"'}><i class="dot s-${st}"></i>${esc(t("sg_l_" + st))} <b>${seg.count[st]}</b></li>`).join("");
  }
  // a shared link's portrait: its 256 colours, and its range when the addresses were shared
  function segShared(S) {
    const b3 = S.base ? S.base.split(".").slice(0, 3).join(".") : null;
    const count = Object.fromEntries(ST.map(s => [s, 0]));
    const cells = S.sts.map((st, i) => { count[st]++; return { ip: b3 ? `${b3}.${i}` : null, st }; });
    seg = { base: S.base, cells, count, verdict: verdictOf(count) };
    $("#seg").hidden = false; $("#segN").textContent = b3 ? `${b3}.0/24` : t("b_hidden");
    $(".bt-seg-a").hidden = true; $("#segInfo").textContent = t("sg_hint");
    segDraw();
  }
  async function segShow(base) {
    const label = base.split(".").slice(0, 3).join(".") + ".0/24";
    seg = null; picked = new Set();
    $("#seg").hidden = false; $("#segN").textContent = label; $(".bt-seg-a").hidden = false;
    const v = $("#segV"); v.className = "sg-verdict wait"; v.textContent = t("sg_v_wait");
    $("#segMap").innerHTML = Array.from({ length: 256 }, () => `<i class="s-wait"></i>`).join("");
    $("#segLeg").innerHTML = ""; $("#segInfo").textContent = t("sg_hint"); $("#segListed").hidden = true; $("#segGo").disabled = true; $("#segPick").textContent = "";
    let j = null;
    try { const res = await fetch(D.seg + "/v1/seg?ip=" + encodeURIComponent(base), { credentials: "omit", signal: AbortSignal.timeout(15000) }); if (res.ok) j = await res.json(); } catch (e) {}
    if ($("#segN").textContent !== label) return;
    if (!j || !j.seg) { v.className = "sg-verdict"; v.textContent = t("b_seg_fail"); $("#segMap").innerHTML = ""; return; }
    seg = { ...readSeg(j, null, null), base };
    segDraw();
    segPickUi();
  }
  const segMap = $("#segMap");
  segMap.addEventListener("mouseover", e => { const i = e.target.dataset && e.target.dataset.c; if (i != null) segSay(+i); });
  segMap.addEventListener("click", e => {
    const i = e.target.dataset && e.target.dataset.c; if (i == null || !seg) return;
    segSay(+i);
    if (shared) return;
    if (picked.has(+i)) picked.delete(+i); else if (picked.size < room()) picked.add(+i);
    segPickUi();
  });
  // the listed neighbours, worst first, as many as there is room for
  $("#segListed").onclick = () => {
    if (!seg) return;
    const order = seg.cells.map((c, i) => [i, ST.indexOf(c.st)]).filter(([, k]) => ST[k] !== "ok").sort((a, b) => a[1] - b[1]);
    picked = new Set(order.slice(0, room()).map(([i]) => i));
    segPickUi();
  };
  // the picked addresses join the table (rows already checked come back from the Worker's cache)
  $("#segGo").onclick = () => {
    if (!seg || !picked.size) return;
    const mine = items.filter(x => !inSeg(x.ip)); note = "";
    start([...mine, ...[...picked].sort((a, b) => a - b).map(i => ({ ip: seg.cells[i].ip }))].slice(0, MAX));
  };

  /* ---------- sharing: the 1ms.dog dialog (/assets/share/, copied from 1ms-shell), as on the main page ---------- */
  // The link carries the rows after #b= (never sent to the server); the dialog's box adds the addresses, to the link
  // and to the card alike. The card is the table, drawn in the page's theme.
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const stamp = () => new Date(at).toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const ROW = 56, HEAD = 150;
  const okRows = () => rows.filter(r => r.r);
  // the /24's block on the card: its title and verdict, the 256 squares 32 a row, the legend
  const SQG = 5, sqOf = kit => (kit.W - 2 * kit.P - 31 * SQG) / 32;
  const segH = kit => seg && seg.cells ? 134 + 8 * (sqOf(kit) + SQG) + 56 : 0;
  // a status's colour as the page draws it (the squares' colours are mixed in CSS; the canvas takes the result)
  const stColor = st => {
    const el = document.createElement("i"); el.className = "s-" + st; el.style.cssText = "position:absolute;width:1px;height:1px;background:var(--sq)";
    $("#segMap").appendChild(el); const c = getComputedStyle(el).backgroundColor; el.remove(); return c;
  };
  function drawSeg(g, kit, y0, font, text, C) {
    const { W, P } = kit, s = sqOf(kit), b3 = seg.base ? seg.base.split(".").slice(0, 3).join(".") : null;
    const SC = Object.fromEntries(ST.map(st => [st, stColor(st)]));
    const VC = { ok: cssVar("--t1"), warn: cssVar("--t3"), bad: cssVar("--t5") };
    font(700, 26); text(t("sg_h") + (kit.show && b3 ? ` · ${b3}.0/24` : ""), P, y0 + 26, C.fg);
    font(700, 24); text(seg.verdict.listed ? t("sg_v_n", { n: seg.verdict.listed }) : t("sg_v_0"), P, y0 + 66, VC[seg.verdict.lv] || C.fg);
    const gy = y0 + 88;
    seg.cells.forEach((c, i) => { g.fillStyle = SC[c.st]; kit.roundRect(g, P + (i % 32) * (s + SQG), gy + Math.floor(i / 32) * (s + SQG), s, s, 4); g.fill(); });
    let lx = P; const ly = gy + 8 * (s + SQG) + 30;
    for (const st of ST) {
      g.globalAlpha = seg.count[st] ? 1 : 0.45;
      g.fillStyle = SC[st]; kit.roundRect(g, lx, ly - 15, 16, 16, 4); g.fill();
      font(500, 20); const lab = `${t("sg_l_" + st)} ${seg.count[st]}`; text(lab, lx + 24, ly, C.mu);
      lx += 24 + g.measureText(lab).width + 28; g.globalAlpha = 1;
    }
  }
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
    if (segH(kit)) drawSeg(g, kit, kit.top + HEAD - 10, font, text, C);
    if (!R.length) return;
    y = kit.top + HEAD + segH(kit);
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
      if (show) { font(600, 22, true); text(kit.clip(g, row.net || row.ip || t("b_hidden"), Wd.ip), X.ip, yy, row.ip ? C.fg : C.mu); }
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
    if (!okRows().length && !(seg && seg.cells)) return;
    const { share } = await import("/assets/share/share.js?v=8");
    // the /24 goes along as its colours; its range, like the addresses, only when the box is ticked
    const S = seg && seg.cells ? { base: seg.base, sts: seg.cells.map(c => c.st) } : null;
    const links = { false: location.origin + SELF + "#b=" + packRows(rows, { at, seg: S }), true: location.origin + SELF + "#b=" + packRows(rows, { at, withIp: true, seg: S }) };
    share({
      lang: LANG, name: t("app_name"), file: `ipqs-batch-${stamp()}`,
      // the addresses stay out of the link and the card unless the box is ticked
      show: ["ip"], canShow: true,
      link: show => links[!!show], home: location.origin + SELF,
      text: () => t("b_h1") + " · " + t("b_n", { n: okRows().length }),
      height: (m, kit) => kit.top + HEAD + segH(kit) + (okRows().length ? okRows().length * ROW + 130 : 40),
      draw: drawCard,
      foot: () => [t("card_cta")],
      ts: Date.parse(at),
    }).open();
  };

  // a shared link: the rows it carries, read only, under the shared banner (whose button checks a list of one's own)
  const m = /^#b=([\w-]+)$/.exec(location.hash);
  if (m) {
    const P = unpackRows(m[1]);
    if (P) {
      shared = true; at = P.at; rows = P.rows; document.documentElement.setAttribute("data-shared", "");
      $(".bt-acts").hidden = true; $("#ask").hidden = true;
      if (P.seg) segShared(P.seg);
      $("#res").hidden = !rows.length;
      if (rows.length) draw();
      import("/assets/share/share.js?v=8").then(({ received }) =>
        received({ lang: LANG, ts: Date.parse(P.at) || Date.now(), at: P.seg ? $("#seg") : $("#res"), test: () => { location.href = SELF; } }), () => {});
    }
  }
})();
