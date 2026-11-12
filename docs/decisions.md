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

## Phone text sizes and the embedded frame's height (2026-11-11)

- The lists' credit line (`#srcCredit`, `#sgSrc`) was 11.5px, below the contract's 12px floor for secondary text
  (docs/tool-contract.md section 5); it and the one-line tags beside the /24 portrait now read 12px, with the tag
  box grown to 20px so nothing clips. `npm run mobile -- ipqs` reports no text under 12px in any language.
- The checkup embed (check.1ms.dog) reports its frame height from a ResizeObserver on `.app`. A source's answer
  changes that height, and reading layout inside the observer's own callback is what browsers report as
  "ResizeObserver loop completed with undelivered notifications" — most of the ipqs errors in the week's report
  came from the page's first day (2,215 on 11-04, 63 on 11-05, a handful a day since), not from the live paint of
  11-10. The measurement now waits for the next animation frame and runs at most once per frame, so the callback
  never forces layout mid-delivery; the reported size stays the same, one frame later.

## The 2026-11-11 batch: new evidence beside the score, and how far it may move it (2026-11-11)

Five new kinds of evidence went in, and only two of them touch the score. The line is: a finding is something a source
asserts about the address (a proxy flag, a list entry, a blocklist answer); everything else is a hint to look into, and
a hint must not lower a score a visitor cannot argue with.

- **Cloud ranges** (AWS, GCP, Cloudflare, Fastly; daily download, read by the lists service) name the provider and its
  region, and mark a CDN edge. An edge is shared by many sites, so it no longer takes the data-center deduction
  (which would have capped an ordinary Cloudflare edge at B); an EC2 address still does. The provider that publishes
  the range is a fact, not a vote: it is not counted into the network-type tally.
- **Team Cymru fullbogons** say the space was never allocated. Shown as a note; no points, because a bogon is
  usually the visitor's mistake (a reserved address), not a reputation finding.
- **The /24's neighbourhood counts** now come with `/v1/ip` (the index already computed them for `/v1/seg`) and are
  the fifth fact on the page. Shown, not scored: a whole /24 being listed is real evidence, but the address itself may
  be clean, and the /24 card is one click away. Revisit after two weeks of data.
- **RIPEstat routing-status and abuse-contact-finder** fold into the existing routing source (one extra request each,
  at once): since when the prefix is routed, how many RIS peers see it, whether several networks announce it, and the
  network's abuse contact. Low visibility and MOAS are notes; the abuse contact feeds the appeal panel.
- **AlienVault OTX** is a new source (keyless, CORS, server-first with a browser retry like ISC). Its pulses are
  reports someone shared, so they are shown and never scored; a whitelist / false-positive mark reads as good.

Two features ride on the same data:

- **The appeal panel** (`#appealBtn`, only when there is something to appeal) names the network's abuse contact from
  RIPEstat, links each blocklist's own lookup/delist page, and links Spamhaus for DROP. This is the first screen here
  that answers "I was misjudged, what now?".
- **A privacy switch** (`#srvOnly`, `localStorage`): with it on, the sources that would be asked from the browser stay
  empty and only our server sees the address. Default stays as it was (browser sources on); the switch is for
  visitors who would rather have fewer rows than another third party seeing their address.

Smaller pieces from the same report: the history line now says which way the score moved; the finding under the
verdict says what the next grade would take; a group's header counts the sources that failed (`✕n`) instead of
counting them as answered silently; DroneBL and blocklist.de reason codes are read as words (open proxy, spam, bot,
attack), any other code stays the number the list gave; the help gains an entry on what the score cannot see; the API
gains `GET /api` (a machine-readable list) and `GET /openapi.json`, plus `X-RateLimit-Limit` / `X-RateLimit-Window`
and `rate_limit` in the JSON, so a 429 is not a mystery.

Go tests cover the four cloud parsers, `CloudOfIP` (including replacing one provider's ranges), `BogonOf` (v4 and v6)
and `NearOf`'s union count; `src/score.mjs` tests cover the edge skipping the hosting deduction, the cloud/neighbour/
routing/OTX notes, and that none of them adds a deduction.

## The arrow after a wrapped link stays with the text (2026-11-11)

The links under the verdict end in an external-link arrow. Laid out as a flex row the arrow sat at the right edge of
the whole paragraph, beside the first line, not after the last word (the owner's screenshot). Inline it is worse:
Chinese lets a line break anywhere, including right before an inline icon, so a paragraph that fills its column leaves
the arrow alone on a line of its own — a word joiner before the icon does not stop it.

So the link is a block (`display: block`, `align-self: flex-start`), the arrow is inline after the text, and the link
balances its lines (`text-wrap: balance`). The last line then ends well short of the column's edge and the arrow fits
after the last word. `text-wrap` older than Chrome 114 / Safari 17.5 / Firefox 121 simply wraps as before, and may
leave the arrow on its own line — degrade, not break.

## A source's answer is shown whole (2026-11-11)

The owner pointed at "CHINA169-BJ - China Unicom Beijing Pr…" and at an exit card cut at "China Unicom Guandong":
a value that ends in an ellipsis hides the answer the tool exists to give. So `.fc-v` (finding and connection cells)
and `.pa` (a source's value) wrap instead of truncating (`overflow-wrap: anywhere` for a name with no spaces), and a
row grows to fit it — `.pr` is `min-height` + a little padding rather than a fixed 34px. Names and labels keep their
ellipsis; it is only answers that may no longer be shortened.

## No block waits for its answer to take its place (2026-11-11)

The shell's smoke run gave this page a CLS of 0.15 against the 0.1 line in `docs/tool-contract.md` §4「多路查询」. The
page was drawing only part of itself at the start of a check and growing as answers came in: the /24 card appeared
with the server's first message, the connection card only once both servers had answered, the Turnstile card once its
key had arrived, and the verdict's notes (confidence, last check, next grade) at the end — each one pushing the
sources section down, and the verdict pushing the facts down inside the card.

So every block now takes its place and its height as the check starts, at the moment the check starts:

- `/24` (`#sgt`): `reset()` calls `segStart` — with the address when the check already knows it (a typed address), or
  as a waiting grid when it doesn't (a self check learns its address from the shell a moment later). The card is a
  section below the hero, but it was still moving the sources section under it.
- connection (`#cnt`): drawn with its two cells waiting whenever the check is the visitor's own; a check of someone
  else's address and a shared result have no card, and both are known before the check starts.
- Cloudflare check (`#cft`): drawn at the start with the question the card is in anyway, so the answer never moves it.
  A Worker that names no key (404) has no card, and that arrives before the answer does.
- verdict notes: `#conf`, `#hist` and `#nextG` keep their lines from the first paint (`&nbsp;`, `#conf` two lines);
  a note that doesn't apply keeps its line empty rather than vanishing at the end. The row with the share button is
  already as tall as the button.

A block no longer disappears when its answer is missing, either: if neither connection server answers, both cells say
so instead of the card vanishing.

Measured with the smoke's own method (a buffered `PerformanceObserver`, 1280×900): 0.15 before, 0.01–0.03 after. What
is left is a block whose height depends on its answer — the connection cells grow when a network name wraps to two
lines — and that is allowed by §4 (states may differ by 2–3 lines).

## The first paint is the check's layout, not the empty page (2026-11-11)

The blocks drawn at check start were still drawn *after* the first paint: the page ships them `hidden` and the module
script reveals them. When the script answers quickly no one sees it; when the font or the script lands after the first
paint, that first paint has no cards at all, and the reveal moves the sources section by 200 px in one go — a CLS of
0.13 on the live page in about one run in four, against 0.02 otherwise (measured with `npm run cls -- ipqs`).

So the two cards of the visitor's own connection are in the markup, in the state they will be in: `#cnt` with its two
waiting cells, `#cft` with its question (`data-i` fills the text at build time) and its button. `#cft` is hidden by
CSS unless the page is the visitor's own check: the head script sets `data-own` when the URL has no `ip` parameter, is
not a shared result and is not an embed — before the first paint, so those pages never flash the cards. A check of one
of the visitor's own exits is theirs: `cnShow` sets `data-own` itself when it shows the card.

The /24 card stays out of the markup on purpose: its height depends on the address's family (a 256-cell grid, or the
one-line IPv6 card), which a self check doesn't know until the shell answers — and at 1280×900 the card is below the
fold anyway, so its arrival moves nothing visible.

Local measurement with the script delayed 0, 400, 1200 and 2500 ms: 0.012, 0.03, 0.012, 0.012.

## A shared class name reaches into the page it only half-matches (2026-11-12)

Adopting the shared `assets/design/base.css` broke the page the same day: the findings' 14px status dots came out as
32×14 ellipses and the verdict column centred its text. Two separate causes, both silent.

The shared file used `.st` for its status pill and this page uses `.st` for the dot beside a finding. `base.css` is
concatenated *before* `style.css`, so the page rule wins only for the properties it lists (here width, height, radius,
grid, colour); base's `padding: 0 9px` and `height: 22px` were not listed and leaked in, and 14px plus 18px of padding
with `border-radius: 50%` is an ellipse. The same happened to `.verdict`: the page's column never set `align-items`,
`font-size` or `font-weight`, so it took base's `center`, `17px` and `600`.

The other cause was in the copy itself: `src/base.css` had lost the `/*` that opens the `===== ACCENT ends =====`
comment. The stray `*/` and the `*` that followed it were never parsed, so `* { box-sizing: border-box }` — the first
rule after that comment — did not exist at all, and every padded box on the page grew by its padding. Nothing failed:
the CSS was valid, the page just measured wrong.

The shared file now avoids generic names for its components (`.pill`, `.page-verdict`, `.page-h`, `.page-sub`,
`.card-pad`, `.hint`, `.blank`, `.skel`), and this page keeps `.st`, `.verdict` and `.skl` as its own. Two tests in
`test/site.test.mjs` hold the line: one fails when the two files define the same class outside a short list of
components both draw, the other when a comment in `base.css` closes without opening.

The rule for later: a page never overrides a shared class, it merges with one — so a class name on both sides means
the page inherits every property it forgot to state. When adopting a new base, look at the page with the base's rules
in mind, not only at what the base changed.

## A phone row of four buttons is two columns (2026-11-12)

When a result makes all four action buttons appear (batch, appeal, check again, run again) they don't fit one row on a
phone: at 375px the row was 405px inside a 294px bar, and the page scrolled sideways to 438px — `flex-wrap: nowrap`
plus a `white-space: nowrap` button means nothing could give. Under 460px the row is now a two-column grid, and a last
button with no partner takes the whole row. Spacing and button size don't change; only the number of columns does
(design.md §5).

Found by Public at 375px after the base.css rename; the rules were the same before it, so this was older than the
migration. At 320px the top bar still overflows on every tool of the suite — partly the shared `.top-acts`, partly
fixed-width blocks a page draws itself — so 375 is the width phones are accepted at (docs/design.md §9 in
1ms-shell). `npm run mobile` checks 375 and does not look for sideways scrolling: check that with
`document.documentElement.scrollWidth > innerWidth`.
