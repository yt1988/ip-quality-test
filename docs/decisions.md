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

### Grade ceilings, single-source findings and confidence (2026-11-10)

The score stays arithmetic ("every point taken off is shown"), but the grade adds ceilings, because a high score must
not claim more than the findings support:

- on one mail blocklist an address is never graded A; on two or more, never above C. UCEPROTECT L1 flags whole ranges
  for one neighbour's behaviour, so it counts half, both in the points (3 instead of 6) and towards the ceilings;
- fewer than two sources that said anything about risk (a risk score or any risk flag) stops the grade at B;
- a Tor exit is always F. Its deduction is 75 points (it was 40), so the score lands below 30 and the letter and the
  number still agree; a source-only Tor flag counts by the share of sources, as the other flags do.

A flag, a hosting vote or a risk score made by a single source counts half: one noisy source (ip-api calling a public
DNS resolver a proxy, say) can't move the score as far as several agreeing sources. The result carries `confidence`:
the sources that answered, the ones with risk data, and whether they disagreed (a split vote or a single-source flag
makes it "mid"; fewer than three answers or fewer than two risk sources, "low"). The page shows it under the verdict,

and a shared link or the report JSON sets it again from the answers it carries.

## Public lists, routing and reverse DNS (2026-11-10)

The sources that needed no key but were missing were added, and one source of our own:

- **1ms public lists** (`server/`'s `GET /v1/ip`): IPsum, Spamhaus DROP and ASN-DROP, Apple iCloud Private Relay
  egress ranges, and the Tor Project's running relays, read for the exact address (IPv4 and IPv6). The lists are
  downloaded once a day by the existing timer; the Worker asks its VPS for one address, and the answer is cached for
  six hours like any source's. IP2Proxy, X4BNet and the Tor exit list were already there.
- **SANS ISC (DShield)**: attack reports and threat feeds, IPv4 only (its API refuses IPv6), cut off at 90 days so an
  old report doesn't count. Because it answered, it can also say no: an address with no report in 90 days counts as a
  clean abuse reading (the cell gets a green check) instead of "no data". Its API often stalls requests from
  Cloudflare's addresses, so the page asks again from the visitor's browser when the server times out. CC BY-NC-SA:
  the site is non-commercial and the source is named and linked in the row.
- **RIPEstat**: whether the covering prefix is announced, its origin AS, and its RPKI status. Keyless, CORS, both
  families. An unannounced prefix or an invalid RPKI record is shown, not scored heavily.
- **Reverse DNS**: the PTR name, forward-confirmed reverse DNS, and whether the name reads like a dynamic pool or a
  server network. Mail servers check FCrDNS, so a failure turns the mail verdict to "warn"; the name is a hint and is
  never voted into the network type (a data-centre address with "customer" in its PTR is still a data centre).
- **DroneBL** joins the DNS blocklists, and a list that answers with reason codes (DroneBL's 127.0.0.x) shows them on
  hover.

The lists count without double counting: when a source already flags the address as proxy/VPN/Tor/abuser, IPsum's
lists don't take points again. DROP (whole range) takes 15 and caps the grade at B; ASN-DROP (whole network) takes 3
and also caps at B; one or two IPsum lists take 4 and three or more take 8, capping at B (two list findings at C). A
Private Relay exit is treated like an anonymizer (5 points, the same finding cell as VPN and proxy) and `n_relay`
says what it is. A Tor relay (not an exit) is only noted.

The Apple list (12 MB, about 285,000 prefixes) and Onionoo's relay list (about 600 KB) are merged into inclusive
ranges and gob-encoded with the rest of the index (1.65 MB with every list but IP2Proxy). ASN-DROP is matched against
the origin AS of the covering prefix, so an address's lists answer needs the prefix first; `/v1/ip` asks Team Cymru and
the PTR in parallel, within 5 seconds.

## The JSON API, hostnames and local history (2026-11-10)

- `GET /api/check?format=json` runs the same collection as the stream and returns one document, with `sources` (each
  answer or error), `dnsbl`, `parts`, `notes` (keys and parameters, not sentences) and `summary`. CORS is open; the
  rate limit and the six-hour cache are the same as the stream's. A script that wants every source has to wait for the
  slowest one; the page keeps the stream.
- `GET /api/resolve?host=…` resolves a hostname through Cloudflare's DoH (A, else AAAA), returns the first public
  address, and caches it six hours. Only hostnames pass validation, and a private answer is refused, so the endpoint
  can't be used to reach an internal address. The page's box accepts a hostname, resolves it, then checks the address
  (the link carries the address, so it replays without another lookup). A name with no public address is cached for
  five minutes, so a typo isn't asked again on every submit.
- The last 30 addresses checked on a device are kept in `localStorage` (`ipqs:hist`), with score, grade and time. A
  result shows how the address read last time; shared results neither read nor write it. Nothing leaves the browser.
- A shared link without the address keeps only what the score re-reads: the country, network type, flags and risk
  scores, plus which lists named the address, whether its prefix is announced, the RPKI verdict and whether the
  reverse DNS name matches. The prefix and the reverse DNS name itself stay out, as before, so a link scores and
  grades the same as the check it came from while naming no more than the score needs.
- The score, the address facts and the findings are drawn while the sources are still answering, not only when the
  last one is in: each answer repaints them from what has arrived so far, dimmed (`livePaint()`), and the final paint
  clears the dimming and adds what only a finished check can say (the verdict sentence, confidence, history, links,
  the deduction lines). A slower source no longer holds the whole result back; the dimming says the numbers can still
  move.

## What was not added

- **Two-address comparison** needs a shared shell component (the 1ms.dog site's), so it waits for that; it is not
  rebuilt here.
- **StopForumSpam, CINS, GreenSnow, blocklist.de's HTTP API and similar lists** are left out: IPsum already aggregates
  them, so querying both would count one finding twice. Spamhaus ZEN is left out for DNS: it refuses public resolvers.
  Its DROP and ASN-DROP are used from the daily download instead.
- **Shodan's port list** was already read; commonly abused open ports (23, 445, 3389, …) now get their own note.
