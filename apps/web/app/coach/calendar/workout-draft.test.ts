import assert from "node:assert/strict";
import test from "node:test";
import {
  assignmentTargets,
  clearDraft,
  isDraftContentEmpty,
  loadDraft,
  resolveStoredDraft,
  saveDraft,
  sanitizeExtraAthleteIds,
  toggleExtraAthlete,
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
