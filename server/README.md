# 1ms-ipqs: the /24 portrait and the exact-address lists

The service behind ipqs's "/24 portrait" card and its "1ms public lists" source, on the 1ms.dog VPS. For an IPv4
address it reads the /24 around it:

- **Reverse DNS**: all 256 names, asked of 1.1.1.1 and 8.8.8.8 from the server, then sorted by what they say
  (hosting, home and mobile access, fixed business lines, VPN/proxy words, mail). The most common domains and a few
  sample names come back with the counts.
- **Prefix**: the announced prefix holding it and its origin AS (Team Cymru's DNS, `origin.asn.cymru.com`; RIPEstat
  `network-info` when that has no answer).
- **Public lists**, fetched once a day into a per-address index (about 1.6 MB with every list but IP2Proxy):
  IP2Proxy PX1 LITE (open proxies; free with attribution, needs a free account's download token), IPsum (malicious
  IPs with a 1–10 score; Unlicense), X4BNet lists_vpn (VPN and data-centre ranges; MIT), Spamhaus DROP and ASN-DROP
  (non-commercial use, attribution), Apple's iCloud Private Relay egress ranges (IPv4 and IPv6), and the Tor Project's
  exit list plus its running relays from Onionoo (IPv4 and IPv6). The page credits them under the card; the
  attribution Spamhaus, IP2Proxy and X4BNet ask for lives there and in the README's source table.
- **One exact address** (`/v1/ip`): the same lists read for an IPv4 or IPv6 address, with its reverse name and its
  announced prefix and origin AS. No sweep, no rate limit, cached by the Worker for six hours like every source.

No address in the /24 is contacted. Names and prefix are cached in memory for 7 days (at most 3,000 /24s, and only when the prefix is known; a sweep
with fewer than 240 answers isn't kept); the lists are read fresh on every request. New /24s are limited to 30 per
client address per hour and 4 sweeps at a time; cached ones are free. Nothing is logged, including the HTTP server's
own error log, which would name clients.

## API

`GET /v1/seg?ip=1.2.3.4` (CORS `*`, `no-store`):

```json
{"seg":"95.216.1.0/24","at":"…",
 "rdns":{"asked":256,"answered":255,"named":255,"kinds":{"hosting":208,"mail":7,"anon":2,"other":38},
         "domains":[{"d":"your-server.de","n":204}],"samples":["static.0.1.216.95.clients.your-server.de"]},
 "prefix":{"prefix":"95.216.0.0/16","asns":[24940]},
 "lists":{"proxy":8,"bad":0,"badMax":0,"tor":0,"vpn":0,"dc":256,"drop":0,"at":"…"},
 "names":["static.0.1.216.95.clients.your-server.de", …256], "kinds":"hhhh…", "flags":[16,16,17,…256], "score":[0,…256]}
```

Per address: `names` ("" for none), `kinds` (one letter each: h hosting, d home or mobile, s fixed line, a VPN or proxy
words, m mail, o other, - no name), `flags` (1 open proxy, 2 IPsum, 4 Tor exit, 8 VPN range, 16 data-centre range,
32 Spamhaus DROP) and `score` (IPsum: how many blocklists name it). A list never fetched is `null` (not "none listed"); `vpn`, `dc` and `drop` count the /24's addresses inside those
ranges (0–256). Errors: 400 `bad_ip` (not a public IPv4 address), 429 `rate`, 503 `busy`. `GET /healthz` →
`{"ok":true,"lists":true}`.

`GET /v1/ip?ip=…` (CORS `*`, `no-store`) reads the lists for one IPv4 or IPv6 address and answers without a sweep:

```json
{"ip":"172.224.226.1","v":4,
 "lists":{"proxy":false,"bad":0,"tor":false,"vpn":true,"dc":true,"drop":false,"relay":true,"torrelay":false,"asndrop":false,"at":"…"},
 "ptr":"a172-224-226-1.source.akaquill.net","prefix":"172.224.226.0/24","asns":[36183]}
```

`lists.at` is the fetch time of the oldest list that answered. `proxy`, `bad` and `tor` are IPv4-only; `relay`,
`torrelay` and `asndrop` cover both families; `vpn` and `dc` come from X4BNet's IPv4 lists, so they are false for
IPv6. `asndrop` matches the origin AS of the covering prefix (Team Cymru), not the address itself. Errors: 400
`bad_ip` (not a public address), 404 `not_found`, 503 `no_lists` (the index isn't loaded yet).

## Build and run

```bash
cd server && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o seg .
go test ./...
```

```bash
seg -update -data /var/lib/1ms-ipqs        # daily (timer 1ms-ipqs-lists): fetch the lists, write lists2.gob
seg -addr <addr:port> -cert <fullchain.pem> -key <privkey.pem> -data /var/lib/1ms-ipqs
```

The IP2Proxy token comes from `$IP2PROXY_TOKEN` or the systemd credential `ip2proxy`; without one the proxy
list is skipped and the page says it isn't connected. The service picks up a new index within 10 minutes.
Port, subdomain, directory and user are as registered in 1ms-shell `docs/processes.md` ("专用服务器"); the page reads
the address from `SEG` in `scripts/build.mjs` (`SEG_API=http://127.0.0.1:8447 npm run build` for a local test, not to
be committed).
