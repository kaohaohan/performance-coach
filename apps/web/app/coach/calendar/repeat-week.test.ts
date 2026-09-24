import assert from "node:assert/strict";
import test from "node:test";
import { addDays, buildRepeatWeekPreview, collectWeekAssignments, repeatWeekBounds } from "./repeat-week.ts";
import type { ScheduledWorkoutSummary, Workout } from "./types.ts";

const ATHLETE = { id: "athlete-1", name: "Alex" };

function assignment(id: string, date: string, workoutId: string, name: string): ScheduledWorkoutSummary {
  return {
    id,
    scheduledDate: date,
    athlete: ATHLETE,
    workout: { id: workoutId, name },
    session: null,
  };
}

const squatWorkout: Workout = {
  id: "workout-1",
  name: "Lower",
  exercises: [{
    workoutExerciseId: "we-1",
    exerciseId: "ex-1",
    name: "Back Squat",
    loadIncrement: 2.5,
    setIncrement: 1,
    plan: {
      setCount: 3,
      defaults: { reps: 8, load: 80, unit: "kg" },
      overrides: [],
    },
    position: 1,
  }],
};

test("addDays shifts by seven for repeat target week", () => {
  assert.equal(addDays("2026-09-21", 7), "2026-09-28");
});

test("repeatWeekBounds uses Sunday-first weekDays", () => {
  const bounds = repeatWeekBounds("2026-09-24");
  assert.deepEqual(bounds.days, [
    "2026-09-20",
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
  ]);
});

test("collectWeekAssignments filters athlete and week days", () => {
  const bounds = repeatWeekBounds("2026-09-24");
  const assignments = [
    assignment("a1", "2026-09-22", "workout-1", "Lower"),
    assignment("a2", "2026-09-29", "workout-1", "Lower"),
    assignment("a3", "2026-09-23", "workout-2", "Upper"),
  ];
  const got = collectWeekAssignments(assignments, ATHLETE.id, bounds.days);
  assert.deepEqual(got.map((item) => item.id), ["a1", "a3"]);
});

test("buildRepeatWeekPreview bumps sets and load with conflict flag", () => {
  const bounds = repeatWeekBounds("2026-09-24");
  const source = [assignment("a1", "2026-09-22", "workout-1", "Lower")];
  const workoutsById = new Map([["workout-1", squatWorkout]]);
  const targetAssignments = new Map([
    ["2026-09-29", [assignment("existing", "2026-09-29", "workout-9", "Other")]],
  ]);
  const preview = buildRepeatWeekPreview(source, workoutsById, targetAssignments, { "ex-1": 100 });
  assert.equal(preview.length, 1);
  assert.equal(preview[0].targetDate, "2026-09-29");
  assert.equal(preview[0].hasConflict, true);
  assert.equal(preview[0].exercises[0].sourceSets, 3);
  assert.equal(preview[0].exercises[0].suggestedSets, 4);
  assert.equal(preview[0].exercises[0].suggestedLoad, "102.5 kg");
});

test("buildRepeatWeekPreview keeps template load without history", () => {
  const source = [assignment("a1", "2026-09-22", "workout-1", "Lower")];
  const workoutsById = new Map([["workout-1", squatWorkout]]);
  const preview = buildRepeatWeekPreview(source, workoutsById, new Map(), { "ex-1": null });
  assert.equal(preview[0].exercises[0].suggestedLoad, "82.5 kg");
});

test("setIncrement zero does not bump sets in preview", () => {
  const workout: Workout = {
    ...squatWorkout,
    exercises: [{ ...squatWorkout.exercises[0], setIncrement: 0 }],
  };
  const source = [assignment("a1", "2026-09-22", "workout-1", "Lower")];
  const preview = buildRepeatWeekPreview(source, new Map([["workout-1", workout]]), new Map(), {});
  assert.equal(preview[0].exercises[0].suggestedSets, 3);
});
