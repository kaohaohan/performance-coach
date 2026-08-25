// Unit coverage for the draft's assignment-context contract: who a draft
// targets, how that survives serialization, and what happens to drafts
// written by the previous (v1) format.
import { beforeEach, describe, expect, it } from "vitest";
import {
  assignmentTargets,
  clearDraft,
  isDraftContentEmpty,
  loadDraft,
  saveDraft,
  toggleExtraAthlete,
  type WorkoutBuilderDraftContent,
} from "./workout-draft";

const COACH = "coach-1";
const KEY = `performance-coach:workout-builder-draft:${COACH}`;

const EXERCISE = {
  exercise: { id: "ex-squat", name: "Back Squat", scope: "SYSTEM" as const },
  setCount: "3",
  prescriptionMode: "REPS" as const,
  defaultReps: "8",
  defaultPrescriptionNote: "",
  defaultLoad: "",
  unit: "kg" as const,
  defaultRpe: "",
  overrides: [],
  customizationOpen: false,
  editingPositions: [],
};

function content(overrides: Partial<WorkoutBuilderDraftContent> = {}): WorkoutBuilderDraftContent {
  return {
    name: "Wednesday Lower",
    exercises: [EXERCISE],
    sourceAthleteId: "athlete-hao",
    extraAthleteIds: [],
    scheduledDate: "2026-08-26",
    editTarget: null,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("assignmentTargets", () => {
  it("always includes the source athlete first", () => {
    expect(assignmentTargets("athlete-hao", [])).toEqual(["athlete-hao"]);
    expect(assignmentTargets("athlete-hao", ["athlete-colin"])).toEqual(["athlete-hao", "athlete-colin"]);
  });

  it("never lists an athlete twice", () => {
    expect(assignmentTargets("athlete-hao", ["athlete-hao", "athlete-colin", "athlete-colin"]))
      .toEqual(["athlete-hao", "athlete-colin"]);
  });

  it("is empty only when there is no source athlete and no extras", () => {
    expect(assignmentTargets("", [])).toEqual([]);
    expect(assignmentTargets("", ["athlete-colin"])).toEqual(["athlete-colin"]);
  });
});

describe("toggleExtraAthlete", () => {
  it("adds and removes an extra athlete", () => {
    const added = toggleExtraAthlete("athlete-hao", [], "athlete-colin");
    expect(added).toEqual(["athlete-colin"]);
    expect(toggleExtraAthlete("athlete-hao", added, "athlete-colin")).toEqual([]);
  });

  it("cannot remove the source athlete from the assignment", () => {
    expect(toggleExtraAthlete("athlete-hao", [], "athlete-hao")).toEqual([]);
    expect(assignmentTargets("athlete-hao", toggleExtraAthlete("athlete-hao", [], "athlete-hao")))
      .toEqual(["athlete-hao"]);
  });
});

describe("isDraftContentEmpty", () => {
  it("ignores athlete selection — opening a builder is not a draft", () => {
    expect(isDraftContentEmpty({ name: "", exercises: [] })).toBe(true);
    expect(isDraftContentEmpty({ name: "  ", exercises: [] })).toBe(true);
    expect(isDraftContentEmpty({ name: "", exercises: [EXERCISE] })).toBe(false);
    expect(isDraftContentEmpty({ name: "Lower", exercises: [] })).toBe(false);
  });
});

describe("saveDraft / loadDraft", () => {
  it("round-trips the assignment context", () => {
    saveDraft(COACH, content({ extraAthleteIds: ["athlete-colin"] }));
    const loaded = loadDraft(COACH);
    expect(loaded?.sourceAthleteId).toBe("athlete-hao");
    expect(loaded?.extraAthleteIds).toEqual(["athlete-colin"]);
    expect(loaded?.scheduledDate).toBe("2026-08-26");
    expect(loaded?.version).toBe(2);
  });

  it("scopes the draft to one coach", () => {
    saveDraft(COACH, content());
    expect(loadDraft("coach-2")).toBeNull();
  });

  it("clears the draft", () => {
    saveDraft(COACH, content());
    clearDraft(COACH);
    expect(loadDraft(COACH)).toBeNull();
  });

  it("migrates a v1 draft, keeping the prescription and dropping the stale athlete list", () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      version: 1,
      savedAt: "2026-08-25T09:00:00.000Z",
      name: "Wednesday Lower",
      exercises: [EXERCISE],
      selectedAthleteIds: ["athlete-cheryl"],
      scheduledDate: "2026-08-26",
      editTarget: null,
    }));

    const loaded = loadDraft(COACH);
    expect(loaded?.version).toBe(2);
    expect(loaded?.name).toBe("Wednesday Lower");
    expect(loaded?.exercises).toHaveLength(1);
    expect(loaded?.scheduledDate).toBe("2026-08-26");
    // No source athlete is claimed: page.tsx falls back to the calendar the
    // draft reopens on rather than resurrecting a prior session's checkbox.
    expect(loaded?.sourceAthleteId).toBe("");
    expect(loaded?.extraAthleteIds).toEqual([]);
  });

  it("returns null for junk rather than throwing", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(loadDraft(COACH)).toBeNull();
    window.localStorage.setItem(KEY, JSON.stringify({ version: 99 }));
    expect(loadDraft(COACH)).toBeNull();
  });
});
