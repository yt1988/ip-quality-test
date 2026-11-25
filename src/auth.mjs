// The page's short-lived endpoint token (docs/tool-contract.md "端点鉴权"): the shell writes it into
// <meta name="ms-auth">, and the page sends it to the deployment's own measurement endpoints only. A 401 means the
// five-minute token has aged out while the tab sat open: ask /_ms/token once, use the new one for one retry, then
// leave the answer unavailable. No meta at all means this is a self-hosted copy with no such endpoints.

// Which URLs carry the token: the seg service, the DNS API and its random-name zone, and the two anchors.
export function authTargets({ seg = "", dns = "", anchors = [] } = {}) {
  const hosts = new Set();
  const add = u => {
    try { const x = new URL(u); if (x.host) hosts.add(x.host); } catch (e) {}
  };
  if (seg) add(seg);
  if (dns) add(dns);
  for (const a of anchors) if (a) add(a);
  let zone = "", port = "";
  try { const x = new URL(dns); zone = x.hostname.replace(/^api\./, ""); port = x.port; } catch (e) {}
  return { hosts, zone, port };
}

export function needsAuth(url, targets) {
  if (!targets) return false;
  try {
    const x = new URL(url, "https://placeholder.invalid");
    if (targets.hosts.has(x.host)) return true;
    // the DNS random names are <token>-a.<zone>:<port>, a different host from the result API
    return !!targets.zone && x.hostname.endsWith("." + targets.zone) && (!targets.port || x.port === targets.port);
  } catch (e) { return false; }
}

// fetch with the token; on 401 refresh once and retry once. token()/refresh() are injected so a test can count calls.
export async function authFetch(url, init = {}, { token = () => "", refresh = async () => "", targets, fetchImpl = fetch } = {}) {
  const send = t => {
    const headers = new Headers(init.headers || {});
    if (t && needsAuth(url, targets)) headers.set("Authorization", "Bearer " + t);
    return fetchImpl(url, { ...init, headers });
  };
  let res = await send(token());
  if (res.status === 401 && needsAuth(url, targets)) {
    const t = await refresh();
    if (t) res = await send(t);
  }
  return res;
}
