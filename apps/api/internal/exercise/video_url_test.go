package exercise

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateVideoURL(t *testing.T) {
	accepted := map[string]string{
		"https://www.youtube.com/watch?v=abc123": "https://www.youtube.com/watch?v=abc123",
		"  https://youtu.be/abc123  ":            "https://youtu.be/abc123",
		"https://youtube.com/watch?v=abc123":     "https://youtube.com/watch?v=abc123",
		"https://m.youtube.com/watch?v=abc123":   "https://m.youtube.com/watch?v=abc123",
		"HTTPS://WWW.YOUTUBE.COM/watch?v=abc123": "HTTPS://WWW.YOUTUBE.COM/watch?v=abc123",
	}
	for raw, want := range accepted {
		got, err := ValidateVideoURL(raw)
		if err != nil || got != want {
			t.Errorf("ValidateVideoURL(%q) = %q, %v; want %q, nil", raw, got, err, want)
		}
	}

	rejected := []string{
		"",
		"   ",
		"http://www.youtube.com/watch?v=abc123",
		"https://vimeo.com/12345",
		"https://evil.example/www.youtube.com",
		"https://www.youtube.com.evil.example/watch?v=abc",
		"https://user:pass@www.youtube.com/watch?v=abc",
		"https://www.youtube.com:8443/watch?v=abc",
		"javascript:alert(1)",
		"www.youtube.com/watch?v=abc123",
		"https://",
		"https://www.youtube.com/" + strings.Repeat("a", maxVideoURLLength),
	}
	for _, raw := range rejected {
		_, err := ValidateVideoURL(raw)
		var target *ValidationError
		if !errors.As(err, &target) {
			t.Errorf("ValidateVideoURL(%q) error = %v, want ValidationError", raw, err)
		}
	}
}
