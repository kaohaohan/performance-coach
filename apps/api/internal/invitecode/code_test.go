package invitecode_test

import (
	"strings"
	"testing"

	"github.com/kaohaohan/performance-coach/apps/api/internal/invitecode"
)

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

func TestGenerateProducesCanonicalAlphabetAndLength(t *testing.T) {
	for i := 0; i < 500; i++ {
		code, err := invitecode.Generate()
		if err != nil {
			t.Fatalf("Generate() returned error: %v", err)
		}
		if len(code) != 10 {
			t.Fatalf("Generate() = %q, want length 10", code)
		}
		for _, r := range code {
			if !strings.ContainsRune(alphabet, r) {
				t.Fatalf("Generate() = %q contains character %q outside alphabet %q", code, r, alphabet)
			}
		}
	}
}

func TestGenerateHasNoAmbiguousCharacters(t *testing.T) {
	for i := 0; i < 500; i++ {
		code, err := invitecode.Generate()
		if err != nil {
			t.Fatalf("Generate() returned error: %v", err)
		}
		for _, ambiguous := range []rune{'I', 'L', 'O', 'U'} {
			if strings.ContainsRune(code, ambiguous) {
				t.Fatalf("Generate() = %q contains ambiguous character %q, which must never appear", code, ambiguous)
			}
		}
	}
}

// TestGenerateUniformDistributionSmoke is not a proof of uniformity — it is
// a smoke test that a large sample of independently generated codes
// contains no duplicates, which would be expected at ~50 bits of entropy
// (the birthday bound at this sample size is astronomically unlikely to
// collide) and would fail loudly if Generate regressed to something with
// far less entropy (e.g. a narrow range or a biased source).
func TestGenerateUniformDistributionSmoke(t *testing.T) {
	const samples = 5000
	seen := make(map[string]bool, samples)
	for i := 0; i < samples; i++ {
		code, err := invitecode.Generate()
		if err != nil {
			t.Fatalf("Generate() returned error: %v", err)
		}
		if seen[code] {
			t.Fatalf("Generate() produced duplicate code %q within %d samples", code, samples)
		}
		seen[code] = true
	}
}

func TestNormalizeAcceptsHyphenatedLowercaseForm(t *testing.T) {
	got, err := invitecode.Normalize("k7m2q-9xr4t")
	if err != nil {
		t.Fatalf("Normalize() returned error: %v", err)
	}
	if want := "K7M2Q9XR4T"; got != want {
		t.Fatalf("Normalize(%q) = %q, want %q", "k7m2q-9xr4t", got, want)
	}
}

func TestNormalizeAcceptsUppercaseWithInteriorSpace(t *testing.T) {
	got, err := invitecode.Normalize("K7M2Q 9XR4T")
	if err != nil {
		t.Fatalf("Normalize() returned error: %v", err)
	}
	if want := "K7M2Q9XR4T"; got != want {
		t.Fatalf("Normalize(%q) = %q, want %q", "K7M2Q 9XR4T", got, want)
	}
}

func TestNormalizeIsIdempotentAcrossEquivalentForms(t *testing.T) {
	const canonical = "K7M2Q9XR4T"

	for _, variant := range []string{
		"K7M2Q9XR4T",
		"k7m2q-9xr4t",
		"K7M2Q 9XR4T",
		" k7m2q-9xr4t ",
		"K7M2Q\t9XR4T",
	} {
		got, err := invitecode.Normalize(variant)
		if err != nil {
			t.Fatalf("Normalize(%q) returned error: %v", variant, err)
		}
		if got != canonical {
			t.Fatalf("Normalize(%q) = %q, want %q (same as canonical form)", variant, got, canonical)
		}
	}
}

func TestNormalizeMapsAmbiguousCharacters(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"uppercase I to 1", "I234567890", "1234567890"},
		{"uppercase L to 1", "L234567890", "1234567890"},
		{"uppercase O to 0", "O234567890", "0234567890"},
		{"lowercase i/l/o mixed with digits", "iIlLoO1111", "1111001111"},
	}
	for _, c := range cases {
		got, err := invitecode.Normalize(c.input)
		if err != nil {
			t.Fatalf("%s: Normalize(%q) returned unexpected error: %v", c.name, c.input, err)
		}
		if got != c.want {
			t.Fatalf("%s: Normalize(%q) = %q, want %q", c.name, c.input, got, c.want)
		}
	}
}

func TestNormalizeRejectsMalformedInput(t *testing.T) {
	cases := []string{
		"",
		"SHORT",
		"WAYTOOLONGCODEHERE",
		"K7M2Q9XR4",   // 9 chars after strip
		"K7M2Q9XR4TU", // 11 chars, contains U
		"K7M2Q9XR4U",  // valid length, but U has no substitution and isn't in alphabet
		"!!!!!!!!!!",
	}
	for _, input := range cases {
		if _, err := invitecode.Normalize(input); err != invitecode.ErrMalformedCode {
			t.Fatalf("Normalize(%q) error = %v, want ErrMalformedCode", input, err)
		}
	}
}
