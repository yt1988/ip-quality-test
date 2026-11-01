# IPQS

**English** · [简体中文](README.zh-CN.md)

How clean is your IP? [IPQS](https://ipqs.1ms.dog) asks a dozen IP intelligence sources and 8 DNS blocklists about an address at once, shows each answer as it arrives, then turns them into one 0–100 score with a verdict for everyday uses.

**Live:** https://ipqs.1ms.dog

## What it tells you

- **A score and grade (A–F)**, with the breakdown: every point taken off and why.
- **Residential, mobile or data center**, by how many sources agree.
- **Native or broadcast IP**: the regional registry's country (RDAP) against where the databases place the address.
- **VPN, proxy and Tor flags**, counted per source, plus the Tor Project's own exit list.
- **Fraud and abuse scores** from the sources that have them, averaged with weights.
- **Mail blocklists** (SpamCop, Barracuda, PSBL, Mailspike, UCEPROTECT, GBUdb, blocklist.de, Anonmails).
- **What it means** for streaming, AI services (including the regions OpenAI and Anthropic don't serve), CAPTCHAs on Google and Cloudflare, sign-ups and payments, and sending mail.
- **Sharing**: an image card (grade and score first; address, city and network only if you switch them on) and a link that opens the same result, with the grade in its link preview. Both are made in your browser.
- **Every source's own answer**, linked to its page so you can check it there, and links to look the address up elsewhere (Scamalytics, Spur, ping0…).

Your own IPv4 and IPv6 are both found (the IPv4-only and IPv6-only hosts are asked from your browser), and any public address can be checked: `https://ipqs.1ms.dog/?ip=8.8.8.8`.

## Sources

| Source | Needs a key | What it adds |
|---|---|---|
| Cloudflare | – | what Cloudflare's edge sees (your own address only) |
| ip-api.com | – | proxy, hosting, mobile, reverse DNS |
| IPQuery | – | proxy, VPN, Tor, data center, risk |
| ipapi.is | optional `IPAPI_IS_KEY` | network; with a key, VPN/proxy/abuser flags and network abuse level |
| IPinfo | optional `IPINFO_TOKEN` | location, network, anycast (asked from the browser without a token) |
| ipwho.is | – | location, network (asked from the browser) |
| IP.SB | – | location, network |
| iplocation.net | – | location, ISP |
| GeoJS | – | location, network |
| RDAP (RIR) | – | registration country, net name, range |
| ip.guide | – | the network's registered country and RIR |
| Shodan InternetDB | – | open ports, tags such as `vpn`, `proxy`, `tor` (IPv4) |
| Tor Project | – | exit list (IPv4) |
| IPQualityScore | `IPQS_KEY` | fraud score, proxy, VPN, Tor, recent abuse |
| AbuseIPDB | `ABUSEIPDB_KEY` | abuse confidence, reports, usage type |
| Scamalytics | `SCAMALYTICS_USER`, `SCAMALYTICS_KEY` | fraud score |
| ipdata | `IPDATA_KEY` | threat flags and score |
| proxycheck.io | `PROXYCHECK_KEY` | proxy, VPN, Tor, network type, risk 0–100, operator |
| IP2Location | `IP2LOCATION_KEY` | proxy |

Sources without their keys are left out. All the keyed ones have free plans; proxycheck.io and IP2Location answer without a key too, but not to Cloudflare's shared addresses. Sources that limit those addresses are asked from the visitor's browser instead, and a source the server got no answer from is asked again from the browser when it allows that (CORS). Spamhaus and SORBS aren't in the blocklists: they refuse queries that come through public DNS resolvers.

## How the score works

Every address starts at 100. Points come off for what the sources find: up to 20 for a data-center network (the full 20 when most sources say so, so a clean server address tops out at B), 20 for proxy and 15 for VPN flags, 40 for Tor, 10 for abuse reports, up to 35 for the weighted average fraud score, and 6 per mail blocklist (at most 24). Flags count by the share of sources that agree. Grades: A 85+, B 70+, C 50+, D 30+, F below.

The logic is in [`src/score.mjs`](src/score.mjs) and has unit tests.

## API

```
GET /api/check            your own address
GET /api/check?ip=<addr>  any public IPv4 or IPv6 address
```

The answer is NDJSON: a `start` line listing the rows, one `src` line per source and one `bl` line per blocklist as they answer, then a `done` line with `score`, `grade`, `parts`, `notes`, `uses` and `summary`. Answers are cached for six hours per address. Fresh lookups are limited to 20 a minute per visitor.

Shared results live at `/r/<code>` (or `/<lang>/r/<code>`): the code is the answers, deflated and base64url-encoded, behind a format number (`src/share.mjs`). The Worker puts the grade and score into that page's link preview.

## Self-hosting

```bash
git clone https://github.com/yt1988/ip-quality-test
cd ip-quality-test
npx wrangler login
npx wrangler deploy
```

It's one Worker: the pages are static assets (free, unmetered), and `src/worker.js` answers `/api/check`. `wrangler.toml` turns off `*.workers.dev` and preview URLs; bind your own domain under **Workers & Pages → ipqs → Settings → Domains & Routes**, or set `workers_dev = true` for a quick test. Add keys with `npx wrangler secret put IPQS_KEY` and so on.

To put your own domain into canonical tags and the sitemap, rebuild with `SITE_URL`:

```bash
npm install
SITE_URL=https://ip.example.com node scripts/build.mjs
```

On 1ms.dog the page also gets the site's shared top bar, analytics and theme/language sync.

## Development

```bash
npm install
npm run dev        # wrangler dev on http://localhost:8792 (your own address isn't known locally: use ?ip=)
npm run build      # regenerate public/ after changing src/ (commit public/)
npm test           # public/ up to date, page contract, the scoring, sharing and IP parsing tests
npm run og         # redraw the link-preview images in public/og/ (after changing the headline or grade texts)
```

On 1ms.dog, every push to `main` deploys automatically (Cloudflare Workers Builds runs `npm ci && npm test` first).

## License

MIT
