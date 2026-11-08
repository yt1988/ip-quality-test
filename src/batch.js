// ipqs batch page (/batch/): a pasted list of up to 20 addresses, each checked with the same /api/check the main page
// uses (a few at a time, answers the Worker has cached cost the sources nothing), drawn as one table: score and grade,
// location, network type, native or broadcast, anonymity flags, AI and streaming verdicts. Sortable by any column;
// a shared link carries the rows in its #fragment, without the addresses unless the visitor ticks the box.
// Strings: window.L1MS (the main page's, plus the b_* ones).
import { parseList, rowOf, packRows, unpackRows, sortRows, MAX, SEGS, inRange, rangeLabel } from "./batch.mjs";
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
    const done = rows.filter(r => r.st === "ok" || r.st === "err").length, segOk = segs.some(g => g.d);
    // the whole result's header, above the ranges and the table: what there is, and the share button for all of it
    // (a shared result has the shared banner instead)
    $("#sum").hidden = shared || (!rows.length && !segs.length);
    $("#sumT").textContent = [segs.length && t("b_sr_count", { n: segs.length }), rows.length && t("b_sum_ip", { n: rows.length })].filter(Boolean).join(" · ");
    $("#res").hidden = !rows.length;
    $("#prog").textContent = shared ? t("b_n", { n: rows.length }) : t("b_prog", { n: done, of: rows.length });
    $("#shareBtn").disabled = shared || done < rows.length || (!rows.some(r => r.r) && !segOk);
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
    // with /24s, the count is every address looked at: the 256 of each /24 (read against the lists) and the rows
    // outside them (scored in full)
    const inSegs = ip => segs.some(g => g.base && ip.split(".").length === 4 && ip.startsWith(g.base.slice(0, -1)) && inRange(g, +ip.split(".")[3]));
    const out = rows.filter(r => !inSegs(r.ip)).length, a = segs.reduce((x, g) => x + g.n, 0);
    const done = segs.length ? t("b_done_seg", { all: a + out, n: rows.length, s: segs.length, a }) : t("b_done", { n: rows.length });
    hint.textContent = (bad ? t("b_errs", { n: bad }) : done) + (note ? " " + note : "");
  }
  $("#ask").onsubmit = e => {
    e.preventDefault();
    const P = parseList(box.value);
    if (!P.items.length && !P.segs.length) { say(P.big.length ? "b_seg_big" : "b_none", { p: P.big[0], n: SEGS }); box.focus(); return; }
    if (history.replaceState && location.hash) history.replaceState(null, "", SELF + location.search);
    listItems = P.items;
    segsStart(P.segs);
    if (P.items.length) start(P.items); else { run++; items = []; rows = []; go.disabled = false; draw(); }
    const parts = [P.over && t("b_cut", { n: MAX, over: P.over }), ...["priv", "dup", "bad"].map(k => P.skip[k].length && t("b_skip_" + k, { list: names(P.skip[k]) })),
      P.big.length && t("b_seg_big", { p: names(P.big), n: SEGS }), P.segMore.length && t("b_seg_more", { n: SEGS, list: names(P.segMore) })].filter(Boolean);
    note = parts.join(" ");
    hint.textContent = note || t(P.segs.length && !P.items.length ? "b_seg_hint" : "b_hint", { n: MAX });
  };

  /* ---------- /24s: each one's portrait from the 1ms.dog server, compared a row each; one opened to pick from ---------- */
  // A portrait is one request for all 256 addresses (public lists and reverse names, read on the server: no source's
  // quota). Up to SEGS of them are compared in a list; the one opened under it shows its grid, where the visitor picks
  // addresses for the table: every /24's picks together, with the list's own addresses, up to MAX.
  // segs: [{ base, lo, bits, n (the range in its /24: all 256 for a /24), st: "wait" | "ok" | "err", why,
  //          d: the /24's portrait (readSeg), v: what the range's own addresses say ({ count, verdict }), picked }]
  // A range narrower than a /24 is counted, picked from and shared as its own addresses; the rest of its /24 stays in
  // view, faint, for the neighbours.
  let segs = [], cur = -1, listItems = [];
  const viewOf = g => {
    const count = Object.fromEntries(ST.map(s => [s, 0]));
    g.d.cells.forEach((c, k) => { if (inRange(g, k)) count[c.st]++; });
    const listed = g.n - count.ok;
    return { count, verdict: { listed, lv: count.bad ? "bad" : listed ? "warn" : "ok" } };
  };
  const KIND_LV = { hosting: "warn", dynamic: "ok", static: "info", mixed: "info", unknown: "none" };
  const TAGC = { ok: "good", warn: "warn", bad: "bad" };
  const pickedN = () => segs.reduce((a, g) => a + g.picked.size, 0);
  const room = () => MAX - listItems.length - pickedN();
  const labelOf = (g, i) => g.base ? rangeLabel(g) : t("b_seg_n", { n: i + 1 }) + (g.bits > 24 ? ` (/${g.bits})` : "");
  const inList = ip => listItems.some(x => x.ip === ip);
  const verdictText = v => v.verdict.listed ? t("b_sr_n", { n: v.verdict.listed }) : t("b_sr_0");
  // one row of the comparison: the range, what kind of network it is, how many of its addresses are listed (by list),
  // the 256 squares small, and how many are picked from it
  function segRow(g, i) {
    let body;
    if (g.st === "wait") body = `<span class="bt-sr-v m">${esc(t("b_sr_wait"))}</span><span class="bt-mini wait">${"<i></i>".repeat(256)}</span>`;
    else if (g.st === "err") body = `<span class="bt-sr-v m">${esc(t(g.why === "rate" ? "b_sr_rate" : "b_sr_err"))}</span><span class="bt-mini"></span>`;
    else {
      const d = g.d, px = d.prefix && !d.prefix.none ? d.prefix : null;
      const meta = [`<span class="tag ${TAGC[KIND_LV[d.kind.kind]] || ""}">${esc(t("sg_k_" + d.kind.kind))}</span>`,
        px && `<span class="m">${esc(px.prefix)}${px.asns && px.asns.length ? " · AS" + px.asns.join(" AS") : ""}</span>`].filter(Boolean).join(" ");
      const v = g.v, by = ST.filter(s => s !== "ok" && v.count[s]).map(s => `<span class="bt-sr-c"><i class="dot s-${s}"></i>${v.count[s]}</span>`).join("");
      body = `<span class="bt-sr-k">${meta}</span><span class="bt-sr-v ${v.verdict.lv}">${esc(verdictText(v))}${by}</span>` +
        `<span class="bt-mini">${d.cells.map((c, k) => `<i class="s-${c.st}${inRange(g, k) ? "" : " x"}"></i>`).join("")}</span>`;
    }
    const pk = g.picked.size ? `<span class="bt-sr-p">${esc(t("b_sr_picked", { n: g.picked.size }))}</span>` : "";
    return `<li class="bt-sr${i === cur ? " on" : ""}"><button type="button" data-s="${i}" aria-expanded="${i === cur}"><span class="bt-sr-n ip">${esc(labelOf(g, i))}</span>${body}${pk}</button></li>`;
  }
  function segList() {
    $("#seg").hidden = !segs.length;
    $("#segN").textContent = "";
    $("#segList").innerHTML = segs.map(segRow).join("");
    $("#segList").hidden = segs.length < 2;   // one /24 needs no list: its grid is the whole story
    draw();
  }
  // the opened /24: its verdict, its grid (the list's own addresses ringed, the picked ones marked), its legend
  function segOpen(i) {
    cur = i; const g = segs[i];
    $("#segXN").textContent = labelOf(g, i);
    const v = $("#segV"), map = $("#segMap");
    if (!g || g.st !== "ok") {
      v.className = "sg-verdict" + (g && g.st === "wait" ? " wait" : ""); v.textContent = t(!g ? "sg_v_wait" : g.st === "wait" ? "sg_v_wait" : g.why === "rate" ? "b_sr_rate" : "b_seg_fail");
      map.innerHTML = g && g.st === "wait" ? `<i class="s-wait"></i>`.repeat(256) : "";
      $("#segLeg").innerHTML = ""; $("#segInfo").textContent = "";
    } else {
      const d = g.d, vw = g.v, part = g.n < 256;
      v.className = "sg-verdict " + vw.verdict.lv;
      v.textContent = part ? t(vw.verdict.listed ? "b_rg_v_n" : "b_rg_v_0", { n: vw.verdict.listed, m: g.n }) : vw.verdict.listed ? t("sg_v_n", { n: vw.verdict.listed }) : t("sg_v_0");
      // outside the range: faint, and not for picking
      map.innerHTML = d.cells.map((c, k) => inRange(g, k)
        ? `<i class="s-${c.st}${c.ip && inList(c.ip) ? " me" : ""}${g.picked.has(k) ? " on" : ""}" data-c="${k}"${c.ip ? ` aria-label="${esc(c.ip)}"` : ""}></i>`
        : `<i class="s-${c.st} x" data-c="${k}"></i>`).join("");
      $("#segLeg").innerHTML = ST.map(st => `<li${vw.count[st] ? "" : ' class="z"'}><i class="dot s-${st}"></i>${esc(t("sg_l_" + st))} <b>${vw.count[st]}</b></li>`).join("") +
        (part ? `<li class="z"><i class="dot x"></i>${esc(t("b_rg_out"))}</li>` : "") +
        (d.cells.some(c => c.ip && inList(c.ip)) ? `<li><i class="dot me"></i>${esc(t("b_seg_inlist"))}</li>` : "");
      $("#segInfo").textContent = t("sg_hint");
    }
    $$("#segList [data-s]").forEach(b => { const on = +b.dataset.s === i; b.parentElement.classList.toggle("on", on); b.setAttribute("aria-expanded", on); });
    segPickUi();
  }
  function segPickUi() {
    const g = segs[cur], ok = !!(g && g.st === "ok") && !shared;
    $(".bt-seg-a").hidden = shared || !segs.some(x => x.st === "ok");
    $("#segPick").textContent = t("b_seg_pick", { n: pickedN(), max: Math.max(0, room()) });
    const go2 = $("#segGo"); go2.disabled = !pickedN(); go2.textContent = t("b_seg_go", { n: pickedN() });
    const listed = ok ? g.d.cells.filter((c, k) => inRange(g, k) && c.st !== "ok" && !g.picked.has(k) && !inList(c.ip)).length : 0;
    const lb = $("#segListed"); lb.hidden = !listed || room() <= 0; lb.textContent = t("b_seg_listed", { n: Math.min(listed, Math.max(0, room())) });
  }
  const segSay = k => {
    const g = segs[cur], c = g && g.d && g.d.cells[k], el = $("#segInfo");
    if (!c) { el.textContent = t("sg_hint"); return; }
    // a shared portrait carries each address's colour only (and the addresses only when they were shared)
    if (c.flags == null) { el.innerHTML = `<span class="ip">${esc(c.ip || "#" + k)}</span><span class="st2"><i class="dot s-${c.st}"></i>${esc(t("sg_l_" + c.st))}</span>`; return; }
    el.innerHTML = `<span class="ip">${esc(c.ip)}</span>${inList(c.ip) ? `<span class="tag">${esc(t("b_seg_inlist"))}</span>` : ""}<span class="st2"><i class="dot s-${c.st}"></i>${esc(addrLines(c).map(([a, q]) => t(a, q)).join(t("v_join")))}</span>` +
      `<span class="nm" title="${esc(c.name)}">${esc(c.name || t("sg_a_noname"))}</span>`;
  };
  // a /24's portrait from the server, two at a time; a busy server is asked again, a used-up allowance is said so
  async function segFetch(g, me) {
    for (let tries = 0; tries < 4; tries++) {
      let res = null;
      try { res = await fetch(D.seg + "/v1/seg?ip=" + encodeURIComponent(g.base), { credentials: "omit", signal: AbortSignal.timeout(15000) }); } catch (e) {}
      if (me !== segRun) return;
      if (res && res.ok) { try { const j = await res.json(); if (j && j.seg) { g.d = readSeg(j, null, null); g.v = viewOf(g); g.st = "ok"; return; } } catch (e) {} break; }
      if (res && res.status === 429) { g.why = "rate"; break; }
      await sleep(2000 * (tries + 1));
    }
    g.st = "err";
  }
  let segRun = 0;
  async function segsStart(bases) {
    const me = ++segRun;
    segs = bases.map(r => ({ ...r, st: "wait", d: null, picked: new Set() }));
    cur = segs.length ? 0 : -1;
    segList(); if (segs.length) segOpen(0);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, segs.length) }, async () => {
      while (next < segs.length && me === segRun) {
        const g = segs[next++];
        await segFetch(g, me);
        if (me !== segRun) return;
        segList(); if (segs[cur] === g) segOpen(cur); else segPickUi();
      }
    }));
  }
  $("#segList").addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (b) segOpen(+b.dataset.s); });
  const segMap = $("#segMap");
  segMap.addEventListener("mouseover", e => { const k = e.target.dataset && e.target.dataset.c; if (k != null) segSay(+k); });
  segMap.addEventListener("click", e => {
    const k = e.target.dataset && e.target.dataset.c, g = segs[cur]; if (k == null || !g || !g.d) return;
    segSay(+k);
    if (shared || !inRange(g, +k)) return;
    if (g.picked.has(+k)) g.picked.delete(+k); else if (room() > 0 && !inList(g.d.cells[+k].ip)) g.picked.add(+k);
    e.target.classList.toggle("on", g.picked.has(+k));
    segList(); segPickUi();
  });
  // this /24's listed addresses, worst first, as many as there is room for
  $("#segListed").onclick = () => {
    const g = segs[cur]; if (!g || !g.d) return;
    const order = g.d.cells.map((c, k) => [k, ST.indexOf(c.st)]).filter(([k, s]) => inRange(g, k) && ST[s] !== "ok" && !g.picked.has(k) && !inList(g.d.cells[k].ip)).sort((a, b) => a[1] - b[1]);
    for (const [k] of order.slice(0, Math.max(0, room()))) g.picked.add(k);
    segList(); segOpen(cur);
  };
  // the picked addresses join the table after the list's own (rows already checked come back from the Worker's cache)
  $("#segGo").onclick = () => {
    if (!pickedN()) return;
    note = "";
    const picks = segs.flatMap(g => g.d ? [...g.picked].sort((a, b) => a - b).map(k => ({ ip: g.d.cells[k].ip })) : []);
    start([...listItems, ...picks].slice(0, MAX));
  };

  /* ---------- sharing: the 1ms.dog dialog (/assets/share/, copied from 1ms-shell), as on the main page ---------- */
  // The link carries the rows and the /24s after #b= (never sent to the server); the dialog's box adds the addresses
  // (and the /24s' ranges, prefixes and ASes), to the link and to the card alike. The card is the /24s' comparison and
  // the table, drawn in the page's theme.
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const stamp = () => new Date(at).toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const ROW = 56, HEAD = 150, SROW = 100;
  const okRows = () => rows.filter(r => r.r);
  const okSegs = () => segs.filter(g => g.d);
  const segH = () => okSegs().length ? 56 + okSegs().length * SROW + 24 : 0;
  // a status's colour as the page draws it (the squares' colours are mixed in CSS; the canvas takes the result)
  const stColor = st => {
    const el = document.createElement("i"); el.className = "s-" + st; el.style.cssText = "position:absolute;width:1px;height:1px;background:var(--sq)";
    $("#segMap").appendChild(el); const c = getComputedStyle(el).backgroundColor; el.remove(); return c;
  };
  // the /24s on the card: one row each, the range (when shown) and what it is on the left, the 256 squares 64 a row
  function drawSegs(g, kit, y0, font, text, C) {
    const { W, P } = kit, show = kit.show, SC = Object.fromEntries(ST.map(st => [st, stColor(st)]));
    const VC = { ok: cssVar("--t1"), warn: cssVar("--t3"), bad: cssVar("--t5") };
    const GX = P + 380, GW = W - P - GX, GAP = 2, sq = (GW - 63 * GAP) / 64;
    font(700, 26); text(t("sg_h"), P, y0 + 26, C.fg);
    okSegs().forEach((s, i) => {
      const y = y0 + 56 + i * SROW, d = s.d, px = d.prefix && !d.prefix.none ? d.prefix : null;
      font(600, 22, !!(show && s.base)); text(kit.clip(g, show && s.base ? labelOf(s, i) : labelOf({ ...s, base: null }, i), 360), P, y + 26, C.fg);
      font(500, 19); text(kit.clip(g, [t("sg_k_" + d.kind.kind), show && px ? px.prefix + (px.asns.length ? " · AS" + px.asns[0] : "") : ""].filter(Boolean).join(" · "), 360), P, y + 56, C.mu);
      font(700, 20); text(kit.clip(g, verdictText(s.v), 360), P, y + 84, VC[s.v.verdict.lv] || C.fg);
      // outside a narrower range: faint
      d.cells.forEach((c, k) => { g.globalAlpha = inRange(s, k) ? 1 : 0.22; g.fillStyle = SC[c.st]; kit.roundRect(g, GX + (k % 64) * (sq + GAP), y + 18 + Math.floor(k / 64) * (sq + GAP), sq, sq, 2); g.fill(); });
      g.globalAlpha = 1;
      if (i < okSegs().length - 1) { g.fillStyle = C.line; g.fillRect(P, y + SROW - 2, W - 2 * P, 1); }
    });
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
    font(500, 24); text([R.length && t("b_n", { n: R.length }), okSegs().length && t("b_sr_count", { n: okSegs().length })].filter(Boolean).join(" · "), P, y + 42, C.mu);
    if (segH()) drawSegs(g, kit, kit.top + HEAD - 10, font, text, C);
    if (!R.length) return;
    y = kit.top + HEAD + segH() + (segH() ? 30 : 0);
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
    if (!okRows().length && !okSegs().length) return;
    const { share } = await import("/assets/share/share.js?v=9");
    const S = okSegs().map(g => ({ base: g.base, lo: g.lo, bits: g.bits, sts: g.d.cells.map(c => c.st), kind: g.d.kind.kind, prefix: g.d.prefix && !g.d.prefix.none ? g.d.prefix : null }));
    const link = withIp => location.origin + SELF + "#b=" + packRows(rows, { at: at || new Date().toISOString(), withIp, segs: S });
    const links = { false: link(false), true: link(true) };
    share({
      lang: LANG, name: t("app_name"), file: `ipqs-batch-${stamp()}`,
      // the addresses (and the /24s' ranges) stay out of the link and the card unless the box is ticked
      show: ["ip"], canShow: true,
      link: show => links[!!show], home: location.origin + SELF,
      text: () => t("b_h1") + " · " + [okRows().length && t("b_n", { n: okRows().length }), okSegs().length && t("b_sr_count", { n: okSegs().length })].filter(Boolean).join(" · "),
      height: (m, kit) => kit.top + HEAD + segH() + (okRows().length ? (segH() ? 30 : 0) + okRows().length * ROW + 130 : 60),
      draw: drawCard,
      foot: () => [t("card_cta")],
      ts: Date.parse(at) || Date.now(),
    }).open();
  };

  // a shared link: the rows and /24s it carries, read only, under the shared banner (whose button checks a list of
  // one's own)
  const m = /^#b=([\w-]+)$/.exec(location.hash);
  if (m) {
    const P = unpackRows(m[1]);
    if (P) {
      shared = true; at = P.at; rows = P.rows; document.documentElement.setAttribute("data-shared", "");
      $("#ask").hidden = true;
      segs = P.segs.map(s => {
        const b3 = s.base ? s.base.split(".").slice(0, 3).join(".") : null;
        const count = Object.fromEntries(ST.map(x => [x, 0]));
        const cells = s.sts.map((st, k) => { count[st]++; return { ip: b3 ? `${b3}.${k}` : null, st }; });
        const g = { base: s.base, lo: s.lo, bits: s.bits, n: s.n, st: "ok", picked: new Set(), d: { cells, count, verdict: verdictOf(count), kind: { kind: s.kind }, prefix: s.prefix } };
        g.v = viewOf(g);
        return g;
      });
      cur = segs.length ? 0 : -1;
      segList(); if (segs.length) segOpen(0);
      if (rows.length) draw();
      import("/assets/share/share.js?v=9").then(({ received }) =>
        received({ lang: LANG, ts: Date.parse(P.at) || Date.now(), at: segs.length ? $("#seg") : $("#res"), test: () => { location.href = SELF; } }), () => {});
    }
  }
})();
