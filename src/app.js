// ipqs page: asks /api/check for an address, fills each source's row the moment it answers (the rows are in the
// HTML from the start), then shows the score, notes and verdicts once every source is in. Strings: window.L1MS.
import { family, canon, isPublic } from "./ip.mjs";

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
  const applyMask = () => { $("#facts").classList.toggle("masked", masked()); eye.textContent = t(masked() ? "show" : "hide"); };
  eye.onclick = () => { store.set(K.mask, masked() ? "0" : "1"); applyMask(); };
  applyMask();

  /* ---------- rendering pieces ---------- */
  const NA = '<span class="na">–</span>';
  const riskColor = v => v >= 70 ? "var(--t5)" : v >= 35 ? "var(--t3)" : "var(--t1)";
  const bar = v => typeof v === "number" ? `<span class="bar" style="--v:${v / 100};--c:${riskColor(v)}"><i></i><b class="num">${v}</b></span>` : NA;
  const typeName = ty => ty ? t("t_" + ty) : "–";
  const flagTag = (lv, x) => `<span class="ft ${lv}">${esc(x)}</span>`;
  // what a source flags, as small tags: only the yeses; "none" when it answered every question it asks with no
  const flagsOf = d => {
    const on = [["tor", "Tor"], ["vpn", "VPN"], ["proxy", t("tag_proxy")], ["abuser", t("f_abuse")]].filter(([k]) => d[k] === true);
    if (on.length) return on.map(([, x]) => flagTag("bad", x)).join("");
    return ["tor", "vpn", "proxy", "abuser"].some(k => d[k] === false) ? `<span class="no">${esc(t("f_none"))}</span>` : NA;
  };
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

  function fillSource(m) {
    if (!m.ok) { srcName(m.id, m.site, esc(t("src_fail"))); srcRow(m.id, [NA, NA, NA, NA], "fail"); return; }
    const d = m.d, extra = (d.extra || []).map(([k, v]) => `${esc(t(k))} ${esc(v)}`);
    if (!d.cc && d.org && !d.regCc && !d.asCc) extra.unshift(esc((d.asn ? "AS" + d.asn + " " : "") + d.org));
    if (d.regCc) extra.unshift(esc(t("x_reg", { c: country(d.regCc) })) + (d.rir ? " · " + esc(d.rir) : ""));
    if (d.asCc) extra.unshift(esc(t("x_as_cc", { c: country(d.asCc) })));
    if (d.ports) extra.push(d.ports.length ? esc(t("x_ports")) + " " + esc(d.ports.slice(0, 10).join(", ")) : esc(t("x_no_ports")));
    if (d.tags && d.tags.length) extra.push(esc(d.tags.join(", ")));
    srcName(m.id, m.site, extra.join(" · "));
    const loc = d.cc ? `${flag(d.cc)} ${esc(d.cc)}` : NA;
    srcRow(m.id, [loc, d.type ? esc(typeName(d.type)) : NA, flagsOf(d), bar(d.risk)]);
  }

  // the blocklists: one row, counting as they answer; the lists that carry the address are named and linked
  const BL = { of: 0, done: 0, hits: [] };
  function blRow(final) {
    const hits = BL.hits.map(b => `<a class="ft bad" href="${esc(b.site)}" target="_blank" rel="noopener noreferrer">${esc(b.name)}</a>`).join("");
    const cell = !BL.of ? `<span class="m">${esc(t("bl_v6"))}</span>`
      : hits || (final || BL.done === BL.of ? `<span class="no">${esc(t("bl_clean"))}</span>` : `<span class="m num">${BL.done}/${BL.of}</span>`);
    srcRow("dnsbl", [NA, NA, cell, NA], BL.of ? "" : "fail");
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
    for (const id in rows) { rows[id].hidden = false; srcName(id, null, ""); srcRow(id, [SK, SK, SK, SK]); }
    $("#srcN").textContent = ""; $("#srcFoot").innerHTML = "&nbsp;";
    $$(".chip").forEach(c => c.setAttribute("aria-pressed", c.dataset.ip === ip));
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

  let CUR = null, keyless = 0;
  function handle(m) {
    if (m.t === "start") {
      CUR = m;
      const dd = $("#facts dd"); dd.className = "ipv"; dd.innerHTML = `${esc(m.ip)} <span class="m">IPv${m.v}</span>`;
      // sources this check can't use leave the table before any answer arrives; the ones needing keys get a footnote
      for (const id in m.skip) if (rows[id]) rows[id].hidden = true;
      keyless = Object.values(m.skip).filter(w => w === "key").length;
      BL.of = m.bl.length; BL.done = 0; BL.hits = [];
      blRow(false);
      total = Object.keys(rows).length - 1 - Object.keys(m.skip).length + m.bl.length;
      if (m.self) { selfIp = m.ip; noteMine(m.ip, m.v); }
      progress();
    } else if (m.t === "src") { fillSource(m); got++; progress(); }
    else if (m.t === "bl") {
      BL.done++; if (m.listed === true) BL.hits.push(m);
      blRow(false); got++; progress();
    } else if (m.t === "done") finish(m);
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
    const ok = Object.keys(rows).filter(id => !rows[id].hidden && rows[id].className === "" && id !== "dnsbl").length;
    $("#srcN").textContent = t("src_n", { ok, at: new Date(r.at).toLocaleString(LANG) }) + (r.cached ? " · " + t("cached") : "");
    $("#srcFoot").innerHTML = (keyless ? esc(t("skip_n", { n: keyless })) + " " : "") +
      `${esc(t("more_l"))} ` + r.elsewhere.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a>`).join(" · ");
  }

  /* ---------- the visitor's own addresses: the one the check sees, plus the other family ---------- */
  const mine = { 4: null, 6: null };
  function chip(f) {
    const c = $("#m" + f), ip = mine[f];
    c.classList.remove("sk");
    if (ip) { c.disabled = false; c.dataset.ip = ip; c.querySelector("b").textContent = ip; c.classList.remove("none"); c.setAttribute("aria-pressed", CUR && CUR.ip === ip); }
    else { c.disabled = true; c.querySelector("b").textContent = t("none"); c.classList.add("none"); }
  }
  function noteMine(ip, f) { if (!mine[f]) { mine[f] = ip; chip(f); } }
  // the address the check itself sees stays out of the URL (a shared link then checks whoever opens it)
  let selfIp = null;
  $$(".chip").forEach(c => { c.onclick = () => { if (c.dataset.ip) { input.value = ""; run(c.dataset.ip === selfIp ? null : c.dataset.ip, true); } }; });
  const getJ = (u, ms = 5000) => fetch(u, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(ms) }).then(r => r.ok ? r.json() : Promise.reject());
  const firstIp = (urls, f) => Promise.any(urls.map(([u, k]) => getJ(u).then(j => family(j[k]) === f ? canon(j[k]) : Promise.reject())));
  const FAM = {
    4: [["https://ipv4-check-perf.radar.cloudflare.com/", "ip_address"], ["https://api4.ipify.org/?format=json", "ip"]],
    6: [["https://ipv6-check-perf.radar.cloudflare.com/", "ip_address"], ["https://api6.ipify.org/?format=json", "ip"]],
  };
  for (const f of [4, 6]) firstIp(FAM[f], f).then(ip => { if (!mine[f]) { mine[f] = ip; } chip(f); }, () => chip(f));

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
