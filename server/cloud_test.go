package main

import (
	"net/netip"
	"strings"
	"testing"
)

// The providers' own range lists: AWS marks CloudFront as an edge and keeps each prefix's region, GCP carries a scope,
// Cloudflare and Fastly publish their CDN edges and nothing else.
func TestCloudParsers(t *testing.T) {
	aws := `{"prefixes":[{"ip_prefix":"3.5.140.0/22","region":"ap-northeast-2","service":"AMAZON"},
		{"ip_prefix":"13.32.0.0/15","region":"GLOBAL","service":"CLOUDFRONT"}],
		"ipv6_prefixes":[{"ipv6_prefix":"2600:1f00::/24","region":"us-east-1","service":"AMAZON"}]}`
	v4, v6, err := parseAWS(strings.NewReader(aws))
	if err != nil {
		t.Fatal(err)
	}
	if len(v4) != 2 || len(v6) != 1 {
		t.Fatalf("aws: v4 %d v6 %d", len(v4), len(v6))
	}
	if cloudNames[v4[0].P] != "aws" || v4[0].Edge || v4[0].Region != "ap-northeast-2" {
		t.Fatalf("aws EC2 range: %+v", v4[0])
	}
	if !v4[1].Edge || v4[1].Region != "GLOBAL" {
		t.Fatalf("aws CloudFront range: %+v", v4[1])
	}

	gcp := `{"prefixes":[{"ipv4Prefix":"34.80.0.0/15","scope":"asia-east1"},{"ipv6Prefix":"2600:1901::/48","scope":"global"}]}`
	v4, v6, err = parseGCP(strings.NewReader(gcp))
	if err != nil {
		t.Fatal(err)
	}
	if len(v4) != 1 || len(v6) != 1 || v4[0].Region != "asia-east1" || v4[0].Edge {
		t.Fatalf("gcp: %+v %+v", v4, v6)
	}

	v4, v6, err = parseCloudflare(strings.NewReader("173.245.48.0/20\n2400:cb00::/32\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(v4) != 1 || len(v6) != 1 || !v4[0].Edge || cloudNames[v4[0].P] != "cloudflare" {
		t.Fatalf("cloudflare: %+v", v4)
	}

	v4, v6, err = parseFastly(strings.NewReader(`{"addresses":["151.101.0.0/16"],"ipv6_addresses":["2a04:4e42::/32"]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(v4) != 1 || len(v6) != 1 || !v4[0].Edge || cloudNames[v4[0].P] != "fastly" {
		t.Fatalf("fastly: %+v", v4)
	}
}

func TestCloudOfIP(t *testing.T) {
	af, at, _ := rangeOf("13.32.0.0/15")
	gf, gt, _ := rangeOf("34.80.0.0/15")
	idx := &Index{}
	idx.setCloud(cloudID("aws"), []CloudRange{{F: af, T: at, P: cloudID("aws"), Region: "GLOBAL", Edge: true}}, nil)
	idx.setCloud(cloudID("gcp"), []CloudRange{{F: gf, T: gt, P: cloudID("gcp"), Region: "asia-east1"}}, nil)

	if name, region, edge := idx.CloudOfIP(netip.MustParseAddr("13.32.5.5")); name != "aws" || region != "GLOBAL" || !edge {
		t.Fatalf("aws lookup: %q %q %v", name, region, edge)
	}
	if name, region, edge := idx.CloudOfIP(netip.MustParseAddr("34.80.1.1")); name != "gcp" || region != "asia-east1" || edge {
		t.Fatalf("gcp lookup: %q %q %v", name, region, edge)
	}
	if name, _, _ := idx.CloudOfIP(netip.MustParseAddr("8.8.8.8")); name != "" {
		t.Fatalf("outside every range: %q", name)
	}
	// replacing one provider's ranges keeps the other's
	idx.setCloud(cloudID("aws"), nil, nil)
	if name, _, _ := idx.CloudOfIP(netip.MustParseAddr("34.80.1.1")); name != "gcp" {
		t.Fatalf("gcp after aws update: %q", name)
	}
}

func TestBogonOf(t *testing.T) {
	f, to, _ := rangeOf("10.0.0.0/8")
	idx := &Index{Bogon: merge([][2]uint32{{f, to}})}
	if !idx.BogonOf(netip.MustParseAddr("10.1.2.3")) {
		t.Fatal("inside the range")
	}
	if idx.BogonOf(netip.MustParseAddr("8.8.8.8")) {
		t.Fatal("outside the range")
	}
	// an IPv6 fullbogon
	a := netip.MustParseAddr("100::1")
	ra, _ := netip.ParsePrefix("100::/64")
	f6, t6, ok := range6(ra)
	if !ok {
		t.Fatal("range6")
	}
	idx.Bogon6 = merge6([][2]A16{{f6, t6}})
	if !idx.BogonOf(a) {
		t.Fatal("v6 inside")
	}
}

func TestNearOf(t *testing.T) {
	seg := uint32(0x0a0000) // 10.0.0.0/24
	var px Mask
	px.set(1, 2)
	idx := &Index{
		Bad:   Scored{A: []uint32{seg<<8 | 1, seg<<8 | 2}, S: []uint8{5, 9}},
		Proxy: Bits{K: []uint32{seg}, M: []Mask{px}},
		VPN:   merge([][2]uint32{{seg<<8 | 5, seg<<8 | 6}}),
		DC:    merge([][2]uint32{{seg<<8 | 7, seg<<8 | 7}}),
		Drop:  merge([][2]uint32{{seg<<8 | 8, seg<<8 | 8}}),
	}
	n := idx.NearOf(seg)
	if n.Of != 256 || n.Listed != 6 || n.Bad != 2 || n.Proxy != 2 || n.VPN != 2 || n.DC != 1 || n.Drop != 1 {
		t.Fatalf("%+v", n)
	}
	if other := idx.NearOf(seg + 1); other.Listed != 0 || other.Of != 256 {
		t.Fatalf("another /24: %+v", other)
	}
}

// AWS publishes one prefix once per service, so the same range arrives twice: it must stay one, with the edge mark.
func TestMergeCloud(t *testing.T) {
	f, to, _ := rangeOf("13.32.0.0/15")
	m := mergeCloud([]CloudRange{{F: f, T: to, P: 0, Region: "GLOBAL"}, {F: f, T: to, P: 0, Region: "GLOBAL", Edge: true}})
	if len(m) != 1 || !m[0].Edge || m[0].Region != "GLOBAL" {
		t.Fatalf("%+v", m)
	}
	// adjacent ranges stay apart (a /15 beside a /15 is two regions, not one)
	a, b, _ := rangeOf("3.5.140.0/22")
	c, d, _ := rangeOf("3.5.144.0/22")
	if m := mergeCloud([]CloudRange{{F: a, T: b, Region: "ap-northeast-2"}, {F: c, T: d, Region: "us-east-1"}}); len(m) != 2 {
		t.Fatalf("adjacent: %+v", m)
	}
}

// Cloudflare's edges arrive as two files: the IPv6 one must not wipe the IPv4 ranges.
func TestCloudFamiliesApart(t *testing.T) {
	f, to, _ := rangeOf("104.16.0.0/13")
	p, _ := netip.ParsePrefix("2606:4700::/32")
	f6, t6, _ := range6(p)
	idx := &Index{}
	idx.setCloud4(cloudID("cloudflare"), []CloudRange{{F: f, T: to, P: cloudID("cloudflare"), Edge: true}})
	idx.setCloud6(cloudID("cloudflare"), []CloudRange6{{F: f6, T: t6, P: cloudID("cloudflare"), Edge: true}})
	if name, _, edge := idx.CloudOfIP(netip.MustParseAddr("104.16.0.1")); name != "cloudflare" || !edge {
		t.Fatalf("v4 edge: %q %v", name, edge)
	}
	if name, _, edge := idx.CloudOfIP(netip.MustParseAddr("2606:4700::1111")); name != "cloudflare" || !edge {
		t.Fatalf("v6 edge: %q %v", name, edge)
	}
}
