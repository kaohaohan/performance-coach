// Coach surfaces except Calendar (sub-task 3 of
// docs/tasks/2026-08-27-i18n-zh-tw.md): /coach/clients, /coach/clients/[id],
// the Invite Codes panel, /coach/workouts and /coach/exercises.
//
// Calendar owns `calendar.*` in its own area file — nothing here may be
// edited from that sub-task, and nothing here duplicates it. The one key
// that crosses the line is `coach.nav.calendar`, the back-link *these* pages
// render; it is coach navigation chrome, not Calendar copy.
//
// English wording is carried over verbatim from the pages, including two
// places where it has already drifted: the client-detail page shows raw
// enum casing ("NOT STARTED") while the workout history shows Calendar's
// sentence case ("Not started"). Both spellings are kept as separate keys
// rather than silently unified — this task translates copy, it does not
// rewrite it. See the Completion Report for the follow-up.
export const coach = {
  // Shared coach chrome.
  "coach.nav.calendar": "← Coach Calendar",
  "coach.optional": "optional",

  // Table column headers, shared by the clients table and the invite-codes
  // table.
  "coach.col.name": "Name",
  "coach.col.status": "Status",
  "coach.col.actions": "Actions",
  "coach.col.description": "Description",
  "coach.col.joinCode": "Join code",
  "coach.col.expires": "Expires",

  // Session lifecycle, shared by the client-detail timeline and the workout
  // history list.
  "coach.session.start": "Start Session",
  "coach.session.starting": "Starting…",
  "coach.session.resume": "Resume",
  "coach.session.review": "Review",

  // Status chip on /coach/clients/[athleteId] — raw API enum casing.
  "coach.sessionStatus.notStarted": "NOT STARTED",
  "coach.sessionStatus.active": "ACTIVE",
  "coach.sessionStatus.completed": "COMPLETED",

  // Status chip in the workout history list — deliberately worded to match
  // the Calendar (see app/coach/workouts/history.test.ts).
  "coach.historyStatus.notStarted": "Not started",
  "coach.historyStatus.inProgress": "In progress",
  "coach.historyStatus.done": "Done",

  // Exercise scope badge, shown on /coach/exercises and in the picker.
  "coach.scope.system": "SYSTEM",
  "coach.scope.private": "PRIVATE",

  // /coach/clients
  "coach.clients.title": "Clients",
  "coach.clients.subtitle": "Your connected athletes.",
  "coach.clients.sectionsNav": "Clients sections",
  "coach.clients.tabAthletes": "Athletes",
  "coach.clients.tabCodes": "Invite Codes",
  "coach.clients.inviteCta": "+ Invite Athletes",
  "coach.clients.loading": "Loading connected athletes…",
  "coach.clients.empty": "No athletes yet. Create an invite code and send the link.",
  "coach.clients.search": "Search athletes",
  "coach.clients.noMatch": "No athletes match “{query}”.",
  "coach.clients.connected": "Connected",
  "coach.clients.removeAria": "Remove {name}",
  "coach.clients.removeTitle": "Remove {name}?",
  "coach.clients.removeBody":
    "They'll no longer appear in your roster, and you won't be able to schedule new training for them. Their existing history is unaffected.",

  // Create-invite modal on /coach/clients, plus the copy the Invite Codes
  // panel reuses.
  "coach.invite.title": "Invite athletes",
  "coach.invite.descriptionLabel": "Description (optional)",
  "coach.invite.descriptionPlaceholder": "Fall squad",
  "coach.invite.descriptionHelp": "Athletes see this when they open the link.",
  "coach.invite.expiresIn": "Expires in",
  "coach.invite.days": "{count} days",
  "coach.invite.create": "Create invite",
  "coach.invite.creating": "Creating…",
  "coach.invite.readyTitle": "Invite ready",
  "coach.invite.joinCode": "Join code",
  "coach.invite.copyCode": "Copy code",
  "coach.invite.inviteLink": "Invite link",
  "coach.invite.copyLink": "Copy link",
  "coach.invite.copied": "Copied ✓",
  "coach.invite.expiresOn": "Expires {date}",
  "coach.invite.share": "Send it over LINE, WhatsApp, or email.",

  // Invite Codes tab.
  "coach.codes.loading": "Loading invite codes…",
  "coach.codes.empty": "No invite codes yet.",
  "coach.codes.emptyHint": "Use + Invite Athletes above to create one.",
  "coach.codes.untitled": "Invite code",
  "coach.codes.revoke": "Revoke",
  "coach.codes.revoking": "Revoking…",
  "coach.codes.revokeTitle": "Revoke this invite code?",
  // {code} is the code itself, optionally prefixed with the coach's own
  // description — assembled in the component, never translated.
  "coach.codes.revokeBody":
    "{code} will stop working for anyone who hasn't already joined. Athletes already connected keep their spot.",
  "coach.codeStatus.active": "ACTIVE",
  "coach.codeStatus.expired": "EXPIRED",
  "coach.codeStatus.revoked": "REVOKED",

  // /coach/clients/[athleteId]
  "coach.clientDetail.loading": "Loading connected athlete…",
  "coach.clientDetail.notConnected": "This athlete is not connected to your account.",
  // Fallback heading when neither the timeline nor the roster has supplied a
  // name yet. A *deleted* client is not this case: the Go API sends the
  // literal name "Deleted Athlete" and the page renders it like any other
  // name, which is what keeps their history readable to the coach.
  "coach.clientDetail.unknownName": "Athlete",
  "coach.clientDetail.subtitle": "Athlete Training",
  "coach.clientDetail.back": "← Clients",
  "coach.clientDetail.trainingHeading": "Training",
  "coach.clientDetail.loadingTraining": "Loading training…",
  "coach.clientDetail.noTraining": "No training scheduled in this period.",

  // /coach/workouts — history view.
  "coach.workouts.historyTitle": "Workout History",
  "coach.workouts.historySubtitle": "Review past workouts across athletes.",
  "coach.workouts.createCta": "+ Create Workout",
  "coach.workouts.athleteFilter": "Athlete",
  "coach.workouts.allAthletes": "All Athletes",
  "coach.workouts.dateRange": "Date range",
  "coach.workouts.range7": "Last 7 Days",
  "coach.workouts.range30": "Last 30 Days",
  "coach.workouts.range90": "Last 90 Days",
  "coach.workouts.rangeAll": "All Time",
  "coach.workouts.loadingHistory": "Loading workout history…",
  "coach.workouts.emptyHistory": "No workout history yet.",
  "coach.workouts.emptyForAthlete": "No workouts found for this athlete.",

  // /coach/workouts — create view.
  "coach.workouts.createTitle": "Create Workout",
  "coach.workouts.createSubtitle": "Build a reusable training template.",
  "coach.workouts.nameLabel": "Workout Name",
  "coach.workouts.exercisesEyebrow": "Exercises",
  "coach.workouts.prescriptionHeading": "Training prescription",
  "coach.workouts.addedCount": "{count} added",
  "coach.workouts.addExercise": "+ Add Exercise",
  "coach.workouts.save": "Save Workout",
  "coach.workouts.saving": "Saving workout…",

  // Draft exercise card. "RPE" and the kg/lb units are left untranslated on
  // purpose: both are written the same way by Taiwan coaches.
  "coach.workouts.exerciseIndex": "Exercise {number}",
  "coach.workouts.sets": "Sets",
  "coach.workouts.targetRpe": "Target RPE",
  "coach.workouts.prescription": "Prescription",
  "coach.workouts.modeReps": "Reps",
  "coach.workouts.modeText": "Text",
  "coach.workouts.instruction": "Instruction",
  "coach.workouts.instructionPlaceholder": "AMAP, 30 sec, 10–12",
  "coach.workouts.reps": "Reps",
  "coach.workouts.plannedLoad": "Planned Load",
  "coach.workouts.load": "Load",
  "coach.workouts.unit": "Unit",
  "coach.workouts.customizeSets": "Customize individual sets",
  "coach.workouts.hideSets": "Hide individual sets",
  "coach.workouts.setNumber": "Set {number}",
  "coach.workouts.repsValue": "{value} reps",
  "coach.workouts.useDefault": "Use default",
  "coach.workouts.useDefaultLoad": "Use default load",
  "coach.workouts.useDefaultRpe": "Use default RPE",
  "coach.workouts.moveUp": "Move Up",
  "coach.workouts.moveDown": "Move Down",

  // Draft validation. Every one of these is shown next to the field it
  // describes, so each has to stand alone as a whole sentence.
  "coach.workouts.error.nameRequired": "Workout name is required.",
  "coach.workouts.error.exercisesRequired": "Add at least one exercise.",
  "coach.workouts.error.wholeNumber": "Enter a whole number of at least 1.",
  "coach.workouts.error.noteRequired": "Instruction is required.",
  "coach.workouts.error.load": "Load must be 0 or greater.",
  "coach.workouts.error.rpe": "RPE must be between 1 and 10.",
  "coach.workouts.error.setCountOverrides":
    "Remove overrides above the new set count before reducing sets.",
  "coach.workouts.error.overridePosition":
    "Each individual override must be within the set count.",
  "coach.workouts.error.overrideMode":
    "Each individual set needs either reps or text, not both.",
  "coach.workouts.error.overrideReps":
    "Individual reps must be a whole number of at least 1.",
  "coach.workouts.error.overrideNote": "Individual text instruction is required.",
  "coach.workouts.error.overrideLoad": "Individual load must be 0 or greater.",
  "coach.workouts.error.overrideRpe": "Individual RPE must be between 1 and 10.",

  // Exercise picker inside the workout builder.
  "coach.picker.title": "Add Exercise",
  "coach.picker.startTyping": "Start typing to find an exercise.",
  "coach.picker.cantFind": "Can't find the movement you need?",
  "coach.picker.openLibrary": "Open Exercise Library",
  "coach.picker.allAdded": "All matching exercises are already added.",
  "coach.picker.updating": "Updating exercises…",
  "coach.picker.added": "Added",
  // translate() has no plural support by design (lib/i18n/locale.ts), so the
  // two English forms are two keys and the component picks one. zh-TW does
  // not inflect for number, so both translations are identical — that is
  // correct, not a copy-paste slip.
  "coach.picker.moreResultsOne": "{count} more result. Keep typing to narrow the list.",
  "coach.picker.moreResultsOther": "{count} more results. Keep typing to narrow the list.",

  // /coach/exercises — also the source of the picker's shared group titles
  // and search copy.
  "coach.exercises.title": "Exercise Library",
  "coach.exercises.subtitle": "Manage the movements you use in programming.",
  "coach.exercises.searchLabel": "Search exercises",
  "coach.exercises.searchPlaceholder": "Search exercises…",
  "coach.exercises.createCta": "+ Create Exercise",
  "coach.exercises.create": "Create Exercise",
  "coach.exercises.creating": "Creating exercise…",
  "coach.exercises.nameLabel": "Exercise name",
  "coach.exercises.nameRequired": "Exercise name is required.",
  "coach.exercises.loading": "Loading exercises…",
  "coach.exercises.loadFailed": "Exercises could not be loaded.",
  "coach.exercises.noneFound": "No exercises found.",
  "coach.exercises.noneFoundHint": "Try another search or create a new exercise.",
  "coach.exercises.systemTitle": "System exercises",
  "coach.exercises.systemEmpty": "No system exercises available yet.",
  "coach.exercises.privateTitle": "My exercises",
  "coach.exercises.privateEmpty": "You haven't created any exercises yet.",
} as const;

export type CoachMessages = Record<keyof typeof coach, string>;
