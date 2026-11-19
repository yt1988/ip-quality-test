# IPQS MCP server

A small, dependency-free [Model Context Protocol](https://modelcontextprotocol.io/) server for the public IP quality
API. It speaks newline-delimited JSON-RPC over stdio, needs no key or account, and only calls this site's public HTTP
endpoints.

## Run it

Node 20+:

```bash
node mcp/index.mjs
```

Set `IPQS_API` to use another deployment (default `https://ipqs.1ms.dog`).

## Claude Desktop / Claude Code

Add it to the MCP configuration:

```json
{
  "mcpServers": {
    "ipqs": {
      "command": "node",
      "args": ["/absolute/path/to/ip-quality-test/mcp/index.mjs"]
    }
  }
}
```

In Claude Code: `claude mcp add ipqs -- node /absolute/path/to/ip-quality-test/mcp/index.mjs`.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `check_ip` | `ip` (IPv4, IPv6 or hostname) | score, grade, country/city, ASN/org, type, native/broadcast, risk flags, DNSBL, public lists, routing, reverse DNS, uses, confidence, deduction parts, API link |
| `check_self` | – | the same for the address **this server** connects from (not the end user's address) |
| `explain_score` | `ip` | the deduction ledger, notes, uses and confidence for one address |
| `resolve_host` | `host` | the first public address a hostname resolves to |
| `batch_check` | `ips` (up to 20) | one compact result per address; per-row errors stay in the row |

## Rate limits and privacy

- A fresh lookup is limited to **20 a minute per caller** on the public API; a cached answer (six hours per address)
  does not count.
- The API sends the address to the public sources listed on the site. Results are cached six hours per address; the
  site does not record the visitor's IP, and this server adds no logging.
- `check_self` is the egress of the machine running the server. On a laptop that is the visitor's own connection; on a
  VPS it is that VPS.

## Development

There are no dependencies. `node mcp/index.mjs` is the whole server; `test/mcp.test.mjs` covers the JSON-RPC framing
and the compact output.
