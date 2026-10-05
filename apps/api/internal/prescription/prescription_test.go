package prescription

import (
	"reflect"
	"strings"
	"testing"
)

func TestResolveUniformFiveSetPlan(t *testing.T) {
	reps := 10
	load := 80.0
	unit := UnitKG
	rir := 8.0

	resolved, err := Resolve(Plan{
		SetCount: 5,
		Defaults: Defaults{Reps: &reps, Load: &load, Unit: &unit, RIR: &rir},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(resolved) != 5 {
		t.Fatalf("resolved length = %d, want 5", len(resolved))
	}
	for i, set := range resolved {
		position := i + 1
		if set.Position != position {
			t.Fatalf("position[%d] = %d, want %d", i, set.Position, position)
		}
		assertIntPointer(t, set.Reps, 10, "reps")
		assertFloatPointer(t, set.Load, 80, "load")
		assertStringPointer(t, set.Unit, UnitKG, "unit")
		assertFloatPointer(t, set.RIR, 8, "rir")
		if set.PrescriptionNote != nil {
			t.Fatalf("position %d prescriptionNote = %q, want nil", position, *set.PrescriptionNote)
		}
	}
}

func TestResolveIndependentOverrides(t *testing.T) {
	reps := 10
	load := 80.0
	unit := UnitKG
	rir := 8.0
	altReps := 8
	altLoad := 90.0
	altRIR := 9.0
	amap := "AMAP"

	tests := []struct {
		name      string
		defaults  Defaults
		overrides []SetOverride
		assert    func(*testing.T, []ResolvedPlannedSet)
	}{
		{
			name:     "reps only override preserves load and rir",
			defaults: Defaults{Reps: &reps, Load: &load, Unit: &unit, RIR: &rir},
			overrides: []SetOverride{{
				Position: 3,
				Reps:     &altReps,
			}},
			assert: func(t *testing.T, sets []ResolvedPlannedSet) {
				assertIntPointer(t, sets[2].Reps, 8, "set 3 reps")
				assertFloatPointer(t, sets[2].Load, 80, "set 3 load")
				assertFloatPointer(t, sets[2].RIR, 8, "set 3 rir")
				assertIntPointer(t, sets[0].Reps, 10, "set 1 inherited reps")
			},
		},
		{
			name:     "load only override preserves prescription and rir",
			defaults: Defaults{Reps: &reps, Load: &load, Unit: &unit, RIR: &rir},
			overrides: []SetOverride{{
				Position: 2,
				Load:     &altLoad,
			}},
			assert: func(t *testing.T, sets []ResolvedPlannedSet) {
				assertIntPointer(t, sets[1].Reps, 10, "set 2 reps")
				assertFloatPointer(t, sets[1].Load, 90, "set 2 load")
				assertStringPointer(t, sets[1].Unit, UnitKG, "set 2 unit")
				assertFloatPointer(t, sets[1].RIR, 8, "set 2 rir")
			},
		},
		{
			name:     "rir only override preserves prescription and load",
			defaults: Defaults{Reps: &reps, Load: &load, Unit: &unit, RIR: &rir},
			overrides: []SetOverride{{
				Position: 4,
				RIR:      &altRIR,
			}},
			assert: func(t *testing.T, sets []ResolvedPlannedSet) {
				assertIntPointer(t, sets[3].Reps, 10, "set 4 reps")
				assertFloatPointer(t, sets[3].Load, 80, "set 4 load")
				assertFloatPointer(t, sets[3].RIR, 9, "set 4 rir")
			},
		},
		{
			name:     "combined independent overrides",
			defaults: Defaults{Reps: &reps, Load: &load, Unit: &unit, RIR: &rir},
			overrides: []SetOverride{
				{Position: 3, Reps: &altReps},
				{Position: 5, Load: &altLoad, RIR: &altRIR},
			},
			assert: func(t *testing.T, sets []ResolvedPlannedSet) {
				assertIntPointer(t, sets[2].Reps, 8, "set 3 reps")
				assertFloatPointer(t, sets[2].Load, 80, "set 3 inherited load")
				assertFloatPointer(t, sets[2].RIR, 8, "set 3 inherited rir")
				assertIntPointer(t, sets[4].Reps, 10, "set 5 inherited reps")
				assertFloatPointer(t, sets[4].Load, 90, "set 5 load")
				assertFloatPointer(t, sets[4].RIR, 9, "set 5 rir")
			},
		},
		{
			name:     "reps default switches to text override",
			defaults: Defaults{Reps: &reps},
			overrides: []SetOverride{{
				Position:         2,
				PrescriptionNote: &amap,
			}},
			assert: func(t *testing.T, sets []ResolvedPlannedSet) {
				if sets[1].Reps != nil {
					t.Fatalf("set 2 reps = %d, want nil", *sets[1].Reps)
				}
				assertStringPointer(t, sets[1].PrescriptionNote, "AMAP", "set 2 prescriptionNote")
				assertIntPointer(t, sets[0].Reps, 10, "set 1 inherited reps")
			},
		},
		{
			name:     "text default switches to reps override",
			defaults: Defaults{PrescriptionNote: &amap},
			overrides: []SetOverride{{
				Position: 2,
				Reps:     &altReps,
			}},
			assert: func(t *testing.T, sets []ResolvedPlannedSet) {
				if sets[1].PrescriptionNote != nil {
					t.Fatalf("set 2 prescriptionNote = %q, want nil", *sets[1].PrescriptionNote)
				}
				assertIntPointer(t, sets[1].Reps, 8, "set 2 reps")
				assertStringPointer(t, sets[0].PrescriptionNote, "AMAP", "set 1 inherited note")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolved, err := Resolve(Plan{SetCount: 5, Defaults: tt.defaults, Overrides: tt.overrides})
			if err != nil {
				t.Fatal(err)
			}
			tt.assert(t, resolved)
		})
	}
}

func TestResolveOverrideLoadCanUseExerciseLevelUnitWithoutDefaultLoad(t *testing.T) {
	reps := 10
	unit := UnitKG
	load := 80.0

	resolved, err := Resolve(Plan{
		SetCount: 3,
		Defaults: Defaults{
			Reps: &reps,
			Unit: &unit,
		},
		Overrides: []SetOverride{{Position: 3, Load: &load}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if resolved[0].Load != nil || resolved[0].Unit != nil {
		t.Fatalf("set 1 load/unit = %#v/%#v, want nil/nil", resolved[0].Load, resolved[0].Unit)
	}
	assertFloatPointer(t, resolved[2].Load, 80, "set 3 load")
	assertStringPointer(t, resolved[2].Unit, UnitKG, "set 3 unit")
}

func TestResolveValidation(t *testing.T) {
	validReps := 10
	validUnit := UnitKG
	validLoad := 80.0
	validRIR := 8.0
	validNote := "AMAP"
	invalidReps := 0
	negativeLoad := -1.0
	belowRIR := -0.5
	aboveRIR := 9.5
	invalidUnit := "stone"
	blank := ""
	spaces := " \t "

	tests := []struct {
		name    string
		plan    Plan
		message string
	}{
		{"set count zero", Plan{Defaults: Defaults{Reps: &validReps}}, "setCount must be at least 1"},
		{"negative set count", Plan{SetCount: -1, Defaults: Defaults{Reps: &validReps}}, "setCount must be at least 1"},
		{"defaults both prescription forms", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps, PrescriptionNote: &validNote}}, "defaults must specify exactly one"},
		{"defaults neither prescription form", Plan{SetCount: 1}, "defaults must specify exactly one"},
		{"default reps zero", Plan{SetCount: 1, Defaults: Defaults{Reps: &invalidReps}}, "defaults.reps must be at least 1"},
		{"blank default text", Plan{SetCount: 1, Defaults: Defaults{PrescriptionNote: &blank}}, "defaults.prescriptionNote must be nonblank"},
		{"whitespace default text", Plan{SetCount: 1, Defaults: Defaults{PrescriptionNote: &spaces}}, "defaults.prescriptionNote must be nonblank"},
		{"negative default load", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps, Load: &negativeLoad, Unit: &validUnit}}, "defaults.load must be at least 0"},
		{"default load requires unit", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps, Load: &validLoad}}, "load requires unit"},
		{"invalid unit", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps, Load: &validLoad, Unit: &invalidUnit}}, "unit must be kg or lb"},
		{"unit without any load", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps, Unit: &validUnit}}, "unit requires a default or override load"},
		{"rir below zero", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps, RIR: &belowRIR}}, "defaults.rir must be between 0 and 9"},
		{"rir above nine", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps, RIR: &aboveRIR}}, "defaults.rir must be between 0 and 9"},
		{"position zero", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps}, Overrides: []SetOverride{{Position: 0, RIR: &validRIR}}}, "override position 0 must be at least 1"},
		{"negative position", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps}, Overrides: []SetOverride{{Position: -1, RIR: &validRIR}}}, "override position -1 must be at least 1"},
		{"position exceeds set count", Plan{SetCount: 3, Defaults: Defaults{Reps: &validReps}, Overrides: []SetOverride{{Position: 5, RIR: &validRIR}}}, "override position 5 exceeds setCount 3"},
		{"duplicate override positions", Plan{SetCount: 2, Defaults: Defaults{Reps: &validReps}, Overrides: []SetOverride{{Position: 1, RIR: &validRIR}, {Position: 1, Load: &validLoad}}}, "override position 1 is duplicated"},
		{"empty override", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps}, Overrides: []SetOverride{{Position: 1}}}, "override at position 1 must specify at least one property"},
		{"override reps and text", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps}, Overrides: []SetOverride{{Position: 1, Reps: &validReps, PrescriptionNote: &validNote}}}, "override at position 1 must not specify both"},
		{"invalid override reps", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps}, Overrides: []SetOverride{{Position: 1, Reps: &invalidReps}}}, "override at position 1 reps must be at least 1"},
		{"blank override text", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps}, Overrides: []SetOverride{{Position: 1, PrescriptionNote: &spaces}}}, "override at position 1 prescriptionNote must be nonblank"},
		{"negative override load", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps, Unit: &validUnit}, Overrides: []SetOverride{{Position: 1, Load: &negativeLoad}}}, "override at position 1 load must be at least 0"},
		{"override load requires exercise unit", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps}, Overrides: []SetOverride{{Position: 1, Load: &validLoad}}}, "load requires unit"},
		{"override rir below zero", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps}, Overrides: []SetOverride{{Position: 1, RIR: &belowRIR}}}, "override at position 1 rir must be between 0 and 9"},
		{"override rir above nine", Plan{SetCount: 1, Defaults: Defaults{Reps: &validReps}, Overrides: []SetOverride{{Position: 1, RIR: &aboveRIR}}}, "override at position 1 rir must be between 0 and 9"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Resolve(tt.plan)
			if err == nil {
				t.Fatal("Resolve returned nil error")
			}
			var validationErr *ValidationError
			if !asValidationError(err, &validationErr) {
				t.Fatalf("error = %T %v, want *ValidationError", err, err)
			}
			if !strings.Contains(err.Error(), tt.message) {
				t.Fatalf("error = %q, want substring %q", err.Error(), tt.message)
			}
		})
	}
}

func TestResolveDoesNotMutateInputOrAliasCallerValues(t *testing.T) {
	reps := 10
	load := 80.0
	unit := UnitKG
	rir := 8.0
	overrideReps := 8
	overrideLoad := 90.0
	plan := Plan{
		SetCount:  2,
		Defaults:  Defaults{Reps: &reps, Load: &load, Unit: &unit, RIR: &rir},
		Overrides: []SetOverride{{Position: 2, Reps: &overrideReps, Load: &overrideLoad}},
	}
	before := clonePlan(plan)

	resolved, err := Resolve(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(plan, before) {
		t.Fatalf("Resolve mutated plan:\n got %#v\nwant %#v", plan, before)
	}

	*resolved[0].Reps = 99
	*resolved[1].Load = 101
	if reps != 10 || overrideLoad != 90 {
		t.Fatalf("resolved values alias caller values: reps=%d overrideLoad=%v", reps, overrideLoad)
	}
}

func assertIntPointer(t *testing.T, got *int, want int, label string) {
	t.Helper()
	if got == nil || *got != want {
		if got == nil {
			t.Fatalf("%s = nil, want %d", label, want)
		}
		t.Fatalf("%s = %d, want %d", label, *got, want)
	}
}

func assertFloatPointer(t *testing.T, got *float64, want float64, label string) {
	t.Helper()
	if got == nil || *got != want {
		if got == nil {
			t.Fatalf("%s = nil, want %v", label, want)
		}
		t.Fatalf("%s = %v, want %v", label, *got, want)
	}
}

func assertStringPointer(t *testing.T, got *string, want, label string) {
	t.Helper()
	if got == nil || *got != want {
		if got == nil {
			t.Fatalf("%s = nil, want %q", label, want)
		}
		t.Fatalf("%s = %q, want %q", label, *got, want)
	}
}

func clonePlan(plan Plan) Plan {
	cloned := Plan{
		SetCount: plan.SetCount,
		Defaults: Defaults{
			Reps:             cloneInt(plan.Defaults.Reps),
			PrescriptionNote: cloneString(plan.Defaults.PrescriptionNote),
			Load:             cloneFloat64(plan.Defaults.Load),
			Unit:             cloneString(plan.Defaults.Unit),
			RIR:              cloneFloat64(plan.Defaults.RIR),
		},
		Overrides: make([]SetOverride, len(plan.Overrides)),
	}
	for i, override := range plan.Overrides {
		cloned.Overrides[i] = SetOverride{
			Position:         override.Position,
			Reps:             cloneInt(override.Reps),
			PrescriptionNote: cloneString(override.PrescriptionNote),
			Load:             cloneFloat64(override.Load),
			RIR:              cloneFloat64(override.RIR),
		}
	}
	return cloned
}

func asValidationError(err error, target **ValidationError) bool {
	validationErr, ok := err.(*ValidationError)
	if ok {
		*target = validationErr
	}
	return ok
}
