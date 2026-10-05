package progress

import (
	"reflect"
	"testing"
)

func TestBuildBaselineNoHistory(t *testing.T) {
	b := BuildBaseline(nil, "kg")
	if b.Last != nil || b.MaxLoad != nil || b.BestRepsByLoad == nil || len(b.BestRepsByLoad) != 0 {
		t.Fatalf("empty baseline wrong: %+v", b)
	}
}

func TestBuildBaseline(t *testing.T) {
	earlier := []Exposure{
		ex("2026-09-15", kg(1, 30, 12, 2), kg(2, 32.5, 8, 1)),
		ex("2026-09-22", kg(1, 30, 12, 2), kg(2, 32.5, 9, 1)), // 12 @ 30 ties the earlier best: date stays 09-15
		ex("2026-09-29", kg(2, 32.5, 9, 1), kg(1, 30, 10, 3)),
	}
	b := BuildBaseline(earlier, "kg")

	wantLast := &Last{Date: "2026-09-29", SetLogs: []LastSet{
		{SetNumber: 1, Load: f(30), Unit: "kg", Reps: 10, RIR: f(3)},
		{SetNumber: 2, Load: f(32.5), Unit: "kg", Reps: 9, RIR: f(1)},
	}}
	if !reflect.DeepEqual(b.Last, wantLast) {
		t.Fatalf("last = %+v, want %+v", b.Last, wantLast)
	}
	wantBests := []Best{
		{Load: f(30), Unit: "kg", Reps: 12, Date: "2026-09-15"},
		{Load: f(32.5), Unit: "kg", Reps: 9, Date: "2026-09-22"},
	}
	if !reflect.DeepEqual(b.BestRepsByLoad, wantBests) {
		t.Fatalf("bests = %+v, want %+v", b.BestRepsByLoad, wantBests)
	}
	if want := (&Best{Load: f(32.5), Unit: "kg", Reps: 9, Date: "2026-09-22"}); !reflect.DeepEqual(b.MaxLoad, want) {
		t.Fatalf("maxLoad = %+v, want %+v", b.MaxLoad, want)
	}
}

func TestBuildBaselineKeepsUnitsSeparate(t *testing.T) {
	earlier := []Exposure{
		ex("2026-09-15", kg(1, 100, 5, 2)),
		ex("2026-09-22", lb(1, 135, 8, 2)), // most recent, other unit
	}
	b := BuildBaseline(earlier, "kg")
	if b.Last == nil || b.Last.SetLogs[0].Unit != "lb" {
		t.Fatalf("last should keep its recorded unit: %+v", b.Last)
	}
	if len(b.BestRepsByLoad) != 1 || *b.BestRepsByLoad[0].Load != 100 || b.BestRepsByLoad[0].Unit != "kg" {
		t.Fatalf("bests must only cover kg: %+v", b.BestRepsByLoad)
	}
	if b.MaxLoad == nil || *b.MaxLoad.Load != 100 {
		t.Fatalf("maxLoad = %+v", b.MaxLoad)
	}
	// Other unit only: nothing in the planned unit.
	lbOnly := BuildBaseline(earlier[1:], "kg")
	if lbOnly.MaxLoad != nil || len(lbOnly.BestRepsByLoad) != 0 || lbOnly.Last == nil {
		t.Fatalf("lb-only history under kg plan: %+v", lbOnly)
	}
}

func TestBuildBaselineUnitFallsBackToLast(t *testing.T) {
	b := BuildBaseline([]Exposure{ex("2026-09-22", lb(1, 135, 8, 2))}, "")
	if b.MaxLoad == nil || b.MaxLoad.Unit != "lb" || *b.MaxLoad.Load != 135 {
		t.Fatalf("maxLoad = %+v", b.MaxLoad)
	}
}

func TestBuildBaselineBodyweight(t *testing.T) {
	b := BuildBaseline([]Exposure{ex("2026-09-15", bw(1, 10, 2)), ex("2026-09-22", bw(1, 12, 1))}, "")
	if b.MaxLoad != nil {
		t.Fatalf("bodyweight has no max load: %+v", b.MaxLoad)
	}
	want := []Best{{Load: nil, Reps: 12, Date: "2026-09-22"}}
	if !reflect.DeepEqual(b.BestRepsByLoad, want) {
		t.Fatalf("bests = %+v, want %+v", b.BestRepsByLoad, want)
	}
	if b.Last == nil || b.Last.SetLogs[0].Load != nil || b.Last.SetLogs[0].Unit != "" {
		t.Fatalf("last = %+v", b.Last)
	}
}
