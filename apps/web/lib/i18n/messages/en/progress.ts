// Exercise Progress (docs/tasks/2026-10-04-training-history.md, sub-task 4):
// the chart, selected-point card and history timeline, plus the exercise list
// on /coach/clients/[athleteId]. Wording is neutral on purpose: raw numbers
// and engine events, never a grade, score, or Progressing / Stable / Review
// label. "PR", "RIR" and "1RM" are gym vocabulary and stay in Latin letters.
export const progress = {
  "progress.title": "Exercise progress",
  "progress.loading": "Loading progress…",
  "progress.backToClient": "← Back to athlete",
  "progress.backToToday": "← Back to Today",
  "progress.unknownExercise": "Exercise",

  "progress.metricLabel": "Metric",
  "progress.metric.topSet": "Top set",
  "progress.metric.estimated1rm": "Est. 1RM",
  "progress.metric.load": "Load",
  "progress.metric.reps": "Reps",
  "progress.metric.volume": "Volume",
  "progress.estimated1rmNote": "Estimated from the top set: load × (1 + (reps + RIR) / 30). A calculation, not a tested max.",

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
  "progress.selected.previous": "Previous session",
  "progress.selected.firstTime": "First time on record in {unit}.",

  "progress.timeline.heading": "History",
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

  "progress.clients.heading": "Exercise progress",
  "progress.clients.loading": "Loading exercises…",
  "progress.clients.empty": "No completed exercises in the last 6 months.",
  "progress.clients.lastTrained": "Last {date}",
  "progress.viewProgress": "View progress",
} as const;

export type ProgressMessages = Record<keyof typeof progress, string>;
