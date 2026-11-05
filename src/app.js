// ipqs page, laid out as EgressLens: the hero holds the score, the address, the visitor's exits and the findings; the
// second card lists every source, each row filled the moment it answers (the rows are in the HTML from the start).
// The score and findings come once every source is in. A shared link (src/share.mjs) draws someone else's answers the
// same way, without asking anything. Strings: window.L1MS.
import { family, canon, isPublic } from "./ip.mjs";
import { assess } from "./score.mjs";
import { ccOfName, SOURCES } from "./sources.mjs";
import { pack, unpackResults, encode, decode, SHARE_PATH, CF_OF } from "./share.mjs";
import { readDns, readConn } from "./conn.mjs";
import { readSeg, addrLines } from "./seg.mjs";

(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const D = JSON.parse($("#data").textContent);
  const L = window.L1MS || {}, LANG = D.lang;
  // a count of one picks the key_one sentence where there is one (docs: 1ms-shell translation.md, plurals)
  const PLURAL = new Intl.PluralRules(LANG), plural = (k, v) => { const c = v && (v.n ?? v.ok), r = c != null && k + "_" + PLURAL.select(+c); return r && L[r] != null ? r : k; };
  const t = (k, v) => { let s = L[plural(k, v)] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const K = { theme: "ipqs:theme", lang: "ipqs:lang", mask: "ipqs:mask" };
  // Taiwan is "中国台湾 / Taiwan, China" with the PRC flag (1ms-shell docs/tool-contract.md §5); every other region by its system name
  const TW = { "zh-CN": "中国台湾", "zh-TW": "中國台灣", en: "Taiwan, China", ja: "中国台湾", ko: "중국 대만", es: "Taiwán, China", fr: "Taïwan, Chine", de: "Taiwan, China", pt: "Taiwan, China", ru: "Тайвань, Китай" };
  const country = cc => { if (cc === "TW") return TW[LANG]; try { return new Intl.DisplayNames([LANG], { type: "region" }).of(cc); } catch (e) { return cc; } };
  const flagCode = cc => cc === "TW" ? "cn" : cc.toLowerCase();
  const flag = cc => /^[A-Z]{2}$/.test(cc || "") ? `<img class="flag" src="/flags/${flagCode(cc)}.svg" alt="" width="20" height="15">` : "";
  const list = a => a.join(t("v_join"));
  const SHARE_M = SHARE_PATH.exec(location.pathname), SHARE_CODE = SHARE_M ? SHARE_M[2] : "";
  let SHARED = null;
  // Embedded in the line check (check.1ms.dog, the shell's docs/checkup.md): ?embed=checkup, and only when the shell
  // names the check's address (<meta name="check">) and the frame sits on it; otherwise the parameter is ignored. The
  // page then checks the current address at once, shows only the score, and posts its progress, height and result to
  // that address alone.
  const CHECK = (() => { try { return new URL(document.querySelector('meta[name="check"]').content).origin; } catch (e) { return ""; } })();
  const EMBED = !SHARE_CODE && !!CHECK && parent !== window && new URLSearchParams(location.search).get("embed") === "checkup" &&
    (() => { try { return new URL(document.referrer).origin === CHECK; } catch (e) { return false; } })();
  // once an error is out, no result follows (the checkup marks the tool unfinished and moves on)
  let ERRED = false;
  const post = msg => {
    if (!EMBED || (msg.type === "result" && ERRED)) return;
    if (msg.type === "error") ERRED = true;
    parent.postMessage({ ms: "checkup", v: 1, tool: "ipqs", ...msg }, CHECK);
  };
  if (EMBED) document.documentElement.setAttribute("data-embed", "");

  /* ---------- theme and language (synced across the 1ms.dog tools) ---------- */
  const thBtn = $("#theme"), TH = ["system", "light", "dark"];
  const applyTheme = th => {
    if (th === "light" || th === "dark") document.documentElement.setAttribute("data-theme", th); else document.documentElement.removeAttribute("data-theme");
    thBtn.dataset.th = th; thBtn.title = t("th_" + th); thBtn.setAttribute("aria-label", t("th_" + th));
  };
  applyTheme(TH.includes(store.get(K.theme)) ? store.get(K.theme) : "system");
  thBtn.onclick = () => { const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3]; store.set(K.theme, n); applyTheme(n); };
  $("#lang").onchange = e => { const l = e.target.value; store.set(K.lang, l); location.href = D.paths[l] + (SHARE_CODE ? "r/" + SHARE_CODE : "") + location.search; };
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
  const applyMask = () => { $("#facts").classList.toggle("masked", masked()); $("#exList").classList.toggle("masked", masked()); $("#sgt").classList.toggle("masked", masked()); eye.textContent = t(masked() ? "show" : "hide"); };
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
  let RUN = null, total = 0, got = 0, CUR = null, RES = [], BLR = [], PEND = [], FAILS = [], SKIP = {}, SNAP = null, lastIp = null;
  const gauge = $("#gauge");
  function progress() {
    $("#prog i").style.transform = `scaleX(${total ? got / total : 0})`;
    $("#progTxt").textContent = t("progress", { n: got, of: total });
    $("#gNum").textContent = `${got}/${total}`;
    groupCounts();
    post({ type: "progress", done: got, total, text: $("#progTxt").textContent });
  }
  function reset(ip) {
    gauge.classList.add("busy"); gauge.dataset.g = ""; $("#gArc").style.strokeDashoffset = 100; $("#gSeg").innerHTML = "";
    $("#gNum").textContent = "–"; $("#gGrade").innerHTML = "&nbsp;";
    $("#vHead").textContent = t("checking"); const vt = $("#vText"); vt.classList.remove("err"); vt.innerHTML = "&nbsp;";
    $("#parts").innerHTML = "&nbsp;";
    $$("#facts b").forEach((b, i) => { b.className = i ? "" : "ipv"; b.innerHTML = SKL; });
    $$(".fc, .uc").forEach(c => { c.className = c.classList.contains("uc") ? "uc" : "fc"; c.style.removeProperty("--pc"); delete c.dataset.why; c.querySelector(".fc-v, .uc-v").innerHTML = '<span class="skl"></span>'; const p = c.querySelector(".fr-p"); if (p) p.textContent = ""; const st = c.querySelector(".st"); if (st) st.textContent = ""; });
    for (const id in PR) { const r = PR[id]; r.hidden = false; r.className = "pr wait"; delete r.dataset.why; r.querySelector(".pa").textContent = "…"; r.querySelector(".pk").innerHTML = ""; r.querySelector(".pms").textContent = ""; }
    $("#prog").classList.remove("end"); $("#rerun").disabled = true; $("#shareBtn").hidden = true; SNAP = null; $("#ulLink").hidden = true;
    cnShow(); cfShow();
    markExit(ip || selfIp);
  }
  function fail(key) {
    gauge.classList.remove("busy"); $("#gNum").textContent = "–"; $("#sgt").hidden = true;
    $("#vHead").textContent = t("err_h");
    const vt = $("#vText"); vt.textContent = t(key); vt.classList.add("err");
    $("#rerun").disabled = false; $("#prog").classList.add("end");
    post({ type: "error", text: t(key) });
  }

  async function run(ip, push) {
    // a shared result's page checks nothing itself: a check starts on the language page
    if (SHARE_CODE) { location.href = D.paths[LANG] + (ip ? "?ip=" + encodeURIComponent(ip) : ""); return; }
    if (RUN) RUN.abort();
    const ctl = RUN = new AbortController();
    lastIp = ip;
    if (push) {
      const u = new URL(location.href);
      if (ip) u.searchParams.set("ip", ip); else u.searchParams.delete("ip");
      history.pushState(null, "", u);
    }
    reset(ip); got = 0; total = 0;
    // the visitor's own address comes from the shell first (/_ms/me: Cloudflare's view of this connection, no third
    // party), with its place and network shown at once; a page without the shell (404) lets the API take the
    // connection's address as before
    let ask = ip;
    if (!ip) {
      const me = await getJ("/_ms/me", 3000).catch(() => null);
      if (ctl !== RUN) return;
      if (me && me.ip && canon(me.ip) && isPublic(canon(me.ip))) { ask = canon(me.ip); showMe(me, ask); }
    }
    // a request that never answers (held by a blocker or a dead network) fails within seconds, not never
    const slow = setTimeout(() => ctl.abort(), 15000);
    let res;
    try { res = await fetch("/api/check" + (ask ? "?ip=" + encodeURIComponent(ask) : ""), { cache: "no-store", signal: ctl.signal }); }
    catch (e) { if (ctl === RUN) fail("err_net"); return; }
    finally { clearTimeout(slow); }
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

  function showMe(me, ip) {
    const fb = $$("#facts b");
    fb[0].className = "ipv"; fb[0].innerHTML = ipHtml(ip, family(ip));
    const cc = /^[A-Z]{2}$/.test(me.country || "") ? me.country : "";
    const where = [me.city, cc && country(cc)].filter(Boolean).join(", ");
    if (where) { fb[1].className = ""; fb[1].innerHTML = `${flag(cc)} ${esc(where)}`; }
    if (me.asn || me.org) { fb[2].className = ""; fb[2].innerHTML = `${me.asn ? "AS" + me.asn + " " : ""}<span class="m">${esc(me.org || "")}</span>`; }
    noteMine(ip, cc);
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
    if (m.ok) RES.push({ id: m.id, data: m.d }); else FAILS.push(m.id);
    fillSource(m); got++; progress();
  }
  function handle(m) {
    if (m.t === "start") {
      CUR = m; RES = []; BLR = []; PEND = []; FAILS = []; SKIP = {};
      segStart(m.ip, m.v);
      const b = $("#facts b"); b.className = "ipv"; b.innerHTML = ipHtml(m.ip, m.v);
      // sources this deployment has no keys for stay out of the list (the same for every address); the ones that don't apply to this address (IPv4-only lists, the visitor's own address) keep their row
      const cur = m, mine = Object.keys(m.skip).filter(id => m.skip[id] === "browser");
      for (const id in m.skip) {
        if (!PR[id] || m.skip[id] === "browser") continue;
        if (m.skip[id] === "key") PR[id].hidden = true;
        else { SKIP[id] = m.skip[id]; prSet(id, "na", `<span class="m">${esc(t("skip_" + m.skip[id]))}</span>`, "", ""); }
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
      blRow(m); got++; progress();
    } else if (m.t === "done") {
      // scored here, once the browser's own lookups are in too (same rules as the API: src/score.mjs)
      // no source answering at all is a failed check, not a clean address
      const cur = CUR;
      Promise.allSettled(PEND).then(() => { if (CUR !== cur) return; if (RES.length) finish({ ...m, ...assess(RES, BLR) }); else fail("err_net"); });
    } else if (m.t === "error") fail("err_net");
  }

  function blRow(m) {
    BLR.push(m);
    const hit = m.site ? `<a class="ft bad" data-p="dnsbl" href="${esc(m.site)}" target="_blank" rel="noopener noreferrer">${esc(t("bl_in"))}</a>` : `<span class="ft bad" data-p="dnsbl">${esc(t("bl_in"))}</span>`;
    prSet(m.id, m.listed === true ? "hit-row" : m.listed === null ? "fail" : "", m.listed === true ? hit : `<span class="m">${esc(t(m.listed === false ? "bl_clean" : "src_fail"))}</span>`, "", "");
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
    // a shared result without the address has no network or reverse DNS name either
    const hid = `<span class="m">${esc(t("r_hidden"))}</span>`, open = !SHARED || SHARED.i;
    set(1, s.cc ? `${flag(s.cc)} ${esc(where)}` : "–");
    // the AS number opens the ASN lookup when the shell names it
    const asTxt = s.asn ? (asnHost ? `<a class="asl" href="${esc(asnHost + D.paths[LANG] + "AS" + s.asn)}" title="${esc(t("asn_go"))}" target="_blank" rel="noopener">AS${s.asn}</a> ` : "AS" + s.asn + " ") : "";
    set(2, !open ? hid : s.asn || s.org ? `${asTxt}<span class="m">${esc(s.org || "")}</span>` : "–");
    set(3, !open ? (s.host ? hid : "–") : s.host ? `<span class="num">${esc(s.host)}</span>` : "–");

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
    SNAP = { at: r.at, v: CUR.v, ip: CUR.ip, res: RES.slice(), fails: FAILS.slice(), skip: { ...SKIP }, bl: BLR.map(b => ({ id: b.id, listed: b.listed })), r };
    showLinks(); segShow(); cnShow(); cfShow();
    $("#prog").classList.add("end"); $("#rerun").disabled = false; $("#shareBtn").hidden = false;
    $("#progTxt").textContent = t("src_n", { ok: RES.length, at: new Date(r.at).toLocaleString(LANG) }) + (r.cached ? " · " + t("cached") : "");
    groupCounts();
    if (EMBED && !SHARED) postResult(SNAP);
  }
  // the result for the line check: the verdict as on the page, a few numbers, the notes that matter most, the facts
  // its cross-tool rules read, and a link that replays it (without the address, city or network, as sharing defaults)
  async function postResult(snap) {
    const r = snap.r, s = r.summary, F = s.flags, hits = snap.bl.filter(b => b.listed === true).length;
    const stats = [
      s.cc && { label: t("r_loc"), value: country(s.cc) },
      s.type && { label: t("fl_type"), value: typeName(s.type) },
      s.dnsbl.checked && { label: t("fl_dnsbl"), value: `${hits}/${s.dnsbl.checked}` },
      s.risk !== null && { label: t("fl_risk"), value: String(s.risk) },
      (F.vpn.of || F.proxy.of) && { label: t("fl_anon"), value: F.vpn.yes || F.proxy.yes ? `${Math.max(F.vpn.yes, F.proxy.yes)}/${Math.max(F.vpn.of, F.proxy.of)}` : t("fs_clean") },
    ].filter(Boolean).slice(0, 4);
    const RANK = { bad: 0, warn: 1, good: 2 };
    const noteText = n => {
      const p = { ...n.p };
      for (const k of ["reg", "cc"]) if (p[k]) p[k] = country(p[k]);
      if (Array.isArray(p.list)) p.list = list(n.k === "n_geo_split" ? p.list.map(country) : p.list);
      return t(n.k, p);
    };
    const findings = r.notes.filter(n => n.lv in RANK).sort((a, b) => RANK[a.lv] - RANK[b.lv]).slice(0, 4)
      .map(n => ({ level: n.lv === "good" ? "ok" : n.lv, text: noteText(n) }));
    const facts = { score: r.score, grade: r.grade };
    if (s.cc) facts.country = s.cc;
    if (s.type) facts.type = s.type;
    facts.native = s.native;
    if (F.vpn.of || F.proxy.of) facts.proxy = !!(F.vpn.yes || F.proxy.yes);
    if (s.dnsbl.checked) facts.blacklists = hits;
    const path = D.paths[LANG] + "r/" + await encode(pack({ ...snap, details: false }));
    post({ type: "result", lang: LANG, path, grade: r.grade, score: r.score, headline: t("g_" + r.grade), stats, findings, facts });
  }
  // the frame's height follows the content
  if (EMBED) {
    const app = $(".app");
    let lastH = 0;
    new ResizeObserver(() => { const h = Math.ceil(app.getBoundingClientRect().height); if (h !== lastH) post({ type: "size", height: lastH = h }); }).observe(app);
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
  let EX = new Map(), exFinished = false, selfIp = null, selfCc = null, exGen = 0;
  const egress = (document.querySelector('meta[name="egress"]') || {}).content || "";
  if (egress) { const a = $("#egLink"); a.href = egress + D.paths[LANG]; a.hidden = false; }
  // links to the other tools, each only when the shell names its host (<meta name="...">)
  const meta = n => (document.querySelector(`meta[name="${n}"]`) || {}).content || "";
  // the address and the AS number open the ASN lookup: values themselves, so a dotted underline and a title instead of
  // the external-link mark (tool contract, rule 4)
  const asnHost = meta("asn"), who = meta("who"), v6 = meta("ipv6");
  // the browser check: an address that scores clean can still be told apart by the browser (fingerprint, time zone),
  // so its link sits under a clean verdict for the visitor's own exit
  if (who) $("#whoLink").href = who + D.paths[LANG];
  // the checkup runs this check with the others (the visitor's whole connection): under the verdict from the start,
  // except inside the checkup itself
  if (CHECK && !EMBED) { const a = $("#ckLink"); a.href = CHECK + D.paths[LANG]; a.hidden = false; }
  // the IPv6 test: under the exits when the address checked is IPv6, or when no check found an IPv6 exit
  if (v6) $("#v6Link").href = v6 + D.paths[LANG];
  // the unlock check tests the visitor's own route, so its link sits under the verdict only when the address checked is one of their exits
  const unlock = meta("unlock");
  if (unlock) $("#ulLink").href = unlock + D.paths[LANG];
  // the address opens its page in the ASN lookup (public addresses only)
  const ipHtml = (ip, v) => (asnHost && isPublic(ip) ? `<a class="asl" href="${esc(asnHost + D.paths[LANG] + "ip/" + ip)}" title="${esc(t("asn_go"))}" target="_blank" rel="noopener">${esc(ip)}</a>` : esc(ip)) + ` <span class="m">IPv${v}</span>`;
  function showLinks() {
    const mine = SNAP && EX.has(SNAP.ip);
    $("#whoLink").hidden = !(who && mine && /^[AB]$/.test(SNAP.r.grade));
    $("#ulLink").hidden = !(unlock && mine);
    const checked = SNAP && SNAP.v === 6, none = exFinished && ![...EX.keys()].some(ip => family(ip) === 6);
    const l = $("#v6Link"); l.hidden = !(v6 && (checked || none));
    if (!l.hidden) $("#v6T").textContent = t(checked ? "v6_more" : "v6_none");
  }
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
    markExit(CUR ? CUR.ip : null); showLinks();
    if (SNAP && SNAP.v === 6) segShow();
  }
  // the visitor's own address, with its country when the shell gave one (no lookup needed for it then)
  function noteMine(ip, cc) {
    if (ip !== selfIp) selfCc = null;
    if (cc) selfCc = cc;
    selfIp = ip;
    const x = EX.get(ip);
    if (!x) EX.set(ip, { ip, cc: selfCc, n: 1 }); else if (!x.cc) x.cc = selfCc;
    if (exFinished) renderExits();
  }
  async function findExits() {
    const gen = ++exGen; exFinished = false; EX = new Map(); if (selfIp) EX.set(selfIp, { ip: selfIp, cc: selfCc, n: 1 });
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
  // (the exits aren't shown in the line check: egress lists them there)
  if (!SHARE_CODE && !EMBED) findExits();

  /* ---------- a shared result ---------- */
  // the answers in the link fill the rows and the findings as a check would; the address only when it was shared
  async function replay(code) {
    const P = await decode(code);
    if (!P) { toast(t("shared_bad")); history.replaceState(null, "", D.paths[LANG]); setTimeout(() => location.reload(), 1500); return; }
    SHARED = P;
    document.documentElement.setAttribute("data-shared", "");
    // the shared banner: whose result this is, and a button that checks the visitor's own address on the language page
    if (!EMBED) import("/assets/share/share.js?v=8").then(({ received }) =>
      received({ lang: LANG, ts: P.t * 60000, at: $(".hero"), test: () => { location.href = D.paths[LANG]; } }), () => {});
    reset(P.i || null);
    const { res, bl } = unpackResults(P);
    CUR = { ip: P.i || null, v: P.f }; RES = []; BLR = []; FAILS = (P.x || []).slice(); SKIP = { ...(P.k || {}) };
    // a shared result with its address can show that address's /24 (public facts about the /24, read now)
    segStart(P.i, P.f);
    const b = $("#facts b"); b.className = "ipv";
    b.innerHTML = P.i ? ipHtml(P.i, P.f) : `<span class="m">${esc(t("r_hidden"))} · IPv${P.f}</span>`;
    for (const id in PR) {
      if (PR[id].closest('[data-g="dnsbl"]')) {
        const m = bl.find(x => x.id === id);
        if (m) blRow(m); else prSet(id, "na", `<span class="m">${esc(t(P.f === 6 ? "skip_v4" : "q_nodata"))}</span>`, "", "");
      } else if (P.s[id]) {
        const def = SRCDEF[id], m = { id, ok: true, d: P.s[id], site: P.i && def ? def.site(P.i) : "", ms: null };
        RES.push({ id, data: m.d }); fillSource(m);
      } else if (FAILS.includes(id)) prSet(id, "fail", `<span class="m">${esc(t("src_fail"))}</span>`, "", "");
      else if (SKIP[id]) prSet(id, "na", `<span class="m">${esc(t("skip_" + SKIP[id]))}</span>`, "", "");
      else PR[id].hidden = true;
    }
    total = got = RES.length + BLR.length; progress();
    finish({ ...assess(res, bl), at: P.t * 60000, cached: false });
    if (CF_OF[P.c]) { SNAP.cf = CF_OF[P.c]; cfShow(); }
    $("#rerun").hidden = true;
  }

  /* ---------- the /24 portrait: what the 1ms.dog server finds for the address's /24 ---------- */
  // Asked as soon as the check knows the address (IPv4 only), drawn when the check is in (src/seg.mjs reads it). The
  // server (server/) reads the /24's 256 reverse names and a few public lists, daily; it contacts no address of the
  // /24. Not in the line check (D.seg empty there too) and absent without the service.
  // The card takes its place as soon as the check knows the address, as it will look (a grey grid of 256 squares, the
  // checked one ringed, the legend, the lists' credit), and fills in when the answer comes, so nothing around it moves.
  let segP = null;
  function segStart(ip, v) {
    segP = null;
    if (!D.seg || EMBED || !ip) { $("#sgt").hidden = true; return; }
    if (v === 6) { segV6({ r: { summary: {} } }); return; }
    segP = getJ(D.seg + "/v1/seg?ip=" + encodeURIComponent(ip), 12000).catch(() => null);
    const base = ip.split(".").slice(0, 3).join("."), me = +ip.split(".")[3];
    $("#sgV6").hidden = true; $("#sgBody").hidden = false;
    $("#sgN").textContent = `${base}.0 – ${base}.255`;
    const vd = $("#sgVerdict"); vd.className = "sg-verdict wait"; vd.textContent = t("sg_v_wait");
    $("#sgMeta").innerHTML = "&nbsp;"; $("#sgVs").hidden = true;
    sgCells = []; sgPick = -1;
    sgMap.innerHTML = Array.from({ length: 256 }, (_, i) => `<i class="s-wait${i === me ? " me" : ""}"></i>`).join("");
    $("#sgInfo").textContent = t("sg_hint");
    $("#sgLeg").innerHTML = sgLegend(null);
    $("#sgNote").innerHTML = "&nbsp;";
    $("#sgSrc").innerHTML = sgCredit(null);
    $("#sgt").hidden = false;
  }
  // the lists' credit (IP2Proxy LITE asks for it), with the oldest list's date
  const SG_SRC = [["proxy", "IP2Proxy LITE", "https://lite.ip2location.com"], ["bad", "IPsum", "https://github.com/stamparm/ipsum"],
    ["vpn", "X4BNet", "https://github.com/X4BNet/lists_vpn"], ["drop", "Spamhaus DROP", "https://www.spamhaus.org/blocklists/do-not-route-or-peer/"],
    ["tor", "Tor Project", "https://www.torproject.org/"]];
  // the legend: each colour, when its list was read
  const SG_LEG = { bad: "bad", proxy: "proxy", tor: "tor", vpn: "vpn", ok: null };
  const TAG = { ok: "good", warn: "warn", bad: "bad" };
  // list parameters read as a list in the page's language; a network type by its name
  const say = (k, v) => { const q = { ...v }; for (const x in q) if (Array.isArray(q[x])) q[x] = list(q[x]); if (q.type) q.type = typeName(q.type); return t(k, q); };
  // An IPv6 address has no portrait: a /64 alone is 2^64 addresses, too many to name one by one, and the lists are
  // IPv4 only. The card says so, and for the visitor's own check offers their IPv4 exit (the one in the address's
  // country first), whose check then shows its /24.
  function segV6(snap) {
    const box = $("#sgt"), v4s = mine() ? [...EX.values()].filter(x => family(x.ip) === 4) : [];
    const v4 = (v4s.find(x => x.cc && x.cc === snap.r.summary.cc) || v4s[0] || {}).ip;
    $("#sgN").textContent = ""; $("#sgBody").hidden = true;
    $("#sgV6T").textContent = t("sg_v6");
    const go = $("#sgGo"); go.hidden = !v4;
    if (v4) {
      go.innerHTML = esc(t("sg_v6_go", { ip: "\u0000" })).replace("\u0000", `<span class="num">${esc(v4)}</span>`) + " →";
      go.onclick = () => { input.value = ""; run(v4, true); };
    }
    $("#sgV6").hidden = false; box.hidden = false;
  }
  // the legend: each colour (with its count once the answer is in; while it's on its way, a dash), then the ring of the
  // checked address
  const sgLegend = r => Object.entries(SG_LEG).filter(([, l]) => !r || !l || r.lists[l])
    .map(([st]) => `<li${r && !r.count[st] ? ' class="z"' : ""}><i class="dot s-${st}"></i>${esc(t("sg_l_" + st))} <b>${r ? r.count[st] : "–"}</b></li>`).join("") +
    `<li><i class="dot me"></i>${esc(t("sg_l_me"))}</li>`;
  // the lists' credit: the lists read (all of them while the answer is on its way), and the oldest one's date
  const sgCredit = L => {
    const src = SG_SRC.filter(([k]) => !L || L[k] != null).map(([, n, u]) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${esc(n)}</a>`);
    return src.length ? esc(t("sg_src", { at: L && L.at ? new Date(L.at).toLocaleDateString(LANG) : "…" })) + (CJK ? "" : " ") + src.join(esc(t("v_join"))) : "";
  };
  // the map: one square per address; the one under the pointer (or the last one tapped, or the checked one) is told
  // under it
  let sgCells = [], sgPick = -1;
  const sgSay = i => {
    const c = sgCells[i], box = $("#sgInfo"); if (!c) { box.textContent = t("sg_hint"); return; }
    box.innerHTML = `<span class="ip">${esc(c.ip)}</span>${c.me ? `<span class="tag">${esc(t("sg_me"))}</span>` : ""}` +
      `<span class="st2"><i class="dot s-${c.st}"></i>${esc(addrLines(c).map(([k, q]) => say(k, q)).join(t("v_join")))}</span>` +
      `<span class="nm" title="${esc(c.name)}">${esc(c.name || t("sg_a_noname"))}</span>`;
  };
  const sgRest = () => sgSay(sgPick >= 0 ? sgPick : sgCells.findIndex(c => c.me));
  const sgMap = $("#sgMap");
  sgMap.addEventListener("mouseover", e => { const n = e.target.dataset && e.target.dataset.n; if (n != null) sgSay(+n); });
  sgMap.addEventListener("mouseleave", sgRest);
  sgMap.addEventListener("click", e => {
    const n = e.target.dataset && e.target.dataset.n; if (n == null) return;
    const old = sgMap.querySelector(".on"); if (old) old.classList.remove("on");
    sgPick = +n; e.target.classList.add("on"); sgSay(sgPick);
  });
  async function segShow() {
    const box = $("#sgt"), snap = SNAP, p = segP;
    if (snap && snap.v === 6 && D.seg && !EMBED) { segV6(snap); return; }
    $("#sgV6").hidden = true; $("#sgBody").hidden = false;
    if (!snap || !p) { box.hidden = true; return; }
    const j = await p;
    if (snap !== SNAP || p !== segP) return;
    if (!j || !j.rdns) { box.hidden = true; return; }
    const r = readSeg(j, snap.r.summary.type, snap.ip), L = j.lists || {};
    $("#sgN").textContent = `${r.base}.0 – ${r.base}.255`;
    // the verdict: how many neighbours the lists name; then the /24's kind, prefix and main domain on one line
    const vd = $("#sgVerdict"), v = r.verdict;
    vd.className = "sg-verdict " + v.lv; vd.textContent = v.listed ? t("sg_v_n", { n: v.listed }) : t("sg_v_0");
    const px = r.prefix, d0 = r.domains[0];
    $("#sgMeta").innerHTML = [`<span class="tag ${TAG[r.kind.lv] || ""}">${esc(t("sg_k_" + r.kind.kind))}</span>`,
      px && (px.none ? esc(t("sg_m_noprefix")) : `<span class="num">${esc(px.prefix)}</span>`),
      px && !px.none && px.asns.length && px.asns.map(a => "AS" + a).join(" "),
      d0 && `${esc(d0.d)} (${d0.n})`].filter(Boolean).join(`<span aria-hidden="true">·</span>`);
    const vs = $("#sgVs"); vs.hidden = !r.vs; vs.textContent = r.vs ? say(...r.vs) : "";
    // the kind's sentence, and anything odd about the names (servers that don't answer, a sweep cut short)
    $("#sgNote").textContent = r.sum.map(([k, q]) => say(k, q)).join(gap) || "\u00a0";
    sgCells = r.cells; sgPick = -1;
    sgMap.innerHTML = r.cells.map((c, i) => `<i class="s-${c.st}${c.me ? " me" : ""}" data-n="${i}"></i>`).join("");
    sgRest();
    $("#sgLeg").innerHTML = sgLegend(r);
    $("#sgSrc").innerHTML = sgCredit(L);
    box.hidden = false;
  }
  // the visitor's own connection: their own check, or a check of one of the exits found for them (the connection
  // tests below and the IPv6 card's IPv4 exit are for them, not for someone else's address)
  function mine() { return !SHARED && (!lastIp || EX.has(lastIp)); }

  /* ---------- the connection, measured on the 1ms.dog server: the DNS resolver and the TCP handshake ---------- */
  // What the sources above can't see, because it isn't in the address: which DNS resolvers look names up for the
  // visitor (dns's authoritative server on l.1ms.dog records who asks for a random name, its port 2053 answers with
  // them), and how the visitor's TCP connection looks on arrival (who's probe /fp: MSS, MTU and the system it came from). Both are read against the
  // exit the check scored (src/conn.mjs). Only for the visitor's own check; started once at load (each lookup is a new
  // random name), drawn when the check is in. The servers keep nothing beyond two minutes in memory.
  const CN_ON = !EMBED && !SHARE_CODE;
  $("#cnxGo").onclick = () => { input.value = ""; run(null, true); };
  let cnDns = null, cnTcp = null;
  if (CN_ON) {
    const tok = Array.from(crypto.getRandomValues(new Uint8Array(20)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
    const look = tag => getJ(`https://${tok}-${tag}.l.1ms.dog:2053/`, 5000).catch(() => null);
    // three names: a resolver pool may send each through another of its addresses
    cnDns = Promise.all(["a", "b", "c"].map(look)).then(() => getJ(`https://api.l.1ms.dog:2053/t/${tok}?wait=1500`, 5000))
      .then(j => Array.isArray(j && j.hits) ? j.hits : null).catch(() => null);
    cnTcp = getJ("https://probe.1ms.dog/fp", 5000).catch(() => null);
  }
  // the dns server places resolvers with DB-IP, whose licence asks for this line wherever its data shows
  const DBIP = "IP geolocation by DB-IP (https://db-ip.com), CC BY 4.0";
  const SYS = { windows: "Windows", apple: "macOS / iOS", linux: "Linux / Android" };
  const DNS_V = { own: "cn_d_own", same: "cn_d_same", public: "cn_d_pub", leak: "cn_d_leak", unknown: "cn_d_unknown" };
  // Chinese and Japanese run sentences together and bracket full-width
  const CJK = /^(zh|ja)/.test(LANG), gap = CJK ? "" : " ";
  // a group's networks (two names at most) and its country
  const where = r => {
    const o = (r.orgs || [r.org]).filter(Boolean), org = o.slice(0, 2).join(t("v_join")) + (o.length > 2 ? "…" : "");
    return (org && r.cc ? org + (CJK ? "（" + country(r.cc) + "）" : " (" + country(r.cc) + ")") : org || (r.cc && country(r.cc))) || r.ip;
  };
  async function cnShow() {
    const box = $("#cnt"), snap = SNAP;
    // a shared result, someone else's address, or no reading from either server: no card
    // someone else's address: say why the tests aren't here, with the way back to the visitor's own check
    $("#cnx").hidden = !(CN_ON && snap && !SHARED && !mine());
    if (!CN_ON || !snap || !mine()) { box.hidden = true; return; }
    const [hits, tcp] = await Promise.all([cnDns, cnTcp]);
    if (snap !== SNAP) return;
    const s = snap.r.summary, exit = { ip: snap.ip, asn: s.asn, cc: s.cc, type: s.type, ips: [...EX.keys()] };
    const d = hits && readDns(hits, exit), c = readConn(tcp, exit, navigator.userAgent);
    box.hidden = !(hits || c);
    if (box.hidden) return;
    const off = `<span class="m">${esc(t("cn_none"))}</span>`;
    if (!d) finding("dns", "none", off, t(hits ? "cn_d_none" : "cn_d_down"));
    else {
      // the worst network on the cell (and how many others there are); each network, its addresses and why, on hover
      const g = d.groups, m = g[0], v = m.ecsOff && m.kind !== "leak" ? "cn_d_leak" : DNS_V[m.kind];
      const tail = m.kind === "public" ? esc(m.pub) : `${flag(m.cc)} ${esc(m.org || m.ip)}`;
      const more = g.length > 1 ? ` <span class="m">+${g.length - 1}</span>` : "";
      const ips = r => r.ips.slice(0, 3).join(", ") + (r.ips.length > 3 ? ` … (${r.ips.length})` : "");
      const line = r => (ips(r) + " · " + t("cn_dw_" + r.kind, { at: where(r), pub: r.pub, exit: s.cc ? country(s.cc) : "" }) + (r.ecsOff ? gap + t("cn_dw_ecs", { ecs: r.ecs }) : "")).replace(/） /g, "）");
      finding("dns", d.lv, `${esc(t(v))} <span class="m">${tail}</span>${more}`, [...g.map(line), DBIP].join("\n"));
    }
    if (!c) finding("tcp", "none", off, t("cn_t_down"));
    else {
      const p = { mss: c.mss, mtu: c.mtu, ip: c.ip, sys: SYS[c.os] || t("cn_sys_other"), ua: SYS[c.ua] };
      const why = [t("cn_tw_" + c.kind, p)];
      if (c.kind === "proxy" && c.mtu < 1480) why.push(t("cn_tw_tunnel", p));
      if (c.other) why.push(t("cn_tw_other", p));
      finding("tcp", c.lv, `${esc(t("cn_t_" + c.kind))} <span class="m">MSS ${c.mss}</span>`, why.join("\n"));
    }
  }

  /* ---------- Cloudflare's human check, measured: Turnstile on this exit and browser ---------- */
  // The uses above guess from the address whether Cloudflare will challenge it; this runs the real thing once, for the
  // visitor's own address, when they press the button (the widget runs in Cloudflare's frame and reads the browser).
  // The Worker names the site key (GET /api/turnstile; 404 without one, and the card stays hidden) and verifies the
  // token (POST). "pass": no tick needed; "click": Turnstile asked for one first (before-interactive-callback) and
  // then passed; "fail": refused. The answer is then read against the guess, which says where the trouble likely is.
  let CFK = null, cfId = null, cfP = null;
  if (!EMBED && !SHARE_CODE) getJ("/api/turnstile", 4000).then(j => { if (j && j.sitekey) { CFK = j.sitekey; cfShow(); } }).catch(() => {});
  const CF_LV = { pass: "ok", click: "warn", fail: "bad" };
  // state: idle | run | ask | err | pass | click | fail. Until the answer the card keeps its question, icon and colour
  // (only the line under it and the button change), so the one big change on the card is the answer itself
  // the card only grows while a test runs (the tallest state it has shown sets its height), so moving from one state
  // to the next never makes the page below it jump up and back down. Held right before each change (each new state,
  // and the widget leaving): no ResizeObserver, whose callback writing a size it just read sets off another round in
  // the same frame. The exact height (not offsetHeight, which rounds 109.5 up to 110), so holding never resizes it.
  const cfBox = $("#cfc");
  const cfHold = () => { const h = cfBox.getBoundingClientRect().height; if (h > (cfBox._h || 0)) { cfBox._h = h; cfBox.style.minHeight = h + "px"; } };
  const cfUnhold = () => { cfBox._h = 0; cfBox.style.minHeight = ""; };
  function cfCard(state, lv, v, d, x) {
    if (state !== "idle") cfHold();
    const c = cfBox; c.dataset.s = state; c.className = "cfc st-" + lv;
    c.querySelector(".st").textContent = ICON[lv];
    $("#cfV").textContent = v; $("#cfD").textContent = d;
    const xe = $("#cfX"); xe.hidden = !x; xe.innerHTML = x || "";
  }
  // the button stays put through the test: busy, it shows a spinner and waits
  function cfGo(label, busy) {
    const b = $("#cfGo"); b.hidden = !label; if (!label) return;
    b.disabled = !!busy; b.classList.toggle("pri", label === "cf_go" && !busy);
    b.innerHTML = (busy ? '<i class="spin"></i>' : "") + esc(t(label));
  }
  // what the answer says next to the guess: the address's reputation, or the browser
  function cfRead(res) {
    const guess = SNAP.r.uses && SNAP.r.uses.captcha ? SNAP.r.uses.captcha.lv : "good";
    if (res === "pass") return esc(t(guess === "good" ? "cf_x_same_ok" : "cf_x_lucky"));
    if (guess !== "good") return esc(t("cf_x_ip"));
    const link = who && !SHARED ? ` <a href="${esc(who + D.paths[LANG])}" target="_blank" rel="noopener">${esc(t("cf_who"))} →</a>` : "";
    return esc(t("cf_x_browser")) + link;
  }
  function cfShow() {
    const box = $("#cft"), res = SNAP && SNAP.cf;
    // a shared result shows the sender's answer when it holds one; a check of another address has nothing to test
    const can = !!(CFK && SNAP && mine());
    box.hidden = !(res || can);
    if (box.hidden) { $("#cfW").textContent = ""; cfUnhold(); return; }
    if (res) cfCard(res, CF_LV[res], t("cf_v_" + res), t("cf_" + res), cfRead(res));
    else cfCard("idle", "info", t("cf_q"), t("cf_idle"), esc(t("cf_priv")));
    cfGo(can ? (res ? "cf_again" : "cf_go") : "");
  }
  const loadTurnstile = () => cfP ||= new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.onload = () => window.turnstile ? ok(window.turnstile) : no(); s.onerror = () => { cfP = null; no(); };
    document.head.appendChild(s);
  });
  $("#cfGo").onclick = async () => {
    const snap = SNAP; if (!CFK || !snap) return;
    cfCard("run", "info", t("cf_q"), t("cf_wait_d"), ""); cfGo("cf_busy", true);
    let ts = null, asked = false, over = false;
    function end(v) {
      if (over) return; over = true;
      // held with the widget still in it: the answer then starts at least as tall as the tick box made the card
      cfHold();
      if (ts && cfId !== null) { try { ts.remove(cfId); } catch (e) {} cfId = null; }
      if (snap !== SNAP) return;
      if (v) { snap.cf = v; cfShow(); }
      else { cfCard("err", "none", t("cf_err_v"), t("cf_err"), ""); cfGo("cf_retry"); }
    }
    try { ts = await loadTurnstile(); } catch (e) { return end(null); }
    if (cfId !== null) { try { ts.remove(cfId); } catch (e) {} cfId = null; }
    cfId = ts.render("#cfW", {
      sitekey: CFK, action: "ipqs", theme: "auto", appearance: "interaction-only", retry: "never",
      language: LANG === "pt" ? "pt-br" : LANG.toLowerCase(),
      "before-interactive-callback": () => { asked = true; cfCard("ask", "info", t("cf_q"), "", ""); cfGo("cf_wait_tick", true); },
      callback: async token => {
        cfGo("cf_busy", true);
        const j = await fetch("/api/turnstile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" })
          .then(r => r.ok ? r.json() : null).catch(() => null);
        end(!j ? null : j.success ? (asked ? "click" : "pass") : "fail");
      },
      // 3xxxxx and 6xxxxx: the challenge itself failed; anything else (setup, network, a blocked frame) is no answer
      "error-callback": code => { end(/^[36]/.test(String(code)) ? "fail" : null); return true; },
      "unsupported-callback": () => end(null),
    });
  };

  /* ---------- share: the 1ms.dog dialog (/assets/share/, copied from 1ms-shell) with this result's card and link ---------- */
  const shareLink = async withLoc => location.origin + D.paths[LANG] + "r/" + await encode(pack({ ...SNAP, details: withLoc }));
  const shareTitle = () => t("og_r_title", { g: SNAP.r.grade, s: SNAP.r.score, v: t("g_" + SNAP.r.grade) });
  const stamp = () => new Date(SNAP.at).toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const loadImg = src => new Promise(res => { const img = new Image(); img.onload = () => res(img); img.onerror = () => res(null); img.src = src; });
  // where the card's parts sit, from kit.top: the title and where the address is (with the address and network when
  // the box is ticked), the score ring beside the verdict, the findings in two columns, the five uses
  const R = 130, CELLS = ["type", "native", "anon", "tor", "risk", "abuse", "dnsbl", "geo"];
  function layout(kit) {
    const my = kit.top + 94 + (kit.show ? 42 : 0), cy = my + 40 + R, cells = cy + R + 96;
    const uses = cells + Math.ceil(CELLS.length / 2) * 58 - 10;
    // Cloudflare's human check, when it was run, gets a line under the uses
    return { my, cy, cells, uses, end: uses + 108 + 36 + (SNAP && SNAP.cf ? 56 : 0) };
  }
  // the result between kit.top and kit.bottom, in the page's theme; the findings and uses are read off the page's cells
  async function drawCard(g, kit) {
    const { W, P } = kit, r = SNAP.r, s = r.summary, L = layout(kit), withLoc = kit.show;
    const C = { fg: cssVar("--fg"), mu: cssVar("--muted"), line: cssVar("--line"), soft: cssVar("--soft"), ok: cssVar("--t1"), warn: cssVar("--t3"), bad: cssVar("--t5") };
    const GC = { A: cssVar("--t1"), B: cssVar("--t2"), C: cssVar("--t3"), D: cssVar("--t4"), F: cssVar("--t5") }[r.grade];
    const FF = cssVar("--f-ui") || kit.F, FN = cssVar("--f-num") || kit.M;
    const font = (wt, sz, mono) => { g.font = `${wt} ${sz}px ${mono ? FN : FF}`; };
    const text = (str, x, y, color, align) => { g.fillStyle = color; g.textAlign = align || "left"; g.fillText(str, x, y); };
    const fit = (str, max) => kit.clip(g, str, max);
    // wraps at spaces, or anywhere in scripts written without them
    const wrap = (str, max, lines) => {
      const out = []; let cur = "";
      for (const tok of str.match(/\S+\s*|\s+/g) || []) {
        for (const piece of g.measureText(tok).width > max ? [...tok] : [tok]) {
          if (g.measureText(cur + piece).width > max && cur.trim()) { out.push(cur.trim()); cur = piece.trimStart(); } else cur += piece;
        }
      }
      if (cur.trim()) out.push(cur.trim());
      return out.length > lines ? [...out.slice(0, lines - 1), fit(out.slice(lines - 1).join(" "), max)] : out;
    };
    const pc = k => cssVar("--p-" + k.slice(2));
    try { await document.fonts.ready; } catch (e) {}
    g.textBaseline = "alphabetic";

    // title, then the country (and, when asked, the city, address and network)
    font(700, 50); text(fit(t("card_title"), W - 2 * P), P, kit.top + 44, C.fg);
    let my = kit.top + 94;
    const fl = s.cc ? await loadImg(`/flags/${flagCode(s.cc)}.svg`) : null;
    font(500, 28);
    const where = [withLoc && s.city, s.cc && country(s.cc)].filter(Boolean).join(", ") + "  ·  IPv" + SNAP.v;
    if (fl) { g.drawImage(fl, P, my - 23, 36, 27); text(fit(where, W - 2 * P - 50), P + 50, my, C.mu); } else text(fit(where, W - 2 * P), P, my, C.mu);
    if (withLoc) { my += 42; text(fit([SNAP.ip, s.asn && "AS" + s.asn, s.org].filter(Boolean).join("  ·  "), W - 2 * P), P, my, C.mu); }

    // the ring: the score in the grade's color, each deduction after it in its own color, as on the page
    const cx = P + R + 10, cy = L.cy;
    const arc = (from, len, color) => { g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2 + from / 50 * Math.PI, -Math.PI / 2 + (from + len) / 50 * Math.PI); g.strokeStyle = color; g.stroke(); };
    g.lineWidth = 26; g.lineCap = "butt"; arc(0, 100, C.soft);
    let at = r.score;
    for (const p of r.parts) { const len = Math.min(p.pts, 100 - at); if (len <= 0) continue; arc(at + .6, Math.max(0, len - 1.2), pc(p.k)); at += len; }
    if (r.score > 0) arc(0, r.score, GC);
    // the card is also the link's preview, shrunk to about half: the score, grade and verdict are drawn large
    g.textBaseline = "middle"; font(700, 112, true); text(String(r.score), cx, cy - 16, C.fg, "center");
    font(800, 40); text(fit(t("grade", { g: r.grade }), 2 * R - 70), cx, cy + 64, GC, "center"); g.textBaseline = "alphabetic";

    // the verdict and where the points went
    const vx = cx + R + 64, vw = W - P - vx;
    font(800, 62); text(fit(t("g_" + r.grade), vw), vx, cy - 70, GC);
    font(500, 26); const dl = wrap(t("d_" + r.grade), vw, 3); dl.forEach((l, i) => text(l, vx, cy - 22 + i * 38, C.mu));
    let px = vx, py = cy - 22 + dl.length * 38 + 30;
    font(600, 24);
    for (const p of r.parts) {
      const label = "−" + p.pts + " " + t("pp_" + p.k.slice(2)), w = g.measureText(label).width + 28;
      if (px + w > W - P && px > vx) { px = vx; py += 44; }
      if (py > cy + R + 10) break;
      g.fillStyle = pc(p.k); g.beginPath(); g.arc(px + 9, py - 8, 8, 0, Math.PI * 2); g.fill();
      text(label, px + 26, py, C.fg); px += w + 22;
    }

    // what the address is and what it is good for, read off the page's cells
    const LV = { "st-ok": C.ok, "st-warn": C.warn, "st-bad": C.bad };
    const lvOf = el => LV[[...el.classList].find(c => c in LV)] || C.mu;
    const y = L.cells;
    g.strokeStyle = C.line; g.lineWidth = 2; g.beginPath(); g.moveTo(P, y - 48); g.lineTo(W - P, y - 48); g.stroke();
    const cells = CELLS.map(f => $(`.fc[data-f="${f}"]`)).filter(Boolean);
    const colW = (W - 2 * P - 48) / 2;
    cells.forEach((c, i) => {
      const x = P + (i % 2) * (colW + 48), yy = y + Math.floor(i / 2) * 58, col = lvOf(c);
      g.fillStyle = col; g.beginPath(); g.arc(x + 9, yy - 9, 8, 0, Math.PI * 2); g.fill();
      font(500, 25); const lab = fit(c.querySelector(".fc-l").lastChild.textContent.trim(), colW * .5); text(lab, x + 28, yy, C.mu);
      font(600, 25); text(fit(c.querySelector(".fc-v").textContent.replace(/\s+/g, " ").trim(), colW - 48 - g.measureText(lab).width), x + colW, yy, col === C.mu ? C.fg : col, "right");
    });
    const uses = $$(".uc[data-f]"), uw = (W - 2 * P - 4 * 14) / 5;
    uses.forEach((u, i) => {
      const x = P + i * (uw + 14), col = lvOf(u);
      kit.roundRect(g, x, L.uses, uw, 108, 16); g.fillStyle = C.soft; g.fill();
      g.fillStyle = col; kit.roundRect(g, x + 18, L.uses + 18, 30, 6, 3); g.fill();
      font(500, 22); text(fit(u.querySelector(".uc-l").textContent.trim(), uw - 36), x + 18, L.uses + 58, C.mu);
      font(700, 26); text(fit(u.querySelector(".uc-v").textContent.trim(), uw - 36), x + 18, L.uses + 92, col);
    });
    if (SNAP.cf) {
      const col = { pass: C.ok, click: C.warn, fail: C.bad }[SNAP.cf], yy = L.uses + 108 + 62;
      g.fillStyle = col; g.beginPath(); g.arc(P + 9, yy - 9, 8, 0, Math.PI * 2); g.fill();
      font(500, 25); const lab = t("cf_l"), lw = g.measureText(lab).width; text(lab, P + 28, yy, C.mu);
      font(700, 25); text(fit(t("cf_v_" + SNAP.cf), W - 2 * P - 60 - lw), P + 44 + lw, yy, col);
    }
  }
  $("#shareBtn").onclick = async () => {
    if (!SNAP) return;
    const snap = SNAP, { share } = await import("/assets/share/share.js?v=8");
    // the link is packed (deflated) ahead, both ways, as the dialog asks for it without waiting
    const can = !SHARED || !!SHARED.i, links = { false: await shareLink(false), true: can ? await shareLink(true) : "" };
    if (snap !== SNAP) return;
    share({
      lang: LANG, name: t("app_name"), file: `ipqs-${stamp()}`,
      // the address, city and network stay out unless asked for; a shared result without them can't add them
      show: ["ip", "city", "isp"], canShow: can,
      link: show => links[show && can], home: location.origin + D.paths[LANG],
      text: () => shareTitle(),
      height: (m, kit) => layout(kit).end + 70,
      draw: drawCard,
      foot: () => [t("card_cta")],
      ts: Date.parse(snap.at),
    }).open();
  };
  let toastEl, toastT = 0;
  function toast(msg) {
    if (!toastEl) toastEl = document.body.appendChild(Object.assign(document.createElement("div"), { className: "toast", role: "status" }));
    toastEl.textContent = msg; toastEl.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 1800);
  }

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
  if (SHARE_CODE) replay(SHARE_CODE);
  else { addEventListener("popstate", start); start(); }
})();
