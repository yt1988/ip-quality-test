# 1ms-ipqs: the /24 portrait

The service behind ipqs's "/24 portrait" card, on the 1ms.dog VPS. For an IPv4 address it reads the /24 around it:

- **Reverse DNS**: all 256 names, asked of 1.1.1.1 and 8.8.8.8 from the server, then sorted by what they say
  (hosting, home and mobile access, fixed business lines, VPN/proxy words, mail). The most common domains and a few
  sample names come back with the counts.
- **Prefix**: the announced prefix holding it and its origin AS (RIPEstat `network-info`).
- **Public lists**, fetched once a day into a compact index (under 1 MB without IP2Proxy):
  IP2Proxy PX1 LITE (open proxies; free with attribution, needs a free account's download token), IPsum (malicious
  IPs with a 1–10 score; Unlicense), X4BNet lists_vpn (VPN and data-centre ranges; MIT), Spamhaus DROP, the Tor
  Project's exit list. The page credits them under the card.

No address in the /24 is contacted. Names and prefix are cached in memory for 7 days (at most 5,000 /24s; a sweep
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
 "lists":{"proxy":null,"bad":0,"badMax":0,"tor":0,"vpn":0,"dc":256,"drop":0,"at":"…"}}
```

A list never fetched is `null` (not "none listed"); `vpn`, `dc` and `drop` count the /24's addresses inside those
ranges (0–256). Errors: 400 `bad_ip` (not a public IPv4 address), 429 `rate`, 503 `busy`. `GET /healthz` →
`{"ok":true,"lists":true}`.

## Build and run

```bash
cd server && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o seg .
go test ./...
```

```bash
seg -update -data /var/lib/1ms-ipqs        # daily (timer 1ms-ipqs-lists): fetch the lists, write lists.gob
seg -addr <addr:port> -cert <fullchain.pem> -key <privkey.pem> -data /var/lib/1ms-ipqs
```

The IP2Proxy token comes from `$IP2PROXY_TOKEN` or the systemd credential `ip2proxy`; without one the proxy
list is skipped and the page says it isn't connected. The service picks up a new index within 10 minutes.
Port, subdomain, directory and user are as registered in 1ms-shell `docs/processes.md` ("专用服务器"); the page reads
the address from `SEG` in `scripts/build.mjs` (`SEG_API=http://127.0.0.1:8447 npm run build` for a local test, not to
be committed).
