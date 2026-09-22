import assert from "node:assert/strict";
import test from "node:test";
import { compactPrescription, type Plan } from "./prescription-summary";

const t = (key: string, vars?: Record<string, string | number>) => {
  if (key === "athlete.plan.none") return "No planned sets";
  if (key === "athlete.plan.mixedSets") return `${vars?.count} sets, mixed`;
  if (key === "athlete.set.reps") return `${vars?.count} reps`;
  return key;
};

test("compactPrescription collapses a uniform plan", () => {
  const plan: Plan = {
    sets: [
      { scheduledWorkoutPlannedSetId: "a", position: 1, reps: 5, load: 80, unit: "kg", rpe: 8 },
      { scheduledWorkoutPlannedSetId: "b", position: 2, reps: 5, load: 80, unit: "kg", rpe: 8 },
      { scheduledWorkoutPlannedSetId: "c", position: 3, reps: 5, load: 80, unit: "kg", rpe: 8 },
      { scheduledWorkoutPlannedSetId: "d", position: 4, reps: 5, load: 80, unit: "kg", rpe: 8 },
    ],
  };
  assert.equal(compactPrescription(t as never, plan), "4 × 5 · 80 kg · RPE 8");
});

test("compactPrescription names mixed plans without listing every set", () => {
  const plan: Plan = {
    sets: [
      { scheduledWorkoutPlannedSetId: "a", position: 1, reps: 5, load: 80, unit: "kg" },
      { scheduledWorkoutPlannedSetId: "b", position: 2, reps: 3, load: 90, unit: "kg" },
    ],
  };
  assert.equal(compactPrescription(t as never, plan), "2 sets, mixed");
});

test("compactPrescription reports an empty plan", () => {
  assert.equal(compactPrescription(t as never, { sets: [] }), "No planned sets");
});
