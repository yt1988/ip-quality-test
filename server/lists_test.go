package main

import (
	"net/netip"
	"strings"
	"testing"
	"time"
)

func TestRange6(t *testing.T) {
	f, to, ok := range6(netip.MustParsePrefix("2001:db8:1::/64"))
	if !ok {
		t.Fatal("not a v6 prefix")
	}
	if !(Ranges6{F: []A16{f}, T: []A16{to}}).Has(netip.MustParseAddr("2001:db8:1::1")) {
		t.Fatal("inside")
	}
	if (Ranges6{F: []A16{f}, T: []A16{to}}).Has(netip.MustParseAddr("2001:db8:2::1")) {
		t.Fatal("outside")
	}
	// a /127 holds two addresses, a /128 one
	f2, t2, _ := range6(netip.MustParsePrefix("2001:db8::/127"))
	if !(Ranges6{F: []A16{f2}, T: []A16{t2}}).Has(netip.MustParseAddr("2001:db8::1")) {
		t.Fatal("/127 second")
	}
	f3, t3, _ := range6(netip.MustParsePrefix("2001:db8::/128"))
	if !(Ranges6{F: []A16{f3}, T: []A16{t3}}).Has(netip.MustParseAddr("2001:db8::")) ||
		(Ranges6{F: []A16{f3}, T: []A16{t3}}).Has(netip.MustParseAddr("2001:db8::1")) {
		t.Fatal("/128")
	}
}

func TestMerge6(t *testing.T) {
	a, _ := netip.ParseAddr("2001:db8::1")
	b, _ := netip.ParseAddr("2001:db8::2")
	c, _ := netip.ParseAddr("2001:db8::4")
	ra, rb, rc := A16(a.As16()), A16(b.As16()), A16(c.As16())
	m := merge6([][2]A16{{rb, rb}, {ra, ra}, {rc, rc}})
	if len(m.F) != 2 {
		t.Fatalf("merged %d ranges, want 2 (adjacent 1–2, then 4)", len(m.F))
	}
	if !m.Has(b) || !m.Has(c) || m.Has(netip.MustParseAddr("2001:db8::3")) {
		t.Fatal("lookup")
	}
}

func TestParseRelay(t *testing.T) {
	var v4rs [][2]uint32
	var v6rs [][2]A16
	in := "172.224.226.0/27,GB,GB-EN,London,\n2a02:26f7:b000:4000::/64,US,US-AK,Anchorage,\n"
	if err := parseRelay(strings.NewReader(in), &v4rs, &v6rs); err != nil {
		t.Fatal(err)
	}
	if len(v4rs) != 1 || len(v6rs) != 1 {
		t.Fatalf("v4 %d v6 %d", len(v4rs), len(v6rs))
	}
	idx := &Index{Relay4: merge(v4rs), Relay6: merge6(v6rs), At: map[string]time.Time{"relay": time.Now()}}
	if l := idx.OfIP(netip.MustParseAddr("172.224.226.1"), nil); !l.Relay {
		t.Fatal("v4 relay")
	}
	if l := idx.OfIP(netip.MustParseAddr("2a02:26f7:b000:4000::1"), nil); !l.Relay {
		t.Fatal("v6 relay")
	}
}

func TestParseTorRelay(t *testing.T) {
	var v4rs [][2]uint32
	var v6rs [][2]A16
	in := `{"relays":[{"or_addresses":["1.2.3.4:9001","[2001:db8::1]:9001"]}]}`
	if err := parseTorRelay(strings.NewReader(in), &v4rs, &v6rs); err != nil {
		t.Fatal(err)
	}
	if len(v4rs) != 1 || len(v6rs) != 1 {
		t.Fatalf("v4 %d v6 %d", len(v4rs), len(v6rs))
	}
	idx := &Index{TorRelay4: merge(v4rs), TorRelay6: merge6(v6rs), At: map[string]time.Time{"torrelay": time.Now()}}
	if l := idx.OfIP(netip.MustParseAddr("1.2.3.4"), nil); !l.TorRelay {
		t.Fatal("v4 relay")
	}
	if l := idx.OfIP(netip.MustParseAddr("2001:db8::1"), nil); !l.TorRelay {
		t.Fatal("v6 relay")
	}
}

func TestParseASNDrop(t *testing.T) {
	asns, err := parseASNDrop(strings.NewReader(`{"asn":2601,"rir":"ripencc"}
{"asn":245,"rir":"arin"}
{"asn":2601,"rir":"ripencc"}
`))
	if err != nil {
		t.Fatal(err)
	}
	if len(asns) != 2 || asns[0] != 245 || asns[1] != 2601 {
		t.Fatalf("%v", asns)
	}
}

func TestOfIP(t *testing.T) {
	b := bitset{}
	a, _ := v4("1.2.3.4")
	b.add(a, a)
	sc := scores{}
	sc.add(a, a, 7)
	idx := &Index{
		Proxy: b.bits(), Bad: sc.scored(),
		Relay4:  Ranges{F: []uint32{a}, T: []uint32{a}},
		ASNDrop: []uint32{24940},
		At:      map[string]time.Time{"proxy": time.Now(), "bad": time.Now(), "relay": time.Now()},
	}
	l := idx.OfIP(netip.MustParseAddr("1.2.3.4"), []int{24940})
	if !l.Proxy || l.Bad != 7 || !l.Relay || !l.ASNDrop {
		t.Fatalf("%+v", l)
	}
	if l := idx.OfIP(netip.MustParseAddr("1.2.3.5"), []int{15169}); l.Proxy || l.Bad != 0 || l.Relay || l.ASNDrop {
		t.Fatalf("another address %+v", l)
	}
}

func TestPublicIP(t *testing.T) {
	for s, want := range map[string]bool{
		"8.8.8.8":              true,
		"2001:4860:4860::8888": true,
		"10.0.0.1":             false,
		"100.64.0.1":           false,
		"192.0.2.1":            false,
		"::1":                  false,
		"2001:db8::1":          false,
		"2002:0808:0808::1":    false,
		"fe80::1":              false,
	} {
		if got := publicIP(netip.MustParseAddr(s)); got != want {
			t.Errorf("publicIP(%s) = %v, want %v", s, got, want)
		}
	}
}

func TestCymruName6(t *testing.T) {
	a := netip.MustParseAddr("2001:db8::1")
	n := cymruName6(a)
	if !strings.HasPrefix(n, "1.0.0.0.") || !strings.HasSuffix(n, ".origin6.asn.cymru.com") {
		t.Fatalf("%q", n)
	}
}
