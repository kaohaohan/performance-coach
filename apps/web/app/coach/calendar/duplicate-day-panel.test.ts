import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DuplicateDayPanel, { canDuplicateSelectedWorkouts } from "./duplicate-day-panel";
import type { Workout } from "./types";

const sourceAssignments = [
  { id: "assignment-squat", scheduledDate: "2026-08-24", athlete: { id: "client", name: "Kevin" }, workout: { id: "squat", name: "Aug 23 Workout" }, session: null },
  { id: "assignment-bench", scheduledDate: "2026-08-24", athlete: { id: "client", name: "Kevin" }, workout: { id: "bench", name: "Aug 23 Workout" }, session: null },
];

function workout(id: string, exerciseName: string): Workout {
  return {
    id,
    name: "Aug 23 Workout",
    exercises: [{
      workoutExerciseId: `${id}-exercise`,
      exerciseId: `${id}-exercise`,
      name: exerciseName,
      position: 1,
      plan: { setCount: 1, defaults: {}, overrides: [] },
    }],
  };
}

test("defaults all source workouts and the focused client, distinguishes identical names, and keeps the +7 target", () => {
  const markup = renderToStaticMarkup(React.createElement(DuplicateDayPanel, {
    athletes: [{ id: "client", name: "Kevin" }],
    sourceDate: "2026-08-24",
    sourceAssignments,
    workoutsById: new Map([
      ["squat", workout("squat", "Back Squat")],
      ["bench", workout("bench", "Bench Press")],
    ]),
    sourceError: null,
    submitting: false,
    submitError: null,
    initialAthleteId: "client",
    onClose: () => {},
    onDuplicate: async () => undefined,
  }));

  assert.match(markup, /value="2026-08-31"/);
  assert.equal((markup.match(/checked=""/g) ?? []).length, 3);
  assert.equal((markup.match(/Aug 23 Workout/g) ?? []).length, 2);
  assert.match(markup, /Back Squat · 1 exercise/);
  assert.match(markup, /Bench Press · 1 exercise/);
  assert.match(markup, /2 workouts will be duplicated to 1 client/);
  assert.match(markup, />Duplicate</);
  assert.match(markup, />Cancel</);
  assert.doesNotMatch(markup, /NEXT|BACK|PASTE|Step/);
});

test("requires selected source workouts and clients before Duplicate is enabled", () => {
  assert.equal(canDuplicateSelectedWorkouts({
    sourceAssignments,
    selectedWorkoutIds: [],
    selectedAthleteIds: ["client"],
    targetDate: "2026-08-31",
  }), false);
  assert.equal(canDuplicateSelectedWorkouts({
    sourceAssignments,
    selectedWorkoutIds: ["squat"],
    selectedAthleteIds: [],
    targetDate: "2026-08-31",
  }), false);
  assert.equal(canDuplicateSelectedWorkouts({
    sourceAssignments,
    selectedWorkoutIds: ["squat"],
    selectedAthleteIds: ["client"],
    targetDate: "2026-08-31",
  }), true);
});
