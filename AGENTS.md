# AGENTS.md

For anyone, person or AI agent, picking up this repository: what the project is, how to run and test it, and how to
deploy it, including the one server-side piece that doesn't run on Cloudflare. Technical design reasons and measured
results are in [docs/decisions.md](docs/decisions.md). 1ms.dog's own operating notes (how it is deployed there, its
accounts, its product decisions) are in the private repository 1ms-shell; nothing here depends on reading them.

## What it is

IPQS checks an IP address against a dozen IP intelligence sources and eight DNS blocklists and turns their answers
into one 0–100 score, with what it means for streaming, AI services, CAPTCHAs, sign-ups and mail.

| Part | Where | What |
|---|---|---|
| Pages | `src/page.html`, `src/batch.html` → `public/` | the check (`/`, `/<lang>/`) and the batch page (`/batch/`), 10 languages, built by `scripts/build.mjs` |
| Page code | `src/app.js`, `src/batch.js` (+ the pure `src/*.mjs` they share with the tests) | bundled by esbuild into `public/assets/` |
| Worker | `src/worker.js` | `GET /api/check` (NDJSON stream: one line per source, then the score), shared-result previews, Turnstile |
| Sources | `src/sources.mjs` | each source's request and how its answer is read; `browser: "only" / "retry"` marks the ones the page asks itself |
| Score | `src/score.mjs` | deductions, grade, notes and the five uses; the same code runs in the Worker and the page |
| Strings | `src/i18n/*.mjs` | every language has every key (the build fails otherwise) |
| /24 portrait service | `server/` (Go) | a small HTTPS API on a Linux server, not on Cloudflare: see [server/README.md](server/README.md) and "The /24 portrait service" below |

## Run it locally

Node 20+ and npm.

```bash
npm install
npm run dev        # wrangler dev on http://localhost:8792
```

Your own address isn't known locally: use `?ip=8.8.8.8`. The /24 portrait card reads the service at the address
built in as `SEG` (`scripts/build.mjs`; `SEG_API=<url> npm run build` to point it at another one, empty to hide the
card). The connection cells (DNS resolver, TCP handshake) read services that a fork may not have; they stay hidden
when those don't answer.

The batch page can be tried without wrangler: serve `public/` with any static server and forward `/api/check` to a
running deployment.

## Test: pick by what changed

`public/` is generated and committed. After any change under `src/` or `scripts/`, run `npm run build` and commit
`public/` with it; `npm test` fails while `public/` is out of date.

| Change | Run |
|---|---|
| Strings, page markup, styles, page code (`src/*.html`, `src/style.css`, `src/app.js`, `src/batch.js`, `src/i18n/`) | `npm run build && npm test`, then open the page (dev server or static) and look at it in light and dark, desktop and 390 px wide |
| Scoring, sources, sharing, IP parsing, the report dialog's data (`src/score.mjs`, `src/sources.mjs`, `src/share.mjs`, `src/ip.mjs`, `src/batch.mjs`, `src/seg.mjs`, `src/report.mjs`) | `npm run build && npm test`, and a few real addresses through `npm run dev` with `?ip=` |
| Worker (`src/worker.js`, `wrangler.toml`) | `npm test`, then `npm run dev` and `curl -N "http://localhost:8792/api/check?ip=8.8.8.8"` |
| Headline or grade texts | `npm run og` to redraw the link-preview images in `public/og/` |
| Go service (`server/`) | `cd server && go test ./...` |

The tests (`test/*.test.mjs`, Node's built-in runner) cover the page contract, scoring, sharing, IP parsing, the
batch page's parsing and links, the connection and /24 readers, and that every language has every string.

## Deploy the pages and the Worker

```bash
npx wrangler deploy
```

Or connect the repository to Cloudflare Workers Builds so every push to `main` deploys; have it run
`npm ci && npm test` first, so a red test stops the deploy. The page's bundle name (`assets/app.<hash>.js`,
`assets/batch.<hash>.js`) tells which build a page is. Domains, `SITE_URL` and the rest: "Self-hosting" in
[README.md](README.md).

Worker secrets (set with `npx wrangler secret put <NAME>`): `TURNSTILE_SITEKEY` and `TURNSTILE_SECRET` (the
human-check test; without them it stays hidden), and the optional source keys listed in `wrangler.toml`
(`IPQS_KEY`, `ABUSEIPDB_KEY`, `SCAMALYTICS_USER` + `SCAMALYTICS_KEY`, `IPDATA_KEY`, `PROXYCHECK_KEY`, `IPAPI_IS_KEY`,
`IP2LOCATION_KEY`, `IPINFO_TOKEN`); a source without its key is left out. Bindings in `wrangler.toml`: `ASSETS`, the
rate limit `LIMIT` (20 fresh lookups per visitor address a minute).

## The /24 portrait service

`server/` is a Go HTTPS server answering `GET /v1/seg?ip=…` for the page's /24 portrait and the batch page's range
comparison: reverse DNS for the 256 addresses, the announced prefix, and a daily index of public lists (API and
behaviour in [server/README.md](server/README.md)). Two systemd units come with it: the API, and a daily job that
fetches the lists. The unit files in `server/` carry 1ms.dog's paths and port; adjust them to yours. On a Linux
server (amd64), as root:

1. **Get the binary.** Every change to `server/` on `main` is built by GitHub Actions
   (`.github/workflows/server-release.yml`) into a static linux/amd64 binary and published as a release tagged
   `server-<short commit>`, the newest marked latest, with `SHA256SUMS`. Download and check it:
   ```bash
   cd /tmp
   curl -fLO https://github.com/yt1988/ip-quality-test/releases/latest/download/ipqs-seg-linux-amd64
   curl -fLO https://github.com/yt1988/ip-quality-test/releases/latest/download/SHA256SUMS
   sha256sum -c SHA256SUMS      # ipqs-seg-linux-amd64: OK
   ```
   A specific build: `releases/download/server-<short commit>/…` instead of `releases/latest/download/…`. Or build
   it yourself on any machine with Go:
   ```bash
   cd server && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ipqs-seg-linux-amd64 .
   ```
2. **A system user and directories**, for example:
   ```bash
   useradd --system --no-create-home --shell /usr/sbin/nologin <user>
   install -d -m 755 /opt/<app>
   install -d -m 700 /etc/<app>
   ```
   The data directory comes from the unit's `StateDirectory`.
3. **Install** the binary as `/opt/<app>/seg` (`install -m 755 ipqs-seg-linux-amd64 /opt/<app>/seg`) and the unit
   files in `/etc/systemd/system/`,
   with `User=`, the paths, `-addr :<port>` and the certificate paths set to yours.
4. **DNS and firewall**: `<your-domain>` A/AAAA to the server, not proxied by a CDN unless it passes `<port>`; open
   TCP `<port>`.
5. **Certificate** for `<your-domain>` (certbot or any ACME client). The unit passes the files in as systemd
   credentials (`LoadCredential=`), so the service user never reads the certificate directory; make renewal restart
   the API service.
6. **IP2Proxy token** (optional): the download token of a free ip2location.com account, for the IP2Proxy PX1 LITE
   list, in a root-only file (mode 600) that the update unit loads as the credential `ip2proxy`; or set
   `IP2PROXY_TOKEN`. Without it the open-proxy list is skipped and the page says so.
7. **Start**: `systemctl daemon-reload`, run the update unit once (the first fetch takes a few minutes), then
   `systemctl enable --now` the API service and the update timer.
8. **Verify**: `curl -s https://<your-domain>:<port>/healthz` answers `{"ok":true,"lists":true}`;
   `/v1/seg?ip=95.216.1.2` has `"lists":{…,"at":"…"}`; the update unit's journal shows one line per list. Then build
   the pages with `SEG_API=https://<your-domain>:<port>` and check that the card appears.

To update the binary: download and check the latest release as in step 1, install it next to the old one
(`install -m 755 ipqs-seg-linux-amd64 /opt/<app>/seg.new`), `mv` it over, restart the API service. The cache is in
memory and refills.

The service logs nothing about visitors (no access log, and the HTTP server's own error log is silenced, as it would
name clients); fetch errors are stripped of the URL so the token never reaches the journal. Keep it that way.

## Conventions

- Every visible string is in all 10 `src/i18n/*.mjs` files; Chinese is written for Chinese readers, not translated
  word for word. Taiwan is shown as "中国台湾 / Taiwan, China" with the PRC flag.
- A shared link carries its result in the URL (after `#b=` on the batch page, `/r/<code>` for one address); the
  addresses stay out unless the visitor ticks the box in the share dialog.
- `public/assets/share/` is a verbatim copy of 1ms.dog's shared share dialog: don't edit it here.
- Commit messages say what changed and why, in plain sentences.
