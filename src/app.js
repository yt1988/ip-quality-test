// ipqs page: asks /api/check for an address, fills each source's row the moment it answers (the rows are in the
// HTML from the start), then shows the score, notes and verdicts once every source is in. Strings: window.L1MS.
import { family, canon, isPublic } from "./ip.mjs";
import { assess } from "./score.mjs";

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
  const applyMask = () => { $("#facts").classList.toggle("masked", masked()); $("#mine").classList.toggle("masked", masked()); eye.textContent = t(masked() ? "show" : "hide"); };
  eye.onclick = () => { store.set(K.mask, masked() ? "0" : "1"); applyMask(); };
  applyMask();

  /* ---------- rendering pieces ---------- */
  const NA = '<span class="na">–</span>';
  const riskColor = v => v >= 70 ? "var(--t5)" : v >= 35 ? "var(--t3)" : "var(--t1)";
  const bar = v => `<span class="bar" style="--v:${v / 100};--c:${riskColor(v)}"><em>${esc(t("col_risk"))}</em><i></i><b class="num">${v}</b></span>`;
  const typeName = ty => ty ? t("t_" + ty) : "–";
  const rows = Object.fromEntries($$("#src tr[data-s]").map(r => [r.dataset.s, r]));

  function srcRow(id, cells, cls = "") {
    const r = rows[id]; if (!r) return;
    r.className = cls;
    for (let i = 0; i < cells.length; i++) r.children[i + 1].innerHTML = cells[i];
  }
  function srcName(id, site, x) {
    const r = rows[id]; if (!r) return;
    const name = r.dataset.name;
    r.children[0].innerHTML = (site ? `<a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>` : `<b>${esc(name)}</b>`) + (x ? `<span class="x">${x}</span>` : "");
  }
  const SK = '<span class="sk-l" style="display:inline-block;width:38px;min-height:12px"></span>';

  // A source's answer as one line of what it actually said: place, network type, flags, risk. Sources answer
  // different questions (a registry only knows where the block is registered, the Tor list only whether it's an exit),
  // so one summary cell reads better than columns that would be mostly empty.
  function fillSource(m) {
    if (!m.ok) { srcName(m.id, m.site, ""); srcRow(m.id, [`<span class="m">${esc(t("src_fail"))}</span>`], "fail"); return; }
    const d = m.d, extra = (d.extra || []).map(([k, v]) => `${esc(t(k))} ${esc(v)}`);
    if (d.org && (d.cc || !d.regCc)) extra.unshift(esc((d.asn ? "AS" + d.asn + " " : "") + d.org));
    if (d.tags && d.tags.length) extra.push(esc(d.tags.join(", ")));
    srcName(m.id, m.site, extra.join(" · "));
    const out = [];
    if (d.cc) out.push(`<span class="pl">${flag(d.cc)} ${esc(country(d.cc))}${d.city ? ` <span class="m">${esc(d.city)}</span>` : ""}</span>`);
    const reg = d.regCc || d.asCc;
    if (reg && !d.cc) out.push(`<span class="pl">${flag(reg)} ${esc(t(d.regCc ? "x_reg" : "x_as_cc", { c: country(reg) }))}${d.rir ? ` <span class="m">${esc(d.rir)}</span>` : ""}</span>`);
    else if (!d.cc && d.rir) out.push(`<span class="m">${esc(d.rir)}</span>`);
    if (d.type) out.push(`<span class="ft ${d.type === "hosting" ? "warn" : ""}">${esc(typeName(d.type))}</span>`);
    const on = [["tor", "Tor"], ["vpn", "VPN"], ["proxy", t("tag_proxy")], ["abuser", t("f_abuse")]].filter(([k]) => d[k] === true);
    if (on.length) out.push(on.map(([, x]) => `<span class="ft bad">${esc(x)}</span>`).join(""));
    else if (m.id === "tor") out.push(`<span class="no">${esc(t("x_tor_no"))}</span>`);
    else if (["tor", "vpn", "proxy"].some(k => d[k] === false)) out.push(`<span class="no">${esc(t("f_clean"))}</span>`);
    if (typeof d.risk === "number") out.push(bar(d.risk));
    if (d.ports) out.push(`<span class="m">${esc(d.ports.length ? t("x_ports") + " " + d.ports.slice(0, 10).join(", ") : t("x_no_ports"))}</span>`);
    srcRow(m.id, [out.join("") || NA]);
  }

  // the blocklists: one row, counting as they answer; the lists that carry the address are named and linked
  const BL = { of: 0, done: 0, hits: [] };
  function blRow(final) {
    const hits = BL.hits.map(b => `<a class="ft bad" href="${esc(b.site)}" target="_blank" rel="noopener noreferrer">${esc(b.name)}</a>`).join("");
    const cell = !BL.of ? `<span class="m">${esc(t("bl_v6"))}</span>`
      : hits || (final || BL.done === BL.of ? `<span class="no">${esc(t("bl_clean"))}</span>` : `<span class="m num">${BL.done}/${BL.of}</span>`);
    srcRow("dnsbl", [cell], BL.of ? "" : "fail");
  }

  /* ---------- the check ---------- */
  let RUN = null, total = 0, got = 0;
  const gauge = $("#gauge");
  function progress() {
    $("#gNum").textContent = `${got}/${total}`;
    $("#vText").textContent = t("progress", { n: got, of: total });
    $("#srcN").textContent = `${got}/${total}`;
  }
  function reset(ip) {
    gauge.classList.add("busy"); gauge.dataset.g = ""; $("#gArc").style.strokeDashoffset = 100;
    $("#gNum").textContent = "–"; $("#gGrade").innerHTML = "&nbsp;";
    $("#vHead").textContent = t("checking"); const vt = $("#vText"); vt.classList.remove("err"); vt.innerHTML = "&nbsp;";
    $("#parts").innerHTML = "&nbsp;";
    $$("#facts dd").forEach(dd => { dd.className = "sk-l"; dd.innerHTML = ""; });
    $("#facts dd").classList.add("ipv");
    $("#notes").innerHTML = '<li class="sk-l"></li>'.repeat(2);
    $$("#uses li").forEach(li => { li.className = ""; li.querySelector(".lv").innerHTML = SK; li.querySelector(".why").innerHTML = "&nbsp;"; });
    for (const id in rows) { rows[id].hidden = false; srcName(id, null, ""); srcRow(id, [SK]); }
    $("#srcN").textContent = ""; $("#srcFoot").innerHTML = "&nbsp;";
    $$(".chip").forEach(c => c.setAttribute("aria-pressed", c.dataset.ip === (ip || selfIp)));
  }
  function fail(key) {
    gauge.classList.remove("busy"); $("#gNum").textContent = "–";
    $("#vHead").textContent = t("err_h");
    const vt = $("#vText"); vt.textContent = t(key); vt.classList.add("err");
  }

  async function run(ip, push) {
    if (RUN) RUN.abort();
    const ctl = RUN = new AbortController();
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

  let CUR = null, keyless = 0, RES = [], BLR = [], PEND = [];
  // IPinfo limits the shared Cloudflare addresses the server asks from; the browser asks it directly instead
  const ipinfo = ip => getJ(`https://ipinfo.io/${encodeURIComponent(ip)}/json`).then(j => {
    if (j.bogon || !j.country) throw 0;
    const d = { cc: j.country, city: j.city, org: String(j.org || "").replace(/^ASd+s*/, "") || undefined, host: j.hostname || undefined };
    const asn = /^AS(d+)/.exec(j.org || ""); if (asn) d.asn = +asn[1]; if (j.anycast === true) d.anycast = true;
    return d;
  });
  function handle(m) {
    if (m.t === "start") {
      CUR = m; RES = []; BLR = []; PEND = [];
      const dd = $("#facts dd"); dd.className = "ipv"; dd.innerHTML = `${esc(m.ip)} <span class="m">IPv${m.v}</span>`;
      // sources this check can't use leave the table before any answer arrives; the ones needing keys get a footnote
      for (const id in m.skip) if (rows[id]) rows[id].hidden = true;
      keyless = Object.values(m.skip).filter(w => w === "key").length;
      BL.of = m.bl.length; BL.done = 0; BL.hits = [];
      blRow(false);
      total = Object.keys(rows).length - 1 - Object.keys(m.skip).length + m.bl.length;
      if (m.self) noteMine(m.ip);
      progress();
    } else if (m.t === "src") {
      if (!m.ok && m.id === "ipinfo") {
        const cur = CUR;
        PEND.push(ipinfo(cur.ip).then(d => { if (CUR !== cur) return; RES.push({ id: m.id, data: d }); fillSource({ ...m, ok: true, d }); },
          () => { if (CUR === cur) fillSource(m); }).finally(() => { if (CUR === cur) { got++; progress(); } }));
        return;
      }
      if (m.ok) RES.push({ id: m.id, data: m.d });
      fillSource(m); got++; progress();
    }
    else if (m.t === "bl") {
      BL.done++; BLR.push(m); if (m.listed === true) BL.hits.push(m);
      blRow(false); got++; progress();
    } else if (m.t === "done") {
      // scored here, once the browser's own lookups are in too (same rules as the API: src/score.mjs)
      const cur = CUR;
      Promise.allSettled(PEND).then(() => { if (CUR === cur) finish({ ...m, ...assess(RES, BLR) }); });
    }
    else if (m.t === "error") fail("err_net");
  }

  function finish(r) {
    const s = r.summary;
    gauge.classList.remove("busy"); gauge.dataset.g = r.grade;
    $("#gNum").textContent = r.score; $("#gGrade").textContent = t("grade", { g: r.grade });
    requestAnimationFrame(() => { $("#gArc").style.strokeDashoffset = 100 - r.score; });
    $("#vHead").textContent = t("g_" + r.grade);
    $("#vText").textContent = t("d_" + r.grade);
    // where the points went, in one line (the full wording on hover)
    $("#parts").innerHTML = r.parts.map(p => `<span title="${esc(t(p.k, p.p))}">−${p.pts} ${esc(t("pp_" + p.k.slice(2)))}</span>`).join("") || "&nbsp;";

    const dd = $$("#facts dd");
    const set = (i, h) => { dd[i].className = i ? "" : "ipv"; dd[i].innerHTML = h; };
    const where = [s.city, s.cc && country(s.cc)].filter(Boolean).join(", ");
    set(1, s.cc ? `${flag(s.cc)} ${esc(where)}` + (s.ccs.length > 1 ? ` <span class="m">${esc(t("also", { list: s.ccs.slice(1).map(c => c.cc).join(", ") }))}</span>` : "") : "–");
    set(2, s.asn || s.org ? `${s.asn ? "AS" + s.asn + " " : ""}<span class="m">${esc(s.org || "")}</span>` : "–");
    const typeLv = s.type === "hosting" ? "warn" : s.type === "residential" || s.type === "mobile" ? "good" : "";
    set(3, s.type ? `<span class="tag ${typeLv}">${esc(typeName(s.type))}</span>` : "–");
    const nat = s.native === true ? `<span class="tag good">${esc(t("tag_native"))}</span>` : s.native === false ? `<span class="tag warn">${esc(t("tag_broadcast"))}</span>` : "";
    set(4, s.regCc ? `${flag(s.regCc)} ${esc(country(s.regCc))} ${nat}` : "–");
    set(5, s.host ? `<span class="num">${esc(s.host)}</span>` : "–");

    // only what needs attention; the score and the facts above already say the rest
    const shown = r.notes.filter(n => n.lv !== "good" && n.k !== "n_ports");
    $("#notes").innerHTML = shown.length ? shown.map(n => {
      const p = { ...n.p };
      for (const k of ["reg", "cc"]) if (p[k]) p[k] = country(p[k]);
      if (Array.isArray(p.list)) p.list = list(p.list.map(x => /^[A-Z]{2}$/.test(x) ? country(x) : x));
      for (const k in p) p[k] = esc(p[k]);
      return `<li><i class="dot ${n.lv}"></i><span>${t(n.k, p)}</span></li>`;
    }).join("") : `<li><i class="dot good"></i><span>${esc(t("n_none"))}</span></li>`;
    for (const li of $$("#uses li")) {
      const u = r.uses[li.dataset.u]; if (!u) continue;
      li.className = u.lv;
      li.querySelector(".lv").innerHTML = `<span class="tag ${u.lv}">${esc(t("lv_" + u.lv))}</span>`;
      li.querySelector(".why").textContent = t(u.why);
    }
    blRow(true);
    // the checked address, when it is one of the visitor's exits that no check placed, takes the country found here
    const ex = EX.get(CUR.ip); if (ex && !ex.cc && s.cc) { ex.cc = s.cc; if (exFinished) renderExits(); }
    // sources that didn't answer leave the table now that everything is in, named in the footnote instead
    const down = Object.keys(rows).filter(id => id !== "dnsbl" && !rows[id].hidden && rows[id].className === "fail");
    for (const id of down) rows[id].hidden = true;
    const ok = Object.keys(rows).filter(id => !rows[id].hidden && rows[id].className === "" && id !== "dnsbl").length;
    $("#srcN").textContent = t("src_n", { ok, at: new Date(r.at).toLocaleString(LANG) }) + (r.cached ? " · " + t("cached") : "");
    $("#srcFoot").innerHTML = (down.length ? esc(t("src_down", { list: list(down.map(id => rows[id].dataset.name)) })) + " " : "") +
      (keyless ? esc(t("skip_n", { n: keyless })) + " " : "") +
      `${esc(t("more_l"))} ` + r.elsewhere.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a>`).join(" · ");
  }

  /* ---------- the visitor's exits ---------- */
  // A rule-based proxy picks the route by destination, so one "what is my IP" only shows one exit. As on EgressLens,
  // the browser asks checks at different kinds of destination at once (sites in mainland China, IP services abroad, AI
  // services, IPv4-only and IPv6-only hosts) and lists every address they saw, each with its country. The list draws
  // once every check is in; until then the row holds its place with a counter.
  const getJ = (u, ms = 5000) => fetch(u, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(ms) }).then(r => r.ok ? r.json() : Promise.reject());
  const getT = (u, ms = 5000) => fetch(u, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(ms) }).then(r => r.ok ? r.text() : Promise.reject());
  const trace = host => () => getT(`https://${host}/cdn-cgi/trace`).then(x => { const ip = (/^ip=(.+)$/m.exec(x) || [])[1], cc = (/^loc=(\w\w)$/m.exec(x) || [])[1]; return { ip, cc }; });
  const PROBES = [
    () => getJ("https://myip.ipip.net/json").then(j => ({ ip: j.data && j.data.ip })),
    () => getT("https://api.ipify.cn").then(x => ({ ip: x.trim() })),
    () => getJ("https://api.ip.sb/geoip").then(j => ({ ip: j.ip, cc: j.country_code })),
    () => getJ("https://ipinfo.io/json").then(j => ({ ip: j.ip, cc: j.country })),
    trace("chatgpt.com"), trace("claude.ai"),
    () => getJ("https://ipv4-check-perf.radar.cloudflare.com/").then(j => ({ ip: j.ip_address })),
    () => getJ("https://ipv6-check-perf.radar.cloudflare.com/").then(j => ({ ip: j.ip_address })),
  ];
  const EX = new Map();               // ip → { ip, cc, n: how many checks saw it }
  let exDone = 0, exFinished = false, selfIp = null;
  const egress = (document.querySelector('meta[name="egress"]') || {}).content || "";
  function renderExits() {
    const el = $("#mine");
    if (!exFinished) { el.innerHTML = `<span class="m">${esc(t("mine_h"))}</span><span class="m num">${esc(t("ex_wait", { n: exDone, of: PROBES.length }))}</span>`; return; }
    // the address the check itself sees first, then by how many checks saw it; IPv4 before IPv6
    const list = [...EX.values()].sort((a, b) => (b.ip === selfIp) - (a.ip === selfIp) || b.n - a.n || family(a.ip) - family(b.ip));
    el.innerHTML = `<span class="m">${esc(t("mine_h"))}</span>` + (list.length ? list.map(x =>
      `<button type="button" class="chip" data-ip="${esc(x.ip)}" aria-pressed="${CUR && CUR.ip === x.ip}">${flag(x.cc)}<b>${esc(x.ip)}</b></button>`).join("")
      : `<span class="m">${esc(t("none"))}</span>`) +
      (egress ? `<a class="eg" href="${esc(egress)}${D.paths[LANG]}" target="_blank" rel="noopener">${esc(t("ex_more"))}</a>` : "");
    el.querySelectorAll(".chip").forEach(c => { c.onclick = () => { input.value = ""; run(c.dataset.ip === selfIp ? null : c.dataset.ip, true); }; });
  }
  function noteMine(ip) { selfIp = ip; if (!EX.has(ip)) EX.set(ip, { ip, cc: null, n: 1 }); if (exFinished) renderExits(); }
  (async () => {
    renderExits();
    await Promise.allSettled(PROBES.map(p => p().then(r => {
      const ip = canon(r.ip || "");
      if (!ip || !isPublic(ip)) return;
      const x = EX.get(ip) || { ip, cc: null, n: 0 };
      x.n++; if (r.cc && /^[A-Z]{2}$/i.test(r.cc) && r.cc.toUpperCase() !== "XX") x.cc = x.cc || r.cc.toUpperCase();
      EX.set(ip, x);
    }).finally(() => { exDone++; if (!exFinished) renderExits(); })));
    // an address no check placed gets its country from ip.sb
    await Promise.allSettled([...EX.values()].filter(x => !x.cc).slice(0, 6).map(x =>
      getJ("https://api.ip.sb/geoip/" + encodeURIComponent(x.ip)).then(j => { if (j.country_code) x.cc = j.country_code.toUpperCase(); })));
    exFinished = true; renderExits();
  })();

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
