package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func makeToken(secret, scope string, exp int64, nonce string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(fmt.Sprintf("v1|%d|%s|%s", exp, nonce, scope)))
	return fmt.Sprintf("v1.%d.%s.%s.%s", exp, nonce, scope, base64.RawURLEncoding.EncodeToString(h.Sum(nil)))
}

func get(t *testing.T, s *Server, path, auth string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, path, nil)
	if auth != "" {
		r.Header.Set("Authorization", auth)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func TestAuthUnsetAllows(t *testing.T) {
	// no secret: the request reaches the route (a bad address is a 400, not a 401)
	w := get(t, &Server{}, "/v1/seg?ip=not-an-ip", "")
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"bad_ip"`) {
		t.Fatalf("unset secret: %d %s", w.Code, w.Body.String())
	}
}

func TestAuthNoToken(t *testing.T) {
	w := get(t, &Server{auth: "s3cret"}, "/v1/seg?ip=1.2.3.4", "")
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"no_token"`) {
		t.Fatalf("no token: %d %s", w.Code, w.Body.String())
	}
}

func TestAuthExpired(t *testing.T) {
	s := &Server{auth: "s3cret"}
	tok := makeToken("s3cret", "seg", time.Now().Add(-time.Second).Unix(), "n1")
	w := get(t, s, "/v1/seg?ip=1.2.3.4", "Bearer "+tok)
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"bad_token"`) {
		t.Fatalf("expired: %d %s", w.Code, w.Body.String())
	}
}

func TestAuthScope(t *testing.T) {
	s := &Server{auth: "s3cret"}
	tok := makeToken("s3cret", "dns", time.Now().Add(time.Minute).Unix(), "n2")
	w := get(t, s, "/v1/seg?ip=1.2.3.4", "Bearer "+tok)
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"bad_token"`) {
		t.Fatalf("wrong scope: %d %s", w.Code, w.Body.String())
	}
}

func TestAuthValid(t *testing.T) {
	s := &Server{auth: "s3cret"}
	exp := time.Now().Add(time.Minute).Unix()
	for _, scope := range []string{"seg", "*", "seg,dns", "dns,seg", "probe,seg,dns"} {
		tok := makeToken("s3cret", scope, exp, "n3")
		w := get(t, s, "/v1/seg?ip=not-an-ip", "Bearer "+tok)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("scope %q should pass auth: %d %s", scope, w.Code, w.Body.String())
		}
	}
}

func TestAuthScopeListWithoutSeg(t *testing.T) {
	s := &Server{auth: "s3cret"}
	tok := makeToken("s3cret", "dns,data", time.Now().Add(time.Minute).Unix(), "n4")
	w := get(t, s, "/v1/seg?ip=1.2.3.4", "Bearer "+tok)
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"bad_token"`) {
		t.Fatalf("scope list without seg: %d %s", w.Code, w.Body.String())
	}
}

func TestAuthOldFourPartToken(t *testing.T) {
	s := &Server{auth: "s3cret"}
	tok := makeToken("s3cret", "seg", time.Now().Add(time.Minute).Unix(), "n5")
	old := strings.Join(strings.Split(tok, ".")[:3], ".") + "." + strings.Split(tok, ".")[4]
	w := get(t, s, "/v1/seg?ip=1.2.3.4", "Bearer "+old)
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"bad_token"`) {
		t.Fatalf("four-part token: %d %s", w.Code, w.Body.String())
	}
}

func TestAuthTamperedScope(t *testing.T) {
	s := &Server{auth: "s3cret"}
	tok := makeToken("s3cret", "dns", time.Now().Add(time.Minute).Unix(), "n6")
	parts := strings.Split(tok, ".")
	parts[3] = "seg" // signature still covers dns, so this must fail
	w := get(t, s, "/v1/seg?ip=1.2.3.4", "Bearer "+strings.Join(parts, "."))
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"bad_token"`) {
		t.Fatalf("tampered scope: %d %s", w.Code, w.Body.String())
	}
}

func TestAuthHexMAC(t *testing.T) {
	s := &Server{auth: "s3cret"}
	exp := time.Now().Add(time.Minute).Unix()
	h := hmac.New(sha256.New, []byte("s3cret"))
	h.Write([]byte(fmt.Sprintf("v1|%d|n7|seg", exp)))
	tok := fmt.Sprintf("v1.%d.n7.seg.%s", exp, hex.EncodeToString(h.Sum(nil)))
	w := get(t, s, "/v1/seg?ip=not-an-ip", "Bearer "+tok)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("hex MAC: %d %s", w.Code, w.Body.String())
	}
}

func TestAuth401HasCORS(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/v1/seg?ip=1.2.3.4", nil)
	r.Header.Set("Origin", "https://ipqs.1ms.dog")
	w := httptest.NewRecorder()
	(&Server{auth: "s3cret"}).ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status: %d", w.Code)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://ipqs.1ms.dog" {
		t.Fatalf("ACAO = %q", got)
	}
	if !strings.Contains(w.Header().Get("Vary"), "Origin") {
		t.Fatalf("Vary = %q", w.Header().Get("Vary"))
	}
}

func TestAuthHealthzExempt(t *testing.T) {
	w := get(t, &Server{auth: "s3cret"}, "/healthz", "")
	if w.Code != http.StatusOK {
		t.Fatalf("healthz: %d %s", w.Code, w.Body.String())
	}
}

func TestAuthPreflight(t *testing.T) {
	r := httptest.NewRequest(http.MethodOptions, "/v1/seg?ip=1.2.3.4", nil)
	w := httptest.NewRecorder()
	(&Server{auth: "s3cret"}).ServeHTTP(w, r)
	if w.Code != http.StatusNoContent || w.Header().Get("Access-Control-Allow-Headers") != "Authorization" {
		t.Fatalf("preflight: %d %v", w.Code, w.Header())
	}
}
