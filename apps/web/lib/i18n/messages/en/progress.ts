// Exercise Progress (docs/tasks/2026-10-04-training-history.md, sub-task 4):
// the chart, selected-point card and history timeline, plus the Overview
// on /coach/clients/[athleteId] (docs/tasks/2026-10-05-coach-progress-overview.md).
// Wording is neutral on purpose: raw numbers and engine events, never a grade, score, or Progressing / Stable / Review
// label. "PR", "RIR" and "1RM" are gym vocabulary and stay in Latin letters.
export const progress = {
  "progress.title": "Exercise progress",
  "progress.loading": "Loading progress…",
  "progress.backToClient": "← Back to athlete",
  "progress.backToToday": "← Back to Today",
  "progress.unknownExercise": "Exercise",

  "progress.metricLabel": "Metric",
  "progress.metric.performance": "Performance",
  "progress.metric.estimated1rm": "Estimated strength",
  "progress.metric.estimated1rmSubtitle": "Estimated 1RM (e1RM)",
  "progress.estimated1rmNote": "Estimated from load, reps and RIR to watch long-term trends. It is not a measured 1RM.",
  "progress.point.estimated1rm": "Estimated 1RM {value} {unit} · from {top}",
  "progress.point.sets": "{count} sets",
  "progress.point.volume": "{volume} {unit} volume",

  "progress.rangeLabel": "Range",
  "progress.range.3m": "3 months",
  "progress.range.1y": "1 year",
  "progress.range.all": "All",

  "progress.unitHeading": "Logged in {unit}",
  "progress.chartLabel": "{metric} over time ({unit})",
  "progress.legend.otherCoach": "Hollow point = logged under another Coach",
  "progress.noPoints": "Nothing to chart for this metric in this range.",
  "progress.empty": "No completed sets with a load in this range.",

  "progress.selected.heading": "Selected session",
  "progress.compare.heading": "Compared with last time · {date}",
  "progress.compare.load": "Load",
  "progress.compare.reps": "Reps",
  "progress.compare.rir": "Reps in reserve",
  "progress.compare.notLogged": "Not logged",
  "progress.compare.effortDown": "↓ lower effort",
  "progress.compare.effortUp": "↑ higher effort",
  "progress.compare.last": "Last",
  "progress.compare.this": "This",
  "progress.compare.change": "Change",
  "progress.compare.sameDay": "Earlier the same day",
  "progress.compare.otherCoach": "Other coach",
  "progress.compare.basis": "Compared on the heaviest set",
  "progress.describe.same": "same as last time",
  "progress.describe.sameLoad": "same load",
  "progress.describe.sameReps": "same reps",
  "progress.describe.sameRir": "same RIR",
  "progress.describe.rirSame": "RIR unchanged",
  "progress.describe.repsRirKept": "reps and RIR unchanged",
  "progress.describe.loadUp": "load up {delta} {unit}",
  "progress.describe.loadDown": "load down {delta} {unit}",
  "progress.describe.repsMoreOne": "{count} more rep",
  "progress.describe.repsMoreMany": "{count} more reps",
  "progress.describe.repsFewerOne": "{count} fewer rep",
  "progress.describe.repsFewerMany": "{count} fewer reps",
  "progress.describe.effortLower": "done at lower effort",
  "progress.describe.effortHigher": "done at higher effort",
  "progress.describe.rirMissing": "RIR not logged, effort cannot be compared",
  "progress.describe.joinList": ", ",
  "progress.describe.joinClause": "; ",
  "progress.selected.firstTime": "First time on record in {unit}.",

  "progress.timeline.heading": "History",
  "progress.timeline.prev": "Previous",
  "progress.timeline.next": "Next",
  "progress.timeline.page": "Page {page} of {total}",
  "progress.position": "Exercise #{position}",
  "progress.otherCoach": "Other coach",
  "progress.openSession": "Open session",

  "progress.loadEarlier": "Load earlier",
  "progress.loadingEarlier": "Loading…",
  "progress.noEarlier": "No earlier history found.",

  "progress.event.loadPr": "Load PR",
  "progress.event.repPr": "Rep PR · {reps} @ {load} {unit}",
  "progress.event.repPrBodyweight": "Rep PR · {reps}",
  "progress.event.matched": "Matched",
  "progress.event.repsDown": "Reps ↓ {from}→{to}",

  "progress.overview.heading": "Overview",
  "progress.overview.loading": "Loading overview…",
  "progress.overview.error": "Could not load the overview.",
  "progress.overview.empty": "No completed exercises with a load in the last {weeks} weeks.",
  "progress.overview.scopeNote": "Completion and sets count only workouts you scheduled. Exercise data includes training under any Coach.",
  "progress.overview.completion": "Completion",
  "progress.overview.completionDetail": "{completed} of {scheduled} workouts",
  "progress.overview.noAssignments": "None scheduled by you",
  "progress.overview.sets": "Planned vs completed sets",
  "progress.overview.setsValue": "{completed} / {planned}",
  "progress.overview.extraSets": "+{count} extra",
  "progress.overview.prs": "PRs · last 28 days",
  "progress.overview.prsDetail": "Rep PR and Load PR",
  "progress.overview.trendLabel": "Estimated 1RM by week, last {weeks} weeks",
  "progress.overview.chip.repPr": "Rep PR",
  "progress.viewProgress": "View progress",

  // Cross-coach visibility disclosure (join flow + Privacy page). Must ship
  // with or before LAST / PR reaches production.
  "progress.disclosure.join":
    "Every Coach you connect with can see your full training log, including training you logged with other Coaches. A Coach sees another Coach's sessions as dates, exercises and sets only.",
  "progress.disclosure.privacyLink": "Privacy Policy",
  "privacy.trainingLog.heading": "Training log visibility",
  "privacy.trainingLog.body1":
    "Every Coach connected to you in PumpLoop can see your full training log, including training you logged with other Coaches. This lets a Coach see your lifting history and progress over time.",
  "privacy.trainingLog.body2":
    "Training logged under another Coach appears to a connected Coach as actuals only: the date, exercises, and sets (load, unit, reps, RIR). It does not show the other Coach's name, the workout name, coaching cues, or the planned prescription. You always see all of your own history.",
} as const;

export type ProgressMessages = Record<keyof typeof progress, string>;
