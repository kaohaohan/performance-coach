import assert from "node:assert/strict";
import test from "node:test";
import {
  areProgrammingControlsDisabled,
  clearedBuildTransaction,
  shouldOfferRetry,
  type BuildTransaction,
} from "./build-transaction.ts";

// A build that got as far as creating the template and then failed to assign
// it: the state the "Retry Assignment" affordance exists for.
function halfCommitted(): BuildTransaction {
  return {
    buildStatus: "assignmentFailed",
    pendingAssignment: {
      workoutId: "workout-b",
      athleteIds: ["athlete-1"],
      scheduledDate: "2026-08-25",
    },
    buildError: "offline",
    assignError: null,
    assignSuccess: null,
  };
}

test("clearing a half-committed transaction drops the created workout id", () => {
  const cleared = clearedBuildTransaction();

  assert.equal(cleared.pendingAssignment, null);
  assert.equal(cleared.buildStatus, "idle");
  assert.equal(cleared.buildError, null);
  assert.equal(cleared.assignError, null);
  assert.equal(cleared.assignSuccess, null);
});

test("a cleared transaction no longer offers to retry the assignment", () => {
  assert.equal(shouldOfferRetry(halfCommitted()), true);
  assert.equal(shouldOfferRetry(clearedBuildTransaction()), false);
});

test("retry is not offered while the transaction is still in flight", () => {
  const inFlight = { ...halfCommitted(), buildStatus: "assigning" as const };

  assert.equal(shouldOfferRetry(inFlight), false);
});

test("retry is not offered once the assignment has landed", () => {
  const assigned = { ...halfCommitted(), buildStatus: "idle" as const };

  assert.equal(shouldOfferRetry(assigned), false);
});

// The guard that makes Discard Draft unreachable mid-build. If this ever goes
// false while a template has been created, discarding could strand a workout
// id that the retry button would still act on.
test("programming controls stay disabled for every non-idle build status", () => {
  for (const buildStatus of ["creating", "assigning", "assignmentFailed", "savingChanges"] as const) {
    assert.equal(
      areProgrammingControlsDisabled({ buildStatus }, false),
      true,
      `expected controls disabled while buildStatus is ${buildStatus}`,
    );
  }

  assert.equal(areProgrammingControlsDisabled({ buildStatus: "idle" }, false), false);
  assert.equal(areProgrammingControlsDisabled({ buildStatus: "idle" }, true), true);
});

test("a discarded draft cannot carry a stale workout id into the next build", () => {
  const next = { ...halfCommitted(), ...clearedBuildTransaction() };

  assert.equal(next.pendingAssignment, null);
  assert.equal(shouldOfferRetry(next), false);
  assert.equal(areProgrammingControlsDisabled(next, false), false);
});
