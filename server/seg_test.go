package main

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestKindOf(t *testing.T) {
	for name, want := range map[string]string{
		"static.2.1.216.95.clients.your-server.de":           "hosting", // the domain wins over "static"
		"ec2-3-112-1-2.ap-northeast-1.compute.amazonaws.com": "hosting",
		"li1234-5.members.linode.com":                        "hosting",
		"vps-1234.example.net":                               "hosting",
		"ppp-118-2-3-4.dynamic.ocn.ne.jp":                    "dynamic",
		"123.125.119.144.static.bjtelecom.net":               "static",
		"c-73-1-2-3.hsd1.ca.comcast.net":                     "other",
		"pool-71-1-2-3.nycmny.fios.verizon.net":              "dynamic",
		"vpn-node-17.example.com":                            "anon",
		"tor-exit-3.example.org":                             "anon",
		"mail2.example.co.jp":                                "mail",
		"":                                                   "",
	} {
		if got := kindOf(name); got != want {
			t.Errorf("kindOf(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestDomainOf(t *testing.T) {
	for name, want := range map[string]string{
		"static.1.clients.your-server.de":            "your-server.de",
		"ppp-1.dynamic.ocn.ne.jp":                    "ocn.ne.jp",
		"1.2.3.4.broad.bj.bj.dynamic.163data.com.cn": "163data.com.cn",
		"example.com":                                "example.com",
	} {
		if got := domainOf(name); got != want {
			t.Errorf("domainOf(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestSummarize(t *testing.T) {
	var names [256]string
	for i := 0; i < 200; i++ {
		names[i] = "static." + string(rune('a'+i%26)) + ".clients.your-server.de"
	}
	names[250] = "mail.example.com"
	s := Summarize(names, 256)
	if s.Named != 201 || s.Kinds["hosting"] != 200 || s.Kinds["mail"] != 1 {
		t.Fatalf("summary %+v", s)
	}
	if s.Domains[0].D != "your-server.de" || s.Domains[0].N != 200 || len(s.Samples) != 4 {
		t.Fatalf("domains %+v samples %v", s.Domains, s.Samples)
	}
}

func TestCountsAndRanges(t *testing.T) {
	c := counter{}
	a, _ := v4("1.2.3.4")
	c.add(a, a, 3)
	c.add(a+1, a+1, 7)
	// a range across two /24s splits between them
	f, _ := v4("1.2.4.250")
	c.add(f, f+9, 0)
	k := c.counts()
	if n, s := k.Get(0x010203); n != 2 || s != 7 {
		t.Fatalf("1.2.3.0/24: %d %d", n, s)
	}
	if n, _ := k.Get(0x010204); n != 6 {
		t.Fatalf("1.2.4.0/24: %d", n)
	}
	if n, _ := k.Get(0x010205); n != 4 {
		t.Fatalf("1.2.5.0/24: %d", n)
	}
	lo, hi, _ := rangeOf("10.0.0.0/23")
	mid, _, _ := rangeOf("10.0.1.128/25")
	r := merge([][2]uint32{{lo, hi}, {mid, mid + 127}})
	if len(r.F) != 1 || r.Cover(0x0a0000) != 256 || r.Cover(0x0a0001) != 256 || r.Cover(0x0a0002) != 0 {
		t.Fatalf("ranges %+v", r)
	}
	half, _, _ := rangeOf("10.9.9.0/25")
	if h := (Ranges{F: []uint32{half}, T: []uint32{half + 127}}); h.Cover(0x0a0909) != 128 {
		t.Fatal("half a /24")
	}
}

func TestParseLines(t *testing.T) {
	var got [][3]int
	parseLines(strings.NewReader("# IPsum\n1.2.3.4\t5\n5.6.7.0/24 ; SBL1\n\n2001:db8::1\n"), true, func(f, to uint32, s int) {
		got = append(got, [3]int{int(f), int(to), s})
	})
	if len(got) != 2 || got[0][2] != 5 || got[1][1]-got[1][0] != 255 {
		t.Fatalf("%v", got)
	}
}

func TestPX1(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "px1.zip")
	f, _ := os.Create(p)
	z := zip.NewWriter(f)
	w, _ := z.Create("IP2PROXY-LITE-PX1.CSV")
	w.Write([]byte(`"16909060","16909061","US","United States of America"` + "\n"))
	z.Close()
	f.Close()
	c := counter{}
	if err := loadPX1(p, c); err != nil {
		t.Fatal(err)
	}
	if n, _ := c.counts().Get(0x010203); n != 2 {
		t.Fatalf("px1 %d", n)
	}
	// a refused token: a text page, named in the error
	os.WriteFile(p, []byte("THIS FILE CAN ONLY BE DOWNLOADED 5 TIMES PER HOUR"), 0o644)
	if err := loadPX1(p, counter{}); err == nil || !strings.Contains(err.Error(), "5 TIMES") {
		t.Fatalf("err %v", err)
	}
}

func TestOfNullsWhatWasNeverFetched(t *testing.T) {
	idx := &Index{At: map[string]time.Time{"bad": time.Now()}}
	o := idx.Of(0x010203)
	if o.Bad == nil || *o.Bad != 0 || o.Proxy != nil || o.VPN != nil {
		t.Fatalf("%+v", o)
	}
	if (*Index)(nil).Of(1).Bad != nil {
		t.Fatal("nil index")
	}
}

func TestSegOf(t *testing.T) {
	if _, s, ok := segOf("95.216.1.2"); !ok || s != "95.216.1.0/24" {
		t.Fatal(s)
	}
	for _, bad := range []string{"10.1.2.3", "100.64.1.1", "127.0.0.1", "2001:db8::1", "junk", "198.18.0.1", "240.0.0.1"} {
		if _, _, ok := segOf(bad); ok {
			t.Errorf("%s accepted", bad)
		}
	}
}

func TestCacheAndLimiter(t *testing.T) {
	now := time.Unix(0, 0)
	c := NewCache(2, time.Hour)
	c.now = func() time.Time { return now }
	c.Put(1, &Seg{Seg: "a"})
	c.Put(2, &Seg{Seg: "b"})
	c.Get(1)
	c.Put(3, &Seg{Seg: "c"}) // 2 is the oldest asked
	if c.Get(2) != nil || c.Get(1) == nil || c.Get(3) == nil {
		t.Fatal("lru")
	}
	now = now.Add(2 * time.Hour)
	if c.Get(1) != nil {
		t.Fatal("ttl")
	}
	l := NewLimiter(2, time.Hour)
	l.now = func() time.Time { return now }
	if !l.Allow("x") || !l.Allow("x") || l.Allow("x") || !l.Allow("y") {
		t.Fatal("limit")
	}
	now = now.Add(2 * time.Hour)
	if !l.Allow("x") {
		t.Fatal("window")
	}
}
