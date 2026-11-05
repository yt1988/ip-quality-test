package main

// The prefix the /24 is announced in and by whom. First from Team Cymru's DNS origin lookup (a TXT record per
// announced prefix holding the address, "ASN | prefix | CC | registry | date"), asked of the same resolvers as the
// reverse names; then, if that gives nothing, from RIPEstat's network-info (over HTTPS, which from the VPS sometimes
// hangs over IPv4).

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"
)

type Prefix struct {
	Prefix string `json:"prefix"` // "" when not announced
	ASNs   []int  `json:"asns"`
}

func PrefixOf(ctx context.Context, ip string) (*Prefix, error) {
	if p, err := cymru(ctx, ip); err == nil {
		return p, nil
	}
	return ripeStat(ctx, ip)
}

// the most specific announced prefix in the TXT records, with every origin AS that announces it
func parseCymru(txts []string) *Prefix {
	out, bits := &Prefix{ASNs: []int{}}, -1
	for _, t := range txts {
		f := strings.Split(t, "|")
		if len(f) < 2 {
			continue
		}
		p, err := netip.ParsePrefix(strings.TrimSpace(f[1]))
		if err != nil {
			continue
		}
		var asns []int
		for _, a := range strings.Fields(f[0]) {
			if n, err := strconv.Atoi(a); err == nil {
				asns = append(asns, n)
			}
		}
		switch {
		case p.Bits() > bits:
			out.Prefix, out.ASNs, bits = p.String(), asns, p.Bits()
		case p.Bits() == bits:
			out.ASNs = append(out.ASNs, asns...)
		}
	}
	return out
}

func cymru(ctx context.Context, ip string) (*Prefix, error) {
	a, err := netip.ParseAddr(ip)
	if err != nil || !a.Is4() {
		return nil, err
	}
	b := a.As4()
	qctx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	txts, err := resolver(0).LookupTXT(qctx, net.IPv4(b[3], b[2], b[1], b[0]).String()+".origin.asn.cymru.com")
	if err != nil {
		var de *net.DNSError
		if asDNSError(err, &de) && de.IsNotFound {
			return &Prefix{ASNs: []int{}}, nil // not announced
		}
		return nil, err
	}
	return parseCymru(txts), nil
}

var ripe = &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{
	DialContext:         (&net.Dialer{Timeout: 3 * time.Second, FallbackDelay: 150 * time.Millisecond}).DialContext,
	TLSHandshakeTimeout: 3 * time.Second, MaxIdleConns: 4, IdleConnTimeout: 90 * time.Second,
}}

func ripeStat(ctx context.Context, ip string) (*Prefix, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://stat.ripe.net/data/network-info/data.json?sourceapp=1ms-ipqs&resource="+ip, nil)
	res, err := ripe.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var j struct {
		Data struct {
			Prefix string   `json:"prefix"`
			ASNs   []string `json:"asns"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&j); err != nil {
		return nil, err
	}
	out := &Prefix{Prefix: j.Data.Prefix, ASNs: []int{}}
	for _, a := range j.Data.ASNs {
		if n, err := strconv.Atoi(a); err == nil {
			out.ASNs = append(out.ASNs, n)
		}
	}
	return out, nil
}
