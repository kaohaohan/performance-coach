package accountdeletion

import (
	"strings"
	"testing"
)

func TestParseDeleteMeBodyAcceptsOmittedAndEmptyObject(t *testing.T) {
	for _, raw := range []string{"", "   ", "{}"} {
		code, err := parseDeleteMeBody(strings.NewReader(raw))
		if err != nil {
			t.Fatalf("body %q: %v", raw, err)
		}
		if code != nil {
			t.Fatalf("body %q: code = %v, want omitted", raw, *code)
		}
	}
}

func TestParseDeleteMeBodyRejectsMalformedUnknownAndNonObject(t *testing.T) {
	cases := []string{
		`{`,
		`{"appleAuthorizationCode":}`,
		`{"nope":true}`,
		`[]`,
		`null`,
		`"x"`,
		`{"appleAuthorizationCode":"ok"}{"extra":1}`,
	}
	for _, raw := range cases {
		if _, err := parseDeleteMeBody(strings.NewReader(raw)); err == nil {
			t.Fatalf("body %q: expected parse error", raw)
		}
	}
}

func TestParseDeleteMeBodyTrimsAuthorizationCode(t *testing.T) {
	code, err := parseDeleteMeBody(strings.NewReader(`{"appleAuthorizationCode":"  abc  "}`))
	if err != nil {
		t.Fatal(err)
	}
	if code == nil || *code != "abc" {
		t.Fatalf("code = %v", code)
	}
}

func TestParseDeleteMeBodyEmptyAuthorizationCodeStaysPresent(t *testing.T) {
	code, err := parseDeleteMeBody(strings.NewReader(`{"appleAuthorizationCode":"   "}`))
	if err != nil {
		t.Fatal(err)
	}
	if code == nil || *code != "" {
		t.Fatalf("empty code should be present and empty, got %v", code)
	}
}
