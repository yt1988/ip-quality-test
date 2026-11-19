#!/usr/bin/env node
// A small, dependency-free MCP server for the public IP quality API. It speaks newline-delimited JSON-RPC over stdio
// and only calls the public HTTP endpoints, so it needs no key and no account.
//
//   node mcp/index.mjs
//
// See mcp/README.md for the tool list and the Claude Desktop / Claude Code configuration.

const BASE = (process.env.IPQS_API || "https://ipqs.1ms.dog").replace(/\/+$/, "");
const VERSION = "1.0.0";

const TOOLS = [
  {
    name: "check_ip",
    description: "Check one IPv4/IPv6 address or hostname: score, grade, network type, native/broadcast, risk flags, blocklists, and what the IP layer says about AI, streaming, sign-ups, CAPTCHA and mail.",
    inputSchema: { type: "object", properties: { ip: { type: "string", description: "IPv4, IPv6 or hostname" } }, required: ["ip"] },
  },
  {
    name: "check_self",
    description: "Check the address this MCP server connects from (not the end user's address). Useful on a VPS or behind a fixed egress.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "explain_score",
    description: "The deduction ledger for one address: every part, its points and parameters, the notes, uses and confidence. Use this when the user asks why the score is what it is.",
    inputSchema: { type: "object", properties: { ip: { type: "string", description: "IPv4, IPv6 or hostname" } }, required: ["ip"] },
  },
  {
    name: "resolve_host",
    description: "Resolve a hostname to its first public address (Cloudflare DoH, A then AAAA), without checking its quality.",
    inputSchema: { type: "object", properties: { host: { type: "string", description: "Hostname" } }, required: ["host"] },
  },
  {
    name: "batch_check",
    description: "Check up to 20 addresses and return a compact table. Fresh lookups share the public API's limit of 20 a minute per caller.",
    inputSchema: { type: "object", properties: { ips: { type: "array", items: { type: "string" }, maxItems: 20, description: "IPv4, IPv6 or hostnames" } }, required: ["ips"] },
  },
];

const send = obj => process.stdout.write(JSON.stringify(obj) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, message, code = -32603) => send({ jsonrpc: "2.0", id, error: { code, message: String(message) } });

async function api(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${path}`);
  return r.json();
}

// what an agent needs, not every field: the API's full document is one request away at `api`
function compact(d) {
  const s = d.summary || {};
  return {
    ip: d.ip,
    score: d.score,
    grade: d.grade,
    as_of: d.at,
    cached: !!d.cached,
    summary: {
      country: s.cc, city: s.city, asn: s.asn, org: s.org, type: s.type, native: s.native, risk: s.risk,
      flags: s.flags, dnsbl: s.dnsbl, lists: s.lists, route: s.route, ptr: s.ptr,
    },
    uses: d.uses,
    confidence: d.confidence,
    parts: d.parts,
    evidence: { sources: Array.isArray(d.sources) ? d.sources.length : Object.keys(d.sources || {}).length, notes: d.notes },
    api: `${BASE}/api/check?ip=${encodeURIComponent(d.ip || "")}&format=json`,
  };
}

async function call(name, args = {}) {
  if (name === "check_ip") return compact(await api("/api/check", { ip: args.ip, format: "json" }));
  if (name === "check_self") return compact(await api("/api/check", { format: "json" }));
  if (name === "explain_score") {
    const d = await api("/api/check", { ip: args.ip, format: "json" });
    return { ...compact(d), summary: d.summary, notes: d.notes, uses: d.uses, confidence: d.confidence, parts: d.parts };
  }
  if (name === "resolve_host") return api("/api/resolve", { host: args.host });
  if (name === "batch_check") {
    const ips = [...new Set((args.ips || []).filter(x => typeof x === "string" && x.trim()).map(x => x.trim()))].slice(0, 20);
    if (!ips.length) throw new Error("ips is empty");
    const rows = [];
    for (let i = 0; i < ips.length; i += 4) {
      const part = await Promise.all(ips.slice(i, i + 4).map(async ip => {
        try { return compact(await api("/api/check", { ip, format: "json" })); }
        catch (e) { return { ip, error: String(e.message || e) }; }
      }));
      rows.push(...part);
    }
    return { count: rows.length, rows };
  }
  throw new Error(`unknown tool: ${name}`);
}

async function handle(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "ipqs", version: VERSION } });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params && params.name, args = (params && params.arguments) || {};
    try {
      const out = await call(name, args);
      return reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], isError: false });
    } catch (e) {
      return reply(id, { content: [{ type: "text", text: String(e.message || e) }], isError: true });
    }
  }
  if (id != null) fail(id, `method not found: ${method}`, -32601);
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); continue; }
    handle(msg).catch(e => { if (msg && msg.id != null) fail(msg.id, e.message || e); });
  }
});

process.stdin.on("end", () => process.exit(0));
