package workoutsession

import "testing"

func TestSetLogRIRRange(t *testing.T) {
	reps := 5
	for _, tc := range []struct {
		name string
		rir  float64
		ok   bool
	}{
		{"zero is valid (to failure)", 0, true},
		{"half step", 1.5, true},
		{"nine is valid", 9, true},
		{"negative", -0.5, false},
		{"ten", 10, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rir := tc.rir
			create := CreateSetLogInput{Kind: "EXTRA", Reps: &reps, RIR: &rir}
			err := create.validate()
			if (err == nil) != tc.ok {
				t.Fatalf("create validate err = %v, ok want %v", err, tc.ok)
			}
			update := UpdateSetLogInput{RIR: &rir, RIRPresent: true}
			err = update.validate(nil, nil, &reps, &rir)
			if (err == nil) != tc.ok {
				t.Fatalf("update validate err = %v, ok want %v", err, tc.ok)
			}
			if err != nil && err.Error() != "rir must be between 0 and 9" {
				t.Fatalf("message = %q", err.Error())
			}
		})
	}
}
