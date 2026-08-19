// Package invitecode implements coach-issued reusable invite codes:
// server-side generation, canonical storage normalization, and the
// coach-facing Create/List/Revoke service. See
// docs/athlete-onboarding-invite-codes-v0.1.md for the full design. Public
// preview and athlete redemption are a later phase and are not implemented
// here.
package invitecode

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"
)

// alphabet is Crockford Base32: the 10 digits plus 22 letters, excluding
// I, L, O, and U (visually ambiguous with 1, 1, 0, and V respectively).
// Matches the coach_invite_codes.code CHECK constraint
// (apps/api/migrations/0003_coach_invite_codes.up.sql).
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// codeLength is the number of alphabet characters in a generated code —
// ~50 bits of entropy (log2(32^10)). The stored canonical form has no
// separators; the UI displays it hyphenated as XXXXX-XXXXX.
const codeLength = 10

// Generate returns one cryptographically random, canonical (uppercase,
// unhyphenated) invite code. Each of the codeLength characters is drawn
// independently and uniformly from alphabet via crypto/rand — never
// math/rand, which is not safe for this purpose.
func Generate() (string, error) {
	max := big.NewInt(int64(len(alphabet)))

	var b strings.Builder
	b.Grow(codeLength)
	for i := 0; i < codeLength; i++ {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("invitecode: generate: %w", err)
		}
		b.WriteByte(alphabet[n.Int64()])
	}
	return b.String(), nil
}

// ErrMalformedCode indicates input that, even after normalization, cannot
// be a valid stored code (wrong length, or a character outside alphabet).
// Callers on the preview/redeem path should treat this identically to
// "not found" — see docs/athlete-onboarding-invite-codes-v0.1.md §5.2's
// uniform 404 for unknown/malformed/expired/revoked codes.
var ErrMalformedCode = errors.New("invitecode: malformed code")

// Normalize converts athlete-entered input into the canonical stored form:
// uppercase, unhyphenated, with the visually ambiguous characters I/L/O
// mapped to their digit look-alikes (1, 1, 0). It tolerates hyphens and
// interior whitespace — the display form is "XXXXX-XXXXX" — so a
// copy-pasted, lowercased, or hyphenated code still normalizes correctly.
// Returns ErrMalformedCode if the result isn't exactly codeLength
// characters from alphabet (e.g. it contains 'U', which has no natural
// single-character correction and is rejected rather than guessed).
func Normalize(raw string) (string, error) {
	var b strings.Builder
	b.Grow(len(raw))
	for _, r := range raw {
		switch r {
		case '-', ' ', '\t', '\n', '\r':
			continue
		case 'i', 'I', 'l', 'L':
			b.WriteByte('1')
		case 'o', 'O':
			b.WriteByte('0')
		default:
			if r >= 'a' && r <= 'z' {
				r -= 'a' - 'A'
			}
			b.WriteRune(r)
		}
	}

	code := b.String()
	if len(code) != codeLength || strings.IndexFunc(code, notInAlphabet) != -1 {
		return "", ErrMalformedCode
	}
	return code, nil
}

func notInAlphabet(r rune) bool {
	return !strings.ContainsRune(alphabet, r)
}
