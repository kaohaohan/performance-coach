package accountdeletion

import (
	"context"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v4"

	"github.com/kaohaohan/performance-coach/apps/api/internal/config"
)

const (
	defaultAppleTokenURL  = "https://appleid.apple.com/auth/token"
	defaultAppleRevokeURL = "https://appleid.apple.com/auth/revoke"
	defaultAppleJWKSURL   = "https://appleid.apple.com/auth/keys"
	appleIssuer           = "https://appleid.apple.com"
)

// AppleTokens is the verified result of exchanging an authorization code.
// RefreshToken is secret-at-rest and must never be logged.
type AppleTokens struct {
	RefreshToken string
	Subject      string
}

// AppleClient exchanges Sign in with Apple authorization codes and revokes
// refresh tokens. Implementations used in tests must not contact Apple.
type AppleClient interface {
	ExchangeAuthorizationCode(ctx context.Context, code string) (AppleTokens, error)
	RevokeRefreshToken(ctx context.Context, refreshToken string) error
}

// Client talks to Apple's token and revoke endpoints. TokenURL, RevokeURL,
// and JWKSURL are overridable for tests.
type Client struct {
	teamID     string
	keyID      string
	clientID   string
	privateKey *ecdsa.PrivateKey
	httpClient *http.Client
	TokenURL   string
	RevokeURL  string
	JWKSURL    string
}

// NewAppleClient builds a Client from environment-derived config. The
// private key is parsed here so a malformed .p8 fails process start rather
// than the first deletion.
func NewAppleClient(cfg config.AppleConfig) (*Client, error) {
	key, err := parseApplePrivateKey(cfg.PrivateKey)
	if err != nil {
		return nil, err
	}
	return &Client{
		teamID:     cfg.TeamID,
		keyID:      cfg.KeyID,
		clientID:   cfg.ClientID,
		privateKey: key,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		TokenURL:   defaultAppleTokenURL,
		RevokeURL:  defaultAppleRevokeURL,
		JWKSURL:    defaultAppleJWKSURL,
	}, nil
}

func parseApplePrivateKey(pemBytes string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemBytes))
	if block == nil {
		return nil, fmt.Errorf("accountdeletion: apple private key is not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("accountdeletion: parse apple private key: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("accountdeletion: apple private key is not ECDSA")
	}
	return key, nil
}

type appleTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	Error        string `json:"error"`
}

// ExchangeAuthorizationCode posts grant_type=authorization_code, then
// cryptographically verifies the returned id_token (JWKS signature, iss,
// aud, exp) before returning its sub. A rejected or unbindable code is
// InvalidArgumentError; the caller must not mutate deletion state.
func (c *Client) ExchangeAuthorizationCode(ctx context.Context, code string) (AppleTokens, error) {
	secret, err := c.clientSecret()
	if err != nil {
		return AppleTokens{}, err
	}
	form := url.Values{
		"client_id":     {c.clientID},
		"client_secret": {secret},
		"code":          {code},
		"grant_type":    {"authorization_code"},
	}
	resp, body, err := c.postForm(ctx, c.TokenURL, form)
	if err != nil {
		return AppleTokens{}, err
	}
	var parsed appleTokenResponse
	_ = json.Unmarshal(body, &parsed)

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusBadRequest {
			return AppleTokens{}, &InvalidArgumentError{Message: "appleAuthorizationCode is invalid"}
		}
		return AppleTokens{}, fmt.Errorf("accountdeletion: apple token endpoint HTTP %d", resp.StatusCode)
	}
	if parsed.IDToken == "" || parsed.RefreshToken == "" {
		return AppleTokens{}, &InvalidArgumentError{Message: "appleAuthorizationCode is invalid"}
	}

	sub, err := c.verifyIDToken(ctx, parsed.IDToken)
	if err != nil {
		return AppleTokens{}, err
	}
	return AppleTokens{RefreshToken: parsed.RefreshToken, Subject: sub}, nil
}

// RevokeRefreshToken posts token_type_hint=refresh_token.
//
// Apple's revoke-tokens documentation: HTTP 200 means the token was
// invalidated now, or it was already invalid. That is the only documented
// success/idempotent case this client treats as success. HTTP 400
// (invalid_grant, invalid_client, invalid_request) is a failure and is
// not treated as "already revoked" — the revoke endpoint itself uses 200
// for previously invalidated tokens.
func (c *Client) RevokeRefreshToken(ctx context.Context, refreshToken string) error {
	secret, err := c.clientSecret()
	if err != nil {
		return err
	}
	form := url.Values{
		"client_id":       {c.clientID},
		"client_secret":   {secret},
		"token":           {refreshToken},
		"token_type_hint": {"refresh_token"},
	}
	resp, _, err := c.postForm(ctx, c.RevokeURL, form)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("accountdeletion: apple revoke endpoint HTTP %d", resp.StatusCode)
	}
	return nil
}

func (c *Client) postForm(ctx context.Context, endpoint string, form url.Values) (*http.Response, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("accountdeletion: apple http: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return resp, nil, fmt.Errorf("accountdeletion: apple http read: %w", err)
	}
	return resp, body, nil
}

func (c *Client) clientSecret() (string, error) {
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iss": c.teamID,
		"iat": now.Unix(),
		"exp": now.Add(5 * time.Minute).Unix(),
		"aud": appleIssuer,
		"sub": c.clientID,
	})
	token.Header["kid"] = c.keyID
	signed, err := token.SignedString(c.privateKey)
	if err != nil {
		return "", fmt.Errorf("accountdeletion: apple client secret: %w", err)
	}
	return signed, nil
}

func (c *Client) verifyIDToken(ctx context.Context, raw string) (string, error) {
	keys, err := c.fetchJWKS(ctx)
	if err != nil {
		return "", err
	}
	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}))
	claims := &jwt.RegisteredClaims{}
	parsed, err := parser.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		key, ok := keys[kid]
		if !ok {
			return nil, &InvalidArgumentError{Message: "appleAuthorizationCode is invalid"}
		}
		return key, nil
	})
	if err != nil {
		return "", &InvalidArgumentError{Message: "appleAuthorizationCode is invalid"}
	}
	if !parsed.Valid {
		return "", &InvalidArgumentError{Message: "appleAuthorizationCode is invalid"}
	}
	if claims.Issuer != appleIssuer {
		return "", &InvalidArgumentError{Message: "appleAuthorizationCode is invalid"}
	}
	if !audienceContains(claims.Audience, c.clientID) {
		return "", &InvalidArgumentError{Message: "appleAuthorizationCode is invalid"}
	}
	if claims.Subject == "" {
		return "", &InvalidArgumentError{Message: "appleAuthorizationCode is invalid"}
	}
	return claims.Subject, nil
}

func audienceContains(aud jwt.ClaimStrings, want string) bool {
	for _, a := range aud {
		if a == want {
			return true
		}
	}
	return false
}

func (c *Client) fetchJWKS(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.JWKSURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("accountdeletion: apple jwks: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("accountdeletion: apple jwks HTTP %d", resp.StatusCode)
	}
	var doc struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&doc); err != nil {
		return nil, fmt.Errorf("accountdeletion: apple jwks decode: %w", err)
	}
	out := make(map[string]*rsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "RSA" || k.Kid == "" {
			continue
		}
		pub, err := rsaPublicKeyFromJWK(k.N, k.E)
		if err != nil {
			continue
		}
		out[k.Kid] = pub
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("accountdeletion: apple jwks contained no RSA keys")
	}
	return out, nil
}

func rsaPublicKeyFromJWK(nB64, eB64 string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, err
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(new(big.Int).SetBytes(eBytes).Int64()),
	}, nil
}
