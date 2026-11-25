// Endpoint auth (docs/tool-contract.md "端点鉴权"): a short-lived page token or the maintainer's service token.
//
// The token is v1.<exp seconds>.<nonce>.<hmac>, where the HMAC-SHA256 covers "v1|exp|nonce|scope" and scope is the
// comma-separated capability list the signer used. This service answers scope "seg"; the service token uses "*".
// The HMAC is base64url (no padding) as the shell signs it; hex and standard base64 are accepted too, so a token made
// by a small script or an older signer still verifies.
//
// MS_AUTH_SECRET comes from the environment or the systemd credential "ms-auth"; when it is empty nothing is checked,
// which is both the self-hosted default and the switch used to roll the change out one service at a time.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

func authSecret() string {
	if v := strings.TrimSpace(os.Getenv("MS_AUTH_SECRET")); v != "" {
		return v
	}
	d := os.Getenv("CREDENTIALS_DIRECTORY")
	if d == "" {
		return ""
	}
	// systemd: LoadCredential=ms-auth:/path, with the variable name accepted as a second spelling
	for _, name := range []string{"ms-auth", "MS_AUTH_SECRET"} {
		if b, err := os.ReadFile(filepath.Join(d, name)); err == nil {
			if v := strings.TrimSpace(string(b)); v != "" {
				return v
			}
		}
	}
	return ""
}

// decodeMAC accepts the three encodings a signer may produce.
func decodeMAC(s string) ([]byte, bool) {
	if b, err := hex.DecodeString(s); err == nil {
		return b, true
	}
	for _, enc := range []*base64.Encoding{base64.RawURLEncoding, base64.URLEncoding, base64.RawStdEncoding, base64.StdEncoding} {
		if b, err := enc.DecodeString(s); err == nil {
			return b, true
		}
	}
	return nil, false
}

// The capability names in the contract; a page token may carry several, comma-separated. The signer's order is not
// fixed, so a token is checked against every subset that holds "seg", written in the contract order and in sorted
// order. That covers "seg", "seg,dns" and "dns,seg" without knowing which page signed it.
var capabilities = []string{"probe", "reach", "ping", "rtc", "ipv6", "seg", "dns", "data"}

func scopeCandidates(need string) []string {
	seen := map[string]bool{need: true, "*": true}
	out := []string{need, "*"}
	add := func(list []string) {
		a := strings.Join(list, ",")
		if !seen[a] {
			seen[a] = true
			out = append(out, a)
		}
		sorted := append([]string(nil), list...)
		sort.Strings(sorted)
		b := strings.Join(sorted, ",")
		if !seen[b] {
			seen[b] = true
			out = append(out, b)
		}
	}
	for mask := 1; mask < 1<<len(capabilities); mask++ {
		list := []string{}
		has := false
		for i, c := range capabilities {
			if mask&(1<<i) != 0 {
				list = append(list, c)
				if c == need {
					has = true
				}
			}
		}
		if has {
			add(list)
		}
	}
	return out
}

var segScopes = scopeCandidates("seg")

// validToken: signature for one of scopes, not expired, and the version is v1.
func validToken(tok, secret string, now time.Time, scopes []string) bool {
	p := strings.Split(tok, ".")
	if len(p) != 4 || p[0] != "v1" || p[2] == "" {
		return false
	}
	exp, err := strconv.ParseInt(p[1], 10, 64)
	if err != nil || exp <= now.Unix() {
		return false
	}
	mac, ok := decodeMAC(p[3])
	if !ok {
		return false
	}
	for _, scope := range scopes {
		h := hmac.New(sha256.New, []byte(secret))
		h.Write([]byte("v1|" + p[1] + "|" + p[2] + "|" + scope))
		if hmac.Equal(mac, h.Sum(nil)) {
			return true
		}
	}
	return false
}

// authorized returns (true, "") when the secret is unset or the request carries a valid token; otherwise the 401 code.
func (s *Server) authorized(r *http.Request) (bool, string) {
	if s.auth == "" {
		return true, ""
	}
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	if h == "" {
		return false, "no_token"
	}
	const prefix = "Bearer "
	if len(h) <= len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return false, "bad_token"
	}
	if !validToken(strings.TrimSpace(h[len(prefix):]), s.auth, time.Now(), segScopes) {
		return false, "bad_token"
	}
	return true, ""
}

func deny(w http.ResponseWriter, code string) {
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"error":"` + code + `"}`))
}
