// What the 1ms.dog "report a problem" dialog asks the page for (1ms-shell docs/tool-contract.md, section 4): one line
// saying what was checked and what it said, the JSON the score was made from, and the readings a visitor most often
// says are wrong. The page passes its own translator (window.L1MS), its country names and the result it drew; the
// address is masked to its network and nothing a shared link hides by default (the city, the network's name, the
// reverse DNS name, the registry record) is included. Limits are the dialog's: 300 characters for the line, 6 KB for
// the JSON (over it the dialog sends the line alone), 8 short readings of 60 characters.
import { pack } from "./share.mjs";
import { family, isPublic, v6words } from "./ip.mjs";

export const MAX_SUMMARY = 300, MAX_DATA = 6000, MAX_PICKS = 8, MAX_PICK = 60;

// An address no deeper than its network: IPv4 → "95.216.1.x/24" (the page already draws all 256 of that /24),
// IPv6 → "2001:db8:1:2::/64". Anything else, private and loopback included (the check refuses those) → "".
export function maskIp(ip) {
  if (!isPublic(ip)) return "";
  const f = family(ip);
  if (f === 4) return ip.split(".").slice(0, 3).join(".") + ".x/24";
  if (f === 6) return v6words(ip).slice(0, 4).map(w => w.toString(16)).join(":") + "::/64";
  return "";
}

// snap: the result the page drew ({ at, v, ip, res, fails, skip, bl, cf, r }); lang: the page's language; t: the
// page's translator; country(cc): a country's name in that language. No result yet → null (the dialog then lists only
// what the page itself tells about the browser).
export function reportOf({ snap, lang, t, country }) {
  if (!snap || !snap.r) return null;
  const r = snap.r, s = r.summary || {}, F = s.flags || {}, ccs = s.ccs || [];
  const hits = (snap.bl || []).filter(b => b.listed === true);
  // Chinese and Japanese bracket and run sentences together
  const sep = /^(zh|ja)/.test(lang || "") ? "：" : ": ";
  const nil = t("q_nodata");
  // the readings below are the page's own words for what it drew, so the lines read as the visitor's screen does
  const geo = !ccs.length ? nil : ccs.length === 1 ? country(ccs[0].cc) : ccs.map(c => country(c.cc)).join(t("v_join"));
  const type = s.type ? t("t_" + s.type) : nil;
  const native = s.native == null ? nil : t(s.native ? "fs_native" : "fs_broadcast") + (s.regCc ? " · " + country(s.regCc) : "");
  const flagged = !!((F.vpn && F.vpn.yes) || (F.proxy && F.proxy.yes));
  const anon = !(F.vpn && F.vpn.of) && !(F.proxy && F.proxy.of) ? nil
    : flagged ? [F.vpn && F.vpn.yes ? "VPN " + F.vpn.yes + "/" + F.vpn.of : "",
      F.proxy && F.proxy.yes ? t("tag_proxy") + " " + F.proxy.yes + "/" + F.proxy.of : ""].filter(Boolean).join(" · ")
    : t("fs_clean");
  const risk = typeof s.risk === "number" ? String(s.risk) : nil;
  const dnsbl = !s.dnsbl || !s.dnsbl.checked ? nil : hits.length ? t("fs_listed", { n: hits.length, of: s.dnsbl.checked }) : t("bl_clean");
  const use = u => t("lv_" + ((r.uses && r.uses[u] && r.uses[u].lv) || "warn"));

  // what a visitor most often says was read wrong: where it is, the network type, whether it is native, flags, its
  // reputation, the blocklists, then the two verdicts used most (streaming, AI services)
  const picks = [
    [t("r_loc"), geo], [t("fl_type"), type], [t("fl_native"), native], [t("fl_anon"), anon],
    [t("fl_risk"), risk], [t("fl_dnsbl"), dnsbl], [t("fl_stream"), use("stream")], [t("fl_ai"), use("ai")],
  ].slice(0, MAX_PICKS).map(([k, v]) => (k + sep + v).slice(0, MAX_PICK));

  // the line the dialog shows as "this result": the tool, the address's network, the score, and the findings that
  // decide what the address is good for
  const summary = [t("app_name"), maskIp(snap.ip) || t("r_hidden"), r.score + "/100", t("grade", { g: r.grade }), t("g_" + r.grade),
    t("r_loc") + sep + geo, t("fl_type") + sep + type, s.dnsbl && s.dnsbl.checked ? t("fl_dnsbl") + sep + dnsbl : ""]
    .filter(Boolean).join(" · ").slice(0, MAX_SUMMARY);

  // the JSON, as a shared link without the address carries it: the answers the score was read from (src/score.mjs
  // scores them the same way again), how the points came off, and the verdicts by use
  const data = {
    v: 1, lang: lang || "", at: new Date(snap.at || Date.now()).toISOString(),
    ip: maskIp(snap.ip) || null, fam: snap.v,
    score: r.score, grade: r.grade,
    parts: (r.parts || []).map(p => ({ k: p.k, pts: p.pts, p: p.p || {} })),
    uses: Object.fromEntries(Object.entries(r.uses || {}).map(([u, x]) => [u, { lv: x.lv, why: x.why }])),
    src: pack({ ...snap, details: false }),
  };
  if (snap.cf) data.cf = snap.cf;
  return { summary, data, picks };
}
