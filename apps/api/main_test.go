package main

import (
	"encoding/json"
	"testing"

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
