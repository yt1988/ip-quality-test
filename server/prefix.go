package main

// The prefix the /24 is announced in and by whom, from RIPEstat (free, no key): network-info gives the most specific
// announced prefix holding the address and its origin AS(es).

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

type Prefix struct {
	Prefix string `json:"prefix"` // "" when not announced
	ASNs   []int  `json:"asns"`
}

var ripe = &http.Client{Timeout: 4 * time.Second}

func PrefixOf(ctx context.Context, ip string) (*Prefix, error) {
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
		var n int
		if err := json.Unmarshal([]byte(a), &n); err == nil {
			out.ASNs = append(out.ASNs, n)
		}
	}
	return out, nil
}
