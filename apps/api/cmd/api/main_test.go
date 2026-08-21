package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
)

func TestCreateWorkoutRequestDecodesCanonicalPlan(t *testing.T) {
	var req createWorkoutRequest
	if err := json.Unmarshal([]byte(`{"name":"Lower","exercises":[{"name":"Back Squat","plan":{"setCount":5,"defaults":{"reps":10,"load":80,"unit":"kg","rpe":8},"overrides":[{"position":3,"reps":8}]}}]}`), &req); err != nil {
		t.Fatal(err)
	}
	if len(req.Exercises) != 1 || req.Exercises[0].Plan.SetCount != 5 {
		t.Fatalf("decoded request = %#v", req)
	}
	plan := prescription.Plan{SetCount: req.Exercises[0].Plan.SetCount, Defaults: prescription.Defaults{Reps: req.Exercises[0].Plan.Defaults.Reps, Load: req.Exercises[0].Plan.Defaults.Load, Unit: req.Exercises[0].Plan.Defaults.Unit, RPE: req.Exercises[0].Plan.Defaults.RPE}, Overrides: mapWorkoutOverrides(req.Exercises[0].Plan.Overrides)}
	if _, err := prescription.Resolve(plan); err != nil {
		t.Fatalf("canonical plan should resolve: %v", err)
	}
}

func TestCreateWorkoutRequestLegacyScalarDoesNotProducePlan(t *testing.T) {
	var req createWorkoutRequest
	if err := json.Unmarshal([]byte(`{"name":"Legacy","exercises":[{"name":"Back Squat","targetSets":3,"targetReps":5}]}`), &req); err != nil {
		t.Fatal(err)
	}
	plan := prescription.Plan{SetCount: req.Exercises[0].Plan.SetCount, Defaults: prescription.Defaults{Reps: req.Exercises[0].Plan.Defaults.Reps}}
	if _, err := prescription.Resolve(plan); err == nil {
		t.Fatal("legacy scalar payload unexpectedly resolved as a canonical plan")
	}
}

func TestCreateSetLogRequestDecodesPlannedAssociation(t *testing.T) {
	var req createSetLogRequest
	if err := json.Unmarshal([]byte(`{"kind":"PLANNED","scheduledWorkoutExerciseId":"exercise-id","scheduledWorkoutPlannedSetId":"planned-set-id","reps":10}`), &req); err != nil {
		t.Fatal(err)
	}
	if req.Kind != "PLANNED" || req.ScheduledWorkoutExerciseID != "exercise-id" || req.ScheduledWorkoutPlannedSetID == nil || *req.ScheduledWorkoutPlannedSetID != "planned-set-id" || req.Reps == nil || *req.Reps != 10 {
		t.Fatalf("decoded request = %#v", req)
	}
}

func TestCreateSetLogRequestDecodesExtraWithoutPlannedAssociation(t *testing.T) {
	var req createSetLogRequest
	if err := json.Unmarshal([]byte(`{"kind":"EXTRA","scheduledWorkoutExerciseId":"exercise-id","reps":8}`), &req); err != nil {
		t.Fatal(err)
	}
	if req.Kind != "EXTRA" || req.ScheduledWorkoutPlannedSetID != nil {
		t.Fatalf("decoded request = %#v", req)
	}
}

// coachSignupFakeIdentityVerifier lets these tests exercise
// handleCoachSignup behind the real authn.FirebaseOnlyMiddleware without a
// live Firebase project or the Auth Emulator.
type coachSignupFakeIdentityVerifier struct {
	identity authn.Identity
	err      error
}

func (f coachSignupFakeIdentityVerifier) VerifyIdentity(ctx context.Context, idToken string) (authn.Identity, error) {
	return f.identity, f.err
}

// TestCoachSignupRequestDecodesNameOnlyIgnoringClientSuppliedIdentity is
// the "client cannot choose role" contract at the wire level: firebaseUid,
// role, coachId, and athleteId sent by a malicious/buggy client are simply
// discarded by decoding into coachSignupRequest, which has no field for
// any of them — only name survives.
func TestCoachSignupRequestDecodesNameOnlyIgnoringClientSuppliedIdentity(t *testing.T) {
	var req coachSignupRequest
	raw := `{"name":"Coach Kevin","role":"COACH","firebaseUid":"attacker-controlled","coachId":"spoofed-id","athleteId":"spoofed-id"}`
	if err := json.Unmarshal([]byte(raw), &req); err != nil {
		t.Fatal(err)
	}
	if req.Name != "Coach Kevin" {
		t.Fatalf("decoded name = %q, want %q", req.Name, "Coach Kevin")
	}
}

// TestHandleCoachSignupRejectsMissingOrInvalidFirebaseToken proves
// handleCoachSignup, wired behind the real authn.FirebaseOnlyMiddleware
// (exactly as cmd/api/main.go wires it), returns 401 UNAUTHENTICATED both
// for a request with no Authorization header and for one whose token the
// verifier rejects — the handler is never reached in either case.
func TestHandleCoachSignupRejectsMissingOrInvalidFirebaseToken(t *testing.T) {
	cases := []struct {
		name     string
		header   string
		verifier coachSignupFakeIdentityVerifier
	}{
		{name: "missing Authorization header"},
		{name: "invalid token", header: "Bearer not-a-real-token", verifier: coachSignupFakeIdentityVerifier{err: errors.New("invalid token")}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			handler := authn.FirebaseOnlyMiddleware(c.verifier)(handleCoachSignup(nil))

			req := httptest.NewRequest(http.MethodPost, "/api/v1/coach-signup", nil)
			if c.header != "" {
				req.Header.Set("Authorization", c.header)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
		})
	}
}
