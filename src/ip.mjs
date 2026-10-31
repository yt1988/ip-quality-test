// IP address helpers shared by the Worker, the page and the tests. No dependencies.

// "1.2.3.4" → 4, "2001:db8::1" → 6, anything else → 0. Accepts only canonical-looking text (no ports, no zones).
export function family(s) {
  s = String(s || "").trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.split(".").every(o => +o <= 255 && (o === "0" || o[0] !== "0")) ? 4 : 0;
  return v6words(s) ? 6 : 0;
}

// The eight 16-bit words of an IPv6 address, or null when it isn't one (an embedded IPv4 tail is allowed).
export function v6words(s) {
  s = String(s || "").trim().toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(":") || s.length > 45) return null;
  let tail = [];
  const m = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (m) {
    if (family(m[2]) !== 4) return null;
    const o = m[2].split(".").map(Number);
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    s = m[1].endsWith("::") ? m[1] : m[1].slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = h => h === "" ? [] : h.split(":");
  const a = part(halves[0]), b = halves.length === 2 ? part(halves[1]) : [];
  if ([...a, ...b].some(w => !/^[0-9a-f]{1,4}$/.test(w))) return null;
  const fill = 8 - tail.length - a.length - b.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  return [...a, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...b].map(w => parseInt(w, 16)).concat(tail);
}

// Short canonical form (RFC 5952): lower case, longest run of zero words as "::". IPv4 is returned as is.
export function canon(s) {
  const f = family(s);
  if (f === 4) return String(s).trim();
  if (f !== 6) return "";
  const w = v6words(s);
  let best = -1, len = 0;
  for (let i = 0; i < 8;) {
    if (w[i]) { i++; continue; }
    let j = i; while (j < 8 && !w[j]) j++;
    if (j - i > len && j - i > 1) { best = i; len = j - i; }
    i = j;
  }
  const hex = w.map(x => x.toString(16));
  if (best < 0) return hex.join(":");
  return hex.slice(0, best).join(":") + "::" + hex.slice(best + len).join(":");
}

// Addresses no lookup service can say anything about: private, loopback, link-local, CGNAT, documentation, multicast…
export function isPublic(s) {
  const f = family(s);
  if (f === 4) {
    const [a, b, c] = s.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (f === 6) {
    const w = v6words(s);
    if ((w[0] & 0xe000) !== 0x2000) return false;            // only global unicast 2000::/3
    if (w[0] === 0x2001 && w[1] === 0xdb8) return false;     // documentation
    if (w[0] === 0x2001 && w[1] < 0x200) return false;       // Teredo, benchmarking, ORCHID…
    if (w[0] === 0x2002) return false;                       // 6to4: the real address is the IPv4 inside
    return true;
  }
  return false;
}

// The name a DNS blocklist is asked about: 1.2.3.4 → 4.3.2.1, IPv6 → its 32 nibbles reversed.
export function reverse(s) {
  const f = family(s);
  if (f === 4) return s.split(".").reverse().join(".");
  if (f === 6) return v6words(s).map(w => w.toString(16).padStart(4, "0")).join("").split("").reverse().join(".");
  return "";
}
