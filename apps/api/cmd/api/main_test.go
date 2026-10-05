package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
)

func TestCreateWorkoutRequestDecodesCanonicalPlan(t *testing.T) {
	var req createWorkoutRequest
	if err := json.Unmarshal([]byte(`{"name":"Lower","exercises":[{"name":"Back Squat","plan":{"setCount":5,"defaults":{"reps":10,"load":80,"unit":"kg","rir":8},"overrides":[{"position":3,"reps":8}]}}]}`), &req); err != nil {
		t.Fatal(err)
	}
	if len(req.Exercises) != 1 || req.Exercises[0].Plan.SetCount != 5 {
		t.Fatalf("decoded request = %#v", req)
	}
	plan := prescription.Plan{SetCount: req.Exercises[0].Plan.SetCount, Defaults: prescription.Defaults{Reps: req.Exercises[0].Plan.Defaults.Reps, Load: req.Exercises[0].Plan.Defaults.Load, Unit: req.Exercises[0].Plan.Defaults.Unit, RIR: req.Exercises[0].Plan.Defaults.RIR}, Overrides: mapWorkoutOverrides(req.Exercises[0].Plan.Overrides)}
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

func TestUpdateSetLogRequestPreservesOmittedAndNullFields(t *testing.T) {
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/set-logs/id", strings.NewReader(`{"reps":9,"load":null,"rir":null}`))
	in, err := decodeUpdateSetLogRequest(req)
	if err != nil {
		t.Fatal(err)
	}
	if !in.RepsPresent || in.Reps == nil || *in.Reps != 9 {
		t.Fatalf("reps = %#v", in)
	}
	if !in.LoadPresent || in.Load != nil || !in.RIRPresent || in.RIR != nil {
		t.Fatalf("null fields = %#v", in)
	}
	if in.UnitPresent {
		t.Fatal("omitted unit marked present")
	}
}

func TestUpdateSetLogRequestRejectsMalformedSupportedField(t *testing.T) {
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/set-logs/id", strings.NewReader(`{"reps":"nine"}`))
	if _, err := decodeUpdateSetLogRequest(req); err == nil {
		t.Fatal("malformed reps unexpectedly decoded")
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

func TestDecodeEffortRequestRejectsLegacyRPEKey(t *testing.T) {
	cases := map[string]string{
		"top level":        `{"reps":5,"rpe":8}`,
		"plan defaults":    `{"exercises":[{"plan":{"setCount":3,"defaults":{"reps":5,"rpe":8}}}]}`,
		"override":         `{"exercises":[{"plan":{"overrides":[{"position":1,"rpe":8}]}}]}`,
		"null still a key": `{"reps":5,"rpe":null}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
			var dst map[string]any
			if decodeEffortRequest(rec, req, &dst) {
				t.Fatalf("decode accepted legacy rpe body %s", body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rec.Code)
			}
			var resp struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("decode response: %v (%s)", err, rec.Body.String())
			}
			if resp.Error.Code != "INVALID_ARGUMENT" || resp.Error.Message != "rpe is no longer accepted; use rir" {
				t.Fatalf("error = %+v", resp.Error)
			}
		})
	}
}

func TestDecodeEffortRequestAcceptsRIRAndMalformedStaysMalformed(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"reps":5,"rir":2}`))
	var dst struct {
		RIR *float64 `json:"rir"`
	}
	if !decodeEffortRequest(rec, req, &dst) || dst.RIR == nil || *dst.RIR != 2 {
		t.Fatalf("rir body not decoded: ok body=%s dst=%+v", rec.Body.String(), dst)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{`))
	if decodeEffortRequest(rec, req, &dst) || !strings.Contains(rec.Body.String(), "malformed JSON body") {
		t.Fatalf("malformed body: code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestUpdateSetLogRequestRejectsLegacyRPEKey(t *testing.T) {
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"rpe":8}`))
	if _, err := decodeUpdateSetLogRequest(req); !errors.Is(err, errLegacyRPE) {
		t.Fatalf("err = %v, want errLegacyRPE", err)
	}
}
