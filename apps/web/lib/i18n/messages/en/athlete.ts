// Athlete-facing training surfaces: /today and /session/[id].
//
// /session/[id] is the live training screen for *both* roles — a coach
// standing next to the athlete logs sets on it too — so its copy is written
// to read correctly for either person holding the phone.
//
// Domain vocabulary (set / rep / load / RPE) is fixed here and translated
// once. It must not be reassembled from fragments at the call site: Chinese
// word order differs, so a phrase that reads correctly in English produces
// nonsense when its pieces are concatenated in the same order. Every whole
// sentence is one key, and the value-plus-unit summaries (`{count} reps`)
// are keys in their own right rather than a translated word glued onto a
// number.
//
// Two exceptions are deliberately *not* keys and stay as literals in the
// page: "RPE" (an acronym used identically by Taiwan coaches) and the kg/lb
// unit symbols. Neither has a Chinese form, and routing them through the
// catalog would only invite someone to invent one.
export const athlete = {
  // --- /today ---------------------------------------------------------
  "athlete.today.account": "Account",
  "athlete.today.eyebrowToday": "Today",
  "athlete.today.eyebrowTraining": "Training",
  "athlete.today.previousDay": "Previous day",
  "athlete.today.nextDay": "Next day",
  "athlete.today.jumpToToday": "Today",
  "athlete.today.subtitle": "Your training, scheduled by your coach.",
  "athlete.today.loading": "Loading your scheduled training…",
  "athlete.today.emptyTodayTitle": "No Workout Today",
  "athlete.today.emptyTodayBody": "No training session has been scheduled for today.",
  "athlete.today.emptyDateTitle": "No Workout Scheduled",
  "athlete.today.emptyDateBody": "No training session has been scheduled for this date.",
  "athlete.today.workoutEyebrow": "Your workout",
  // Split rather than pluralised: translate() has no plural machinery by
  // design (locale.ts), and Chinese needs none — both keys carry the same
  // Chinese sentence, which is the correct outcome, not a duplication bug.
  "athlete.today.exerciseSummaryOne": "{count} exercise · placed on your day by your coach",
  "athlete.today.exerciseSummaryOther": "{count} exercises · placed on your day by your coach",
  "athlete.today.startWorkout": "Start Workout",
  "athlete.today.startingWorkout": "Starting workout…",
  "athlete.today.resumeWorkout": "Resume Workout",
  "athlete.today.viewResult": "View Result",

  // --- planned-set preview (/today) -----------------------------------
  "athlete.plan.none": "No planned sets",
  "athlete.plan.setCountOne": "{count} set",
  "athlete.plan.setCountOther": "{count} sets",
  "athlete.plan.plannedSetCount": "{count} planned sets",
  "athlete.coachCue": "Coach cue:",

  // --- shared set vocabulary (both pages) -----------------------------
  "athlete.set.label": "Set {position}",
  "athlete.set.labelOfTotal": "Set {position} of {total}",
  "athlete.set.reps": "{count} reps",
  "athlete.set.bodyweight": "Bodyweight",

  // Session status badge. Upper-case in English because that is how the
  // badge has always read; the Chinese form is ordinary words, since
  // capitalisation carries no meaning there.
  "athlete.status.active": "ACTIVE",
  "athlete.status.completed": "COMPLETED",

  // --- /session/[id] --------------------------------------------------
  "athlete.session.eyebrow": "Workout Session",
  "athlete.session.live": "Live training",
  "athlete.session.finished": "Training complete",
  "athlete.session.exerciseEyebrow": "Exercise",
  "athlete.session.plannedSetCountOne": "{count} planned set",
  "athlete.session.plannedSetCountOther": "{count} planned sets",
  "athlete.session.setCompleted": "Completed",
  "athlete.session.setNext": "Recording",
  "athlete.session.setNotLogged": "Not logged",
  "athlete.session.target": "Target",
  "athlete.session.actual": "Actual",
  "athlete.session.loggedNumber": "Logged #{number}",
  "athlete.session.extraLoggedNumber": "Extra · Logged #{number}",
  "athlete.session.logThisSetInstead": "Record",
  "athlete.session.expandExercise": "Expand",
  "athlete.session.collapseExercise": "Collapse",
  "athlete.session.logSet": "Log Set",
  "athlete.session.loggingSet": "Logging set…",
  "athlete.session.extraSetsHeading": "Extra sets",
  "athlete.session.addExtraSet": "Add Extra Set",
  "athlete.session.logExtraSet": "Log Extra Set",
  "athlete.session.completeHint": "When training is finished, complete the workout to lock in these results.",
  "athlete.session.completeWorkout": "Complete Workout",
  "athlete.session.completingWorkout": "Completing workout…",
  "athlete.session.adjustHeading": "Adjust live workout",
  "athlete.session.adjustHint": "Add an exercise without overwriting the existing plan.",
  "athlete.session.addExercise": "Add exercise",
  "athlete.session.addOwnExercise": "+ Add your own exercise",
  "athlete.session.adjustExercise": "Exercise",
  "athlete.session.replaceOptional": "Replace an exercise (optional)",
  "athlete.session.addWithoutReplacing": "Add without replacing",
  "athlete.session.adjustSets": "Sets",
  "athlete.session.adjustReps": "Reps per set",
  "athlete.session.adjustLoad": "Load (optional, kg)",
  "athlete.session.adjustRpe": "RPE (optional)",
  "athlete.session.replaceAndAdd": "Replace and add",
  "athlete.session.addToWorkout": "Add to this workout",
  "athlete.session.athleteAdded": "Athlete added",
  "athlete.session.coachAdded": "Coach added",
  "athlete.session.progressSummary": "{completed} of {total} sets complete",
  "athlete.session.nextExercise": "Next exercise",
  "athlete.session.adjustSetsRepsInvalid": "Enter valid sets and reps.",
  "athlete.session.adjustNumbersInvalid": "Check the load and RPE values.",

  // Set-log form. These labels sit above numeric inputs, so they name the
  // quantity and nothing else.
  "athlete.session.fieldLoad": "Load",
  "athlete.session.fieldUnit": "Unit",
  "athlete.session.fieldReps": "Reps",
  "athlete.session.fieldActualRpe": "Actual RPE",
  "athlete.session.fieldOptional": "optional",
  "athlete.session.textPrescriptionHint": "Record the numeric reps completed.",

  // Client-side validation, shown under the field that failed. Each states
  // the rule the value broke rather than "invalid input".
  "athlete.session.repsInvalid": "Reps must be a whole number ≥ 1.",
  "athlete.session.loadInvalid": "Load must be a number ≥ 0.",
  "athlete.session.rpeInvalid": "Actual RPE must be between 1 and 10.",
  "athlete.session.editSet": "Edit set",
  "athlete.session.cancelEdit": "Cancel",
  "athlete.session.saveEdit": "Save",
  "athlete.session.savingEdit": "Saving…",
} as const;

export type AthleteMessages = Record<keyof typeof athlete, string>;
