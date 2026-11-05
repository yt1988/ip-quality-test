package main

// The public lists a /24 is read against, downloaded once a day by `seg -update` and kept as a compact index (a few
// MB): per /24, how many of its addresses a list names, and for range lists, how much of the /24 they cover.
//
//   proxy  IP2Proxy PX1 LITE: open public proxies (free with attribution; needs the account's download token)
//   bad    IPsum: addresses on many public blocklists, each with a score (how many lists name it, 1–10)
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
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Counts: per /24 (its first address >> 8), how many addresses a list names, and the highest score among them.
type Counts struct {
	K []uint32
	N []uint16
	S []uint8
}

func (c Counts) Get(seg uint32) (n int, s int) {
	i := sort.Search(len(c.K), func(i int) bool { return c.K[i] >= seg })
	if i < len(c.K) && c.K[i] == seg {
		return int(c.N[i]), int(c.S[i])
	}
	return 0, 0
}

// Ranges: merged, sorted, inclusive [from, to] address ranges.
type Ranges struct{ F, T []uint32 }

// Cover: how many addresses of the /24 the ranges hold (0–256).
func (r Ranges) Cover(seg uint32) int {
	lo, hi := seg<<8, seg<<8|0xff
	i := sort.Search(len(r.T), func(i int) bool { return r.T[i] >= lo })
	n := 0
	for ; i < len(r.F) && r.F[i] <= hi; i++ {
		a, b := max(r.F[i], lo), min(r.T[i], hi)
		if b >= a {
			n += int(b-a) + 1
		}
	}
	return n
}

type Index struct {
	At    map[string]time.Time // when each list was last fetched; absent: never
	Proxy Counts
	Bad   Counts
	Tor   Counts
	VPN   Ranges
	DC    Ranges
	Drop  Ranges
}

// counting addresses (and ranges, split at /24 boundaries) into Counts
type counter map[uint32][2]int

func (c counter) add(from, to uint32, score int) {
	for seg := from >> 8; seg <= to>>8; seg++ {
		lo, hi := max(from, seg<<8), min(to, seg<<8|0xff)
		v := c[seg]
		v[0] += int(hi-lo) + 1
		v[1] = max(v[1], score)
		c[seg] = v
		if seg == 0xffffff {
			break
		}
	}
}

func (c counter) counts() Counts {
	out := Counts{K: make([]uint32, 0, len(c))}
	for k := range c {
		out.K = append(out.K, k)
	}
	sort.Slice(out.K, func(i, j int) bool { return out.K[i] < out.K[j] })
	out.N, out.S = make([]uint16, len(out.K)), make([]uint8, len(out.K))
	for i, k := range out.K {
		out.N[i], out.S[i] = uint16(min(c[k][0], 256)), uint8(min(c[k][1], 255))
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

func loadPX1(path string, c counter) error {
	z, err := zip.OpenReader(path)
	if err != nil {
		// a refused token answers with a short text page instead of the zip
		b, _ := os.ReadFile(path)
		return fmt.Errorf("not a zip (%q)", strings.TrimSpace(string(b[:min(len(b), 80)])))
	}
	defer z.Close()
	for _, f := range z.File {
		if strings.HasSuffix(strings.ToUpper(f.Name), ".CSV") {
			r, err := f.Open()
			if err != nil {
				return err
			}
			defer r.Close()
			return parsePX1(r, func(from, to uint32) { c.add(from, to, 0) })
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
		c, rs := counter{}, [][2]uint32{}
		switch name {
		case "proxy":
			err = loadPX1(path, c)
		case "bad", "tor":
			err = withFile(path, func(r io.Reader) error {
				return parseLines(r, name == "bad", func(f, t uint32, s int) { c.add(f, t, s) })
			})
		default:
			err = withFile(path, func(r io.Reader) error {
				return parseLines(r, false, func(f, t uint32, _ int) { rs = append(rs, [2]uint32{f, t}) })
			})
		}
		os.Remove(path)
		if err == nil && len(c) == 0 && len(rs) == 0 {
			err = errors.New("empty")
		}
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", name, err))
			continue
		}
		switch name {
		case "proxy":
			idx.Proxy = c.counts()
		case "bad":
			idx.Bad = c.counts()
		case "tor":
			idx.Tor = c.counts()
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

const indexFile = "lists.gob"

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

// ListsOf: the /24's line for each list; nil for a list never fetched.
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

func (idx *Index) Of(seg uint32) ListsOf {
	var out ListsOf
	if idx == nil {
		return out
	}
	p := func(name string, n int) *int {
		if _, ok := idx.At[name]; !ok {
			return nil
		}
		if out.At.IsZero() || idx.At[name].Before(out.At) {
			out.At = idx.At[name]
		}
		return &n
	}
	n, _ := idx.Proxy.Get(seg)
	out.Proxy = p("proxy", n)
	n, s := idx.Bad.Get(seg)
	out.Bad, out.BadMax = p("bad", n), s
	n, _ = idx.Tor.Get(seg)
	out.Tor = p("tor", n)
	out.VPN = p("vpn", idx.VPN.Cover(seg))
	out.DC = p("dc", idx.DC.Cover(seg))
	out.Drop = p("drop", idx.Drop.Cover(seg))
	return out
}
