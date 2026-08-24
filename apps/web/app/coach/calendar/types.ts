// Shared response/DTO shapes for the Coach Calendar's Week/Month grid and
// Duplicate panel.
//
// Workout mirrors GET /api/v1/workouts, which returns each template's full
// prescription (internal/workout/workout.go ListForCoach). page.tsx imports
// Workout/WorkoutExercise from here (rather than declaring its own shallow
// {id,name} Workout type) specifically so the grid cards can read
// `exercises` without a second request.
//
// NOTE: those numbers come from the live WORKOUT TEMPLATE, not the
// prescription snapshot frozen when a ScheduledWorkout was created. The two
// cannot diverge today — there is no route that updates a Workout template
// (only POST/GET /workouts) — but if template editing is ever added, these
// cards must switch to snapshot data expanded by
// GET /api/v1/scheduled-workouts instead. This is unrelated to
// PUT /api/v1/scheduled-workouts/{id}, which already exists and edits one
// assignment's own frozen snapshot in place, not the reusable template. See
// docs/tasks/2026-08-22-calendar-day-week-month.md §1.
//
// Athlete/Session/ScheduledWorkoutSummary duplicate page.tsx's own local
// declarations of the same shapes rather than being imported by it: page.tsx
// predates this file and already has working, unexported locals for these.
// Structural typing keeps values freely assignable across the two
// declarations, so this is deliberate low-risk duplication, not drift.

export type Athlete = { id: string; name: string };

export type WorkoutSetOverride = {
  position: number;
  reps?: number;
  prescriptionNote?: string;
  load?: number;
  rpe?: number;
};

export type WorkoutPlan = {
  setCount: number;
  defaults: {
    reps?: number;
    prescriptionNote?: string;
    load?: number;
    unit?: string;
    rpe?: number;
  };
  overrides: WorkoutSetOverride[];
};

export type WorkoutExercise = {
  workoutExerciseId: string;
  exerciseId: string;
  name: string;
  plan: WorkoutPlan;
  position: number;
};

export type Workout = {
  id: string;
  name: string;
  exercises: WorkoutExercise[];
};

export type Session = { id: string; status: "ACTIVE" | "COMPLETED" };

export type ScheduledWorkoutSummary = {
  id: string;
  scheduledDate: string;
  athlete: Athlete;
  workout: { id: string; name: string };
  session: Session | null;
};
