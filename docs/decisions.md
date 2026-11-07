# Decisions

Why IPQS works the way it does, what is being measured or planned, and what was considered and turned down. Newest
first within each section. Dates are when the decision was made.

## Open

### Asking the sources from the browser instead of the Worker (measuring since 2026-11-06)

**Question.** Should the page ask the IP sources itself, from the visitor's browser, instead of the Worker asking
them? From the browser, a source's per-address rate limit falls on each visitor's own address instead of Cloudflare's
shared exits; from the Worker, every visitor gets the same answer, answers are cached 6 hours per address, and the
sources never see who is asking about whom.

**What is known.** Most free sources answer CORS (`Access-Control-Allow-Origin: *`): IPQuery, ipapi.is,
iplocation.net, GeoJS, ip.guide, Shodan InternetDB, RDAP (ARIN), ipwho.is, IP.SB. Some can't be asked from a page:
ip-api.com (free tier is HTTP only), the Tor exit list (no CORS, and a whole list), keyed sources (the key would be
public). Cloudflare's DoH JSON can carry the blocklist queries. In five days of traffic before the measurement,
`/api/check` never answered 429, and a batch of 20 fresh lookups saw the same source failures as single ones.

**Measurement.** `src/probe.mjs`: on one in five of a visitor's own checks, after the result, the page asks ten CORS
sources and one DoH query once more and posts only answered/time per source to `/api/probe`; the Worker records the
same sources on one in twenty fresh lookups. Both go to Analytics Engine (`ipqs_probe`) with the asker's country and
nothing about the address. Read with `npm run probe -- <days>` (needs an API token with Account Analytics: Read).

**When and how to decide.** Around 2026-11-10, with about four days of data:

- Browser success high (about 90 % or more), visitors in mainland China included: **browser first for a visitor's
  own address**. The CORS sources are asked from the page; ip-api, the Tor list, DNSBL and keyed sources stay on the
  Worker. Someone else's address, the batch page and `/api/check` stay on the Worker (privacy and cache).
- Otherwise: keep the Worker first with the browser as retry, and move single sources to `browser: "only"` as they
  start refusing Cloudflare's addresses (as IP.SB was).

Afterwards remove `src/probe.mjs`, its two callers (`src/app.js`, `src/worker.js`), the `PROBE` binding and the
sentence about it in the privacy answer of every language.

### Bulk callers of `/api/check`

The API is public (README, `llms.txt`). Third-party tools call it in bulk, for example a node scanner that checks
each proxy node's exit through the node (one call per node, dozens per scan). Allowed. The per-visitor limit
(`LIMIT`, 20 fresh lookups a minute) doesn't hold back such a caller, since each node is its own address, and none of
the keyed sources are configured, so there is no daily quota to exhaust. Watch for 429s or one user agent growing
in Cloudflare's analytics; the answer then is a separate limit for such callers or a cached-only endpoint, not
blocking them.

## Made

### Batch page (2026-11-06)

`/batch/` checks a pasted list in one table.

- **Up to 20 addresses a batch**: the same as the Worker's fresh lookups per visitor a minute. Four at a time; a 429
  pauses every lane for its `Retry-After` instead of failing rows. Answers the Worker cached cost the sources nothing.
- **Ranges**: up to four IPv4 /24s compared in a list (a /23 or /22 counts as two or four). Each is the /24 portrait
  (one request to the VPS service for all 256 addresses, read against offline lists: no source's quota), and the
  visitor picks addresses from them for the table. A range narrower than a /24 (/25 to /31) is its own addresses:
  counted, picked from and shared as those, with the rest of its /24 shown faint. Wider than a /22 is refused: that
  is network auditing or scanning, not choosing between a few candidates, and the cost and the page would grow with
  it. An IPv6 prefix is one row: its first host is checked and stands for the block, because the sources record IPv6
  by block and every address in a prefix reads the same.
- **Stays on the Worker** whatever is decided about browser lookups: a batch is mostly someone else's addresses (from
  the browser, every source would learn who looks at whom), it benefits most from the shared cache, and twenty
  lookups from one proxy exit would get that exit rate-limited.
- **No Turnstile** for now: the numbers didn't call for it. Add it if 429s appear or a script starts driving the page.
- **Sharing** goes through 1ms.dog's shared dialog. The rows and the ranges' colours travel after `#b=` (never sent to
  the server); addresses, ranges' prefixes and ASes only when the visitor ticks the box.

### IP.SB from the browser only (2026-11-06)

IP.SB answered every request from Cloudflare's addresses with 429, so from the Worker it never gave an answer. The
browser gets 200 with CORS, so it is `browser: "only"`, like ipwho.is.

### The /24 portrait (2026-11)

The card shows the 256 neighbours of the checked IPv4 address, coloured by public lists only (IP2Proxy LITE, IPsum,
the Tor exit list, X4BNet VPN and data-centre ranges, Spamhaus DROP), with reverse DNS telling what kind of network
the /24 is. It runs on the VPS (`server/`), not the Worker, because a /24 is 256 reverse lookups and a set of lists
too large to fetch per request.

Considered first and turned down: asking the per-address APIs (AbuseIPDB, IPQualityScore and the like) for all 256
addresses. Their free quotas are tens to a thousand lookups a day, so a handful of visitors would use them up, and
the paid tiers cost more than the card is worth. Offline lists, refreshed daily, have no per-lookup cost.

The colour says only what the lists say. A square without a reverse name isn't "unknown": many home and data-centre
ranges name none. The page states that for the /24 as a whole and for the address under the pointer.

### Broadcast IPs are flagged, not scored (2026-11)

"Broadcast" (registered in one country, used in another) is shown in yellow but takes nothing off the score. The
score counts what makes sites distrust an address (data centre, proxy, VPN, Tor, abuse, fraud scores, mail
blocklists); a registry country that differs from the location doesn't. What it does change is which country a
service that goes by the registry thinks you are in, which matters for region-locked streaming and AI services, and
the uses say so.

## Turned down

- **Scanning the visitor's open ports** (2026-11): proposed with the VPS features and rejected for good. Not to be
  proposed again.
- **Connecting to proxy clients** (Clash, Mihomo and similar: their APIs, subscriptions, switching nodes): out of
  scope for every 1ms.dog tool. What the page knows about a proxy, it measures from the browser. The batch page only
  checks addresses the visitor pastes.
