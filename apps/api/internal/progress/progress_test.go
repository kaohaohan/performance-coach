package progress

import (
	"reflect"
	"testing"
)

func f(v float64) *float64 { return &v }

// kg builds a kg set; rir < 0 means unknown.
func kg(n int, load float64, reps int, rir float64) Set {
	s := Set{SetNumber: n, Load: f(load), Unit: "kg", Reps: reps}
	if rir >= 0 {
		s.RIR = f(rir)
	}
	return s
}

func lb(n int, load float64, reps int, rir float64) Set {
	s := kg(n, load, reps, rir)
	s.Unit = "lb"
	return s
}

func bw(n int, reps int, rir float64) Set {
	s := Set{SetNumber: n, Reps: reps}
	if rir >= 0 {
		s.RIR = f(rir)
	}
	return s
}

func ex(date string, sets ...Set) Exposure { return Exposure{Date: date, Position: 1, Sets: sets} }

func evTypes(evs []Event) []string {
	out := []string{}
	for _, e := range evs {
		out = append(out, e.Type)
	}
	return out
}

func TestTopSetSelection(t *testing.T) {
	cases := []struct {
		name string
		sets []Set
		want TopSet
	}{
		{"heaviest load wins", []Set{kg(1, 60, 10, 2), kg(2, 80, 5, 1), kg(3, 70, 8, 1)}, TopSet{Load: f(80), Reps: 5, RIR: f(1)}},
		{"tie on load: most reps", []Set{kg(1, 80, 5, 2), kg(2, 80, 7, 0)}, TopSet{Load: f(80), Reps: 7, RIR: f(0)}},
		{"tie on load and reps: lowest set number", []Set{kg(3, 80, 6, 0), kg(2, 80, 6, 2), kg(4, 80, 6, 1)}, TopSet{Load: f(80), Reps: 6, RIR: f(2)}},
		{"bodyweight compares reps only", []Set{bw(1, 10, 3), bw(2, 14, 1), bw(3, 12, 0)}, TopSet{Reps: 14, RIR: f(1)}},
		{"bodyweight tie: lowest set number", []Set{bw(2, 12, 0), bw(1, 12, 2)}, TopSet{Reps: 12, RIR: f(2)}},
		{"unknown RIR stays nil", []Set{kg(1, 50, 5, -1)}, TopSet{Load: f(50), Reps: 5}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := topSet(tc.sets)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("topSet = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestFirstExposureHasNoEventsButHasMetrics(t *testing.T) {
	res := Analyze([]Exposure{{Date: "2026-09-01", Position: 3, Sets: []Set{kg(1, 80, 5, 2), kg(2, 80, 5, 2), kg(3, 70, 8, 1)}}})["kg"]
	if len(res) != 1 {
		t.Fatalf("results = %d", len(res))
	}
	r := res[0]
	if len(r.Events) != 0 {
		t.Fatalf("first exposure events = %v, want none", r.Events)
	}
	if r.Position != 3 || r.SetCount != 3 || r.TotalReps != 18 {
		t.Fatalf("context/metrics wrong: %+v", r)
	}
	if r.MaxLoad == nil || *r.MaxLoad != 80 {
		t.Fatalf("max load = %v", r.MaxLoad)
	}
	if r.VolumeLoad == nil || *r.VolumeLoad != 80*5+80*5+70*8 {
		t.Fatalf("volume = %v", r.VolumeLoad)
	}
	// 80 × (1 + (5 + 2) / 30) = 98.666…
	if r.Estimated1RM == nil || *r.Estimated1RM != 98.67 {
		t.Fatalf("e1rm = %v", r.Estimated1RM)
	}
}

func TestEstimated1RMOmittedWithoutRIR(t *testing.T) {
	r := Analyze([]Exposure{ex("2026-09-01", kg(1, 100, 5, -1))})["kg"][0]
	if r.Estimated1RM != nil {
		t.Fatalf("e1rm = %v, want nil when RIR unknown", *r.Estimated1RM)
	}
}

func TestContractExampleEstimated1RM(t *testing.T) {
	// Contract §3.10 example: 32.5 kg × 9 @ 1 RIR → 43.33.
	r := Analyze([]Exposure{ex("2026-09-29", kg(1, 32.5, 9, 1))})["kg"][0]
	if r.Estimated1RM == nil || *r.Estimated1RM != 43.33 {
		t.Fatalf("e1rm = %v, want 43.33", r.Estimated1RM)
	}
}

func TestEvents(t *testing.T) {
	cases := []struct {
		name string
		in   []Exposure
		want []Event // events of the LAST exposure
	}{
		{
			name: "LOAD_PR and LOAD_CHANGE when load goes up",
			in:   []Exposure{ex("d1", kg(1, 80, 5, 2)), ex("d2", kg(1, 82.5, 5, 2))},
			want: []Event{{Type: EventLoadPR, Load: f(82.5), Unit: "kg"}, {Type: EventLoadChange, Delta: f(2.5), Unit: "kg"}},
		},
		{
			name: "LOAD_CHANGE down is not a PR",
			in:   []Exposure{ex("d1", kg(1, 80, 5, 2)), ex("d2", kg(1, 75, 5, 2))},
			want: []Event{{Type: EventLoadChange, Delta: f(-5), Unit: "kg"}},
		},
		{
			name: "no LOAD_PR when an older exposure was heavier, but LOAD_CHANGE vs previous",
			in:   []Exposure{ex("d1", kg(1, 100, 5, 2)), ex("d2", kg(1, 80, 5, 2)), ex("d3", kg(1, 90, 5, 2))},
			want: []Event{{Type: EventLoadChange, Delta: f(10), Unit: "kg"}},
		},
		{
			name: "equal to the all-time max load is not a LOAD_PR",
			in:   []Exposure{ex("d1", kg(1, 100, 5, 2)), ex("d2", kg(1, 80, 5, 2)), ex("d3", kg(1, 100, 5, 2))},
			want: []Event{{Type: EventLoadChange, Delta: f(20), Unit: "kg"}},
		},
		{
			name: "REP_PR at the same load, and no MATCHED/REPS_DOWN",
			in:   []Exposure{ex("d1", kg(1, 80, 5, 2)), ex("d2", kg(1, 80, 6, 1))},
			want: []Event{{Type: EventRepPR, Load: f(80), Unit: "kg", Reps: pi(6)}},
		},
		{
			name: "REP_PR can come from a non-top set",
			in:   []Exposure{ex("d1", kg(1, 100, 5, 2), kg(2, 60, 10, 2)), ex("d2", kg(1, 100, 5, 2), kg(2, 60, 12, 2))},
			want: []Event{{Type: EventRepPR, Load: f(60), Unit: "kg", Reps: pi(12)}, {Type: EventMatched}},
		},
		{
			name: "reps equal to the earlier best at that load are not a REP_PR",
			in:   []Exposure{ex("d1", kg(1, 80, 8, 1)), ex("d2", kg(1, 80, 6, 1)), ex("d3", kg(1, 80, 8, 1))},
			want: []Event{},
		},
		{
			name: "a load never done before is not a REP_PR",
			in:   []Exposure{ex("d1", kg(1, 80, 5, 2)), ex("d2", kg(1, 80, 5, 2), kg(2, 70, 20, 2))},
			want: []Event{{Type: EventMatched}},
		},
		{
			name: "MATCHED: same top load and reps",
			in:   []Exposure{ex("d1", kg(1, 80, 5, 2)), ex("d2", kg(1, 80, 5, 3))},
			want: []Event{{Type: EventMatched}},
		},
		{
			name: "REPS_DOWN: same load, fewer reps, RIR equal",
			in:   []Exposure{ex("d1", kg(1, 80, 8, 2)), ex("d2", kg(1, 80, 6, 2))},
			want: []Event{{Type: EventRepsDown, Reps: pi(6), PreviousReps: pi(8)}},
		},
		{
			name: "REPS_DOWN: same load, fewer reps, RIR lower",
			in:   []Exposure{ex("d1", kg(1, 80, 8, 2)), ex("d2", kg(1, 80, 6, 0))},
			want: []Event{{Type: EventRepsDown, Reps: pi(6), PreviousReps: pi(8)}},
		},
		{
			name: "RIR higher is not a drop",
			in:   []Exposure{ex("d1", kg(1, 80, 8, 1)), ex("d2", kg(1, 80, 6, 3))},
			want: []Event{},
		},
		{
			name: "unknown RIR cannot prove an easier day: REPS_DOWN",
			in:   []Exposure{ex("d1", kg(1, 80, 8, 1)), ex("d2", kg(1, 80, 6, -1))},
			want: []Event{{Type: EventRepsDown, Reps: pi(6), PreviousReps: pi(8)}},
		},
		{
			name: "more reps at the same load as previous, but below the all-time best: no event",
			in:   []Exposure{ex("d1", kg(1, 80, 10, 1)), ex("d2", kg(1, 80, 6, 1)), ex("d3", kg(1, 80, 8, 1))},
			want: []Event{},
		},
		{
			name: "ties on top set choose most reps for comparison",
			in:   []Exposure{ex("d1", kg(1, 80, 5, 2), kg(2, 80, 7, 1)), ex("d2", kg(1, 80, 7, 1), kg(2, 80, 5, 2))},
			want: []Event{{Type: EventMatched}},
		},
		{
			name: "bodyweight: reps PR",
			in:   []Exposure{ex("d1", bw(1, 10, 2)), ex("d2", bw(1, 12, 2))},
			want: []Event{{Type: EventRepPR, Reps: pi(12)}},
		},
		{
			name: "bodyweight: matched",
			in:   []Exposure{ex("d1", bw(1, 10, 2)), ex("d2", bw(1, 10, 2))},
			want: []Event{{Type: EventMatched}},
		},
		{
			name: "bodyweight: reps down",
			in:   []Exposure{ex("d1", bw(1, 12, 2)), ex("d2", bw(1, 9, 1))},
			want: []Event{{Type: EventRepsDown, Reps: pi(9), PreviousReps: pi(12)}},
		},
		{
			name: "bodyweight never produces load events",
			in:   []Exposure{ex("d1", bw(1, 10, 2)), ex("d2", bw(1, 14, 2))},
			want: []Event{{Type: EventRepPR, Reps: pi(14)}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			series := Analyze(tc.in)
			var res []Result
			for _, r := range series {
				res = r
			}
			if len(series) != 1 {
				t.Fatalf("expected one unit series, got %d", len(series))
			}
			got := res[len(res)-1].Events
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("events = %s\n got  %+v\n want %+v", evTypes(got), got, tc.want)
			}
		})
	}
}

func TestREPPRAndLoadPRUseAllEarlierExposures(t *testing.T) {
	// Not just the previous exposure: d1 best at 80 is 10 reps.
	in := []Exposure{ex("d1", kg(1, 80, 10, 1)), ex("d2", kg(1, 80, 6, 1)), ex("d3", kg(1, 80, 11, 0))}
	got := Analyze(in)["kg"][2].Events
	want := []Event{{Type: EventRepPR, Load: f(80), Unit: "kg", Reps: pi(11)}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("events = %+v, want %+v", got, want)
	}
}

func TestUnitsAreNeverConverted(t *testing.T) {
	// 100 lb after 60 kg would be a "load PR" if units were mixed. They are
	// separate series, so the lb exposure is a first exposure with no events.
	in := []Exposure{ex("d1", kg(1, 60, 5, 2)), ex("d2", lb(1, 100, 5, 2)), ex("d3", kg(1, 62.5, 5, 2)), ex("d4", lb(1, 100, 6, 2))}
	got := Analyze(in)

	if n := len(got["kg"]); n != 2 {
		t.Fatalf("kg series = %d, want 2", n)
	}
	if n := len(got["lb"]); n != 2 {
		t.Fatalf("lb series = %d, want 2", n)
	}
	if ev := got["lb"][0].Events; len(ev) != 0 {
		t.Fatalf("first lb exposure events = %v, want none", ev)
	}
	if want := []string{EventLoadPR, EventLoadChange}; !reflect.DeepEqual(evTypes(got["kg"][1].Events), want) {
		t.Fatalf("kg events = %v, want %v", evTypes(got["kg"][1].Events), want)
	}
	if want := []string{EventRepPR}; !reflect.DeepEqual(evTypes(got["lb"][1].Events), want) {
		t.Fatalf("lb events = %v, want %v", evTypes(got["lb"][1].Events), want)
	}
	if got["lb"][1].Unit != "lb" || got["kg"][0].Unit != "kg" {
		t.Fatalf("units not carried: %+v %+v", got["lb"][1], got["kg"][0])
	}
	// Results map back to the input exposures.
	if got["kg"][1].Index != 2 || got["lb"][1].Index != 3 {
		t.Fatalf("indexes = %d, %d", got["kg"][1].Index, got["lb"][1].Index)
	}
}

func TestMixedUnitsInOneExposureSplitIntoSeries(t *testing.T) {
	in := []Exposure{ex("d1", kg(1, 60, 5, 2), lb(2, 135, 5, 2)), ex("d2", kg(1, 60, 5, 2), lb(2, 135, 5, 2))}
	got := Analyze(in)
	for _, unit := range []string{"kg", "lb"} {
		if len(got[unit]) != 2 || got[unit][0].SetCount != 1 {
			t.Fatalf("%s series = %+v", unit, got[unit])
		}
		if !reflect.DeepEqual(evTypes(got[unit][1].Events), []string{EventMatched}) {
			t.Fatalf("%s events = %v", unit, evTypes(got[unit][1].Events))
		}
	}
}

func TestBodyweightIsItsOwnSeries(t *testing.T) {
	in := []Exposure{ex("d1", bw(1, 10, 2)), ex("d2", bw(1, 10, 2), kg(2, 20, 8, 2))}
	got := Analyze(in)
	if len(got[""]) != 2 || len(got["kg"]) != 1 {
		t.Fatalf("series sizes: bw=%d kg=%d", len(got[""]), len(got["kg"]))
	}
	if r := got[""][0]; r.MaxLoad != nil || r.VolumeLoad != nil || r.Estimated1RM != nil {
		t.Fatalf("bodyweight metrics should omit load-based values: %+v", r)
	}
}

func TestEventsEmptySliceNotNil(t *testing.T) {
	r := Analyze([]Exposure{ex("d1", kg(1, 80, 5, 2))})["kg"][0]
	if r.Events == nil {
		t.Fatal("Events must be a non-nil empty slice so JSON renders []")
	}
}

func TestEmptyInput(t *testing.T) {
	if got := Analyze(nil); len(got) != 0 {
		t.Fatalf("Analyze(nil) = %v", got)
	}
}

func pi(v int) *int { return &v }
