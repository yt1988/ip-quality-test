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
//
// A list that couldn't be fetched keeps its last copy; one never fetched is absent, and the answer says so (null)
// rather than "none listed".

import (
	"archive/zip"
	"bufio"
	"encoding/csv"
	"encoding/gob"
	"errors"
	"fmt"
	"io"
	"math/bits"
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
	At    map[string]time.Time // when each list was last fetched; absent: never
	Proxy Bits
	Bad   Scored
	Tor   Bits
	VPN   Ranges
	DC    Ranges
	Drop  Ranges
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

// Sources, by list name. The IP2Proxy URL takes the account's download token.
var sources = map[string]string{
	"proxy": "https://www.ip2location.com/download/?token=%s&file=PX1LITECSV",
	"bad":   "https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt",
	"tor":   "https://check.torproject.org/torbulkexitlist",
	"vpn":   "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt",
	"dc":    "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt",
	"drop":  "https://www.spamhaus.org/drop/drop.txt",
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
	for _, name := range []string{"proxy", "bad", "tor", "vpn", "dc", "drop"} {
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
		switch name {
		case "proxy":
			err = loadPX1(path, b)
		case "bad":
			err = withFile(path, func(r io.Reader) error { return parseLines(r, true, sc.add) })
		case "tor":
			err = withFile(path, func(r io.Reader) error {
				return parseLines(r, false, func(f, t uint32, _ int) { b.add(f, t) })
			})
		default:
			err = withFile(path, func(r io.Reader) error {
				return parseLines(r, false, func(f, t uint32, _ int) { rs = append(rs, [2]uint32{f, t}) })
			})
		}
		os.Remove(path)
		if err == nil && len(b) == 0 && len(sc) == 0 && len(rs) == 0 {
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
