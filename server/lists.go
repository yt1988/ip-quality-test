package main

// The public lists a /24 is read against, downloaded once a day by `seg -update` and kept as a compact index: for each
// /24, which of its 256 addresses each list names (a 256-bit mask), and IPsum's score for each address it names.
//
//   proxy  IP2Proxy PX1 LITE: open public proxies (free with attribution; needs the account's download token)
//   bad    IPsum: addresses on many public blocklists, each with a score (how many lists name it)
//   tor    the Tor Project's exit list
//   vpn    X4BNet lists_vpn, output/vpn: VPN providers' ranges (MIT)
//   dc     X4BNet lists_vpn, output/datacenter: data centres and VPNs, anything not an eyeball network (MIT)
//   drop   Spamhaus DROP: ranges hijacked or run by criminals
//   relay  Apple iCloud Private Relay egress ranges (IPv4 and IPv6; Apple's public endpoint)
//   torrelay  the Tor Project's running relays (IPv4 and IPv6; Onionoo), to tell a relay from an exit
//   asndrop   Spamhaus ASN-DROP: autonomous systems run by criminals (IPv4 and IPv6)
//
// A list that couldn't be fetched keeps its last copy; one never fetched is absent, and the answer says so (null)
// rather than "none listed".

import (
	"archive/zip"
	"bufio"
	"bytes"
	"encoding/csv"
	"encoding/gob"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/bits"
	"net"
	"net/http"
	"net/netip"
	neturl "net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Mask: one bit per address of a /24 (bit i: the address .i)
type Mask [4]uint64

func (m *Mask) set(lo, hi int) {
	for i := lo; i <= hi; i++ {
		m[i>>6] |= 1 << (i & 63)
	}
}
func (m Mask) Has(i int) bool { return m[i>>6]>>(i&63)&1 == 1 }
func (m Mask) Count() int {
	return bits.OnesCount64(m[0]) + bits.OnesCount64(m[1]) + bits.OnesCount64(m[2]) + bits.OnesCount64(m[3])
}

// Bits: per /24 (its first address >> 8), which addresses a list names; sorted by /24
type Bits struct {
	K []uint32
	M []Mask
}

func (b Bits) Of(seg uint32) Mask {
	i := sort.Search(len(b.K), func(i int) bool { return b.K[i] >= seg })
	if i < len(b.K) && b.K[i] == seg {
		return b.M[i]
	}
	return Mask{}
}

// Scored: single addresses with a score (IPsum), sorted
type Scored struct {
	A []uint32
	S []uint8
}

func (x Scored) Of(seg uint32) (m Mask, score [256]uint8) {
	i := sort.Search(len(x.A), func(i int) bool { return x.A[i] >= seg<<8 })
	for ; i < len(x.A) && x.A[i]>>8 == seg; i++ {
		o := int(x.A[i] & 0xff)
		m.set(o, o)
		score[o] = x.S[i]
	}
	return
}

// Ranges: merged, sorted, inclusive [from, to] address ranges.
type Ranges struct{ F, T []uint32 }

// Has: is this address in one of the ranges?
func (r Ranges) Has(a uint32) bool {
	i := sort.Search(len(r.T), func(i int) bool { return r.T[i] >= a })
	return i < len(r.F) && r.F[i] <= a
}

// A16: an IPv6 address as bytes, so the index can be encoded with gob.
type A16 [16]byte

func cmp16(a, b A16) int { return bytes.Compare(a[:], b[:]) }

func inc16(a A16) (A16, bool) {
	for i := 15; i >= 0; i-- {
		a[i]++
		if a[i] != 0 {
			return a, true
		}
	}
	return a, false
}

// Ranges6: merged, sorted, inclusive IPv6 ranges.
type Ranges6 struct{ F, T []A16 }

func (r Ranges6) Has(a netip.Addr) bool {
	if !a.Is6() || a.Is4In6() {
		return false
	}
	x := A16(a.As16())
	i := sort.Search(len(r.T), func(i int) bool { return cmp16(r.T[i], x) >= 0 })
	return i < len(r.F) && cmp16(r.F[i], x) <= 0
}

func merge6(rs [][2]A16) Ranges6 {
	sort.Slice(rs, func(i, j int) bool { return cmp16(rs[i][0], rs[j][0]) < 0 })
	var out Ranges6
	for _, r := range rs {
		if n := len(out.T); n > 0 {
			last := out.T[n-1]
			adj, _ := inc16(last)
			if cmp16(r[0], last) <= 0 || cmp16(r[0], adj) == 0 {
				if cmp16(r[1], last) > 0 {
					out.T[n-1] = r[1]
				}
				continue
			}
		}
		out.F, out.T = append(out.F, r[0]), append(out.T, r[1])
	}
	return out
}

// range6: a prefix's first and last address (masked).
func range6(p netip.Prefix) (A16, A16, bool) {
	if !p.Addr().Is6() || p.Addr().Is4In6() {
		return A16{}, A16{}, false
	}
	p = p.Masked()
	f := A16(p.Addr().As16())
	t := f
	bits := p.Bits()
	for i := 0; i < 16; i++ {
		lo := i * 8
		if lo >= bits {
			t[i] = 0xff
			continue
		}
		if lo+8 > bits {
			t[i] |= byte((1 << (lo + 8 - bits)) - 1)
		}
	}
	return f, t, true
}

// Score: an address's IPsum score (0 when it isn't named).
func (x Scored) Score(a uint32) uint8 {
	i := sort.Search(len(x.A), func(i int) bool { return x.A[i] >= a })
	if i < len(x.A) && x.A[i] == a {
		return x.S[i]
	}
	return 0
}

func (r Ranges) Of(seg uint32) (m Mask) {
	lo, hi := seg<<8, seg<<8|0xff
	i := sort.Search(len(r.T), func(i int) bool { return r.T[i] >= lo })
	for ; i < len(r.F) && r.F[i] <= hi; i++ {
		a, b := max(r.F[i], lo), min(r.T[i], hi)
		if b >= a {
			m.set(int(a&0xff), int(b&0xff))
		}
	}
	return
}

type Index struct {
	At                map[string]time.Time // when each list was last fetched; absent: never
	Proxy             Bits
	Bad               Scored
	Tor               Bits
	VPN               Ranges
	DC                Ranges
	Drop              Ranges
	Relay4, TorRelay4 Ranges
	Relay6, TorRelay6 Ranges6
	ASNDrop           []uint32
	Cloud             []CloudRange // the providers' own published ranges (AWS, GCP, Cloudflare, Fastly)
	Cloud6            []CloudRange6
	Bogon             Ranges // Team Cymru's fullbogons: address space no one may route
	Bogon6            Ranges6
}

// IPLists: what the lists say about one address. The IPv4-only lists are false for IPv6.
type IPLists struct {
	Proxy    bool      `json:"proxy"`
	Bad      int       `json:"bad"`
	Tor      bool      `json:"tor"`
	VPN      bool      `json:"vpn"`
	DC       bool      `json:"dc"`
	Drop     bool      `json:"drop"`
	Relay    bool      `json:"relay"`
	TorRelay bool      `json:"torrelay"`
	ASNDrop  bool      `json:"asndrop"`
	At       time.Time `json:"at"`
}

// oldest: the fetch time of the oldest list among those that answered.
func (idx *Index) oldest(names ...string) time.Time {
	var out time.Time
	for _, n := range names {
		if at, ok := idx.At[n]; ok && !at.IsZero() && (out.IsZero() || at.Before(out)) {
			out = at
		}
	}
	return out
}

// OfIP: one address's list flags. asns are the ASes the address belongs to (for ASN-DROP).
func (idx *Index) OfIP(a netip.Addr, asns []int) (out IPLists) {
	if idx == nil {
		return
	}
	switch {
	case a.Is4():
		u, ok := v4(a.String())
		if !ok {
			return
		}
		seg, off := u>>8, int(u&0xff)
		out.Proxy = idx.Proxy.Of(seg).Has(off)
		out.Bad = int(idx.Bad.Score(u))
		out.Tor = idx.Tor.Of(seg).Has(off)
		out.VPN = idx.VPN.Of(seg).Has(off)
		out.DC = idx.DC.Of(seg).Has(off)
		out.Drop = idx.Drop.Of(seg).Has(off)
		out.Relay = idx.Relay4.Has(u)
		out.TorRelay = idx.TorRelay4.Has(u)
		out.At = idx.oldest("proxy", "bad", "tor", "vpn", "dc", "drop", "relay", "torrelay", "asndrop")
	case a.Is6() && !a.Is4In6():
		out.Relay = idx.Relay6.Has(a)
		out.TorRelay = idx.TorRelay6.Has(a)
		out.At = idx.oldest("relay", "torrelay", "asndrop")
	}
	for _, asn := range asns {
		if asn <= 0 {
			continue
		}
		i := sort.Search(len(idx.ASNDrop), func(i int) bool { return idx.ASNDrop[i] >= uint32(asn) })
		if i < len(idx.ASNDrop) && idx.ASNDrop[i] == uint32(asn) {
			out.ASNDrop = true
			break
		}
	}
	return
}

// Cloud: which hosting or CDN network an address belongs to, from the providers' own published ranges. A range may
// say which region it is (AWS and GCP do), and CDN ranges are marked as edges: an edge is shared infrastructure,
// not a server someone rented.
type CloudRange struct {
	F, T   uint32
	P      uint8 // index into cloudNames
	Region string
	Edge   bool
}

type CloudRange6 struct {
	F, T   A16
	P      uint8
	Region string
	Edge   bool
}

var cloudNames = []string{"aws", "gcp", "azure", "cloudflare", "fastly"}

func cloudID(name string) uint8 {
	for i, n := range cloudNames {
		if n == name {
			return uint8(i)
		}
	}
	return 0
}

// CloudOfIP: the provider, region and whether it is a CDN edge, for an address in one of the published ranges.
func (idx *Index) CloudOfIP(a netip.Addr) (name, region string, edge bool) {
	if idx == nil {
		return
	}
	if a.Is4() {
		u, ok := v4(a.String())
		if !ok {
			return
		}
		i := sort.Search(len(idx.Cloud), func(i int) bool { return idx.Cloud[i].F > u }) - 1
		if i >= 0 && idx.Cloud[i].T >= u {
			r := idx.Cloud[i]
			return cloudNames[r.P], r.Region, r.Edge
		}
		return
	}
	if a.Is6() && !a.Is4In6() {
		x := A16(a.As16())
		i := sort.Search(len(idx.Cloud6), func(i int) bool { return cmp16(idx.Cloud6[i].F, x) > 0 }) - 1
		if i >= 0 && cmp16(idx.Cloud6[i].T, x) >= 0 {
			r := idx.Cloud6[i]
			return cloudNames[r.P], r.Region, r.Edge
		}
	}
	return
}

// BogonOf: space on Team Cymru's fullbogon list — never allocated, or reserved and not meant to be routed.
func (idx *Index) BogonOf(a netip.Addr) bool {
	if idx == nil {
		return false
	}
	if a.Is4() {
		if u, ok := v4(a.String()); ok {
			return idx.Bogon.Has(u)
		}
		return false
	}
	return a.Is6() && !a.Is4In6() && idx.Bogon6.Has(a)
}

// Near: how many addresses of the /24 an address is in are named by the lists. Listed counts every address any list
// names; the per-list counts say which list (an address named by two lists counts once in Listed).
type Near struct {
	Of     int `json:"of"`
	Listed int `json:"listed"`
	Bad    int `json:"bad"`
	Proxy  int `json:"proxy"`
	Tor    int `json:"tor"`
	VPN    int `json:"vpn"`
	DC     int `json:"dc"`
	Drop   int `json:"drop"`
}

// maskInRanges: the offsets of a /24 (lo..hi) that a merged range list covers.
func maskInRanges(r Ranges, lo, hi uint32) Mask {
	var m Mask
	i := sort.Search(len(r.T), func(i int) bool { return r.T[i] >= lo })
	for ; i < len(r.F) && r.F[i] <= hi; i++ {
		f, t := max(r.F[i], lo), min(r.T[i], hi)
		for off := int(f - lo); off <= int(t-lo); off++ {
			m.set(off, off)
		}
	}
	return m
}

// NearOf: the /24's list counts for the address at seg<<8. IPv6 has no /24, so this is only asked for IPv4.
func (idx *Index) NearOf(seg uint32) (n Near) {
	n.Of = 256
	if idx == nil {
		return
	}
	lo, hi := seg<<8, seg<<8|0xff
	bad, _ := idx.Bad.Of(seg)
	px := idx.Proxy.Of(seg)
	tor := idx.Tor.Of(seg)
	vpn := maskInRanges(idx.VPN, lo, hi)
	dc := maskInRanges(idx.DC, lo, hi)
	drop := maskInRanges(idx.Drop, lo, hi)
	var all Mask
	for i := range all {
		all[i] = bad[i] | px[i] | tor[i] | vpn[i] | dc[i] | drop[i]
	}
	n.Listed = all.Count()
	n.Bad = bad.Count()
	n.Proxy = px.Count()
	n.Tor = tor.Count()
	n.VPN = vpn.Count()
	n.DC = dc.Count()
	n.Drop = drop.Count()
	return
}

// building Bits: addresses and ranges (split at /24 boundaries) set into each /24's mask
type bitset map[uint32]*Mask

func (b bitset) add(from, to uint32) {
	for seg := from >> 8; seg <= to>>8; seg++ {
		lo, hi := max(from, seg<<8), min(to, seg<<8|0xff)
		m := b[seg]
		if m == nil {
			m = &Mask{}
			b[seg] = m
		}
		m.set(int(lo&0xff), int(hi&0xff))
		if seg == 0xffffff {
			break
		}
	}
}

func (b bitset) bits() Bits {
	out := Bits{K: make([]uint32, 0, len(b))}
	for k := range b {
		out.K = append(out.K, k)
	}
	sort.Slice(out.K, func(i, j int) bool { return out.K[i] < out.K[j] })
	out.M = make([]Mask, len(out.K))
	for i, k := range out.K {
		out.M[i] = *b[k]
	}
	return out
}

// building Scored: the highest score an address is given
type scores map[uint32]int

func (s scores) add(from, to uint32, score int) {
	if to-from > 65535 {
		return // IPsum lists single addresses; a range this wide isn't one of them
	}
	for a := from; ; a++ {
		s[a] = max(s[a], score)
		if a == to {
			break
		}
	}
}

func (s scores) scored() Scored {
	out := Scored{A: make([]uint32, 0, len(s))}
	for a := range s {
		out.A = append(out.A, a)
	}
	sort.Slice(out.A, func(i, j int) bool { return out.A[i] < out.A[j] })
	out.S = make([]uint8, len(out.A))
	for i, a := range out.A {
		out.S[i] = uint8(min(max(s[a], 1), 255))
	}
	return out
}

func merge(rs [][2]uint32) Ranges {
	sort.Slice(rs, func(i, j int) bool { return rs[i][0] < rs[j][0] })
	var out Ranges
	for _, r := range rs {
		if n := len(out.T); n > 0 && uint64(r[0]) <= uint64(out.T[n-1])+1 {
			out.T[n-1] = max(out.T[n-1], r[1])
			continue
		}
		out.F, out.T = append(out.F, r[0]), append(out.T, r[1])
	}
	return out
}

func v4(s string) (uint32, bool) {
	a, err := netip.ParseAddr(strings.TrimSpace(s))
	if err != nil || !a.Is4() {
		return 0, false
	}
	b := a.As4()
	return uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3]), true
}

// a line's first token as an IPv4 address or CIDR → its range
func rangeOf(tok string) (uint32, uint32, bool) {
	if p, err := netip.ParsePrefix(tok); err == nil {
		if !p.Addr().Is4() {
			return 0, 0, false
		}
		p = p.Masked()
		f, _ := v4(p.Addr().String())
		return f, f | uint32(uint64(1)<<(32-p.Bits())-1), true
	}
	if a, ok := v4(tok); ok {
		return a, a, true
	}
	return 0, 0, false
}

// Plain lists: one address or CIDR per line (comments with #, ;); IPsum adds the score after a tab.
func parseLines(r io.Reader, scored bool, each func(from, to uint32, score int)) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		f := strings.FieldsFunc(line, func(c rune) bool { return c == ' ' || c == '\t' || c == ';' })
		from, to, ok := rangeOf(f[0])
		if !ok {
			continue
		}
		score := 0
		if scored && len(f) > 1 {
			score, _ = strconv.Atoi(f[1])
		}
		each(from, to, score)
	}
	return sc.Err()
}

// IP2Proxy PX1 LITE CSV: "ip_from","ip_to","country_code","country_name", addresses as decimal numbers
func parsePX1(r io.Reader, each func(from, to uint32)) error {
	cr := csv.NewReader(bufio.NewReaderSize(r, 1<<20))
	cr.FieldsPerRecord = -1
	cr.ReuseRecord = true
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if len(rec) < 2 {
			continue
		}
		f, e1 := strconv.ParseUint(rec[0], 10, 32)
		t, e2 := strconv.ParseUint(rec[1], 10, 32)
		if e1 != nil || e2 != nil || t < f {
			continue
		}
		each(uint32(f), uint32(t))
	}
}

// Apple iCloud Private Relay egress ranges: "prefix,country,region,city," per line, IPv4 and IPv6.
func parseRelay(r io.Reader, v4rs *[][2]uint32, v6rs *[][2]A16) error {
	cr := csv.NewReader(bufio.NewReaderSize(r, 1<<20))
	cr.FieldsPerRecord = -1
	cr.ReuseRecord = true
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if len(rec) < 1 {
			continue
		}
		p, err := netip.ParsePrefix(strings.TrimSpace(rec[0]))
		if err != nil {
			continue
		}
		p = p.Masked()
		switch {
		case p.Addr().Is4():
			if f, t, ok := rangeOf(p.String()); ok {
				*v4rs = append(*v4rs, [2]uint32{f, t})
			}
		case p.Addr().Is6() && !p.Addr().Is4In6():
			if f, t, ok := range6(p); ok {
				*v6rs = append(*v6rs, [2]A16{f, t})
			}
		}
	}
}

// Onionoo's running relays: or_addresses holds "ip:port" and "[ipv6]:port" strings.
func parseTorRelay(r io.Reader, v4rs *[][2]uint32, v6rs *[][2]A16) error {
	var j struct {
		Relays []struct {
			Or []string `json:"or_addresses"`
		} `json:"relays"`
	}
	if err := json.NewDecoder(bufio.NewReaderSize(r, 1<<20)).Decode(&j); err != nil {
		return err
	}
	for _, rel := range j.Relays {
		for _, s := range rel.Or {
			host := s
			if h, _, err := net.SplitHostPort(s); err == nil {
				host = h
			}
			a, err := netip.ParseAddr(strings.Trim(host, "[]"))
			if err != nil {
				continue
			}
			switch {
			case a.Is4():
				if u, ok := v4(a.String()); ok {
					*v4rs = append(*v4rs, [2]uint32{u, u})
				}
			case a.Is6() && !a.Is4In6():
				x := A16(a.As16())
				*v6rs = append(*v6rs, [2]A16{x, x})
			}
		}
	}
	return nil
}

// Spamhaus ASN-DROP: one JSON object per line, each with an "asn".
func parseASNDrop(r io.Reader) ([]uint32, error) {
	dec := json.NewDecoder(bufio.NewReaderSize(r, 1<<20))
	set := map[uint32]bool{}
	for {
		var rec struct {
			ASN uint32 `json:"asn"`
		}
		err := dec.Decode(&rec)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if rec.ASN > 0 {
			set[rec.ASN] = true
		}
	}
	out := make([]uint32, 0, len(set))
	for a := range set {
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out, nil
}

// AWS's ip-ranges.json: every prefix with its region and service. CloudFront's prefixes are the CDN edge.
func parseAWS(r io.Reader) (v4 []CloudRange, v6 []CloudRange6, err error) {
	var j struct {
		Prefixes []struct {
			Prefix  string `json:"ip_prefix"`
			Region  string `json:"region"`
			Service string `json:"service"`
		} `json:"prefixes"`
		V6 []struct {
			Prefix  string `json:"ipv6_prefix"`
			Region  string `json:"region"`
			Service string `json:"service"`
		} `json:"ipv6_prefixes"`
	}
	if err = json.NewDecoder(bufio.NewReaderSize(r, 1<<20)).Decode(&j); err != nil {
		return
	}
	p := cloudID("aws")
	for _, x := range j.Prefixes {
		if f, t, ok := rangeOf(x.Prefix); ok {
			v4 = append(v4, CloudRange{F: f, T: t, P: p, Region: x.Region, Edge: x.Service == "CLOUDFRONT"})
		}
	}
	for _, x := range j.V6 {
		if f, t, ok := cloudRange6(x.Prefix); ok {
			v6 = append(v6, CloudRange6{F: f, T: t, P: p, Region: x.Region, Edge: x.Service == "CLOUDFRONT"})
		}
	}
	return
}

// GCP's cloud.json: ipv4Prefix or ipv6Prefix with a scope.
func parseGCP(r io.Reader) (v4 []CloudRange, v6 []CloudRange6, err error) {
	var j struct {
		Prefixes []struct {
			V4    string `json:"ipv4Prefix"`
			V6    string `json:"ipv6Prefix"`
			Scope string `json:"scope"`
		} `json:"prefixes"`
	}
	if err = json.NewDecoder(bufio.NewReaderSize(r, 1<<20)).Decode(&j); err != nil {
		return
	}
	p := cloudID("gcp")
	for _, x := range j.Prefixes {
		if x.V4 != "" {
			if f, t, ok := rangeOf(x.V4); ok {
				v4 = append(v4, CloudRange{F: f, T: t, P: p, Region: x.Scope})
			}
		}
		if x.V6 != "" {
			if f, t, ok := cloudRange6(x.V6); ok {
				v6 = append(v6, CloudRange6{F: f, T: t, P: p, Region: x.Scope})
			}
		}
	}
	return
}

// Cloudflare's edge: one prefix per line.
func parseCloudflare(r io.Reader) (v4 []CloudRange, v6 []CloudRange6, err error) {
	p := cloudID("cloudflare")
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || line[0] == '#' {
			continue
		}
		if f, t, ok := rangeOf(line); ok {
			v4 = append(v4, CloudRange{F: f, T: t, P: p, Edge: true})
		} else if f, t, ok := cloudRange6(line); ok {
			v6 = append(v6, CloudRange6{F: f, T: t, P: p, Edge: true})
		}
	}
	return v4, v6, sc.Err()
}

// Fastly's public IP list.
func parseFastly(r io.Reader) (v4 []CloudRange, v6 []CloudRange6, err error) {
	var j struct {
		Addresses []string `json:"addresses"`
		V6        []string `json:"ipv6_addresses"`
	}
	if err = json.NewDecoder(bufio.NewReaderSize(r, 1<<20)).Decode(&j); err != nil {
		return
	}
	p := cloudID("fastly")
	for _, s := range j.Addresses {
		if f, t, ok := rangeOf(s); ok {
			v4 = append(v4, CloudRange{F: f, T: t, P: p, Edge: true})
		}
	}
	for _, s := range j.V6 {
		if f, t, ok := cloudRange6(s); ok {
			v6 = append(v6, CloudRange6{F: f, T: t, P: p, Edge: true})
		}
	}
	return
}

// A CIDR or address as a v6 range; anything with a v4 prefix or no colon is not one.
func cloudRange6(s string) (A16, A16, bool) {
	p, err := netip.ParsePrefix(strings.TrimSpace(s))
	if err != nil {
		return A16{}, A16{}, false
	}
	if p.Addr().Is4() || p.Addr().Is4In6() {
		return A16{}, A16{}, false
	}
	return range6(p.Masked())
}

// Team Cymru's fullbogon v6 list: one prefix per line.
func parseBogon6(r io.Reader) (Ranges6, error) {
	var rs [][2]A16
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		if f, t, ok := cloudRange6(line); ok {
			rs = append(rs, [2]A16{f, t})
		}
	}
	return merge6(rs), sc.Err()
}

// Sources, by list name. The IP2Proxy URL takes the account's download token.
var sources = map[string]string{
	"proxy":    "https://www.ip2location.com/download/?token=%s&file=PX1LITECSV",
	"bad":      "https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt",
	"tor":      "https://check.torproject.org/torbulkexitlist",
	"vpn":      "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt",
	"dc":       "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt",
	"drop":     "https://www.spamhaus.org/drop/drop.txt",
	"relay":    "https://mask-api.icloud.com/egress-ip-ranges.csv",
	"torrelay": "https://onionoo.torproject.org/details?type=relay&running=true&fields=or_addresses",
	"asndrop":  "https://www.spamhaus.org/drop/asndrop.json",
	"aws":      "https://ip-ranges.amazonaws.com/ip-ranges.json",
	"gcp":      "https://www.gstatic.com/ipranges/cloud.json",
	"cf4":      "https://www.cloudflare.com/ips-v4",
	"cf6":      "https://www.cloudflare.com/ips-v6",
	"fastly":   "https://api.fastly.com/public-ip-list",
	"bogon4":   "https://www.team-cymru.org/Services/Bogons/fullbogons-ipv4.txt",
	"bogon6":   "https://www.team-cymru.org/Services/Bogons/fullbogons-ipv6.txt",
}

var client = &http.Client{Timeout: 10 * time.Minute}

// fetch a list to a temporary file in dir (removed by the caller)
func fetch(dir, url string) (string, error) {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "1ms.dog ipqs lists (+https://ipqs.1ms.dog)")
	res, err := client.Do(req)
	if err != nil {
		// without the URL: IP2Proxy's holds the account's token, and this error goes to the system log
		var ue *neturl.Error
		if errors.As(err, &ue) {
			return "", ue.Err
		}
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", fmt.Errorf("HTTP %d", res.StatusCode)
	}
	f, err := os.CreateTemp(dir, "dl-*")
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := io.Copy(f, io.LimitReader(res.Body, 1<<30)); err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

func loadPX1(path string, b bitset) error {
	z, err := zip.OpenReader(path)
	if err != nil {
		// a refused token answers with a short text page instead of the zip
		raw, _ := os.ReadFile(path)
		return fmt.Errorf("not a zip (%q)", strings.TrimSpace(string(raw[:min(len(raw), 80)])))
	}
	defer z.Close()
	for _, f := range z.File {
		if strings.HasSuffix(strings.ToUpper(f.Name), ".CSV") {
			r, err := f.Open()
			if err != nil {
				return err
			}
			defer r.Close()
			return parsePX1(r, b.add)
		}
	}
	return errors.New("no CSV in the zip")
}

// mergeCloud: AWS publishes one prefix once per service (13.32.0.0/15 is both AMAZON and CLOUDFRONT), so ranges that
// overlap are made one — an edge marking wins, a region is kept — and the lookup can then be a plain search over
// disjoint ranges. IPv4 and IPv6 come from the same lists; each family has its own index.
func mergeCloud(v []CloudRange) []CloudRange {
	sort.Slice(v, func(i, j int) bool {
		if v[i].F != v[j].F {
			return v[i].F < v[j].F
		}
		return v[i].T > v[j].T
	})
	out := v[:0]
	for _, r := range v {
		if n := len(out); n > 0 && r.F <= out[n-1].T {
			if r.T > out[n-1].T {
				out[n-1].T = r.T
			}
			out[n-1].Edge = out[n-1].Edge || r.Edge
			if out[n-1].Region == "" {
				out[n-1].Region = r.Region
			}
			continue
		}
		out = append(out, r)
	}
	return out
}

func mergeCloud6(v []CloudRange6) []CloudRange6 {
	sort.Slice(v, func(i, j int) bool {
		if c := cmp16(v[i].F, v[j].F); c != 0 {
			return c < 0
		}
		return cmp16(v[i].T, v[j].T) > 0
	})
	out := v[:0]
	for _, r := range v {
		if n := len(out); n > 0 && cmp16(r.F, out[n-1].T) <= 0 {
			if cmp16(r.T, out[n-1].T) > 0 {
				out[n-1].T = r.T
			}
			out[n-1].Edge = out[n-1].Edge || r.Edge
			if out[n-1].Region == "" {
				out[n-1].Region = r.Region
			}
			continue
		}
		out = append(out, r)
	}
	return out
}

// setCloud4 / setCloud6 replace one provider's ranges of that family (Cloudflare publishes its IPv4 and IPv6 edges as
// two files, so the two sides are set apart); setCloud sets both.
func (idx *Index) setCloud4(p uint8, v4 []CloudRange) {
	keep := idx.Cloud[:0]
	for _, x := range idx.Cloud {
		if x.P != p {
			keep = append(keep, x)
		}
	}
	idx.Cloud = append(keep, mergeCloud(v4)...)
	sort.Slice(idx.Cloud, func(i, j int) bool { return idx.Cloud[i].F < idx.Cloud[j].F })
}

func (idx *Index) setCloud6(p uint8, v6 []CloudRange6) {
	keep := idx.Cloud6[:0]
	for _, x := range idx.Cloud6 {
		if x.P != p {
			keep = append(keep, x)
		}
	}
	idx.Cloud6 = append(keep, mergeCloud6(v6)...)
	sort.Slice(idx.Cloud6, func(i, j int) bool { return cmp16(idx.Cloud6[i].F, idx.Cloud6[j].F) < 0 })
}

func (idx *Index) setCloud(p uint8, v4 []CloudRange, v6 []CloudRange6) {
	idx.setCloud4(p, v4)
	idx.setCloud6(p, v6)
}

// Update fetches every list into a new index, keeping the old copy of any list that fails, and writes it atomically.
func Update(dir, token string, old *Index) (*Index, []error) {
	idx := &Index{At: map[string]time.Time{}}
	if old != nil {
		*idx = *old
		idx.At = map[string]time.Time{}
		for k, v := range old.At {
			idx.At[k] = v
		}
	}
	var errs []error
	for _, name := range []string{"proxy", "bad", "tor", "vpn", "dc", "drop", "relay", "torrelay", "asndrop",
		"aws", "gcp", "cf4", "cf6", "fastly", "bogon4", "bogon6"} {
		url := sources[name]
		if name == "proxy" {
			if token == "" {
				errs = append(errs, errors.New("proxy: no IP2Proxy download token"))
				continue
			}
			url = fmt.Sprintf(url, token)
		}
		path, err := fetch(dir, url)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", name, err))
			continue
		}
		b, sc, rs := bitset{}, scores{}, [][2]uint32{}
		r6 := [][2]A16{}
		var asns []uint32
		var cv4 []CloudRange
		var cv6 []CloudRange6
		var bog6 Ranges6
		switch name {
		case "proxy":
			err = loadPX1(path, b)
		case "bad":
			err = withFile(path, func(r io.Reader) error { return parseLines(r, true, sc.add) })
		case "tor":
			err = withFile(path, func(r io.Reader) error {
				return parseLines(r, false, func(f, t uint32, _ int) { b.add(f, t) })
			})
		case "relay":
			err = withFile(path, func(r io.Reader) error { return parseRelay(r, &rs, &r6) })
		case "torrelay":
			err = withFile(path, func(r io.Reader) error { return parseTorRelay(r, &rs, &r6) })
		case "asndrop":
			err = withFile(path, func(r io.Reader) error {
				var e error
				asns, e = parseASNDrop(r)
				return e
			})
		case "aws":
			err = withFile(path, func(r io.Reader) error { var e error; cv4, cv6, e = parseAWS(r); return e })
		case "gcp":
			err = withFile(path, func(r io.Reader) error { var e error; cv4, cv6, e = parseGCP(r); return e })
		case "cf4", "cf6":
			err = withFile(path, func(r io.Reader) error { var e error; cv4, cv6, e = parseCloudflare(r); return e })
		case "fastly":
			err = withFile(path, func(r io.Reader) error { var e error; cv4, cv6, e = parseFastly(r); return e })
		case "bogon4":
			err = withFile(path, func(r io.Reader) error {
				return parseLines(r, false, func(f, t uint32, _ int) { rs = append(rs, [2]uint32{f, t}) })
			})
		case "bogon6":
			err = withFile(path, func(r io.Reader) error { var e error; bog6, e = parseBogon6(r); return e })
		default:
			err = withFile(path, func(r io.Reader) error {
				return parseLines(r, false, func(f, t uint32, _ int) { rs = append(rs, [2]uint32{f, t}) })
			})
		}
		os.Remove(path)
		if err == nil && len(b) == 0 && len(sc) == 0 && len(rs) == 0 && len(r6) == 0 && len(asns) == 0 &&
			len(cv4) == 0 && len(cv6) == 0 && len(bog6.F) == 0 {
			err = errors.New("empty")
		}
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", name, err))
			continue
		}
		switch name {
		case "proxy":
			idx.Proxy = b.bits()
		case "bad":
			idx.Bad = sc.scored()
		case "tor":
			idx.Tor = b.bits()
		case "vpn":
			idx.VPN = merge(rs)
		case "dc":
			idx.DC = merge(rs)
		case "drop":
			idx.Drop = merge(rs)
		case "relay":
			idx.Relay4, idx.Relay6 = merge(rs), merge6(r6)
		case "torrelay":
			idx.TorRelay4, idx.TorRelay6 = merge(rs), merge6(r6)
		case "asndrop":
			idx.ASNDrop = asns
		case "aws", "gcp", "fastly":
			idx.setCloud(cloudID(name), cv4, cv6)
		case "cf4":
			// Cloudflare publishes its IPv4 and IPv6 edges as two files: each replaces only its own family
			idx.setCloud4(cloudID("cloudflare"), cv4)
		case "cf6":
			idx.setCloud6(cloudID("cloudflare"), cv6)
		case "bogon4":
			idx.Bogon = merge(rs)
		case "bogon6":
			idx.Bogon6 = bog6
		}
		idx.At[name] = time.Now().UTC()
	}
	return idx, errs
}

func withFile(path string, fn func(io.Reader) error) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return fn(f)
}

// lists2.gob: the per-address index (lists.gob was the first, per-/24 counts only)
const indexFile = "lists2.gob"

func Save(dir string, idx *Index) error {
	tmp, err := os.CreateTemp(dir, "lists-*.tmp")
	if err != nil {
		return err
	}
	if err := gob.NewEncoder(tmp).Encode(idx); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	tmp.Close()
	return os.Rename(tmp.Name(), filepath.Join(dir, indexFile))
}

func Load(dir string) (*Index, time.Time, error) {
	p := filepath.Join(dir, indexFile)
	st, err := os.Stat(p)
	if err != nil {
		return nil, time.Time{}, err
	}
	f, err := os.Open(p)
	if err != nil {
		return nil, time.Time{}, err
	}
	defer f.Close()
	var idx Index
	if err := gob.NewDecoder(f).Decode(&idx); err != nil {
		return nil, time.Time{}, err
	}
	return &idx, st.ModTime(), nil
}

// Per-address flags in an answer
const (
	FProxy = 1 << iota
	FBad
	FTor
	FVPN
	FDC
	FDrop
)

// ListsOf: the /24's count for each list; nil for a list never fetched.
type ListsOf struct {
	Proxy  *int      `json:"proxy"`  // open proxies among its addresses
	Bad    *int      `json:"bad"`    // addresses on IPsum
	BadMax int       `json:"badMax"` // the highest IPsum score among them (how many blocklists name it)
	Tor    *int      `json:"tor"`    // Tor exits
	VPN    *int      `json:"vpn"`    // addresses in VPN providers' ranges (0–256)
	DC     *int      `json:"dc"`     // addresses in data-centre ranges (0–256)
	Drop   *int      `json:"drop"`   // addresses in Spamhaus DROP ranges (0–256)
	At     time.Time `json:"at"`     // the oldest list's fetch time
}

// Of: the /24's counts, and for each of its addresses the lists naming it (F* flags) and its IPsum score.
func (idx *Index) Of(seg uint32) (out ListsOf, flags []int, score []int) {
	flags, score = make([]int, 256), make([]int, 256)
	if idx == nil {
		return
	}
	put := func(name string, m Mask, f int) *int {
		if _, ok := idx.At[name]; !ok {
			return nil
		}
		if out.At.IsZero() || idx.At[name].Before(out.At) {
			out.At = idx.At[name]
		}
		for i := 0; i < 256; i++ {
			if m.Has(i) {
				flags[i] |= f
			}
		}
		n := m.Count()
		return &n
	}
	bad, sc := idx.Bad.Of(seg)
	out.Proxy = put("proxy", idx.Proxy.Of(seg), FProxy)
	out.Bad = put("bad", bad, FBad)
	out.Tor = put("tor", idx.Tor.Of(seg), FTor)
	out.VPN = put("vpn", idx.VPN.Of(seg), FVPN)
	out.DC = put("dc", idx.DC.Of(seg), FDC)
	out.Drop = put("drop", idx.Drop.Of(seg), FDrop)
	for i, s := range sc {
		score[i] = int(s)
		out.BadMax = max(out.BadMax, int(s))
	}
	return
}
