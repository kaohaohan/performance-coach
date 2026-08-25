// Build & Assign is a two-phase transaction, and the pair of phases has a
// lifetime of its own — separate from, and layered on top of, the browser-local
// draft in workout-draft.ts.
//
//   POST /api/v1/workouts           → creates the reusable Workout template
//   POST /api/v1/scheduled-workouts → assigns that template to the athletes
//
// The two are deliberately not atomic (docs/mvp-specification.md, "Partial
// failure / retry"). Between them the page holds `pendingAssignment` — the
// created workout id plus the athletes and date it was meant for — and a
// non-idle `buildStatus`. That pair, and nothing else, is what the "Retry
// Assignment" affordance reads: it re-sends only the scheduling call, never
// re-creating the template.
//
// Because it is a second lifetime, every teardown path has to end it too.
// Clearing the draft alone leaves a live workout id and a live retry button
// pointing at authoring the Coach has already walked away from. The cleared
// shape lives here rather than as a run of setState calls inline in page.tsx
// so it can be asserted directly: page.tsx is ~2000 lines of component and
// this repo has no component test harness or renderer dependency for it, so
// logic that is not extracted is logic that is not tested.

export type BuildStatus =
  | "idle"
  | "creating"
  | "assigning"
  | "assignmentFailed"
  | "savingChanges";

export type PendingAssignment = Readonly<{
  workoutId: string;
  athleteIds: readonly string[];
  scheduledDate: string;
}>;

// The half of builder state that describes the in-flight persistence attempt,
// as opposed to the draft content itself (name, exercises, athletes, date).
export type BuildTransaction = {
  buildStatus: BuildStatus;
  pendingAssignment: PendingAssignment | null;
  buildError: string | null;
  assignError: string | null;
  // The success message for the assignment that just landed, or null. A
  // message rather than a flag because it names the workout and date: the
  // builder closes on success, so this notice is the Coach's only
  // confirmation that anything was persisted at all.
  assignSuccess: string | null;
};

// The state a spent or abandoned build transaction resets to. Returned as one
// value rather than applied as scattered setState calls so that "did the
// teardown actually end the transaction?" is a single assertion.
//
// assignSuccess is included: it is a transient confirmation of the transaction
// that just ended, so it must not outlive it into the next draft.
export function clearedBuildTransaction(): BuildTransaction {
  return {
    buildStatus: "idle",
    pendingAssignment: null,
    buildError: null,
    assignError: null,
    assignSuccess: null,
  };
}

// Whether to render the "Workout was created, but it was not assigned" notice
// and its Retry Assignment button.
//
// Both halves are required. buildStatus alone would offer a retry with nothing
// to retry, and pendingAssignment alone would keep offering one after the
// assignment has since succeeded.
export function shouldOfferRetry(
  state: Pick<BuildTransaction, "buildStatus" | "pendingAssignment">,
): boolean {
  return state.buildStatus === "assignmentFailed" && state.pendingAssignment !== null;
}

// Whether builder controls (Close, Discard Draft, mode tabs, submit) must be
// inert because a persistence attempt is underway or half-committed.
//
// `assigning` is the separate Existing-Workout path's in-flight flag; it is
// passed in rather than read from BuildTransaction because that path never
// creates a template and so never populates pendingAssignment.
export function areProgrammingControlsDisabled(
  state: Pick<BuildTransaction, "buildStatus">,
  assigning: boolean,
): boolean {
  return assigning || state.buildStatus !== "idle";
}
