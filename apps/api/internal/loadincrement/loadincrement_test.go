package loadincrement_test

import (
	"testing"

	"github.com/kaohaohan/performance-coach/apps/api/internal/loadincrement"
)

func TestDefaultForUnit(t *testing.T) {
	if loadincrement.DefaultForUnit("kg") != 2.5 {
		t.Fatalf("kg default = %v", loadincrement.DefaultForUnit("kg"))
	}
	if loadincrement.DefaultForUnit("lb") != 5 {
		t.Fatalf("lb default = %v", loadincrement.DefaultForUnit("lb"))
	}
}

func TestValidateIncrementOptions(t *testing.T) {
	if loadincrement.Validate("kg", 2.5) != "" {
		t.Fatal("expected 2.5 kg to be valid")
	}
	if loadincrement.Validate("kg", 3) == "" {
		t.Fatal("expected 3 kg to be invalid")
	}
	if loadincrement.Validate("lb", 5) != "" {
		t.Fatal("expected 5 lb to be valid")
	}
	if loadincrement.Validate("lb", 2.5) == "" {
		t.Fatal("expected 2.5 lb to be invalid")
	}
}

func TestSuggestLoadUsesHistoryThenTemplate(t *testing.T) {
	history := 100.0
	template := 80.0
	got := loadincrement.SuggestLoad(&history, 2.5)
	if got == nil || *got != 102.5 {
		t.Fatalf("history bump = %#v", got)
	}
	got = loadincrement.SuggestLoad(nil, 2.5)
	if got != nil {
		t.Fatalf("nil base = %#v", got)
	}
	got = loadincrement.SuggestLoad(&template, 2.5)
	if got == nil || *got != 82.5 {
		t.Fatalf("template bump = %#v", got)
	}
}

func TestSuggestLoadZeroIncrementReturnsBase(t *testing.T) {
	base := 80.0
	got := loadincrement.SuggestLoad(&base, 0)
	if got == nil || *got != 80 {
		t.Fatalf("zero increment = %#v", got)
	}
}

func TestBumpLoadSkipsNilAndZeroIncrement(t *testing.T) {
	if loadincrement.BumpLoad(nil, 5) != nil {
		t.Fatal("nil load should stay nil")
	}
	load := 80.0
	got := loadincrement.BumpLoad(&load, 0)
	if got == nil || *got != 80 {
		t.Fatalf("zero increment = %#v", got)
	}
}
