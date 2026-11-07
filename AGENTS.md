# AGENTS.md

For anyone, person or AI agent, picking up this repository. It says what the project is, how to run and test it,
and how it is deployed, including the one server-side piece that doesn't run on Cloudflare. Design decisions and
plans are in [docs/decisions.md](docs/decisions.md). The operating notes for 1ms.dog as a whole (accounts, the other
tools, the VPS's global setup) are in the private repository 1ms-shell; nothing here depends on reading them.

## What it is

IPQS (https://ipqs.1ms.dog) checks an IP address against a dozen IP intelligence sources and eight DNS blocklists and
turns their answers into one 0–100 score, with what it means for streaming, AI services, CAPTCHAs, sign-ups and mail.

| Part | Where | What |
|---|---|---|
| Pages | `src/page.html`, `src/batch.html` → `public/` | the check (`/`, `/<lang>/`) and the batch page (`/batch/`), 10 languages, built by `scripts/build.mjs` |
| Page code | `src/app.js`, `src/batch.js` (+ the pure `src/*.mjs` they share with the tests) | bundled by esbuild into `public/assets/` |
| Worker | `src/worker.js` | `GET /api/check` (NDJSON stream: one line per source, then the score), shared-result previews, Turnstile, `/api/probe` |
| Sources | `src/sources.mjs` | each source's request and how its answer is read; `browser: "only" / "retry"` marks the ones the page asks itself |
| Score | `src/score.mjs` | deductions, grade, notes and the five uses; the same code runs in the Worker and the page |
| Strings | `src/i18n/*.mjs` | every language has every key (the build fails otherwise) |
| /24 portrait service | `server/` (Go) | runs on a VPS, not on Cloudflare: see [server/README.md](server/README.md) and "The VPS service" below |

## Run it locally

Node 20+ and npm.

```bash
npm install
npm run dev        # wrangler dev on http://localhost:8792
```

Your own address isn't known locally: use `?ip=8.8.8.8`. The /24 portrait card reads the live service at
`seg.1ms.dog`; to point it at a local one, build with `SEG_API=http://127.0.0.1:8447 npm run build` (never commit
that build). The connection cells (DNS resolver, TCP handshake) read other 1ms.dog servers and simply stay hidden
when those don't answer.

The batch page can be tried without wrangler: serve `public/` with any static server and forward `/api/check` to
`https://ipqs.1ms.dog/api/check`.

## Test: pick by what changed

`public/` is generated and committed. After any change under `src/` or `scripts/`, run `npm run build` and commit
`public/` with it; `npm test` fails while `public/` is out of date.

| Change | Run |
|---|---|
| Strings, page markup, styles, page code (`src/*.html`, `src/style.css`, `src/app.js`, `src/batch.js`, `src/i18n/`) | `npm run build && npm test`, then open the page (dev server or static) and look at it in light and dark, desktop and 390 px wide |
| Scoring, sources, sharing, IP parsing (`src/score.mjs`, `src/sources.mjs`, `src/share.mjs`, `src/ip.mjs`, `src/batch.mjs`, `src/seg.mjs`) | `npm run build && npm test`, and a few real addresses through `npm run dev` with `?ip=` |
| Worker (`src/worker.js`, `wrangler.toml`) | `npm test`, then `npm run dev` and `curl -N "http://localhost:8792/api/check?ip=8.8.8.8"` |
| Headline or grade texts | `npm run og` to redraw the link-preview images in `public/og/` |
| Go service (`server/`) | `cd server && go test ./...` |

The tests (`test/*.test.mjs`, Node's built-in runner) cover the page contract, scoring, sharing, IP parsing, the
batch page's parsing and links, the connection and /24 readers, and that every language has every string.

## Deploy

**Pages and Worker.** Every push to `main` is deployed by Cloudflare Workers Builds, which runs `npm ci && npm test`
first: a red test stops the deploy. To deploy by hand, `npx wrangler deploy`. A new build is live within a minute or
two; the page's bundle name (`assets/app.<hash>.js`, `assets/batch.<hash>.js`) tells which build a page is.

Worker secrets (names only; set with `npx wrangler secret put <NAME>`): `TURNSTILE_SITEKEY` and `TURNSTILE_SECRET`
(the human-check test; without them it stays hidden), and the optional source keys listed in `wrangler.toml`
(`IPQS_KEY`, `ABUSEIPDB_KEY`, `SCAMALYTICS_USER` + `SCAMALYTICS_KEY`, `IPDATA_KEY`, `PROXYCHECK_KEY`, `IPAPI_IS_KEY`,
`IP2LOCATION_KEY`, `IPINFO_TOKEN`); a source without its key is left out. Bindings in `wrangler.toml`: `ASSETS`, the
rate limit `LIMIT` (20 fresh lookups per visitor address a minute) and the Analytics Engine dataset `PROBE`.

To self-host on your own domain, see "Self-hosting" in [README.md](README.md).

## The VPS service: 1ms-ipqs and 1ms-ipqs-lists

The /24 portrait card reads `https://seg.1ms.dog:8444/v1/seg?ip=…`, a small Go server (`server/`) on a Debian VPS
(amd64). Two systemd units: `1ms-ipqs.service` (the HTTPS API) and `1ms-ipqs-lists.service` + `.timer` (fetches the
public lists daily at 05:10 UTC into `/var/lib/1ms-ipqs/lists.gob`). The unit files in `server/` are the ones
installed. From zero, as root on the VPS:

1. **Build** (on any machine with Go):
   ```bash
   cd server && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o seg .
   ```
2. **User and directories**:
   ```bash
   useradd --system --no-create-home --shell /usr/sbin/nologin 1ms-ipqs
   install -d -m 755 /opt/1ms/ipqs
   install -d -m 700 /etc/1ms/ipqs
   ```
   `/var/lib/1ms-ipqs` is made by systemd (`StateDirectory`).
3. **Upload** the binary to `/opt/1ms/ipqs/seg` (root-owned, mode 755) and the three unit files to
   `/etc/systemd/system/`.
4. **DNS**: `seg.1ms.dog` A (and AAAA) to the VPS, DNS only, not proxied (Cloudflare doesn't proxy port 8444).
   Open TCP 8444 in the VPS firewall and the provider's.
5. **Certificate** for `seg.1ms.dog` at `/etc/letsencrypt/live/seg.1ms.dog/` (certbot, any challenge that works on
   the VPS). The unit passes it in as systemd credentials, so the service user never reads `/etc/letsencrypt`;
   a renewal must restart `1ms-ipqs` (a certbot deploy hook doing `systemctl restart 1ms-ipqs` for this name).
6. **Secret**: the IP2Proxy LITE download token (a free ip2location.com account; the list is PX1 LITE) in
   `/etc/1ms/ipqs/ip2proxy.token`, root-owned, mode 600, the token alone. It reaches the update job as the systemd
   credential `ip2proxy`. Without it the open-proxy list is skipped and the page says so; everything else works.
7. **Start**:
   ```bash
   systemctl daemon-reload
   systemctl start 1ms-ipqs-lists        # first fetch: a few minutes
   systemctl enable --now 1ms-ipqs 1ms-ipqs-lists.timer
   ```
8. **Verify**:
   ```bash
   curl -s https://seg.1ms.dog:8444/healthz                       # {"ok":true,"lists":true}
   curl -s "https://seg.1ms.dog:8444/v1/seg?ip=95.216.1.2" | head -c 400   # "lists":{"proxy":…,"at":"…"}
   journalctl -u 1ms-ipqs-lists -n 20                              # the last fetch, per list
   systemctl list-timers 1ms-ipqs-lists.timer
   ```
   Then check a page: https://ipqs.1ms.dog/?ip=95.216.1.2 shows the /24 portrait with its lists' date.

**Updating the binary**: build as in step 1, upload as `/opt/1ms/ipqs/seg.new`, then
`mv /opt/1ms/ipqs/seg.new /opt/1ms/ipqs/seg && systemctl restart 1ms-ipqs`. The cache is in memory and refills.

The service logs nothing about visitors (no access log, and the HTTP server's error log is silenced, as it would name
clients); fetch errors are stripped of the URL so the token never appears in the journal. Keep it that way.

## Conventions

- Every visible string is in all 10 `src/i18n/*.mjs` files; Chinese is written for Chinese readers, not translated
  word for word. Taiwan is shown as "中国台湾 / Taiwan, China" with the PRC flag.
- A shared link carries its result in the URL (after `#b=` on the batch page, `/r/<code>` for one address); the
  addresses stay out unless the visitor ticks the box in the share dialog.
- `public/assets/share/` is a verbatim copy of 1ms.dog's shared share dialog: don't edit it here.
- Commit messages say what changed and why, in plain sentences.
