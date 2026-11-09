# Design notes

Why IPQS works the way it does, technically, and what was measured. Dates are when the note was written.

## Where the sources are asked: Worker or browser

The Worker asks the sources for most checks: every visitor gets the same answer, answers are cached 6 hours per
address, and the sources never see who is asking about whom. The cost is that a source's per-address rate limit
falls on Cloudflare's shared exits. Sources that refuse those exits are marked `browser: "only"` in
`src/sources.mjs` and asked from the visitor's browser; `browser: "retry"` ones are asked again from the browser
when the Worker got no answer.

What can be asked from a page (checked 2026-11-06): IPQuery, ipapi.is, iplocation.net, GeoJS, ip.guide, Shodan
InternetDB, RDAP (ARIN), ipwho.is and IP.SB answer CORS (`Access-Control-Allow-Origin: *`); Cloudflare's DoH JSON can
carry the blocklist queries. What can't: ip-api.com (its free tier is HTTP only, which an HTTPS page may not fetch),
the Tor exit list (no CORS, and a whole list to download), and keyed sources (the key would be public).

Measured the same day: `/api/check` had answered no 429 in five days, and a batch of 20 fresh lookups at once saw the
same source failures as single lookups.

### The sources stay on the Worker, with the browser as retry (decided 2026-11-10)

To settle it, from 2026-11-05 for four days the site measured how often each CORS source answered the visitor's
browser, next to how often it answered the Worker: on a sample of visitors' own checks the page asked those sources
once more after the result, and the Worker recorded the same sources on a sample of fresh lookups. Both wrote only
answered/time per source and the asker's country to Analytics Engine (`ipqs_probe`), nothing about the address.

Browser success stayed below the ~90 % the browser-first design needs, mainland China included (~1,400 browser asks,
~110 of them from mainland China, ~530 Worker asks):

| source | browser | browser, mainland China | Worker |
|---|---|---|---|
| GeoJS | 91 % | 92 % | 100 % |
| ip.guide | 92 % | 90 % | 100 % |
| iplocation.net | 91 % | 92 % | 100 % |
| IPQuery | 90 % | 83 % | 100 % |
| RDAP | 85 % | 82 % | 82 % |
| IP.SB (`browser: "only"`) | 87 % | 91 % | – |
| IPinfo (`browser: "only"`) | 81 % | 93 % | – |
| Shodan InternetDB | 67 % | 65 % | 100 % |
| ipapi.is | 58 % | 71 % | 100 % |
| the blocklists' DoH queries | 52 % | 30 % | 100 % |
| ipwho.is (`browser: "only"`) | 30 % | 40 % | – |

So the Worker stays first: a visitor's own address, someone else's address, `/batch/` and `/api/check` are all asked
from the Worker, and the sources marked `browser: "retry"` (IPQuery, ipapi.is, GeoJS, RDAP) are still asked again
from the page when the Worker got no answer. No source moved to `browser: "only"`: the Worker answered everything it
asks, except RDAP at 82 % — its registries rate-limit too, and the page already retries it.

A browser test on 2026-11-10 from a mainland-China network (a plain HTTPS page, no CSP of the site's own) confirmed
why the browser cannot take over: ip-api.com's free endpoint is HTTP only (blocked from an HTTPS page, and its HTTPS
endpoint answers 403); proxycheck.io, ip2location.io and AbuseIPDB send no CORS header (and need keys); the Tor exit
list has no CORS; Cloudflare's DoH does not answer from there at all, so the blocklists cannot be asked from the
browser either. IPQuery was the one source that returned its full risk flags with CORS and no key; ipapi.is, IPinfo,
IP.SB, GeoJS, iplocation.net, ip.guide, RDAP and Shodan InternetDB did answer from the browser, but
without a key ipapi.is gives location and network names only — not its proxy/VPN/Tor/risk flags — and ipwho.is
answered 429, the same limit the four days saw (30 % answered). With the Worker asking the sources, the live check of
8.8.8.8 got answers from all nine sources it asks, no failures, and eight blocklists checked. Moving the sources to
the browser would therefore lose the data the score mostly rests on, not gain accuracy.

The measurement is removed now that the question is settled: `src/probe.mjs`, its callers in `src/app.js` and
`src/worker.js`, the `PROBE` binding, `scripts/probe.mjs` and the sentence about it in the privacy answer of every
language.

### IP.SB from the browser only (2026-11-06)

IP.SB answered every request from Cloudflare's addresses with 429, so from the Worker it never gave an answer. The
browser gets 200 with CORS, so it is `browser: "only"`, like ipwho.is.

## The batch page

- **Lookups stay on the Worker.** A batch is mostly other people's addresses: asked from the browser, every source
  would learn who looks at whom. It benefits most from the shared cache. And many lookups from one visitor's address
  (often a proxy exit) would get that address rate-limited by the sources.
- **Pacing.** The page asks a few addresses at a time; a 429 pauses every lane for its `Retry-After` rather than
  failing rows.
- **IPv6 prefixes are one row.** The sources record IPv6 by block (a /48, a /32, the whole AS), so every address in a
  prefix reads the same; the prefix's first host is checked and stands for it.
- **IPv4 ranges use the /24 portrait**: one request to `server/` for all 256 addresses, read against offline lists,
  so a range costs no source's quota. A range narrower than a /24 is its own addresses (counted, picked from, shared
  as those), with the rest of its /24 shown faint for the neighbours.
- **Sharing** carries the rows and each range's colours after `#b=`, which the browser never sends to the server;
  addresses, ranges, prefixes and ASes only when the share dialog's box is ticked.

## The /24 portrait

The card shows the 256 neighbours of an IPv4 address, coloured by public lists only (IP2Proxy LITE, IPsum, the Tor
exit list, X4BNet VPN and data-centre ranges, Spamhaus DROP), with reverse DNS telling what kind of network the /24 is.
It runs as `server/`, not in the Worker, because a /24 is 256 reverse lookups and the lists are too large to fetch per
request.

Per-address APIs (AbuseIPDB, IPQualityScore and the like) were considered and left out: their free quotas are tens
to about a thousand lookups a day, so 256 lookups per card would use them up after a few visitors. Offline lists,
refreshed daily, have no per-lookup cost.

The colour says only what the lists say. A square without a reverse name isn't "unknown": many home and data-centre
ranges name none. The page says that for the /24 as a whole and for the address under the pointer.

The prefix comes from Team Cymru's DNS (`origin.asn.cymru.com`) first: RIPEstat over IPv4 timed out intermittently
from the server it was tested on, so it is the fallback.

## Scoring

### Broadcast IPs are flagged, not scored

"Broadcast" (registered in one country, used in another) is shown in yellow but takes nothing off the score. The score
counts what makes sites distrust an address (data centre, proxy, VPN, Tor, abuse reports, fraud scores, mail
blocklists); a registry country that differs from the location doesn't. What it changes is which country a service
that goes by the registry thinks you are in, which matters for region-locked streaming and AI services; the uses say
so.
