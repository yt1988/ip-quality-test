// ipqs page, laid out as EgressLens: the hero holds the score, the address, the visitor's exits and the findings; the
// second card lists every source, each row filled the moment it answers (the rows are in the HTML from the start).
// The score and findings come once every source is in. Strings: window.L1MS.
import { family, canon, isPublic } from "./ip.mjs";
import { assess } from "./score.mjs";
import { ccOfName, SOURCES } from "./sources.mjs";

(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const D = JSON.parse($("#data").textContent);
  const L = window.L1MS || {}, LANG = D.lang;
  const t = (k, v) => { let s = L[k] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const K = { theme: "ipqs:theme", lang: "ipqs:lang", mask: "ipqs:mask" };
  const country = cc => { try { return new Intl.DisplayNames([LANG], { type: "region" }).of(cc); } catch (e) { return cc; } };
  const flag = cc => /^[A-Z]{2}$/.test(cc || "") ? `<img class="flag" src="/flags/${cc.toLowerCase()}.svg" alt="" width="20" height="15">` : "";
  const list = a => a.join(t("v_join"));

  /* ---------- theme and language (synced across the 1ms.dog tools) ---------- */
  const thBtn = $("#theme"), TH = ["system", "light", "dark"];
  const applyTheme = th => {
    if (th === "light" || th === "dark") document.documentElement.setAttribute("data-theme", th); else document.documentElement.removeAttribute("data-theme");
    thBtn.dataset.th = th; thBtn.title = t("th_" + th); thBtn.setAttribute("aria-label", t("th_" + th));
  };
  applyTheme(TH.includes(store.get(K.theme)) ? store.get(K.theme) : "system");
  thBtn.onclick = () => { const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3]; store.set(K.theme, n); applyTheme(n); };
  $("#lang").onchange = e => { const l = e.target.value; store.set(K.lang, l); location.href = D.paths[l] + location.search; };
  const input = $("#ipIn");
  input.placeholder = t("ph");

  /* ---------- dialogs ---------- */
  function openDlg(id) { $("#" + id).hidden = false; document.documentElement.style.overflow = "hidden"; $("#" + id + " [data-close]").focus(); }
  function closeDlg() { $$(".scrim").forEach(s => { s.hidden = true; }); document.documentElement.style.overflow = ""; }
  $$("[data-close]").forEach(b => { b.onclick = closeDlg; });
  $$(".scrim").forEach(s => s.addEventListener("click", e => { if (e.target === s) closeDlg(); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDlg(); });
  // help: one answer at a time; a picker with previous / next on phones
  let helpIdx = 0;
  const helpN = $$("#helpNav [data-hq]").length;
  $("#helpSel").innerHTML = $$("#helpNav [data-hq]").map((b, i) => `<option value="${i}">${i + 1} / ${helpN} · ${esc(b.textContent)}</option>`).join("");
  function showHelp(i) {
    helpIdx = Math.max(0, Math.min(helpN - 1, i));
    $$("#helpNav [data-hq]").forEach(b => b.setAttribute("aria-selected", +b.dataset.hq === helpIdx));
    $$("#helpC [data-hqb]").forEach(a => { a.hidden = +a.dataset.hqb !== helpIdx; });
    $("#helpSel").value = helpIdx;
    $$("[data-hstep]").forEach(b => { b.disabled = helpIdx + +b.dataset.hstep < 0 || helpIdx + +b.dataset.hstep >= helpN; });
    $("#helpC").scrollTop = 0;
  }
  $("#helpBtn").onclick = () => { showHelp(helpIdx); openDlg("help"); };
  $$("#helpNav [data-hq]").forEach(b => { b.onclick = () => showHelp(+b.dataset.hq); });
  $("#helpSel").onchange = e => showHelp(+e.target.value);
  $$("[data-hstep]").forEach(b => { b.onclick = () => showHelp(helpIdx + +b.dataset.hstep); });


  /* ---------- hide the address (for screenshots) ---------- */
  const eye = $("#eye"), masked = () => store.get(K.mask) === "1";
  const applyMask = () => { $("#facts").classList.toggle("masked", masked()); $("#exList").classList.toggle("masked", masked()); eye.textContent = t(masked() ? "show" : "hide"); };
  eye.onclick = () => { store.set(K.mask, masked() ? "0" : "1"); applyMask(); };
  applyMask();

  /* ---------- pieces ---------- */
  const SKL = '<i class="skl"></i>';
  const typeName = ty => t("t_" + ty);
  const riskLv = v => v >= 70 ? "bad" : v >= 35 ? "warn" : "ok";
  const getJ = (u, ms = 5000) => fetch(u, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(ms) }).then(r => r.ok ? r.json() : Promise.reject());
  const getT = (u, ms = 5000) => fetch(u, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(ms) }).then(r => r.ok ? r.text() : Promise.reject());
  // the tooltip: rows and marks that explain themselves on hover (data-why)
  let tipEl;
  function showTip(el) {
    if (!tipEl) { tipEl = document.body.appendChild(Object.assign(document.createElement("div"), { className: "tip" })); addEventListener("scroll", () => tipEl.classList.remove("on"), { passive: true }); }
    tipEl.textContent = el.dataset.why;
    const b = el.getBoundingClientRect(), w = tipEl.offsetWidth;
    tipEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, b.left + b.width / 2 - w / 2)) + "px";
    tipEl.style.top = b.bottom + 6 + "px"; tipEl.classList.add("on");
  }
  document.addEventListener("mouseover", e => { const el = e.target.closest && e.target.closest("[data-why]"); if (el) showTip(el); else if (tipEl) tipEl.classList.remove("on"); });
  document.addEventListener("focusin", e => { const el = e.target.closest && e.target.closest("[data-why]"); if (el) showTip(el); });

  /* ---------- the source rows (second card), filled as answers arrive ---------- */
  const PR = Object.fromEntries($$(".pr[data-s]").map(r => [r.dataset.s, r]));
  const GROUP = Object.fromEntries($$(".pg").map(g => [g.dataset.g, [...g.querySelectorAll(".pr")]]));
  function groupCounts() {
    for (const g in GROUP) {
      const rows = GROUP[g].filter(r => !r.hidden && !r.classList.contains("na"));
      $("#n-" + g).textContent = rows.length ? `${rows.filter(r => !r.classList.contains("wait")).length} / ${rows.length}` : "–";
    }
  }
  function prSet(id, cls, answer, risk, ms, why) {
    const r = PR[id]; if (!r) return;
    r.className = "pr" + (cls ? " " + cls : "");
    r.querySelector(".pa").innerHTML = answer;
    r.querySelector(".pk").innerHTML = risk;
    r.querySelector(".pms").textContent = ms;
    if (why) r.dataset.why = why; else delete r.dataset.why;
  }
  // what one source said, on one line: where, what kind of network, any flag; the registry sources say where the
  // block is registered, Shodan which ports are open, the Tor list whether it is an exit
  function answerOf(id, d) {
    const out = [];
    if (d.cc) out.push(`<span class="pl" title="${esc(country(d.cc))}">${flag(d.cc)}${esc(d.cc)}</span>`);
    else if (d.regCc || d.asCc) out.push(`<span class="pl">${flag(d.regCc || d.asCc)}${esc(t(d.regCc ? "g_reg_cc" : "g_as_cc"))}</span>`);
    if (d.rir && !d.cc) out.push(`<span class="m">${esc(d.rir)}</span>`);
    if (d.type) out.push(`<span class="ft" data-p="${d.type}">${esc(typeName(d.type))}</span>`);
    for (const [k, x] of [["tor", "Tor"], ["vpn", "VPN"], ["proxy", t("tag_proxy")], ["abuser", t("f_abuse")]]) if (d[k] === true) out.push(`<span class="ft bad" data-p="${k}">${esc(x)}</span>`);
    if (id === "tor" && d.tor === false) out.push(`<span class="m">${esc(t("x_tor_no"))}</span>`);
    if (id === "shodan") out.push(`<span class="m">${esc(d.ports && d.ports.length ? d.ports.slice(0, 8).join(", ") : t("x_no_ports"))}</span>`);
    if (!out.length && d.org) out.push(`<span class="m">${esc(d.org)}</span>`);
    return out.join("") || '<span class="m">–</span>';
  }
  const riskCell = v => typeof v === "number" ? `<b class="rk ${riskLv(v)}" data-p="risk">${v}</b>` : "";
  const detail = (m, d) => [d.org && (d.asn ? "AS" + d.asn + " " : "") + d.org, d.city, ...(d.extra || []).map(([k, v]) => t(k) + " " + v)].filter(Boolean).join(" · ");
  function fillSource(m) {
    if (!m.ok) { prSet(m.id, "fail", `<span class="m">${esc(t("src_fail"))}</span>`, "", "", m.err || ""); return; }
    prSet(m.id, "", answerOf(m.id, m.d), riskCell(m.d.risk), m.ms != null ? m.ms + " ms" : "", detail(m, m.d));
    const a = PR[m.id] && PR[m.id].querySelector(".pn");
    if (a && m.site && !a.querySelector("a")) a.innerHTML = `<a href="${esc(m.site)}" target="_blank" rel="noopener noreferrer">${esc(a.textContent)}</a>`;
  }

  /* ---------- the check ---------- */
  let RUN = null, total = 0, got = 0, CUR = null, RES = [], BLR = [], PEND = [], lastIp = null;
  const gauge = $("#gauge");
  function progress() {
    $("#prog i").style.transform = `scaleX(${total ? got / total : 0})`;
    $("#progTxt").textContent = t("progress", { n: got, of: total });
    $("#gNum").textContent = `${got}/${total}`;
    groupCounts();
  }
  function reset(ip) {
    gauge.classList.add("busy"); gauge.dataset.g = ""; $("#gArc").style.strokeDashoffset = 100; $("#gSeg").innerHTML = "";
    $("#gNum").textContent = "–"; $("#gGrade").innerHTML = "&nbsp;";
    $("#vHead").textContent = t("checking"); const vt = $("#vText"); vt.classList.remove("err"); vt.innerHTML = "&nbsp;";
    $("#parts").innerHTML = "&nbsp;";
    $$("#facts b").forEach((b, i) => { b.className = i ? "" : "ipv"; b.innerHTML = SKL; });
    $$(".fc, .uc").forEach(c => { c.className = c.classList.contains("uc") ? "uc" : "fc"; c.style.removeProperty("--pc"); delete c.dataset.why; c.querySelector(".fc-v, .uc-v").innerHTML = '<span class="skl"></span>'; const p = c.querySelector(".fr-p"); if (p) p.textContent = ""; const st = c.querySelector(".st"); if (st) st.textContent = ""; });
    for (const id in PR) { const r = PR[id]; r.hidden = false; r.className = "pr wait"; delete r.dataset.why; r.querySelector(".pa").textContent = "…"; r.querySelector(".pk").innerHTML = ""; r.querySelector(".pms").textContent = ""; }
    $("#prog").classList.remove("end"); $("#rerun").disabled = true;
    markExit(ip || selfIp);
  }
  function fail(key) {
    gauge.classList.remove("busy"); $("#gNum").textContent = "–";
    $("#vHead").textContent = t("err_h");
    const vt = $("#vText"); vt.textContent = t(key); vt.classList.add("err");
    $("#rerun").disabled = false; $("#prog").classList.add("end");
  }

  async function run(ip, push) {
    if (RUN) RUN.abort();
    const ctl = RUN = new AbortController();
    lastIp = ip;
    if (push) {
      const u = new URL(location.href);
      if (ip) u.searchParams.set("ip", ip); else u.searchParams.delete("ip");
      history.pushState(null, "", u);
    }
    reset(ip); got = 0; total = 0;
    let res;
    try { res = await fetch("/api/check" + (ip ? "?ip=" + encodeURIComponent(ip) : ""), { cache: "no-store", signal: ctl.signal }); }
    catch (e) { if (ctl === RUN) fail("err_net"); return; }
    if (!res.ok) {
      let j = {}; try { j = await res.json(); } catch (e) {}
      if (ctl === RUN) fail({ bad_ip: "err_bad_ip", private: "err_private", rate: "err_rate" }[j.error] || "err_net");
      return;
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", done = false;
    try {
      while (true) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim() || ctl !== RUN) continue;
          const m = JSON.parse(line);
          if (m.t === "done") done = true;
          handle(m);
        }
      }
    } catch (e) { if (ctl !== RUN) return; }
    if (ctl === RUN && !done) fail("err_net");
  }

  // Some sources limit Cloudflare's shared addresses: the page asks those from the visitor's own browser (on the
  // visitor's quota), and asks again from here any source the server got no answer from, when it answers CORS
  const SRCDEF = Object.fromEntries(SOURCES.map(s => [s.id, s]));
  function inBrowser(id, ip) {
    const s = SRCDEF[id], t0 = Date.now(), base = { t: "src", id, name: s.name, site: s.site(ip) };
    return s.run(ip, { env: {} }).then(d => {
      for (const k in d) if (d[k] === undefined || d[k] === null || d[k] === "") delete d[k];
      return { ...base, ok: true, ms: Date.now() - t0, d };
    }, e => ({ ...base, ok: false, ms: Date.now() - t0, err: String(e && e.message || e).slice(0, 80) }));
  }
  function accept(m) {
    if (m.ok && !m.d.cc && m.d.cname) { m.d.cc = ccOfName(m.d.cname); delete m.d.cname; }
    if (m.ok) RES.push({ id: m.id, data: m.d });
    fillSource(m); got++; progress();
  }
  function handle(m) {
    if (m.t === "start") {
      CUR = m; RES = []; BLR = []; PEND = [];
      const b = $("#facts b"); b.className = "ipv"; b.innerHTML = `${esc(m.ip)} <span class="m">IPv${m.v}</span>`;
      // sources this deployment has no keys for stay out of the list (the same for every address); the ones that don't apply to this address (IPv4-only lists, the visitor's own address) keep their row
      const cur = m, mine = Object.keys(m.skip).filter(id => m.skip[id] === "browser");
      for (const id in m.skip) {
        if (!PR[id] || m.skip[id] === "browser") continue;
        if (m.skip[id] === "key") PR[id].hidden = true;
        else prSet(id, "na", `<span class="m">${esc(t("skip_" + m.skip[id]))}</span>`, "", "");
      }
      if (!m.bl.length) for (const id in PR) if (PR[id].closest('[data-g="dnsbl"]')) prSet(id, "na", `<span class="m">${esc(t("skip_v4"))}</span>`, "", "");
      total = m.n + m.bl.length + mine.length;
      for (const id of mine) PEND.push(inBrowser(id, m.ip).then(r => { if (CUR === cur) accept(r); }));
      if (m.self) noteMine(m.ip);
      progress();
    } else if (m.t === "src") {
      if (!m.ok && SRCDEF[m.id] && SRCDEF[m.id].browser) {
        const cur = CUR;
        PEND.push(inBrowser(m.id, cur.ip).then(r => { if (CUR === cur) accept(r.ok ? r : m); }));
        return;
      }
      accept(m);
    } else if (m.t === "bl") {
      BLR.push(m);
      prSet(m.id, m.listed === true ? "hit-row" : m.listed === null ? "fail" : "",
        m.listed === true ? `<a class="ft bad" data-p="dnsbl" href="${esc(m.site)}" target="_blank" rel="noopener noreferrer">${esc(t("bl_in"))}</a>` : `<span class="m">${esc(t(m.listed === false ? "bl_clean" : "src_fail"))}</span>`, "", "");
      got++; progress();
    } else if (m.t === "done") {
      // scored here, once the browser's own lookups are in too (same rules as the API: src/score.mjs)
      const cur = CUR;
      Promise.allSettled(PEND).then(() => { if (CUR === cur) finish({ ...m, ...assess(RES, BLR) }); });
    } else if (m.t === "error") fail("err_net");
  }

  /* ---------- the result ---------- */
  // each finding cell and the deductions that belong to it
  const PARTS_OF = { type: ["hosting", "business"], anon: ["vpn", "proxy"], tor: ["tor"], risk: ["risk"], abuse: ["abuser"], dnsbl: ["dnsbl"] };
  const CELL_OF = Object.fromEntries(Object.entries(PARTS_OF).flatMap(([f, ps]) => ps.map(p => [p, f])));
  const ICON = { ok: "✓", warn: "!", bad: "✕", info: "i", none: "–" };
  const nodata = () => `<span class="m">${esc(t("q_nodata"))}</span>`;
  // a finding: its status, a short answer, and the whole sentence on hover
  function finding(f, lv, html, why) {
    const c = $(`[data-f="${f}"]`); if (!c) return;
    c.className = (c.classList.contains("uc") ? "uc" : "fc") + " st-" + lv;
    const st = c.querySelector(".st"); if (st) st.textContent = ICON[lv];
    c.querySelector(".fc-v, .uc-v").innerHTML = html;
    if (why) c.dataset.why = why; else delete c.dataset.why;
  }
  // hovering a deduction under the score flashes the finding it came from
  $("#parts").addEventListener("mouseover", e => {
    const sp = e.target.closest("[data-k]"); if (!sp) return;
    const c = $(`[data-f="${CELL_OF[sp.dataset.k]}"]`); if (!c) return;
    c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash");
  });
  function finish(r) {
    const s = r.summary, part = k => r.parts.find(p => p.k === "p_" + k);
    const why = p => t("p_why", { why: t(p.k, p.p), n: p.pts });
    gauge.classList.remove("busy"); gauge.dataset.g = r.grade;
    $("#gNum").textContent = r.score; $("#gGrade").textContent = t("grade", { g: r.grade });
    requestAnimationFrame(() => { $("#gArc").style.strokeDashoffset = 100 - r.score; });
    $("#vHead").textContent = t("g_" + r.grade);
    $("#vText").textContent = t("d_" + r.grade);
    // where the points went: one colored line per deduction, the same color as its segment of the ring
    $("#parts").innerHTML = r.parts.map(p => `<span style="--pc:var(--p-${p.k.slice(2)})" data-k="${p.k.slice(2)}" data-why="${esc(why(p))}" tabindex="0"><i></i><b>−${p.pts}</b>${esc(t("pp_" + p.k.slice(2)))}</span>`).join("") || "&nbsp;";
    let at = r.score;
    $("#gSeg").innerHTML = r.parts.map(p => { const len = Math.min(p.pts, 100 - at); if (len <= 0) return ""; const c = `<circle class="g-seg" cx="60" cy="60" r="52" pathLength="100" stroke="var(--p-${p.k.slice(2)})" stroke-dasharray="${Math.max(0, len - .8)} 100" stroke-dashoffset="${-(at + .4)}"/>`; at += len; return c; }).join("");

    // the address
    const fb = $$("#facts b"), set = (i, h) => { fb[i].className = i ? "" : "ipv"; fb[i].innerHTML = h; };
    const where = [s.city, s.cc && country(s.cc)].filter(Boolean).join(", ");
    set(1, s.cc ? `${flag(s.cc)} ${esc(where)}` : "–");
    set(2, s.asn || s.org ? `${s.asn ? "AS" + s.asn + " " : ""}<span class="m">${esc(s.org || "")}</span>` : "–");
    set(3, s.host ? `<span class="num">${esc(s.host)}</span>` : "–");

    // what the address is: a short answer per cell, the sentence behind it on hover
    const F = s.flags, tv = RES.filter(x => x.data.type), geoN = s.ccs.reduce((a, c) => a + c.by.length, 0);
    if (s.type) finding("type", s.type === "hosting" ? "warn" : s.type === "residential" || s.type === "mobile" ? "ok" : "info",
      `${esc(typeName(s.type))} <span class="m">${tv.filter(x => x.data.type === s.type).length}/${tv.length}</span>`, t("n_type_" + s.type) + (s.type === "mobile" ? " " + t("n_cgnat") : ""));
    else finding("type", "none", nodata());
    if (s.native === null) finding("native", "none", nodata());
    else finding("native", s.native ? "ok" : "warn", `${flag(s.regCc)} ${esc(t(s.native ? "fs_native" : "fs_broadcast"))}`,
      t(s.native ? "fv_native" : s.regFrom === "rir" ? "fv_broadcast" : "fv_broadcast_as", { reg: country(s.regCc), cc: country(s.cc) }));
    if (!s.ccs.length) finding("geo", "none", nodata());
    else if (s.ccs.length === 1) finding("geo", "ok", `${flag(s.cc)} ${esc(t("fs_geo_ok", { n: geoN }))}`, s.ccs[0].by.map(id => PR[id] ? PR[id].querySelector(".pn").textContent : id).join(" · "));
    else finding("geo", "warn", s.ccs.map(c => `${flag(c.cc)} <span class="m">${c.by.length}</span>`).join(" "),
      t("n_geo_split", { list: list(s.ccs.map(c => country(c.cc))) }));
    if (!F.vpn.of && !F.proxy.of) finding("anon", "none", nodata());
    else if (F.vpn.yes || F.proxy.yes) finding("anon", F.vpn.yes + F.proxy.yes > 1 ? "bad" : "warn",
      [F.vpn.yes && `VPN ${F.vpn.yes}/${F.vpn.of}`, F.proxy.yes && `${t("tag_proxy")} ${F.proxy.yes}/${F.proxy.of}`].filter(Boolean).map(esc).join(" · "),
      t("n_anon", { n: new Set([...F.vpn.by, ...F.proxy.by]).size }));
    else finding("anon", "ok", `${esc(t("fs_clean"))} <span class="m">${Math.max(F.vpn.of, F.proxy.of)}</span>`, t("q_clean", { n: Math.max(F.vpn.of, F.proxy.of) }));
    if (s.torListed || F.tor.yes) finding("tor", "bad", esc(t("q_tor_yes")), t("n_tor"));
    else if (F.tor.of) finding("tor", "ok", `${esc(t("fs_no"))} <span class="m">${F.tor.of}</span>`, t("q_tor_no", { n: F.tor.of }));
    else finding("tor", "none", nodata());
    if (s.risk === null) finding("risk", "none", nodata());
    else finding("risk", riskLv(s.risk), `${s.risk} <span class="m">${esc(t("fs_avg", { n: s.risks.length }))}</span>`,
      s.risks.map(x => (PR[x.id] ? PR[x.id].querySelector(".pn").textContent : x.id) + " " + x.v).join(" · "));
    if (!F.abuser.of) finding("abuse", "none", nodata());
    else finding("abuse", F.abuser.yes ? "bad" : "ok", esc(F.abuser.yes ? `${F.abuser.yes}/${F.abuser.of}` : t("q_abuse_no")),
      F.abuser.yes ? t("fv_abuse_yes", { n: F.abuser.yes, of: F.abuser.of }) : "");
    const hits = BLR.filter(b => b.listed === true);
    if (!s.dnsbl.checked) finding("dnsbl", "none", `<span class="m">${esc(t(CUR.v === 6 ? "skip_v4" : "q_nodata"))}</span>`);
    else finding("dnsbl", hits.length ? "bad" : "ok", hits.length ? esc(t("fs_listed", { n: hits.length, of: s.dnsbl.checked })) : `${esc(t("bl_clean"))} <span class="m">${s.dnsbl.checked}</span>`,
      hits.length ? t("bl_listed", { list: list(hits.map(b => b.name)) }) : t("q_bl_clean", { n: s.dnsbl.checked }));
    // what it is good for: a verdict each, the reason on hover
    for (const u of ["stream", "ai", "captcha", "account", "mail"]) { const x = r.uses[u], lv = x.lv === "good" ? "ok" : x.lv; finding(u, lv, `<span class="tag ${x.lv}">${esc(t("lv_" + x.lv))}</span>`, t(x.why)); }

    // every deduction: its finding tinted in its color with the points, and every source mark that caused it
    for (const f in PARTS_OF) {
      const ps = PARTS_OF[f].map(part).filter(Boolean); if (!ps.length) continue;
      const c = $(`[data-f="${f}"]`);
      c.classList.add("hit"); c.style.setProperty("--pc", `var(--p-${ps[0].k.slice(2)})`);
      c.querySelector(".fr-p").textContent = "−" + ps.reduce((a, p) => a + p.pts, 0);
      c.dataset.why = [c.dataset.why, ...ps.map(why)].filter(Boolean).join("\n");
    }
    for (const p of r.parts) for (const el of $$(`.pr [data-p="${p.k.slice(2)}"]`)) {
      el.classList.add("hit"); el.style.setProperty("--pc", `var(--p-${p.k.slice(2)})`); el.dataset.why = why(p);
    }

    const ex = EX.get(CUR.ip); if (ex && !ex.cc && s.cc) { ex.cc = s.cc; if (exFinished) renderExits(); }
    $("#prog").classList.add("end"); $("#rerun").disabled = false;
    $("#progTxt").textContent = t("src_n", { ok: RES.length, at: new Date(r.at).toLocaleString(LANG) }) + (r.cached ? " · " + t("cached") : "");
    groupCounts();
  }
  $("#rerun").onclick = () => { findExits(); run(lastIp, false); };

  /* ---------- the visitor's exits ---------- */
  // A rule-based proxy picks the route by destination, so one "what is my IP" only shows one exit. As on EgressLens,
  // the browser asks checks at different kinds of destination at once (sites in mainland China, IP services abroad, AI
  // services, IPv4-only and IPv6-only hosts) and lists every address they saw with its country; each one can be checked.
  // The list draws once every check is in (two placeholder rows hold its place until then).
  const trace = host => () => getT(`https://${host}/cdn-cgi/trace`).then(x => ({ ip: (/^ip=(.+)$/m.exec(x) || [])[1], cc: (/^loc=(\w\w)$/m.exec(x) || [])[1] }));
  const PROBES = [
    () => getJ("https://myip.ipip.net/json").then(j => ({ ip: j.data && j.data.ip })),
    () => getT("https://api.ipify.cn").then(x => ({ ip: x.trim() })),
    () => getJ("https://api.ip.sb/geoip").then(j => ({ ip: j.ip, cc: j.country_code })),
    () => getJ("https://ipinfo.io/json").then(j => ({ ip: j.ip, cc: j.country })),
    trace("chatgpt.com"), trace("claude.ai"),
    () => getJ("https://ipv4-check-perf.radar.cloudflare.com/").then(j => ({ ip: j.ip_address })),
    () => getJ("https://ipv6-check-perf.radar.cloudflare.com/").then(j => ({ ip: j.ip_address })),
  ];
  let EX = new Map(), exFinished = false, selfIp = null, exGen = 0;
  const egress = (document.querySelector('meta[name="egress"]') || {}).content || "";
  if (egress) { const a = $("#egLink"); a.href = egress + D.paths[LANG]; a.hidden = false; }
  function markExit(ip) { $$("#exList .xr").forEach(li => li.classList.toggle("on", li.dataset.ip === ip)); }
  function renderExits() {
    // addresses of the same country together, the visitor's own (the one the check sees) country first, then the
    // countries by how many checks saw them; IPv4 before IPv6 within a country
    const all = [...EX.values()], selfCc = (EX.get(selfIp) || {}).cc;
    const weight = cc => all.filter(x => x.cc === cc).reduce((a, x) => a + x.n, 0);
    const list = all.sort((a, b) => (b.cc === selfCc) - (a.cc === selfCc) || weight(b.cc) - weight(a.cc) || String(a.cc).localeCompare(String(b.cc)) || family(a.ip) - family(b.ip) || b.n - a.n);
    $("#exList").innerHTML = list.length ? list.map(x => `<li class="xr" data-ip="${esc(x.ip)}" tabindex="0" role="button">${flag(x.cc)}<b>${esc(x.ip)}</b><span class="m">${esc(x.cc ? country(x.cc) : "")}</span></li>`).join("")
      : `<li class="xr none"><span class="m">${esc(t("none"))}</span></li>`;
    $$("#exList .xr[data-ip]").forEach(li => {
      const go = () => { input.value = ""; run(li.dataset.ip === selfIp ? null : li.dataset.ip, true); };
      li.onclick = go; li.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    });
    markExit(CUR ? CUR.ip : null);
  }
  function noteMine(ip) { selfIp = ip; if (!EX.has(ip)) EX.set(ip, { ip, cc: null, n: 1 }); if (exFinished) renderExits(); }
  async function findExits() {
    const gen = ++exGen; exFinished = false; EX = new Map(); if (selfIp) EX.set(selfIp, { ip: selfIp, cc: null, n: 1 });
    await Promise.allSettled(PROBES.map(p => p().then(r => {
      const ip = canon(r.ip || "");
      if (!ip || !isPublic(ip) || gen !== exGen) return;
      const x = EX.get(ip) || { ip, cc: null, n: 0 };
      x.n++; if (r.cc && /^[A-Z]{2}$/i.test(r.cc) && r.cc.toUpperCase() !== "XX") x.cc = x.cc || r.cc.toUpperCase();
      EX.set(ip, x);
    })));
    // an address no check placed gets its country from ip.sb
    await Promise.allSettled([...EX.values()].filter(x => !x.cc).slice(0, 6).map(x =>
      getJ("https://api.ip.sb/geoip/" + encodeURIComponent(x.ip)).then(j => { if (j.country_code) x.cc = j.country_code.toUpperCase(); })));
    if (gen !== exGen) return;
    exFinished = true; renderExits(); applyMask();
  }
  findExits();

  /* ---------- the form ---------- */
  $("#ask").onsubmit = e => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) { run(null, true); return; }
    const ip = canon(v);
    if (!ip || !isPublic(ip)) { input.classList.add("bad"); fail(ip ? "err_private" : "err_bad_ip"); return; }
    input.classList.remove("bad");
    run(ip, true);
  };
  input.oninput = () => input.classList.remove("bad");
  const start = () => { const q = new URL(location.href).searchParams.get("ip"); input.value = q || ""; run(q && canon(q) ? canon(q) : null, false); };
  addEventListener("popstate", start);
  start();
})();
