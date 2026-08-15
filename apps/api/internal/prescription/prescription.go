// Package prescription resolves a WorkoutExercise authoring plan into its
// effective ordered planned positions. It is intentionally pure: persistence,
// authorization, HTTP, and identifier generation belong to higher layers.
package prescription

import (
	"fmt"
	"math"
	"strings"
)

const (
	UnitKG = "kg"
	UnitLB = "lb"
)

// Plan is the editable, uniform-first authoring representation for one
// WorkoutExercise.
type Plan struct {
	SetCount  int
	Defaults  Defaults
	Overrides []SetOverride
}

// Defaults are the exercise-level prescription values inherited by positions
// without an explicit override for that property.
type Defaults struct {
	Reps             *int
	PrescriptionNote *string
	Load             *float64
	Unit             *string
	RPE              *float64
}

// SetOverride contains only explicit property values for one planned
// position. Nil means inherit; V0.1 has no explicit-none state.
type SetOverride struct {
	Position         int
	Reps             *int
	PrescriptionNote *string
	Load             *float64
	RPE              *float64
}

// ResolvedPlannedSet is one effective, ordered target after defaults and
// sparse overrides have been resolved.
type ResolvedPlannedSet struct {
	Position         int
	Reps             *int
	PrescriptionNote *string
	Load             *float64
	Unit             *string
	RPE              *float64
}

// ValidationError reports an authoring-plan domain validation failure. It has
// no HTTP meaning; callers map it to their own transport concerns.
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

// Resolve validates plan and returns exactly SetCount effective planned sets
// in ascending position order. It neither mutates plan nor aliases caller
// value pointers in its result.
func Resolve(plan Plan) ([]ResolvedPlannedSet, error) {
	if plan.SetCount < 1 {
		return nil, validationError("setCount must be at least 1")
	}
	if err := validateDefaults(plan.Defaults); err != nil {
		return nil, err
	}

	overridesByPosition, hasAnyLoad, err := validateOverrides(plan)
	if err != nil {
		return nil, err
	}
	if err := validateUnit(plan.Defaults.Unit, hasAnyLoad); err != nil {
		return nil, err
	}

	resolved := make([]ResolvedPlannedSet, 0, plan.SetCount)
	for position := 1; position <= plan.SetCount; position++ {
		set := ResolvedPlannedSet{
			Position:         position,
			Reps:             cloneInt(plan.Defaults.Reps),
			PrescriptionNote: cloneString(plan.Defaults.PrescriptionNote),
			Load:             cloneFloat64(plan.Defaults.Load),
			RPE:              cloneFloat64(plan.Defaults.RPE),
		}

		if override, ok := overridesByPosition[position]; ok {
			if override.Reps != nil {
				set.Reps = cloneInt(override.Reps)
				set.PrescriptionNote = nil
			} else if override.PrescriptionNote != nil {
				set.Reps = nil
				set.PrescriptionNote = cloneString(override.PrescriptionNote)
			}
			if override.Load != nil {
				set.Load = cloneFloat64(override.Load)
			}
			if override.RPE != nil {
				set.RPE = cloneFloat64(override.RPE)
			}
		}

		if set.Load != nil {
			set.Unit = cloneString(plan.Defaults.Unit)
		}
		resolved = append(resolved, set)
	}

	return resolved, nil
}

func validateDefaults(defaults Defaults) error {
	if (defaults.Reps == nil) == (defaults.PrescriptionNote == nil) {
		return validationError("defaults must specify exactly one of reps or prescriptionNote")
	}
	if defaults.Reps != nil && *defaults.Reps < 1 {
		return validationError("defaults.reps must be at least 1")
	}
	if defaults.PrescriptionNote != nil && strings.TrimSpace(*defaults.PrescriptionNote) == "" {
		return validationError("defaults.prescriptionNote must be nonblank")
	}
	if defaults.Load != nil && !isNonNegative(*defaults.Load) {
		return validationError("defaults.load must be at least 0")
	}
	if defaults.RPE != nil && !isRPE(*defaults.RPE) {
		return validationError("defaults.rpe must be between 1 and 10")
	}
	return nil
}

func validateOverrides(plan Plan) (map[int]SetOverride, bool, error) {
	overridesByPosition := make(map[int]SetOverride, len(plan.Overrides))
	hasAnyLoad := plan.Defaults.Load != nil

	for _, override := range plan.Overrides {
		if override.Position < 1 {
			return nil, false, validationError(fmt.Sprintf("override position %d must be at least 1", override.Position))
		}
		if override.Position > plan.SetCount {
			return nil, false, validationError(fmt.Sprintf("override position %d exceeds setCount %d", override.Position, plan.SetCount))
		}
		if _, exists := overridesByPosition[override.Position]; exists {
			return nil, false, validationError(fmt.Sprintf("override position %d is duplicated", override.Position))
		}
		if override.Reps == nil && override.PrescriptionNote == nil && override.Load == nil && override.RPE == nil {
			return nil, false, validationError(fmt.Sprintf("override at position %d must specify at least one property", override.Position))
		}
		if override.Reps != nil && override.PrescriptionNote != nil {
			return nil, false, validationError(fmt.Sprintf("override at position %d must not specify both reps and prescriptionNote", override.Position))
		}
		if override.Reps != nil && *override.Reps < 1 {
			return nil, false, validationError(fmt.Sprintf("override at position %d reps must be at least 1", override.Position))
		}
		if override.PrescriptionNote != nil && strings.TrimSpace(*override.PrescriptionNote) == "" {
			return nil, false, validationError(fmt.Sprintf("override at position %d prescriptionNote must be nonblank", override.Position))
		}
		if override.Load != nil {
			if !isNonNegative(*override.Load) {
				return nil, false, validationError(fmt.Sprintf("override at position %d load must be at least 0", override.Position))
			}
			hasAnyLoad = true
		}
		if override.RPE != nil && !isRPE(*override.RPE) {
			return nil, false, validationError(fmt.Sprintf("override at position %d rpe must be between 1 and 10", override.Position))
		}

		overridesByPosition[override.Position] = override
	}

	return overridesByPosition, hasAnyLoad, nil
}

func validateUnit(unit *string, hasAnyLoad bool) error {
	if unit != nil && *unit != UnitKG && *unit != UnitLB {
		return validationError("unit must be kg or lb")
	}
	if hasAnyLoad && unit == nil {
		return validationError("load requires unit")
	}
	if !hasAnyLoad && unit != nil {
		return validationError("unit requires a default or override load")
	}
	return nil
}

func isNonNegative(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}

func isRPE(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 1 && value <= 10
}

func validationError(message string) error {
	return &ValidationError{Message: message}
}

func cloneInt(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneFloat64(value *float64) *float64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
