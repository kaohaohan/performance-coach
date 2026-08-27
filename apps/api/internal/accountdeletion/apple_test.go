package accountdeletion

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v4"
)

func TestAppleExchangeVerifiesIDTokenSignatureAndClaims(t *testing.T) {
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	const kid = "test-kid"
	const clientID = "com.pumpslate.app"
	const sub = "apple-sub-expected"

	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{{
				"kty": "RSA",
				"kid": kid,
				"use": "sig",
				"alg": "RS256",
				"n":   base64.RawURLEncoding.EncodeToString(rsaKey.PublicKey.N.Bytes()),
				"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(rsaKey.PublicKey.E)).Bytes()),
			}},
		})
	}))
	defer jwks.Close()

	sign := func(modify func(*jwt.RegisteredClaims, *jwt.Token)) string {
		claims := jwt.RegisteredClaims{
			Issuer:    appleIssuer,
			Subject:   sub,
			Audience:  jwt.ClaimStrings{clientID},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		}
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		tok.Header["kid"] = kid
		if modify != nil {
			modify(&claims, tok)
			tok.Claims = claims
		}
		raw, err := tok.SignedString(rsaKey)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}

	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		code := r.Form.Get("code")
		var idToken string
		switch code {
		case "valid":
			idToken = sign(nil)
		case "wrong-aud":
			idToken = sign(func(c *jwt.RegisteredClaims, _ *jwt.Token) {
				c.Audience = jwt.ClaimStrings{"other.app"}
			})
		case "expired":
			idToken = sign(func(c *jwt.RegisteredClaims, _ *jwt.Token) {
				c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour))
			})
		case "wrong-iss":
			idToken = sign(func(c *jwt.RegisteredClaims, _ *jwt.Token) {
				c.Issuer = "https://example.invalid"
			})
		default:
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"refresh_token": "refresh-secret-value",
			"id_token":      idToken,
			"access_token":  "access",
		})
	}))
	defer tokenSrv.Close()

	revokeOK := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer revokeOK.Close()

	client := testAppleHTTPClient(t, clientID, tokenSrv.URL, revokeOK.URL, jwks.URL)

	got, err := client.ExchangeAuthorizationCode(context.Background(), "valid")
	if err != nil {
		t.Fatalf("valid exchange: %v", err)
	}
	if got.Subject != sub {
		t.Fatalf("subject = %q, want %q", got.Subject, sub)
	}
	if got.RefreshToken != "refresh-secret-value" {
		t.Fatal("refresh token mismatch")
	}

	if _, err := client.ExchangeAuthorizationCode(context.Background(), "used-code"); err == nil {
		t.Fatal("invalid_grant should fail")
	} else if _, ok := err.(*InvalidArgumentError); !ok {
		t.Fatalf("invalid_grant error = %T %v, want InvalidArgumentError", err, err)
	}

	for _, code := range []string{"wrong-aud", "expired", "wrong-iss"} {
		if _, err := client.ExchangeAuthorizationCode(context.Background(), code); err == nil {
			t.Fatalf("%s: expected verification failure", code)
		} else if _, ok := err.(*InvalidArgumentError); !ok {
			t.Fatalf("%s: error = %T %v, want InvalidArgumentError", code, err, err)
		}
	}
}

func TestAppleExchangeRejectsTamperedIDToken(t *testing.T) {
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	const kid = "kid-1"
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{{
				"kty": "RSA", "kid": kid, "alg": "RS256",
				"n": base64.RawURLEncoding.EncodeToString(rsaKey.PublicKey.N.Bytes()),
				"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(rsaKey.PublicKey.E)).Bytes()),
			}},
		})
	}))
	defer jwks.Close()

	claims := jwt.RegisteredClaims{
		Issuer:    appleIssuer,
		Subject:   "sub",
		Audience:  jwt.ClaimStrings{"com.pumpslate.app"},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	bad, err := tok.SignedString(other)
	if err != nil {
		t.Fatal(err)
	}

	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{
			"refresh_token": "refresh-secret-value",
			"id_token":      bad,
		})
	}))
	defer tokenSrv.Close()

	client := testAppleHTTPClient(t, "com.pumpslate.app", tokenSrv.URL, tokenSrv.URL, jwks.URL)
	if _, err := client.ExchangeAuthorizationCode(context.Background(), "x"); err == nil {
		t.Fatal("tampered id_token must not verify")
	} else if _, ok := err.(*InvalidArgumentError); !ok {
		t.Fatalf("error = %T %v, want InvalidArgumentError", err, err)
	}
}

func TestAppleRevokeTreatsOnlyHTTP200AsSuccess(t *testing.T) {
	okSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer okSrv.Close()
	failSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
	}))
	defer failSrv.Close()

	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{}})
	}))
	defer jwks.Close()

	okClient := testAppleHTTPClient(t, "com.pumpslate.app", okSrv.URL, okSrv.URL, jwks.URL)
	if err := okClient.RevokeRefreshToken(context.Background(), "refresh-secret-value"); err != nil {
		t.Fatalf("HTTP 200 revoke: %v", err)
	}

	failClient := testAppleHTTPClient(t, "com.pumpslate.app", failSrv.URL, failSrv.URL, jwks.URL)
	if err := failClient.RevokeRefreshToken(context.Background(), "refresh-secret-value"); err == nil {
		t.Fatal("HTTP 400 revoke must not be treated as success")
	}
}

func testAppleHTTPClient(t *testing.T, clientID, tokenURL, revokeURL, jwksURL string) *Client {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return &Client{
		teamID:     "TEAMID",
		keyID:      "KEYID",
		clientID:   clientID,
		privateKey: key,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		TokenURL:   tokenURL,
		RevokeURL:  revokeURL,
		JWKSURL:    jwksURL,
	}
}
