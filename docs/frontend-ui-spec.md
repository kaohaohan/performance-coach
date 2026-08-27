# Performance Coach — Frontend UI / Information Architecture Spec

Status: V0.1 — Calendar-first

This document is the canonical reference for **routes, navigation, and page responsibilities**. It does not redefine product behavior, acceptance criteria, API response shapes, or the data model — those live in:

- `docs/mvp-specification.md` — product stories, acceptance criteria
- `docs/go-backend-api-contract-v0.1.md` — endpoints, request/response shapes, authorization
- `docs/database-schema-relationships.md` — data model

If this document and one of the above disagree on product behavior or data, the other document wins; this one only owns route structure and navigation.

---

## 1. Principle

**Calendar-first, not dashboard-first.**

The Coach's PRIMARY programming workspace is the Calendar. From a selected date and one-or-more selected Athletes, Coach either chooses an existing saved Workout and assigns it, or builds a Workout inline and Build & Assigns it. The Coach is not required to visit a separate template library before scheduling training. There is no separate Coach dashboard as a landing page — Clients, Workout History, and Exercise Library are SECONDARY tools reached from Calendar, not parallel top-level destinations competing with it.

This is a frontend information-architecture decision. It introduces no new backend domain object: Calendar is a UI layer over the existing `Workout` / `ScheduledWorkout` / `WorkoutSession` / `SetLog` model (see `go-backend-api-contract-v0.1.md` §7.5).

---

## 2. Routes

### Coach

| Route | Role | Backs onto | Purpose |
|---|---|---|---|
| `/coach/calendar` | **Primary** | `GET /exercises`, `POST /workouts`, `POST /scheduled-workouts`, `GET /scheduled-workouts` (athleteId omitted → all connected athletes in a date range) | Default landing page after Coach login and the primary programming workspace. Pick a date and one-or-more Athletes, then either choose an existing saved Workout → Assign, or Build Workout inline → add Exercises → define sets → define a uniform prescription and optional individual-set overrides → Build & Assign. Inline Build creates one normal saved Workout template, then batch-schedules it; it does not create a Workout per Athlete. Shows each Athlete's completion status per day (`session` field on the scheduled-workout list). Entry point into `/session/[id]` for review or live 1:1 coaching. |
| `/coach/clients` | Secondary | `GET /athletes`, `DELETE /athletes/{athleteId}`, `GET/POST /invite-codes`, `POST /invite-codes/{id}/revoke` | Athletes tab lists connected Athletes and can remove one (ends the relationship only). Invite Codes tab creates, lists and revokes reusable invite codes. Product behavior is defined in `docs/mvp-specification.md`, "Coach & Athlete Onboarding — Implemented (V0.1)". |
| `/coach/workouts` | Secondary | `GET /athletes`, `GET /scheduled-workouts`, `POST /scheduled-workouts/{id}/session`, `POST /workouts` | Workout History across the Coach's Athletes. Shows today and past assignments newest first, grouped by date, with Athlete and date-range filters and Not started / In progress / Done status. Active and Completed entries reuse `/session/[id]`; Not started uses an explicit Start Session action. The page keeps `+ Create Workout`, while reusable saved Workouts are selected from Calendar → From saved instead of being duplicated as a standalone Library list. |
| `/coach/exercises` | Secondary | `GET /exercises`, `POST /exercises` | Secondary Exercise-management tool for browsing and managing private Exercises. Calendar's inline Workout Builder searches existing Exercises through `GET /api/v1/exercises?q=` and may create one missing private Exercise through `POST /api/v1/exercises` without leaving the builder. |

### Athlete

| Route | Role | Backs onto | Purpose |
|---|---|---|---|
| `/today` | Primary (Athlete's only real destination in V0.1) | `GET /me/scheduled-workouts?date=` | Athlete's primary training destination. It defaults to the Athlete's **local current date** and allows lightweight previous/next day navigation so the Athlete can view ScheduledWorkouts already assigned for nearby dates. A Today action returns to the local current date. Each selected-date change calls `GET /api/v1/me/scheduled-workouts?date={selectedDate}`. This is day navigation inside `/today`, not a new Athlete Calendar route. It remains the only primary Athlete route in V0.1. Account deletion is reached from `/settings`, not from a second primary destination. |

### Shared

| Route | Role | Backs onto | Purpose |
|---|---|---|---|
| `/session/[id]` | Coach (connected) + Athlete (self) | `POST /scheduled-workouts/{id}/session`, `GET /sessions/{id}`, `POST/PATCH/DELETE /sessions/{id}/set-logs`, `POST /sessions/{id}/complete` | The Training Session UI. Both roles use the same screen/domain: start or resume a session, log/edit/delete SetLogs, view plan vs. actual, complete the session. This is what makes Story 2 (Coach runs a live 1:1 session) possible without a separate coach-only UI. After an Athlete deletes their account, a Coach may still open historical sessions as read-only (`GET /sessions/{id}`); start/complete/set-log are refused. |
| `/settings` | Coach + Athlete (self) | `DELETE /api/v1/me` | Account settings. The only in-app account-deletion surface (Guideline 5.1.1(v)). Not a primary programming destination. |

### Onboarding (unauthenticated)

| Route | Role | Backs onto | Purpose |
|---|---|---|---|
| `/join` | Unauthenticated | none | Manual invite-code entry. Normalizes input and routes to `/join/[code]`. |
| `/join/[code]` | Unauthenticated | `GET /invite-codes/{code}/preview`, `POST /invite-codes/{code}/redeem` | Preview → confirm → auth (embedded, no redirect to `/login`) → redeem → `/today`. Product behavior is defined in `docs/mvp-specification.md`, "Coach & Athlete Onboarding — Implemented (V0.1)". |

---

## 3. Product Rules

- No Coach dashboard-first UI.
- Calendar is the Coach's primary programming workspace. Its Workout section conceptually exposes `[ Choose existing workout... ]` or `[ + Build Workout ]`; this document specifies behavior and IA, not pixel styling.
- Existing Workout path: choose a saved Workout and assign it to the selected Athlete(s). **New Workout** (`+ Add Workout`) always follows the Athlete Calendar currently viewed. That Athlete is default-selected and not locked: the Coach may uncheck them and select others. Submit requires at least one Athlete. Assign submits the same Athlete IDs the Assign-to checkboxes show. `+ Add Workout` never continues a stored draft, including when that draft is for the same Athlete and date. Assigning an existing Workout does not destroy a stored Build draft.
- Inline Build path: build one ordered Workout draft from existing Exercises, validate it, `POST /api/v1/workouts` once, retain the returned `workout.id`, then `POST /api/v1/scheduled-workouts` once with all selected Athlete IDs and the selected date. Refresh Calendar assignment state and Workout choices after success. **Continue Draft** restores a stored Build draft's original Athlete, date, and checkbox selection. A Continue Draft that was started as New Workout keeps that exact Assign-to set (the Calendar athlete is not re-added if the Coach unchecked them). A Continue Draft that was started as Continue keeps the source Athlete selected and not clearable. When a stored draft exists, `+ Add Workout` asks the Coach to Start new (current Calendar context) or Continue (original draft context). Backdrop and Escape dismiss the dialog without either action. Start new opens an empty builder and does **not** replace the stored draft until the new Build session has a name or at least one exercise. Build & Assign submits the same Athlete IDs the Assign-to checkboxes show.
- For every exercise in the Calendar Builder, **sets come first**. `Sets = N` establishes `N` effective ordered planned positions. The default Builder interaction is **uniform-first**: one reps value or text prescription, one load plus unit, and one RPE may apply to all positions. The Coach may switch to customize individual positions only when needed; uniform programming must not require manually entering N repeated values.
- Builder authoring distinguishes a property default, an inherited value, and an explicit per-position override. Overrides are property-specific: a position can override reps while continuing to inherit load and RPE.
- When the Coach edits an inherited property on an individual position, the editable control starts with that position's current effective value. Changing it creates an override. Changing a default updates only positions still inheriting that property; clearing an override returns that property to inheriting the current default. The UI may visually distinguish inherited and explicit values, but no styling is canonical here.
- V0.1 override controls expose only inherited and explicit-value states. There is no explicit "no target for this position" state. Clearing means clearing the override and returning to inheritance.
- Planned load uses one `kg`/`lb` unit selector per WorkoutExercise. Per-position customization changes only the numeric load. Changing the exercise unit applies that unit to every effective planned load; no mixed-unit planned rows or automatic conversion are supported.
- Athlete execution and review present only the frozen effective target for each planned position; default/inherited/override provenance is primarily a Coach authoring concern.
- The Session UI associates a normal actual SetLog with a specific frozen planned position while keeping server-assigned `setNumber` as actual chronology. Extra actual sets are allowed and displayed as EXTRA with no target. Planned positions without an actual log remain visibly incomplete; there is no persisted skipped-row UI in V0.1.
- The UI specification owns these interaction rules, not a component layout. It does not require a desktop matrix, a mobile card layout, or any particular control for switching between uniform and per-set customization or clearing an override. Product/domain semantics and API/schema decisions live in the other canonical specifications.
- A scheduled workout that has not been started can be removed from the Calendar day card via `DELETE /api/v1/scheduled-workouts/{id}`, behind a confirmation naming the Athlete, workout, and date. The action is offered only while `session` is `null` — the same condition that gates Edit — and the backend independently refuses with `409` once a session exists. Removal affects exactly one assignment; it never deletes the reusable Workout template.
- Discard Draft issues no request and never removes a scheduled workout; Remove is the undo for an assignment. Discard of persistable live Build content also clears the stored draft. Discard of an empty New Workout builder only closes that transient session and must not delete a stored draft for another Athlete. Save Draft is disabled / a no-op while the live builder has no name and no exercises.
- Build & Assign reports success outside the builder, because success closes the builder. The notice names the workout, the date, and the number of Athletes assigned.
- Calendar-built Workouts are normal saved Workout templates in V0.1: Coach-owned and later selectable through Calendar → From saved. There is no ephemeral or scheduled-only Workout domain.
- Workout History is the secondary cross-athlete review tool, not a competing programming destination. It is a view over existing ScheduledWorkout and WorkoutSession data, never a new persistence model.
- Workout History excludes future assignments, sorts newest first, groups cleanly by scheduled date, and renders the same reusable Workout assigned to multiple Athletes as separate entries. Its minimum filters are All Athletes or one connected Athlete, plus Last 7, 30, 90 Days, or All Time.
- Workout History includes Not started assignments as meaningful history. A generic card tap must not create a session: Not started exposes an explicit Start Session interaction; Active and Completed entries may open the existing `/session/[id]` flow directly.
- Workout History does not infer exercise count from the live template because the scheduled-workout summary does not reliably expose the frozen count. Search, charts, PRs, volume, adherence metrics, and other analytics remain outside this slice.
- Exercise Library is the secondary Exercise-management tool, not a competing top-level destination. When `GET /api/v1/exercises?q=` cannot find a movement, Calendar may create one private Exercise through the existing Exercise API; Exercise Library remains the secondary location for browsing and managing existing Exercises.
- Each scheduled Athlete receives a frozen ScheduledWorkoutExercise prescription snapshot; later Workout-template edits do not alter previously scheduled prescriptions.
- Coach and Athlete share the same Training Session UI/domain wherever the underlying authorization allows it (session start, set-log CRUD).
- Voice / Video / AI are deferred — not part of any V0.1 route.
- `/today` supports lightweight day navigation only; a full month calendar is not required in V0.1.
- Calendar retains historical rows for a tombstoned Athlete, labeled `Deleted Athlete`. Those rows are not in the Assign-to roster.
- Account deletion lives at `/settings`: Delete Account → destructive confirmation → `reauthenticateWithCredential` on the **current** Firebase user (Apple-linked accounts use a deletion-only native Apple login that yields `authorizationCode`, then that credential is passed to `reauthenticateWithCredential`; Google/password use the matching provider credential) → `DELETE /api/v1/me` → sign out → `/login`. Do not present deactivate, email-only deletion, or an external web form as the only method. `403 RECENT_AUTH_REQUIRED` returns the user to re-auth. Apple sheet cancel stays silent.
- Day navigation does not introduce a Calendar domain object or a new backend endpoint; it uses the existing `GET /me/scheduled-workouts?date=` endpoint.
- Client invite/onboarding mechanism is explicitly undecided (see below).
- Do not copy TeamBuildr's enterprise Calendar/Program/Offset model — Calendar here is a UI over per-athlete `ScheduledWorkout`, not a new scheduling domain.
- Keep the UI lightweight and low-friction; this spec intentionally does not prescribe visual design, only structure.

---

## 4. Explicitly Deferred / Not Implemented

- **Onboarding — implemented, with these parts still deferred.** Athletes self-connect by redeeming a reusable Coach invite code; `CoachAthlete` relationships are no longer seed-only. Product behavior is defined in `docs/mvp-specification.md`, "Coach & Athlete Onboarding — Implemented (V0.1)". Google sign-in is implemented (web popup + native iOS via @capgo/capacitor-social-login), and Sign in with Apple is implemented on iOS only, per App Review Guideline 4.8 (`docs/tasks/2026-08-25-ios-apple-signin.md`). Still deferred: a "Pending" Athlete state, single-use codes, bulk upload, and SMS or email delivery of invites.
- **Voice / Video / AI** — deferred per `docs/mvp-specification.md` Story 5/6 and §4/§5 (Out of Scope / Future Video Flow). No route in this document reflects them.
- **No Calendar domain object or endpoint** — `/coach/calendar` is served entirely by existing `Workout`/`ScheduledWorkout` endpoints (extended per `go-backend-api-contract-v0.1.md` §3.5/V0.5). There is no `calendars` table and no `/calendar` API resource.
- **Exercise Library slice boundaries** — no Exercise edit/archive, video, description, tags, categories, Warm-Up/Cooldown type, SAQ, Circuit, Questionnaire, Health, progressions, PR behavior, assets, standalone Exercise-Library Workout Builder, or System exercise seed implementation.
- **Build & Assign partial failure** — `POST /api/v1/workouts` and `POST /api/v1/scheduled-workouts` are not atomic together. If Workout creation succeeds but scheduling fails, preserve the created `workout.id`, selected date, selected Athletes, and builder state; report that the Workout was created but not assigned; and offer explicit retry-assignment using only the existing `workout.id`. Do not blindly auto-retry ambiguous network failures: scheduled-workouts has no idempotency key and duplicate scheduling is possible.
- **Future Workout modes** — one-off scheduled Workouts, a “Save as template” toggle, and ephemeral prescriptions are not V0.1.
- **Abandoned sessions** — `workout_sessions.status` remains `ACTIVE` \| `COMPLETED`. Account deletion does not invent `ABANDONED`. An Athlete-deleted ACTIVE session stays ACTIVE and mutation-blocked.
- **Prescription scope** — approved V0.1 planned-set behavior is limited to ordered positions, uniform defaults, sparse individual overrides, reps or an existing text prescription, one planned load unit per WorkoutExercise, and RPE. Template authoring and scheduled snapshot representations are defined in the canonical API/schema docs. Explicit-none overrides, mixed planned units within one exercise, percentages, velocity, tempo, rest, supersets, circuits, arbitrary custom properties, and TeamBuildr-style property systems remain out of scope.

---

## 5. Explicitly Not This

- Not a dashboard-first IA (no `/coach` landing page with athlete list + workout list as parallel primary panels).
- Not a Calendar entity/hierarchy, Program, Parent Calendar, nested calendar, group/team hierarchy, required per-set programming matrix, Superset control, or enterprise scheduling architecture. The adopted principle is only direct date-based programming in the primary Calendar workflow.
- Not a large global Coach navigation system or enterprise toolbar; Exercise Library is a single secondary Calendar action once implemented.
- Not a separate template-management navigation system; saved Workouts are reused through Calendar → From saved.
- Not a native mobile app (Athlete and Coach mobile experience is PWA, per `docs/mvp-specification.md` §2 Platform Boundary).
