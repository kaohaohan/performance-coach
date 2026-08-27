import assert from "node:assert/strict";
import test from "node:test";
import {
  assignmentIdsForSession,
  assignmentTargets,
  clearDraft,
  continueDraftActionLabel,
  draftMatchesCalendar,
  extrasForPersistence,
  isDraftContentEmpty,
  loadDraft,
  parseSessionKind,
  resolveNewWorkoutClick,
  resolveStoredDraft,
  saveDraft,
  sanitizeExtraAthleteIds,
  startNewWorkoutActionLabel,
  toggleExtraAthlete,
  toggleSelectedAthlete,
  type DraftExercise,
  type WorkoutBuilderDraftContent,
} from "./workout-draft.ts";

const COACH = "coach-1";
const KEY = `performance-coach:workout-builder-draft:${COACH}`;
const CONNECTED = ["athlete-a", "athlete-b", "athlete-c"];

const EXERCISE: DraftExercise = {
  exercise: { id: "ex-squat", name: "Back Squat", scope: "SYSTEM" },
  setCount: "3",
  prescriptionMode: "REPS",
  defaultReps: "8",
  defaultPrescriptionNote: "",
  defaultLoad: "",
  unit: "kg",
  defaultRpe: "",
  overrides: [],
  customizationOpen: false,
  editingPositions: [],
};

function content(overrides: Partial<WorkoutBuilderDraftContent> = {}): WorkoutBuilderDraftContent {
  return {
    name: "Wednesday Lower",
    exercises: [EXERCISE],
    sourceAthleteId: "athlete-a",
    extraAthleteIds: [],
    sessionKind: "resume",
    scheduledDate: "2026-08-26",
    editTarget: null,
    ...overrides,
  };
}

function v1Draft(selectedAthleteIds: unknown, extras?: Record<string, unknown>) {
  return {
    version: 1,
    savedAt: "2026-08-25T09:00:00.000Z",
    name: "Wednesday Lower",
    exercises: [EXERCISE],
    selectedAthleteIds,
    scheduledDate: "2026-08-26",
    editTarget: null,
    ...extras,
  };
}

const memory = new Map<string, string>();
const localStorageMock = {
  getItem(key: string) {
    return memory.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    memory.set(key, value);
  },
  removeItem(key: string) {
    memory.delete(key);
  },
};

Object.defineProperty(globalThis, "window", {
  value: { localStorage: localStorageMock },
  configurable: true,
});

test("Case A: assignmentTargets always includes the source athlete first", () => {
  assert.deepEqual(assignmentTargets("athlete-a", []), ["athlete-a"]);
  assert.deepEqual(assignmentTargets("athlete-a", ["athlete-b"]), ["athlete-a", "athlete-b"]);
});

test("Case F: assignmentTargets is the exact payload list, source then extras, no dupes", () => {
  assert.deepEqual(
    assignmentTargets("athlete-a", ["athlete-a", "athlete-b", "athlete-b"]),
    ["athlete-a", "athlete-b"],
  );
  assert.deepEqual(assignmentTargets("", []), []);
  assert.deepEqual(assignmentTargets("", ["athlete-b"]), ["athlete-b"]);
});

test("Case C: toggling the source athlete cannot reach a zero-target list", () => {
  const extras = toggleExtraAthlete("athlete-a", [], "athlete-a");
  assert.deepEqual(extras, []);
  assert.deepEqual(assignmentTargets("athlete-a", extras), ["athlete-a"]);
});

test("Case D: extras remain editable while the source stays mandatory", () => {
  const added = toggleExtraAthlete("athlete-a", [], "athlete-b");
  assert.deepEqual(added, ["athlete-b"]);
  assert.deepEqual(assignmentTargets("athlete-a", added), ["athlete-a", "athlete-b"]);
  const removed = toggleExtraAthlete("athlete-a", added, "athlete-b");
  assert.deepEqual(removed, []);
  assert.deepEqual(assignmentTargets("athlete-a", removed), ["athlete-a"]);
});

test("isDraftContentEmpty ignores athlete selection so opening a builder is not a draft", () => {
  assert.equal(isDraftContentEmpty({ name: "", exercises: [] }), true);
  assert.equal(isDraftContentEmpty({ name: "  ", exercises: [] }), true);
  assert.equal(isDraftContentEmpty({ name: "", exercises: [EXERCISE] }), false);
  assert.equal(isDraftContentEmpty({ name: "Lower", exercises: [] }), false);
});

test("Case B: a v2 draft whose source is A is not reinterpreted as B", () => {
  const restored = resolveStoredDraft(
    {
      version: 2,
      savedAt: "2026-08-26T00:00:00.000Z",
      ...content({ sourceAthleteId: "athlete-a", extraAthleteIds: ["athlete-c"] }),
    },
    CONNECTED,
  );
  assert.equal(restored?.sourceAthleteId, "athlete-a");
  assert.deepEqual(restored?.extraAthleteIds, ["athlete-c"]);
  assert.deepEqual(assignmentTargets(restored!.sourceAthleteId, restored!.extraAthleteIds), ["athlete-a", "athlete-c"]);
  assert.notEqual(restored?.sourceAthleteId, "athlete-b");
});

test("v2 drops the draft when the source is disconnected", () => {
  assert.equal(
    resolveStoredDraft({ version: 2, savedAt: "2026-08-26T00:00:00.000Z", ...content({ sourceAthleteId: "athlete-gone" }) }, CONNECTED),
    null,
  );
});

test("v2 restores only still-connected extras, deduped, source excluded", () => {
  assert.deepEqual(
    sanitizeExtraAthleteIds("athlete-a", ["athlete-b", "athlete-b", "athlete-a", "athlete-gone", "athlete-c"], new Set(CONNECTED)),
    ["athlete-b", "athlete-c"],
  );
  const restored = resolveStoredDraft(
    {
      version: 2,
      savedAt: "2026-08-26T00:00:00.000Z",
      ...content({ extraAthleteIds: ["athlete-b", "athlete-b", "athlete-a", "athlete-gone", "athlete-c"] }),
    },
    CONNECTED,
  );
  assert.deepEqual(restored?.extraAthleteIds, ["athlete-b", "athlete-c"]);
});

test("v1 uses only selectedAthleteIds[0] as source and drops extras", () => {
  const restored = resolveStoredDraft(v1Draft(["athlete-a", "athlete-b", "athlete-c"]), CONNECTED);
  assert.equal(restored?.version, 2);
  assert.equal(restored?.sourceAthleteId, "athlete-a");
  assert.deepEqual(restored?.extraAthleteIds, []);
  assert.equal(restored?.name, "Wednesday Lower");
  assert.equal(restored?.exercises.length, 1);
});

test("v1 drops the draft when [0] is missing, invalid, or disconnected — never promotes a later extra", () => {
  assert.equal(resolveStoredDraft(v1Draft([]), CONNECTED), null);
  assert.equal(resolveStoredDraft(v1Draft(["", "athlete-b"]), CONNECTED), null);
  assert.equal(resolveStoredDraft(v1Draft(["athlete-gone", "athlete-b"]), CONNECTED), null);
  assert.equal(resolveStoredDraft(v1Draft([1, "athlete-b"]), CONNECTED), null);
  assert.equal(resolveStoredDraft({ version: 1, name: "x", exercises: [], scheduledDate: "2026-08-26" }, CONNECTED), null);
  const restoredIgnoringLaterJunk = resolveStoredDraft(v1Draft(["athlete-a", 2]), CONNECTED);
  assert.equal(restoredIgnoringLaterJunk?.sourceAthleteId, "athlete-a");
  assert.deepEqual(restoredIgnoringLaterJunk?.extraAthleteIds, []);
});

test("unknown versions and junk fail safe", () => {
  assert.equal(resolveStoredDraft({ version: 99, ...content() }, CONNECTED), null);
  assert.equal(resolveStoredDraft(null, CONNECTED), null);
  assert.equal(resolveStoredDraft("nope", CONNECTED), null);
});

test("Case E: saveDraft / loadDraft round-trips assignment context for the same coach", () => {
  memory.clear();
  const savedAt = saveDraft(COACH, content({ extraAthleteIds: ["athlete-b"] }));
  assert.ok(savedAt);
  const loaded = loadDraft(COACH, CONNECTED);
  assert.equal(loaded?.sourceAthleteId, "athlete-a");
  assert.deepEqual(loaded?.extraAthleteIds, ["athlete-b"]);
  assert.equal(loaded?.scheduledDate, "2026-08-26");
  assert.equal(loaded?.version, 2);
  assert.equal(loadDraft("coach-2", CONNECTED), null);
  clearDraft(COACH);
  assert.equal(loadDraft(COACH, CONNECTED), null);
});

test("Case E: loadDraft drops a stored v1 whose [0] is disconnected rather than rebinding", () => {
  memory.clear();
  memory.set(KEY, JSON.stringify(v1Draft(["athlete-gone", "athlete-b"])));
  assert.equal(loadDraft(COACH, CONNECTED), null);
});

test("draftMatchesCalendar is true only for the same athlete and date", () => {
  assert.equal(draftMatchesCalendar("athlete-a", "2026-08-27", "athlete-a", "2026-08-27"), true);
  assert.equal(draftMatchesCalendar("athlete-a", "2026-08-27", "athlete-b", "2026-08-27"), false);
  assert.equal(draftMatchesCalendar("athlete-a", "2026-08-27", "athlete-a", "2026-08-28"), false);
  assert.equal(draftMatchesCalendar("", "2026-08-27", "athlete-a", "2026-08-27"), false);
});

test("+ Add Workout never continues a stored draft, including same athlete and date", () => {
  assert.equal(resolveNewWorkoutClick(false), "start-new");
  assert.equal(resolveNewWorkoutClick(true), "confirm-replace");
  assert.notEqual(resolveNewWorkoutClick(true), "start-new");
  assert.equal(
    draftMatchesCalendar("athlete-cheryl", "2026-08-27", "athlete-cheryl", "2026-08-27"),
    true,
  );
  assert.equal(resolveNewWorkoutClick(true), "confirm-replace");
  assert.equal(
    draftMatchesCalendar("athlete-apple", "2026-08-27", "athlete-cheryl", "2026-08-27"),
    false,
  );
  assert.equal(resolveNewWorkoutClick(true), "confirm-replace");
});

test("Continue chip copy is explicit for both same-context and different-context drafts", () => {
  assert.equal(continueDraftActionLabel("Apple Test"), "Continue Apple Test");
  assert.equal(continueDraftActionLabel("Cheryl Chao"), "Continue Cheryl Chao");
  assert.equal(continueDraftActionLabel(""), "Continue draft");
  assert.equal(continueDraftActionLabel(undefined), "Continue draft");
  assert.equal(startNewWorkoutActionLabel("Cheryl Chao"), "Start new for Cheryl Chao");
  assert.equal(startNewWorkoutActionLabel("Apple Test"), "Start new for Apple Test");
});

test("New Workout: calendar athlete is the default and can be deselected", () => {
  const seeded = ["athlete-cheryl"];
  assert.deepEqual(assignmentIdsForSession("new", "athlete-cheryl", seeded), ["athlete-cheryl"]);
  const withoutCheryl = toggleSelectedAthlete(seeded, "athlete-cheryl");
  assert.deepEqual(withoutCheryl, []);
  const withColin = toggleSelectedAthlete(withoutCheryl, "athlete-colin");
  assert.deepEqual(assignmentIdsForSession("new", "athlete-cheryl", withColin), ["athlete-colin"]);
});

test("Start new uses current calendar athlete, not a stored different-context source", () => {
  assert.deepEqual(assignmentIdsForSession("new", "athlete-cheryl", ["athlete-cheryl"]), ["athlete-cheryl"]);
  assert.equal(assignmentIdsForSession("new", "athlete-cheryl", ["athlete-cheryl"]).includes("athlete-apple"), false);
});

test("Continue: source stays in the payload even if toggleExtraAthlete is asked to drop it", () => {
  const extras = toggleExtraAthlete("athlete-apple", [], "athlete-apple");
  assert.deepEqual(assignmentIdsForSession("resume", "athlete-apple", extras), ["athlete-apple"]);
});

test("Continue restores the stored draft's original source athlete first", () => {
  assert.deepEqual(
    assignmentIdsForSession("resume", "athlete-apple", ["athlete-colin"]),
    ["athlete-apple", "athlete-colin"],
  );
});

test("New Workout persist extras exclude the calendar source; selecting only another athlete still requires ≥1 at submit", () => {
  assert.deepEqual(extrasForPersistence("resume", "athlete-cheryl", ["athlete-cheryl", "athlete-colin"]), ["athlete-colin"]);
  assert.deepEqual(extrasForPersistence("new", "athlete-cheryl", ["athlete-cheryl", "athlete-colin"]), ["athlete-cheryl", "athlete-colin"]);
  assert.deepEqual(extrasForPersistence("new", "athlete-cheryl", ["athlete-colin"]), ["athlete-colin"]);
  assert.equal(assignmentIdsForSession("new", "athlete-cheryl", []).length, 0);
});

test("empty New for B does not require clearing A's stored draft", () => {
  memory.clear();
  assert.ok(saveDraft(COACH, content({ sourceAthleteId: "athlete-a", name: "A draft", exercises: [EXERCISE] })));
  const storedBefore = loadDraft(COACH, CONNECTED);
  assert.equal(storedBefore?.sourceAthleteId, "athlete-a");
  assert.equal(storedBefore?.name, "A draft");
  assert.equal(isDraftContentEmpty({ name: "", exercises: [] }), true);
  assert.equal(loadDraft(COACH, CONNECTED)?.sourceAthleteId, "athlete-a");
  assert.equal(loadDraft(COACH, CONNECTED)?.name, "A draft");
});

test("assigning an existing workout does not need to clear a stored Build draft", () => {
  memory.clear();
  assert.ok(saveDraft(COACH, content({ sourceAthleteId: "athlete-a", name: "Keep me" })));
  assert.equal(loadDraft(COACH, CONNECTED)?.name, "Keep me");
});

test("persistable Build content for B replaces A's single stored draft", () => {
  memory.clear();
  assert.ok(saveDraft(COACH, content({ sourceAthleteId: "athlete-a", name: "A draft" })));
  assert.ok(saveDraft(COACH, content({
    sourceAthleteId: "athlete-b",
    extraAthleteIds: ["athlete-b"],
    sessionKind: "new",
    name: "B draft",
    exercises: [EXERCISE],
    scheduledDate: "2026-08-30",
  })));
  const loaded = loadDraft(COACH, CONNECTED);
  assert.equal(loaded?.sourceAthleteId, "athlete-b");
  assert.equal(loaded?.name, "B draft");
  assert.equal(loaded?.sessionKind, "new");
  assert.notEqual(loaded?.sourceAthleteId, "athlete-a");
});

test("New draft that unchecked the calendar athlete restores without silently re-adding them", () => {
  const restored = resolveStoredDraft(
    {
      version: 2,
      savedAt: "2026-08-27T00:00:00.000Z",
      ...content({
        sourceAthleteId: "athlete-b",
        extraAthleteIds: ["athlete-c"],
        sessionKind: "new",
        name: "B without B",
      }),
    },
    CONNECTED,
  );
  assert.equal(restored?.sessionKind, "new");
  assert.deepEqual(restored?.extraAthleteIds, ["athlete-c"]);
  assert.deepEqual(assignmentIdsForSession("new", restored!.sourceAthleteId, restored!.extraAthleteIds), ["athlete-c"]);
  assert.equal(assignmentIdsForSession("new", restored!.sourceAthleteId, restored!.extraAthleteIds).includes("athlete-b"), false);
});

test("legacy drafts without sessionKind restore as resume and keep source locked", () => {
  const restored = resolveStoredDraft(
    {
      version: 2,
      savedAt: "2026-08-26T00:00:00.000Z",
      name: "Wednesday Lower",
      exercises: [EXERCISE],
      sourceAthleteId: "athlete-a",
      extraAthleteIds: ["athlete-c"],
      scheduledDate: "2026-08-26",
      editTarget: null,
    },
    CONNECTED,
  );
  assert.equal(parseSessionKind(undefined), "resume");
  assert.equal(restored?.sessionKind, "resume");
  assert.deepEqual(assignmentIdsForSession("resume", restored!.sourceAthleteId, restored!.extraAthleteIds), ["athlete-a", "athlete-c"]);
});

test("same athlete and date still treats + Add Workout as New, never silent Continue", () => {
  assert.equal(resolveNewWorkoutClick(true), "confirm-replace");
  assert.equal(draftMatchesCalendar("athlete-a", "2026-08-27", "athlete-a", "2026-08-27"), true);
});
