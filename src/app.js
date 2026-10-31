// ipqs page, laid out as EgressLens: the hero holds the score, the address, the visitor's exits and the findings; the
// second card lists every source, each row filled the moment it answers (the rows are in the HTML from the start).
// The score and findings come once every source is in. Strings: window.L1MS.
import { family, canon, isPublic } from "./ip.mjs";
import { assess } from "./score.mjs";
import { ccOfName } from "./sources.mjs";

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
      const rows = GROUP[g].filter(r => !r.hidden);
      $("#n-" + g).textContent = rows.length ? `${rows.filter(r => !r.classList.contains("wait")).length} / ${rows.length}` : "";
      $(`.pg[data-g="${g}"]`).hidden = !rows.length;
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
  let RUN = null, total = 0, got = 0, CUR = null, keyless = 0, RES = [], BLR = [], PEND = [], lastIp = null;
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
    $$("#finds .fr").forEach(r => { r.className = "fr"; r.style.removeProperty("--pc"); delete r.dataset.why; r.querySelector(".fr-v").innerHTML = '<span class="skl"></span>'; r.querySelector(".fr-p").textContent = ""; });
    for (const id in PR) { const r = PR[id]; r.hidden = false; r.className = "pr wait"; delete r.dataset.why; r.querySelector(".pa").textContent = "…"; r.querySelector(".pk").innerHTML = ""; r.querySelector(".pms").textContent = ""; }
    $("#prog").classList.remove("end"); $("#rerun").disabled = true; $("#srcFoot").innerHTML = "&nbsp;";
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

  // IPinfo limits the shared Cloudflare addresses the server asks from; the browser asks it directly instead
  const ipinfo = ip => getJ(`https://ipinfo.io/${encodeURIComponent(ip)}/json`).then(j => {
    if (j.bogon || !j.country) throw 0;
    const d = { cc: j.country, city: j.city, org: String(j.org || "").replace(/^AS\d+\s*/, "") || undefined, host: j.hostname || undefined };
    const asn = /^AS(\d+)/.exec(j.org || ""); if (asn) d.asn = +asn[1]; if (j.anycast === true) d.anycast = true;
    return d;
  });
  function handle(m) {
    if (m.t === "start") {
      CUR = m; RES = []; BLR = []; PEND = [];
      const b = $("#facts b"); b.className = "ipv"; b.innerHTML = `${esc(m.ip)} <span class="m">IPv${m.v}</span>`;
      // sources this check can't use leave the list before any answer arrives; the ones needing keys get a footnote
      for (const id in m.skip) if (PR[id]) PR[id].hidden = true;
      if (!m.bl.length) for (const id in PR) if (PR[id].closest('[data-g="dnsbl"]')) PR[id].hidden = true;
      keyless = Object.values(m.skip).filter(w => w === "key").length;
      total = m.n + m.bl.length;
      if (m.self) noteMine(m.ip);
      progress();
    } else if (m.t === "src") {
      if (!m.ok && m.id === "ipinfo") {
        const cur = CUR;
        PEND.push(ipinfo(cur.ip).then(d => { if (CUR !== cur) return; RES.push({ id: m.id, data: d }); fillSource({ ...m, ok: true, d, ms: null }); },
          () => { if (CUR === cur) fillSource(m); }).finally(() => { if (CUR === cur) { got++; progress(); } }));
        return;
      }
      if (m.ok && !m.d.cc && m.d.cname) { m.d.cc = ccOfName(m.d.cname); delete m.d.cname; }
      if (m.ok) RES.push({ id: m.id, data: m.d });
      fillSource(m); got++; progress();
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
  // each finding row and the deductions that belong to it
  const PARTS_OF = { type: ["hosting", "business"], anon: ["vpn", "proxy"], tor: ["tor"], risk: ["risk"], abuse: ["abuser"], dnsbl: ["dnsbl"] };
  const ICON = { ok: "✓", warn: "!", bad: "✕", info: "i", none: "–" };
  function finding(f, lv, html) {
    const r = $(`#finds [data-f="${f}"]`); if (!r) return;
    r.className = "fr st-" + lv;
    r.querySelector(".st").textContent = ICON[lv];
    r.querySelector(".fr-v").innerHTML = html;
  }
  function finish(r) {
    const s = r.summary, part = k => r.parts.find(p => p.k === "p_" + k);
    const why = p => t("p_why", { why: t(p.k, p.p), n: p.pts });
    gauge.classList.remove("busy"); gauge.dataset.g = r.grade;
    $("#gNum").textContent = r.score; $("#gGrade").textContent = t("grade", { g: r.grade });
    requestAnimationFrame(() => { $("#gArc").style.strokeDashoffset = 100 - r.score; });
    $("#vHead").textContent = t("g_" + r.grade);
    $("#vText").textContent = t("d_" + r.grade);
    // where the points went: one colored line per deduction, the same color as its segment of the ring
    $("#parts").innerHTML = r.parts.map(p => `<span style="--pc:var(--p-${p.k.slice(2)})" data-why="${esc(why(p))}" tabindex="0"><i></i><b>−${p.pts}</b>${esc(t("pp_" + p.k.slice(2)))}</span>`).join("") || "&nbsp;";
    let at = r.score;
    $("#gSeg").innerHTML = r.parts.map(p => { const len = Math.min(p.pts, 100 - at); if (len <= 0) return ""; const c = `<circle class="g-seg" cx="60" cy="60" r="52" pathLength="100" stroke="var(--p-${p.k.slice(2)})" stroke-dasharray="${Math.max(0, len - .8)} 100" stroke-dashoffset="${-(at + .4)}"/>`; at += len; return c; }).join("");

    // the address
    const fb = $$("#facts b"), set = (i, h) => { fb[i].className = i ? "" : "ipv"; fb[i].innerHTML = h; };
    const where = [s.city, s.cc && country(s.cc)].filter(Boolean).join(", ");
    set(1, s.cc ? `${flag(s.cc)} ${esc(where)}` + (s.ccs.length > 1 ? ` <span class="m">${esc(t("also", { list: s.ccs.slice(1).map(c => country(c.cc)).join(t("v_join")) }))}</span>` : "") : "–");
    set(2, s.asn || s.org ? `${s.asn ? "AS" + s.asn + " " : ""}<span class="m">${esc(s.org || "")}</span>` : "–");
    set(3, s.host ? `<span class="num">${esc(s.host)}</span>` : "–");

    // the findings
    const F = s.flags, tv = RES.filter(x => x.data.type);
    if (s.type) finding("type", s.type === "hosting" ? "warn" : s.type === "residential" || s.type === "mobile" ? "ok" : "info",
      `${esc(typeName(s.type))} <span class="m">${tv.filter(x => x.data.type === s.type).length}/${tv.length}</span>` + (s.type === "mobile" ? ` <span class="m">${esc(t("fv_cgnat"))}</span>` : ""));
    else finding("type", "none", `<span class="m">${esc(t("q_nodata"))}</span>`);
    if (s.native === null) finding("native", "none", `<span class="m">${esc(t("q_nodata"))}</span>`);
    else finding("native", s.native ? "ok" : "warn", esc(t(s.native ? "fv_native" : s.regFrom === "rir" ? "fv_broadcast" : "fv_broadcast_as", { reg: country(s.regCc), cc: country(s.cc) })));
    if (!F.vpn.of && !F.proxy.of) finding("anon", "none", `<span class="m">${esc(t("q_nodata"))}</span>`);
    else if (F.vpn.yes || F.proxy.yes) finding("anon", F.vpn.yes + F.proxy.yes > 1 ? "bad" : "warn",
      [F.vpn.yes && `VPN ${F.vpn.yes}/${F.vpn.of}`, F.proxy.yes && `${t("tag_proxy")} ${F.proxy.yes}/${F.proxy.of}`].filter(Boolean).map(esc).join(" · "));
    else finding("anon", "ok", esc(t("q_clean", { n: Math.max(F.vpn.of, F.proxy.of) })));
    if (s.torListed || F.tor.yes) finding("tor", "bad", esc(t("q_tor_yes")) + ` <span class="m">${F.tor.yes}/${F.tor.of}</span>`);
    else finding("tor", F.tor.of ? "ok" : "none", esc(F.tor.of ? t("q_tor_no", { n: F.tor.of }) : t("q_nodata")));
    if (s.risk === null) finding("risk", "none", `<span class="m">${esc(t("q_nodata"))}</span>`);
    else finding("risk", riskLv(s.risk), `${esc(t("fv_risk_avg", { v: s.risk }))} <span class="m">${s.risks.map(x => esc((PR[x.id] ? PR[x.id].querySelector(".pn").textContent : x.id) + " " + x.v)).join(" · ")}</span>`);
    if (!F.abuser.of) finding("abuse", "none", `<span class="m">${esc(t("q_nodata"))}</span>`);
    else finding("abuse", F.abuser.yes ? "bad" : "ok", esc(F.abuser.yes ? t("fv_abuse_yes", { n: F.abuser.yes, of: F.abuser.of }) : t("q_abuse_no")));
    const hits = BLR.filter(b => b.listed === true);
    if (!s.dnsbl.checked) finding("dnsbl", "none", `<span class="m">${esc(t(CUR.v === 6 ? "bl_v6" : "q_nodata"))}</span>`);
    else finding("dnsbl", hits.length ? "bad" : "ok", hits.length ? esc(t("bl_listed", { list: list(hits.map(b => b.name)) })) : esc(t("q_bl_clean", { n: s.dnsbl.checked })));
    for (const u of ["stream", "ai", "captcha", "account", "mail"]) { const x = r.uses[u]; finding(u, x.lv === "good" ? "ok" : x.lv, esc(t(x.why))); }

    // every deduction: its finding row tinted in its color with the points, and every source mark that caused it
    for (const f in PARTS_OF) {
      const ps = PARTS_OF[f].map(part).filter(Boolean); if (!ps.length) continue;
      const row = $(`#finds [data-f="${f}"]`);
      row.classList.add("hit"); row.style.setProperty("--pc", `var(--p-${ps[0].k.slice(2)})`);
      row.querySelector(".fr-p").textContent = "−" + ps.reduce((a, p) => a + p.pts, 0);
      row.dataset.why = ps.map(why).join("；");
    }
    for (const p of r.parts) for (const el of $$(`.pr [data-p="${p.k.slice(2)}"]`)) {
      el.classList.add("hit"); el.style.setProperty("--pc", `var(--p-${p.k.slice(2)})`); el.dataset.why = why(p);
    }

    const ex = EX.get(CUR.ip); if (ex && !ex.cc && s.cc) { ex.cc = s.cc; if (exFinished) renderExits(); }
    $("#prog").classList.add("end"); $("#rerun").disabled = false;
    $("#progTxt").textContent = t("src_n", { ok: RES.length, at: new Date(r.at).toLocaleString(LANG) }) + (r.cached ? " · " + t("cached") : "");
    groupCounts();
    $("#srcFoot").innerHTML = (keyless ? esc(t("skip_n", { n: keyless })) + " " : "") +
      `${esc(t("more_l"))} ` + r.elsewhere.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a>`).join(" · ");
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
    const list = [...EX.values()].sort((a, b) => (b.ip === selfIp) - (a.ip === selfIp) || b.n - a.n || family(a.ip) - family(b.ip));
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
