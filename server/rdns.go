package main

// The /24's reverse DNS: all 256 names, asked of public resolvers from this machine (never the visitor's browser,
// whose DNS may be filtered), and read for what the names say the addresses are. Only names are read; no address is
// contacted.

import (
	"context"
	"net"
	"sort"
	"strings"
	"sync"
	"time"
)

var resolvers = []string{"1.1.1.1:53", "8.8.8.8:53"}

func resolver(i int) *net.Resolver {
	d := net.Dialer{Timeout: 1500 * time.Millisecond}
	return &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return d.DialContext(ctx, network, resolvers[i%len(resolvers)])
	}}
}

// Sweep: the PTR name of each of the /24's addresses ("" for none), within the deadline; done says how many got an
// answer of any kind before it (the rest timed out). dead: the first round (one query per worker) got no real answer
// (only failures or timeouts), so the /24's reverse servers are taken to be down and the rest isn't asked.
func Sweep(ctx context.Context, seg uint32, workers int, each time.Duration) (names [256]string, done int, dead bool) {
	ctx, stop := context.WithCancel(ctx)
	defer stop()
	var mu sync.Mutex
	finished, good := 0, 0
	jobs := make(chan int)
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			r := resolver(w)
			for i := range jobs {
				ip := net.IPv4(byte(seg>>16), byte(seg>>8), byte(seg), byte(i)).String()
				qctx, cancel := context.WithTimeout(ctx, each)
				ns, err := r.LookupAddr(qctx, ip)
				cancel()
				var dnsErr *net.DNSError
				// a name, or a clean "no name", is a real answer; the network's own reverse servers failing (SERVFAIL)
				// is an answer too, true of the /24, but not a working zone; only a timeout leaves the address unknown
				isErr := asDNSError(err, &dnsErr)
				real := err == nil || (isErr && dnsErr.IsNotFound)
				answered := real || (isErr && !dnsErr.IsTimeout)
				mu.Lock()
				if err == nil && len(ns) > 0 {
					names[i] = strings.TrimSuffix(strings.ToLower(ns[0]), ".")
				}
				if answered {
					done++
				}
				if real {
					good++
				}
				if finished++; finished == workers && good == 0 {
					dead = true
					stop()
				}
				mu.Unlock()
			}
		}(w)
	}
	for i := 0; i < 256; i++ {
		select {
		case jobs <- i:
		case <-ctx.Done():
			i = 256
		}
	}
	close(jobs)
	wg.Wait()
	return
}

func asDNSError(err error, out **net.DNSError) bool {
	e, ok := err.(*net.DNSError)
	if ok {
		*out = e
	}
	return ok
}

// What a name says, by its words (split at dots and dashes, digits dropped) and by its domain.
//
//	anon     vpn, proxy, tor, exit, relay, socks
//	hosting  a cloud or hosting domain, or server words (server, vps, cloud, dedicated, colo, …)
//	dynamic  home and mobile access words (dynamic, dhcp, pool, ppp, dsl, cable, fttx, broadband, customer, …)
//	static   fixed business lines (static, fixed, business, corp) outside hosting domains
//	mail     mail, smtp, mx
//	other    a name that says none of these
var (
	anonWords    = words("vpn proxy proxies tor exit relay socks socks5 shadowsocks")
	hostingWords = words("server servers srv vps vds cloud compute dedi dedicated colo colocation hosting hosted host hoster datacenter datacentre dc rack node")
	dynamicWords = words("dynamic dyn dhcp pool pools ppp pppoe adsl dsl xdsl vdsl cable catv fttx ftth fttb fiber fibre broadband bb res resi residential cust customer customers home user users client clients subscriber sub mobile cpe wifi lte wireless gprs 3g 4g 5g dial dialup nat cgnat")
	staticWords  = words("static fixed biz business corp corporate enterprise")
	mailWords    = words("mail smtp mx mta email")
	// domains whose reverse names are customers' servers, whatever words they use (Hetzner calls them "static")
	hostingDomains = words("amazonaws.com googleusercontent.com your-server.de vultrusercontent.com vultr.com linode.com linodeusercontent.com ip.linodeusercontent.com ovh.net ovh.ca ovh.us contaboserver.net contabo.host choopa.net leaseweb.net leaseweb.com hostwindsdns.com digitaloceanspaces.com azure.com cloudapp.net akamaitechnologies.com bc.googleusercontent.com hetzner.com hetzner.cloud scaleway.com online.net poneytelecom.eu kimsufi.com ionos.com 1and1.com upcloud.host alicloudecs.com aliyun.com tencentcloud.com myqcloud.com oraclecloud.com secureserver.net servers.com psychz.net quadranet.com colocrossing.com as9009.net m247.com m247.ro datapacket.com cdn77.com zenlayer.net")
)

func words(s string) map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(s) {
		m[w] = true
	}
	return m
}

// the registrable domain, roughly: the last two labels, or three under a country's second level (co.jp, com.cn, …)
func domainOf(name string) string {
	l := strings.Split(name, ".")
	if len(l) < 2 {
		return name
	}
	n := 2
	if len(l) >= 3 && len(l[len(l)-1]) == 2 && map[string]bool{"com": true, "net": true, "org": true, "co": true, "ne": true, "or": true, "ac": true, "gov": true, "edu": true, "ad": true, "gr": true}[l[len(l)-2]] {
		n = 3
	}
	return strings.Join(l[len(l)-n:], ".")
}

func kindOf(name string) string {
	if name == "" {
		return ""
	}
	d, parts := domainOf(name), strings.Split(name, ".")
	last3 := strings.Join(parts[max(0, len(parts)-3):], ".") // ip.linodeusercontent.com and the like
	toks := strings.FieldsFunc(strings.TrimSuffix(name, "."+d), func(c rune) bool { return c == '.' || c == '-' || c == '_' })
	has := func(m map[string]bool) bool {
		for _, t := range toks {
			if m[strings.TrimRight(strings.TrimLeft(t, "0123456789"), "0123456789")] || m[t] {
				return true
			}
		}
		return false
	}
	switch {
	case has(anonWords):
		return "anon"
	case hostingDomains[d] || hostingDomains[last3]:
		return "hosting"
	case has(dynamicWords):
		return "dynamic"
	case has(hostingWords):
		return "hosting"
	case has(staticWords):
		return "static"
	case has(mailWords):
		return "mail"
	}
	return "other"
}

type Domain struct {
	D string `json:"d"`
	N int    `json:"n"`
}

type RDNS struct {
	Asked    int            `json:"asked"`    // 256
	Answered int            `json:"answered"` // answered in time, with a name or without (the rest timed out)
	Dead     bool           `json:"dead"`     // the /24's reverse servers didn't answer at all
	Named    int            `json:"named"`    // addresses with a name
	Kinds    map[string]int `json:"kinds"`    // anon, hosting, dynamic, static, mail, other
	Domains  []Domain       `json:"domains"`  // the most common domains, most first (up to 5)
	Samples  []string       `json:"samples"`  // a few names, spread over the /24
}

func Summarize(names [256]string, answered int, dead bool) RDNS {
	out := RDNS{Asked: 256, Answered: answered, Dead: dead, Kinds: map[string]int{}, Domains: []Domain{}, Samples: []string{}}
	dc := map[string]int{}
	var named []int
	for i, n := range names {
		if n == "" {
			continue
		}
		out.Named++
		named = append(named, i)
		out.Kinds[kindOf(n)]++
		dc[domainOf(n)]++
	}
	for d, n := range dc {
		out.Domains = append(out.Domains, Domain{d, n})
	}
	sort.Slice(out.Domains, func(i, j int) bool {
		if out.Domains[i].N != out.Domains[j].N {
			return out.Domains[i].N > out.Domains[j].N
		}
		return out.Domains[i].D < out.Domains[j].D
	})
	if len(out.Domains) > 5 {
		out.Domains = out.Domains[:5]
	}
	for k := 0; k < 4 && k < len(named); k++ {
		out.Samples = append(out.Samples, names[named[k*len(named)/min(4, len(named))]])
	}
	return out
}

var kindLetter = map[string]byte{"": '-', "hosting": 'h', "dynamic": 'd', "static": 's', "anon": 'a', "mail": 'm', "other": 'o'}

// kindsOf: one letter per address for what its name says (see kindLetter); "-" for no name
func kindsOf(names []string) string {
	out := make([]byte, 256)
	for i := range out {
		n := ""
		if i < len(names) {
			n = names[i]
		}
		out[i] = kindLetter[kindOf(n)]
	}
	return string(out)
}
