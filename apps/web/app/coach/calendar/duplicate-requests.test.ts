import assert from "node:assert/strict";
import test from "node:test";
import { createDuplicateInFlightGuard, duplicateSourceEndpoint, submitDuplicateRequests } from "./duplicate-requests";

test("submits only the selected source workout IDs", async () => {
  const requests: string[] = [];
  const failures = await submitDuplicateRequests({
    workoutIds: ["bench"],
    athleteIds: ["client"],
    targetDate: "2026-08-31",
    allowDuplicates: false,
    schedule: async (body) => { requests.push(body.workoutId); },
    errorMessage: () => "",
    isDuplicateConflict: () => false,
  });

  assert.deepEqual(requests, ["bench"]);
  assert.deepEqual(failures, []);
});

test("retries only the failed workout from a selected set after a partial failure", async () => {
  const firstRequests: string[] = [];
  const firstFailures = await submitDuplicateRequests({
    workoutIds: ["strength", "conditioning", "mobility"],
    athleteIds: ["client"],
    targetDate: "2026-08-31",
    allowDuplicates: false,
    schedule: async (body) => {
      firstRequests.push(body.workoutId);
      if (body.workoutId === "conditioning") throw new Error("offline");
    },
    errorMessage: (error) => (error as Error).message,
    isDuplicateConflict: () => false,
  });
  const retryRequests: string[] = [];
  await submitDuplicateRequests({
    workoutIds: firstFailures.map((failure) => failure.workoutId),
    athleteIds: ["client"],
    targetDate: "2026-08-31",
    allowDuplicates: false,
    schedule: async (body) => { retryRequests.push(body.workoutId); },
    errorMessage: () => "",
    isDuplicateConflict: () => false,
  });

  assert.deepEqual(firstRequests, ["strength", "conditioning", "mobility"]);
  assert.deepEqual(retryRequests, ["conditioning"]);
});

test("reports a selected 409-only set for explicit duplicate confirmation", async () => {
  const conflict = new Error("already scheduled");
  const failures = await submitDuplicateRequests({
    workoutIds: ["strength"],
    athleteIds: ["client"],
    targetDate: "2026-08-31",
    allowDuplicates: false,
    schedule: async () => { throw conflict; },
    errorMessage: (error) => (error as Error).message,
    isDuplicateConflict: (error) => error === conflict,
  });

  assert.deepEqual(failures, [{ workoutId: "strength", message: "already scheduled", isDuplicateConflict: true }]);
});

test("builds an independent source-day request outside the visible range", () => {
  assert.equal(
    duplicateSourceEndpoint("2026-02-01", "client id"),
    "/api/v1/scheduled-workouts?from=2026-02-01&to=2026-02-01&athleteId=client%20id",
  );
});

test("guards a second duplicate submission while one is in flight", () => {
  const guard = createDuplicateInFlightGuard();
  assert.equal(guard.start(), true);
  assert.equal(guard.start(), false);
  guard.finish();
  assert.equal(guard.start(), true);
});
