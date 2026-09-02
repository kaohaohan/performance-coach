// Coach Calendar (app/coach/calendar/*) — the densest string concentration in
// the app, which is why it is its own sub-task in
// docs/tasks/2026-08-27-i18n-zh-tw.md §3.
//
// Two conventions this file follows, both because Chinese word order differs
// from English:
//
//  1. One key per whole sentence. Nothing here is designed to be concatenated
//     with another translated fragment at the call site; where English glues a
//     count and a noun together ("2 workouts scheduled"), the key carries the
//     whole clause and interpolates the number.
//  2. English plurals are two keys (…One / …Other) rather than a "{n} item{s}"
//     template. Chinese has no plural form, so both zh-TW values are the same
//     sentence — that redundancy is the price of never assembling an English
//     plural out of pieces.
//
// A handful of keys are rendered with their {placeholders} emphasised rather
// than interpolated flat (the draft banners and confirmation dialogs). Those
// call t() *without* vars and split the returned message on the placeholder —
// see RichMessage in page.tsx — so the sentence stays one translatable unit
// while the athlete name and date keep their <span className="font-bold">.
export const calendar = {
  // ── Page chrome ──────────────────────────────────────────────────────────
  "calendar.title": "Calendar",
  "calendar.nav.label": "Coach tools",
  "calendar.nav.menuLabel": "Coach tools menu",
  "calendar.nav.workouts": "Workouts",
  "calendar.nav.exercises": "Exercises",
  "calendar.nav.clients": "Clients",
  "calendar.nav.account": "Account",

  "calendar.athletes.loading": "Loading athletes…",
  "calendar.athletes.none": "No connected athletes",
  "calendar.athleteCalendar": "Athlete calendar",
  "calendar.anotherAthlete": "another athlete",
  "calendar.thisAthlete": "this athlete",

  // ── View toolbar ─────────────────────────────────────────────────────────
  // Six explicit keys rather than "Previous {view}": the view noun has to sit
  // in a different place in Chinese, and a shared template would force it.
  "calendar.toolbar.previousDay": "Previous day",
  "calendar.toolbar.previousWeek": "Previous week",
  "calendar.toolbar.previousMonth": "Previous month",
  "calendar.toolbar.nextDay": "Next day",
  "calendar.toolbar.nextWeek": "Next week",
  "calendar.toolbar.nextMonth": "Next month",
  "calendar.toolbar.today": "Today",
  "calendar.toolbar.viewLabel": "Calendar view",
  "calendar.view.day": "Day",
  "calendar.view.week": "Week",
  "calendar.view.month": "Month",

  // ── Day view: mini month picker ──────────────────────────────────────────
  "calendar.previousMonth": "Previous month",
  "calendar.nextMonth": "Next month",
  // The three states a day cell can announce. Kept whole rather than appending
  // ", scheduled training" to a formatted date, which is exactly the kind of
  // fragment assembly that reads as broken Chinese.
  "calendar.day.ariaScheduled": "{date}, scheduled training",
  "calendar.day.ariaDraft": "{date}, draft in progress",
  "calendar.day.ariaScheduledAndDraft": "{date}, scheduled training, draft in progress",

  // ── Day view: selected day ───────────────────────────────────────────────
  "calendar.scheduledCountOne": "1 workout scheduled",
  "calendar.scheduledCountOther": "{count} workouts scheduled",
  "calendar.addWorkout": "Add Workout",
  "calendar.addWorkoutAction": "+ Add Workout",
  "calendar.editWorkout": "Edit Workout",
  "calendar.loadingScheduled": "Loading scheduled training…",
  "calendar.empty.title": "No workouts scheduled",
  "calendar.empty.body": "Add a workout to this athlete’s selected day.",
  "calendar.saveChangesSuccess": "Changes saved. The athlete will see the updated prescription immediately.",

  // Assignment card. The status badge deliberately keeps the API's own
  // vocabulary in English (ACTIVE / COMPLETED / NOT STARTED) — day-card.tsx
  // shows the same three states in sentence case, and unifying them is a copy
  // decision, not a translation one.
  "calendar.status.active": "ACTIVE",
  "calendar.status.completed": "COMPLETED",
  "calendar.status.notStarted": "NOT STARTED",
  "calendar.opening": "Opening…",
  "calendar.removing": "Removing…",
  "calendar.starting": "Starting…",
  "calendar.startSession": "Start Session",
  "calendar.resume": "Resume",
  "calendar.review": "Review",

  // ── Draft chip / banners ─────────────────────────────────────────────────
  "calendar.draft.inProgress": "Draft in progress · {date}",
  "calendar.draft.inProgressWithAthlete": "Draft in progress · {name} · {date}",
  "calendar.draft.continue": "Continue draft",
  "calendar.draft.continueFor": "Continue {name}",
  "calendar.draft.startNew": "Start new",
  "calendar.draft.startNewFor": "Start new for {name}",
  "calendar.draft.restored": "Draft restored from your last session.",
  "calendar.draft.restoredRecheck":
    "Draft restored from your last session. Please re-check who this should be assigned to.",
  "calendar.draft.save": "Save Draft",
  "calendar.draft.saved": "Saved ✓",
  "calendar.draft.savedJustNow": "Draft saved just now",
  "calendar.draft.savedAt": "Draft saved {time}",
  "calendar.draft.saveFailed": "Couldn’t save this draft in your browser.",
  "calendar.draft.discard": "Discard Draft",
  "calendar.draft.discardConfirm":
    "Discard this draft? Everything unsaved in the builder will be permanently deleted.",

  // ── Builder ──────────────────────────────────────────────────────────────
  "calendar.builder.draftFor": "This draft is for {name} on {date}.",
  "calendar.builder.moveToDate": "Move to {date}",
  "calendar.builder.editingNotice":
    "Editing {name}’s assigned workout. This replaces only this one assignment — the reusable Workout template and any other athlete’s copy of it are unaffected.",
  "calendar.mode.existing": "From saved",
  "calendar.mode.build": "New workout",
  "calendar.assignTo": "Assign to",
  "calendar.workout": "Workout",
  "calendar.loadingWorkouts": "Loading workouts…",
  "calendar.noSavedWorkouts.title": "No saved workouts yet",
  "calendar.noSavedWorkouts.body": "Choose Add Workout above to create and assign one here.",
  "calendar.chooseWorkout": "Choose a workout…",
  "calendar.assign.assigning": "Assigning workout…",
  // {count} is the raw expression the English button already rendered, so an
  // empty selection keeps producing the same (disabled) label it does today.
  "calendar.assign.buttonOne": "Assign to {count} athlete",
  "calendar.assign.buttonOther": "Assign to {count} athletes",
  "calendar.workoutNameLabel": "Add Workout Name",
  "calendar.workoutNamePlaceholder": "Add Workout Name",
  "calendar.optional": "optional",
  "calendar.exercises": "Exercises",
  "calendar.exercisesAdded": "{count} added",
  "calendar.addExercise": "+ Add Exercise",
  "calendar.build.createdNotAssigned": "Workout was created, but it was not assigned.",
  "calendar.build.retryAssignment": "Retry Assignment",
  "calendar.build.creating": "Creating workout…",
  "calendar.build.assign": "Assign",
  "calendar.build.saveChanges": "Save Changes",
  "calendar.build.savingChanges": "Saving changes…",

  // ── Exercise card ────────────────────────────────────────────────────────
  "calendar.exercise.number": "Exercise {number}",
  "calendar.exercise.mine": "Mine",
  "calendar.field.sets": "Sets",
  // "RPE" itself is not a key: Taiwan coaches say "RPE", so a zh-TW value
  // would be identical to the English and the label stays a literal in the
  // JSX, exactly like the kg / lb unit options.
  "calendar.field.prescription": "Prescription",
  "calendar.field.instruction": "Instruction",
  "calendar.field.instructionPlaceholder": "AMAP, 30 sec, 10–12",
  "calendar.field.reps": "Reps",
  "calendar.field.repsHintLabel": "About reps",
  "calendar.field.repsHint":
    "Reps takes one whole number, used for every set. For 8-12, 8+, AMAP, or timed sets, switch Prescription to Text — or edit an individual set under Planned sets to vary reps set by set.",
  "calendar.field.load": "Load",
  "calendar.field.unit": "Unit",
  "calendar.prescription.reps": "Reps",
  "calendar.prescription.text": "Text",
  "calendar.plannedSets": "Planned sets",
  "calendar.setNumber": "Set {position}",
  "calendar.setSummaryReps": "{reps} reps",
  "calendar.useDefault": "Use default",
  "calendar.useDefaultLoad": "Use default load",
  "calendar.useDefaultRpe": "Use default RPE",
  "calendar.moveUp": "Move Up",
  "calendar.moveDown": "Move Down",

  // ── Exercise picker ──────────────────────────────────────────────────────
  "calendar.picker.title": "Add Exercise",
  "calendar.picker.searchLabel": "Search exercises",
  "calendar.picker.searchPlaceholder": "Search exercises…",
  "calendar.picker.startTyping": "Start typing to find an exercise.",
  "calendar.picker.loading": "Loading exercises…",
  "calendar.picker.noneFound": "No exercises found.",
  "calendar.picker.noneFoundBody": "Create the movement, or manage your exercise library.",
  "calendar.picker.openLibrary": "Open Exercise Library",
  "calendar.picker.allAdded": "All matching exercises are already added.",
  "calendar.picker.create": "Create “{name}”",
  "calendar.picker.creating": "Creating…",
  "calendar.picker.systemGroup": "System exercises",
  "calendar.picker.myGroup": "My exercises",
  "calendar.picker.added": "Added",
  "calendar.picker.moreResultsOne": "1 more result. Keep typing to narrow the list.",
  "calendar.picker.moreResultsOther": "{count} more results. Keep typing to narrow the list.",
  "calendar.picker.updating": "Updating exercises…",
  "calendar.picker.existsUnavailable": "“{name}” already exists, but it is not available to add.",
  // {reason} is whatever the API said, or the shared errors.unexpected copy.
  "calendar.picker.createFailed": "Couldn’t create “{name}”. {reason}",

  // ── Validation ───────────────────────────────────────────────────────────
  // Every reps message names the Text escape hatch, because reps is an integer
  // column end-to-end (docs/go-backend-api-contract-v0.1.md) and ranges/AMAP/
  // timed sets are expressed through the TEXT prescription mode instead.
  "calendar.validation.setsRequired": "Sets is required. Enter a whole number of at least 1.",
  "calendar.validation.setsWhole": "Enter a whole number of at least 1.",
  "calendar.validation.repsRequired":
    "Reps is required — one whole number, like 8. Switch this exercise's prescription to Text for 8-12, 8+, AMAP, or timed sets.",
  "calendar.validation.repsFormat":
    "“{value}” isn't a whole number. Reps takes a single number like 8. Switch this exercise's prescription to Text for 8-12, 8+, AMAP, or timed sets.",
  "calendar.validation.repsMin": "Reps must be at least 1.",
  "calendar.validation.instructionRequired": "Instruction is required.",
  "calendar.validation.loadMin": "Load must be 0 or greater.",
  "calendar.validation.rpeRange": "RPE must be between 1 and 10.",
  "calendar.validation.setOutsideCount": "Set {position} is outside the current set count.",
  "calendar.validation.setBothRepsAndText": "This set has both reps and text — pick one.",
  "calendar.validation.removeOverridesFirst":
    "Remove overrides above the new set count before reducing sets.",
  "calendar.validation.addExercise": "Add at least one exercise.",
  "calendar.validation.chooseValidDate": "Choose a valid date.",
  "calendar.validation.selectAthlete": "Select at least one athlete.",

  // ── Assignment result / errors ───────────────────────────────────────────
  "calendar.assignedSummaryOne": "“{name}” assigned to 1 client on {date}.",
  "calendar.assignedSummaryOther": "“{name}” assigned to {count} clients on {date}.",
  "calendar.errors.alreadyStartedRemove":
    "This workout has already been started and can no longer be removed.",
  "calendar.errors.alreadyStartedEdit":
    "This workout has already been started and can no longer be edited.",

  // ── Day card (week / month grids) ────────────────────────────────────────
  "calendar.dayCard.setCountOne": "1 set",
  "calendar.dayCard.setCountOther": "{count} sets",
  "calendar.dayCard.statusDone": "Done",
  "calendar.dayCard.statusInProgress": "In progress",
  "calendar.dayCard.statusNotStarted": "Not started",
  "calendar.dayCard.duplicateFrom": "Duplicate workouts from {date}",
  "calendar.dayCard.duplicateTitle": "Duplicate workouts",
  "calendar.dayCard.noTraining": "No training",
  "calendar.dayCard.prescriptionUnavailable": "Prescription unavailable",

  // ── Duplicate day panel ──────────────────────────────────────────────────
  "calendar.duplicate.title": "Duplicate workouts",
  "calendar.duplicate.from": "From {date}",
  "calendar.duplicate.sourceWorkouts": "Source workouts",
  "calendar.duplicate.loadingWorkouts": "Loading workouts…",
  "calendar.duplicate.noWorkouts": "No workouts scheduled on this date.",
  "calendar.duplicate.exerciseCountOne": "1 exercise",
  "calendar.duplicate.exerciseCountOther": "{count} exercises",
  "calendar.duplicate.moreExercises": "{names} · +{count} more",
  "calendar.duplicate.exerciseDetailsUnavailable": "Exercise details unavailable",
  "calendar.duplicate.clients": "Clients",
  "calendar.duplicate.searchClients": "Search clients",
  "calendar.duplicate.selectedOne": "Selected ({count} client)",
  "calendar.duplicate.selectedOther": "Selected ({count} clients)",
  "calendar.duplicate.selectClient": "Select at least one client.",
  "calendar.duplicate.noClientsMatch": "No clients match that search.",
  "calendar.duplicate.targetDate": "Target date",
  // Four keys, one per English plural combination. Chinese needs one sentence;
  // English cannot get there without pluralising both nouns independently.
  "calendar.duplicate.summaryOneOne": "1 workout will be duplicated to 1 client on {date}.",
  "calendar.duplicate.summaryOneOther":
    "1 workout will be duplicated to {clients} clients on {date}.",
  "calendar.duplicate.summaryOtherOne":
    "{workouts} workouts will be duplicated to 1 client on {date}.",
  "calendar.duplicate.summaryOtherOther":
    "{workouts} workouts will be duplicated to {clients} clients on {date}.",
  "calendar.duplicate.submit": "Duplicate",
  "calendar.duplicate.submitting": "Duplicating…",
  "calendar.duplicate.showCalendar": "Show calendar",
  "calendar.duplicate.hideCalendar": "Hide calendar",
  "calendar.duplicate.unnamedWorkout": "a workout",
  // {error} is the API's own last message, so it stays where English put it.
  "calendar.duplicate.partialFailure":
    "{failed} of {total} could not be duplicated ({names}). {error} Press Duplicate to retry just those.",

  // ── Dialogs ──────────────────────────────────────────────────────────────
  "calendar.dialog.alreadyScheduledTitle": "Already scheduled",
  "calendar.dialog.alreadyScheduledBody":
    "Scheduling it again creates a second, separate copy on that day — which is what you want for a two-a-day, and probably is not what you want otherwise.",
  "calendar.dialog.scheduleAnyway": "Schedule it anyway",
  "calendar.dialog.removeTitle": "Remove this workout?",
  "calendar.dialog.removeBody":
    "This removes {workout} from {athlete}’s {date}. Nothing else on that day changes, and the workout itself stays in your library to assign again.",
  "calendar.dialog.removeConfirm": "Remove workout",
  "calendar.dialog.removeCancel": "Keep it",
  "calendar.dialog.unfinishedDraftTitle": "Unfinished draft",
  "calendar.dialog.unfinishedDraftBody":
    "You have an unfinished draft for {draft}. Starting a new workout for {target} keeps that draft until you add a name or exercise to the new workout.",
  "calendar.dialog.closeBuilderTitle": "Close the builder?",
  "calendar.dialog.navBodyDate":
    "Your draft is saved and stays scheduled for {date} — nothing is lost. Going to {target} just closes the builder; reopen it with {label} whenever you’re ready.",
  "calendar.dialog.navBodyAthlete":
    "Your draft is saved and stays scheduled for {date} — nothing is lost. Switching to {target} just closes the builder; reopen it with {label} to keep going.",
  "calendar.dialog.navBodyViewDay":
    "Your draft is saved and stays scheduled for {date} — nothing is lost. Switching to day view just closes the builder; reopen it with {label} to keep going.",
  "calendar.dialog.navBodyViewWeek":
    "Your draft is saved and stays scheduled for {date} — nothing is lost. Switching to week view just closes the builder; reopen it with {label} to keep going.",
  "calendar.dialog.navBodyViewMonth":
    "Your draft is saved and stays scheduled for {date} — nothing is lost. Switching to month view just closes the builder; reopen it with {label} to keep going.",
  "calendar.dialog.navConfirmDate": "Go to that day",
  "calendar.dialog.navConfirmAthlete": "Switch athlete",
  "calendar.dialog.navConfirmView": "Switch view",
  "calendar.dialog.navCancel": "Keep editing",
} as const;

export type CalendarMessages = Record<keyof typeof calendar, string>;
