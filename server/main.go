// 1ms-ipqs: the /24 portrait for ipqs.1ms.dog, on the 1ms.dog VPS.
//
//	GET /v1/seg?ip=1.2.3.4 → the /24 that holds the address: its reverse names read for what they say (hosting,
//	home access, …), the prefix it is announced in, and how many of its addresses public lists name (open proxies,
//	blocklists, Tor exits, VPN and data-centre ranges, Spamhaus DROP).
//
// Nothing is contacted but resolvers (for the names) and RIPEstat: no address of the /24 is probed. The names and
// prefix of a /24 are cached in memory for 7 days (at most 5,000 /24s); the lists are read fresh on every request. No
// request is logged, and the server's own error log is silenced (it would name clients).
//
//	seg -addr :8444 -cert fullchain.pem -key privkey.pem -data /var/lib/1ms-ipqs     the API
//	seg -update -data /var/lib/1ms-ipqs                                               fetch the lists (daily)
//
// The IP2Proxy download token is read from $IP2PROXY_TOKEN or the systemd credential "ip2proxy" (an empty one: none).
// Port, directory, user and service names are as registered in 1ms-shell docs/processes.md ("专用服务器").
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8447", "address to serve on")
	cert := flag.String("cert", "", "TLS certificate chain (PEM); plain HTTP without one (local tests)")
	key := flag.String("key", "", "TLS private key (PEM)")
	data := flag.String("data", "./data", "directory of the lists index")
	update := flag.Bool("update", false, "fetch the lists, write the index and exit")
	flag.Parse()
	log.SetFlags(0)
	os.MkdirAll(*data, 0o755)

	if *update {
		old, _, _ := Load(*data)
		idx, errs := Update(*data, token(), old)
		for _, e := range errs {
			log.Print("lists ", e)
		}
		if err := Save(*data, idx); err != nil {
			log.Fatal("save: ", err)
		}
		return
	}

	s := &Server{data: *data, cache: NewCache(3000, 7*24*time.Hour), limit: NewLimiter(30, time.Hour), slots: make(chan struct{}, 4)}
	s.reload()
	go func() {
		for range time.Tick(10 * time.Minute) {
			s.reload()
		}
	}()
	srv := &http.Server{Addr: *addr, Handler: s, ErrorLog: log.New(io.Discard, "", 0),
		ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	if *cert != "" {
		srv.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
		log.Fatal(srv.ListenAndServeTLS(*cert, *key))
	}
	log.Fatal(srv.ListenAndServe())
}

func token() string {
	if t := strings.TrimSpace(os.Getenv("IP2PROXY_TOKEN")); t != "" {
		return t
	}
	if d := os.Getenv("CREDENTIALS_DIRECTORY"); d != "" {
		if b, err := os.ReadFile(filepath.Join(d, "ip2proxy")); err == nil {
			return strings.TrimSpace(string(b))
		}
	}
	return ""
}

type Server struct {
	data  string
	mu    sync.RWMutex
	idx   *Index
	idxAt time.Time
	cache *Cache
	limit *Limiter
	slots chan struct{} // sweeps at once
	fly   sync.Map      // seg → *flight, so one /24 asked twice at once is swept once
}

// reload picks up the index the daily update wrote (it replaces the file, so a new modification time)
func (s *Server) reload() {
	st, err := os.Stat(filepath.Join(s.data, indexFile))
	if err != nil {
		return
	}
	s.mu.RLock()
	same := st.ModTime().Equal(s.idxAt)
	s.mu.RUnlock()
	if same {
		return
	}
	idx, at, err := Load(s.data)
	if err != nil {
		log.Print("lists: ", err)
		return
	}
	s.mu.Lock()
	s.idx, s.idxAt = idx, at
	s.mu.Unlock()
}

// The part of an answer that is cached: the names and the prefix
type Seg struct {
	Seg    string    `json:"seg"`
	At     time.Time `json:"at"`
	RDNS   RDNS      `json:"rdns"`
	Prefix *Prefix   `json:"prefix"` // null when neither Cymru nor RIPEstat answered
	Names  []string  `json:"names"`  // each address's reverse name, "" for none
}

// An answer: the cached part, the lists' counts, and per address what its name says (kinds: one letter each, h hosting,
// d home or mobile, s fixed line, a VPN or proxy words, m mail, o other, - no name), which lists name it (flags: 1
// open proxy, 2 IPsum, 4 Tor exit, 8 VPN range, 16 data-centre range, 32 Spamhaus DROP) and its IPsum score.
type Answer struct {
	Seg
	Lists ListsOf `json:"lists"`
	Kinds string  `json:"kinds"`
	Flags []int   `json:"flags"`
	Score []int   `json:"score"`
}

type flight struct {
	done chan struct{}
	seg  *Seg
}

// a public IPv4 address (not private, shared, reserved, multicast, …) → its /24
func segOf(s string) (uint32, string, bool) {
	a, err := netip.ParseAddr(strings.TrimSpace(s))
	if err != nil || !a.Is4() || a.IsPrivate() || a.IsLoopback() || a.IsMulticast() || a.IsLinkLocalUnicast() || a.IsUnspecified() {
		return 0, "", false
	}
	b := a.As4()
	for _, p := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4"} {
		if netip.MustParsePrefix(p).Contains(a) {
			return 0, "", false
		}
	}
	seg := uint32(b[0])<<16 | uint32(b[1])<<8 | uint32(b[2])
	return seg, netip.AddrFrom4([4]byte{b[0], b[1], b[2], 0}).String() + "/24", true
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Type", "application/json")
	if r.URL.Path == "/healthz" {
		s.mu.RLock()
		ok := s.idx != nil
		s.mu.RUnlock()
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "lists": ok})
		return
	}
	if r.URL.Path == "/v1/ip" && r.Method == "GET" {
		s.serveIP(w, r)
		return
	}
	if r.URL.Path != "/v1/seg" || r.Method != "GET" {
		w.WriteHeader(404)
		w.Write([]byte(`{"error":"not_found"}`))
		return
	}
	seg, name, ok := segOf(r.URL.Query().Get("ip"))
	if !ok {
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"bad_ip"}`))
		return
	}
	sg := s.cache.Get(seg)
	if sg == nil {
		// a new /24 costs 256 lookups: limited per client, and a few at a time
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		if !s.limit.Allow(host) {
			w.Header().Set("Retry-After", "600")
			w.WriteHeader(429)
			w.Write([]byte(`{"error":"rate"}`))
			return
		}
		sg = s.sweep(r.Context(), seg, name)
		if sg == nil {
			w.WriteHeader(503)
			w.Write([]byte(`{"error":"busy"}`))
			return
		}
	}
	s.mu.RLock()
	lists, flags, score := s.idx.Of(seg)
	s.mu.RUnlock()
	json.NewEncoder(w).Encode(Answer{Seg: *sg, Lists: lists, Kinds: kindsOf(sg.Names), Flags: flags, Score: score})
}

// IPAnswer: one address's list flags, its reverse name and its announced prefix.
type IPAnswer struct {
	IP     string  `json:"ip"`
	V      int     `json:"v"`
	Lists  IPLists `json:"lists"`
	PTR    string  `json:"ptr,omitempty"`
	Prefix string  `json:"prefix,omitempty"`
	ASNs   []int   `json:"asns,omitempty"`
}

// publicIP: an address the public lists and resolvers can say something about.
func publicIP(a netip.Addr) bool {
	if !a.IsValid() || a.Is4In6() || a.IsPrivate() || a.IsLoopback() || a.IsMulticast() || a.IsLinkLocalUnicast() || a.IsUnspecified() {
		return false
	}
	if a.Is4() {
		_, _, ok := segOf(a.String())
		return ok
	}
	b := a.As16()
	if b[0]&0xe0 != 0x20 { // only global unicast 2000::/3
		return false
	}
	if b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8 { // documentation
		return false
	}
	if b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x00 && b[3] == 0x00 { // Teredo
		return false
	}
	if b[0] == 0x20 && b[1] == 0x02 { // 6to4
		return false
	}
	return true
}

// serveIP: the exact address's list flags (IPv4 and IPv6 where the list has them), with the /24 cache's name for an
// IPv4 address and a single lookup otherwise. No sweep, so it is cheap enough to answer per check.
func (s *Server) serveIP(w http.ResponseWriter, r *http.Request) {
	a, err := netip.ParseAddr(strings.TrimSpace(r.URL.Query().Get("ip")))
	if err != nil || !publicIP(a) {
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"bad_ip"}`))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var px *Prefix
	var host string
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		if p, err := PrefixOf(ctx, a.String()); err == nil {
			px = p
		}
	}()
	go func() {
		defer wg.Done()
		host = s.ptrOf(ctx, a)
	}()
	wg.Wait()
	var asns []int
	if px != nil {
		asns = px.ASNs
	}
	s.mu.RLock()
	idx := s.idx
	s.mu.RUnlock()
	// no index yet: say so rather than answer "on no list", which would read as a clean address
	if idx == nil {
		w.WriteHeader(503)
		w.Write([]byte(`{"error":"no_lists"}`))
		return
	}
	lists := idx.OfIP(a, asns)
	out := IPAnswer{IP: a.String(), V: 4, Lists: lists, PTR: host}
	if a.Is6() {
		out.V = 6
	}
	if px != nil {
		out.Prefix, out.ASNs = px.Prefix, px.ASNs
	}
	json.NewEncoder(w).Encode(out)
}

// ptrOf: the address's reverse name, from the /24 cache for IPv4 when it is there, or one lookup.
func (s *Server) ptrOf(ctx context.Context, a netip.Addr) string {
	if a.Is4() {
		if seg, _, ok := segOf(a.String()); ok {
			if sg := s.cache.Get(seg); sg != nil {
				if off := int(a.As4()[3]); off < len(sg.Names) {
					return sg.Names[off]
				}
			}
		}
	}
	qctx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	ns, err := resolver(0).LookupAddr(qctx, a.String())
	if err != nil || len(ns) == 0 {
		return ""
	}
	return strings.TrimSuffix(strings.ToLower(ns[0]), ".")
}

func (s *Server) sweep(ctx context.Context, seg uint32, name string) *Seg {
	f := &flight{done: make(chan struct{})}
	if old, loaded := s.fly.LoadOrStore(seg, f); loaded {
		of := old.(*flight)
		select {
		case <-of.done:
			return of.seg
		case <-ctx.Done():
			return nil
		}
	}
	defer func() { s.fly.Delete(seg); close(f.done) }()
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-time.After(3 * time.Second):
		return nil
	}
	// detached from the request: a visitor leaving early still leaves the /24 cached for the next one
	wctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var px *Prefix
	pdone := make(chan struct{})
	go func() {
		defer close(pdone)
		ip := strings.TrimSuffix(name, "0/24") + "1"
		if p, err := PrefixOf(wctx, ip); err == nil {
			px = p
		}
	}()
	names, answered, dead := Sweep(wctx, seg, 32, 2500*time.Millisecond)
	<-pdone
	f.seg = &Seg{Seg: name, At: time.Now().UTC(), RDNS: Summarize(names, answered, dead), Prefix: px, Names: names[:]}
	// a sweep cut short by slow resolvers, or without its prefix, is still shown, but asked again next time rather
	// than kept for a week
	if (answered >= 240 || dead) && px != nil {
		s.cache.Put(seg, f.seg)
	}
	return f.seg
}
