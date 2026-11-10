// Shared results: what the sources said about an address, packed into a link. The page builds the link in the
// visitor's browser; the page opening it re-scores the answers (src/score.mjs) and draws them like a fresh check, and
// the Worker reads the same link to put the grade into the link preview.
//
// Link: <language page>r/<format>.<the JSON, through 1ms.dog's codec>. The format number leads, so a later format can
// change everything after it while links already shared keep opening. Format 2 (since 2026-11-08) is the codec's
// pack(): "z" + deflated, or "u" + plain when the browser making the link can't compress (Chrome before 103, Safari
// before 16.4), so sharing works in every browser. Format 1 links are the bare deflate and read as the codec's
// legacy form. The payload is the same in both:
//   { t: minutes since 1970, f: 4 | 6, i?: address, s: { source id: answer }, x: [sources that failed],
//     k: { source id: why it doesn't apply }, b: { blocklist id: 1 listed | 0 clean | 2 no answer },
//     c?: Cloudflare's human check when it was run: "p" passed without a click | "c" after a click | "f" refused }
// Without the address (the default) the answers keep only what the score and the findings need: the country, network
// type, flags, risk scores, which public lists named it, the routing verdicts and whether the reverse DNS matches its
// name, never the city, network name, prefix, reverse DNS name itself or registry record.
import { DNSBL } from "./sources.mjs";
// 1ms.dog's shared codec, copied byte for byte from 1ms-shell (served as /assets/share/codec.js, where 1ms-shell's
// check compares it); the page's bundle and the Worker both build from this one file
import { pack as packText, unpack as unpackText, CodecError } from "../public/assets/share/codec.js";
export { CodecError };

export const FORMAT = 2;
// What a link without the address keeps: the score reads these (the lists' findings, the RPKI verdict, whether the
// reverse DNS name matches), and none of them names the address or its prefix
const KEEP = ["cc", "regCc", "asCc", "rir", "type", "tor", "vpn", "proxy", "abuser", "relay", "risk", "anycast", "ports", "tags",
  "lists", "announced", "rpki", "fcrdns"];
const BL = { 1: true, 0: false, 2: null };
// Cloudflare's human check: the page's words for it and the link's letters
const CF_CODE = { pass: "p", click: "c", fail: "f" };
export const CF_OF = { p: "pass", c: "click", f: "fail" };

// at: when the sources answered (ISO string or ms); res: [{ id, data }]; bl: [{ id, listed }]; fails: [ids];
// skip: { id: reason }
export function pack({ at, v, ip, res, fails = [], skip = {}, bl = [], cf, details = false }) {
  const s = {};
  for (const r of res) {
    const d = {};
    for (const k in r.data) if (details || KEEP.includes(k)) d[k] = r.data[k];
    // the score's mail verdict only asks whether a reverse DNS name exists
    if (!details && r.data.host) d.host = 1;
    s[r.id] = d;
  }
  const P = { t: Math.round(new Date(at).getTime() / 60000), f: v, s };
  if (details && ip) P.i = ip;
  if (fails.length) P.x = fails;
  if (Object.keys(skip).length) P.k = skip;
  if (bl.length) P.b = Object.fromEntries(bl.map(b => [b.id, b.listed === true ? 1 : b.listed === false ? 0 : 2]));
  if (CF_CODE[cf]) P.c = CF_CODE[cf];
  return P;
}

// the answers in the form src/score.mjs takes them, blocklists with their names and pages
export function unpackResults(P) {
  const res = Object.entries(P.s).map(([id, data]) => ({ id, data }));
  const bl = Object.entries(P.b || {}).map(([id, n]) => {
    const def = DNSBL.find(d => d.id === id);
    return def ? { id, name: def.name, site: P.i ? def.site(P.i) : "", listed: BL[n] } : null;
  }).filter(Boolean);
  return { res, bl };
}

export const encode = async P => FORMAT + "." + await packText(JSON.stringify(P));

// The payload of a link's last path part, or null when it isn't one this code can read. A compressed link this
// browser can't decompress throws CodecError("inflate"): the caller says the browser is too old rather than showing
// nothing (the Worker can always read it).
export async function decode(code) {
  const m = /^(\d+)\.([A-Za-z0-9_-]{8,8000})$/.exec(code || "");
  if (!m || !(+m[1] === 1 || +m[1] === FORMAT)) return null;
  let text;
  try { text = await unpackText(m[2], { legacy: +m[1] === 1 }); }
  catch (e) { if (e instanceof CodecError && e.reason === "inflate") throw e; return null; }
  try {
    const P = JSON.parse(text);
    if (!P || typeof P !== "object" || !P.s || typeof P.s !== "object" || !(P.f === 4 || P.f === 6) || typeof P.t !== "number") return null;
    for (const id in P.s) if (!P.s[id] || typeof P.s[id] !== "object") return null;
    return P;
  } catch (e) { return null; }
}

// where a shared result lives: /r/<code> after a language folder (or at the root for English)
export const SHARE_PATH = /^\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?r\/([^/]+)\/?$/;
