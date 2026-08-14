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

The Coach's primary workspace is the Calendar. Workout creation, workout scheduling, and reviewing completed training all happen from it. There is no separate Coach dashboard as a landing page — Client management and the workout library are secondary tools reached from the Calendar, not parallel top-level destinations competing with it.

This is a frontend information-architecture decision. It introduces no new backend domain object: Calendar is a UI layer over the existing `Workout` / `ScheduledWorkout` / `WorkoutSession` / `SetLog` model (see `go-backend-api-contract-v0.1.md` §7.5).

---

## 2. Routes

### Coach

| Route | Role | Backs onto | Purpose |
|---|---|---|---|
| `/coach/calendar` | **Primary** | `POST /workouts`, `POST /scheduled-workouts`, `GET /scheduled-workouts` (athleteId omitted → all connected athletes in a date range) | Default landing page after Coach login. Pick a date → create/select a Workout → assign to one or more Athletes. Shows each Athlete's completion status per day (`session` field on the scheduled-workout list). Entry point into `/session/[id]` for review or live 1:1 coaching. |
| `/coach/clients` | Secondary | `GET /athletes` | List of connected Athletes. **Does not yet support inviting/creating a Client** — see "Deferred" below. |
| `/coach/workouts` | Secondary | `GET /workouts`, `POST /workouts` | Workout template library. Reuse an existing Workout without starting from the Calendar. Still the only place workout templates are edited independent of a specific date. |
| `/coach/exercises` | Secondary | `GET /exercises`, `POST /exercises` | Coach Exercise Library. Lists SYSTEM plus the caller Coach's PRIVATE exercises, supports search and private Exercise creation, and shows relevant empty states. |

### Athlete

| Route | Role | Backs onto | Purpose |
|---|---|---|---|
| `/today` | Primary (Athlete's only real destination in V0.1) | `GET /me/scheduled-workouts?date=` | Athlete's primary training destination. It defaults to the Athlete's **local current date** and allows lightweight previous/next day navigation so the Athlete can view ScheduledWorkouts already assigned for nearby dates. A Today action returns to the local current date. Each selected-date change calls `GET /api/v1/me/scheduled-workouts?date={selectedDate}`. This is day navigation inside `/today`, not a new Athlete Calendar route. It remains the only primary Athlete route in V0.1. |

### Shared

| Route | Role | Backs onto | Purpose |
|---|---|---|---|
| `/session/[id]` | Coach (connected) + Athlete (self) | `POST /scheduled-workouts/{id}/session`, `GET /sessions/{id}`, `POST/PATCH/DELETE /sessions/{id}/set-logs`, `POST /sessions/{id}/complete` | The Training Session UI. Both roles use the same screen/domain: start or resume a session, log/edit/delete SetLogs, view plan vs. actual, complete the session. This is what makes Story 2 (Coach runs a live 1:1 session) possible without a separate coach-only UI. |

---

## 3. Product Rules

- No Coach dashboard-first UI.
- Calendar is the Coach's primary workspace.
- The workout library is a secondary tool, not a competing top-level destination.
- Exercise Library is secondary programming tooling, not a competing top-level destination. It may be reached through one lightweight secondary action/link from Coach Calendar.
- Coach and Athlete share the same Training Session UI/domain wherever the underlying authorization allows it (session start, set-log CRUD).
- Voice / Video / AI are deferred — not part of any V0.1 route.
- `/today` supports lightweight day navigation only; a full month calendar is not required in V0.1.
- Day navigation does not introduce a Calendar domain object or a new backend endpoint; it uses the existing `GET /me/scheduled-workouts?date=` endpoint.
- Client invite/onboarding mechanism is explicitly undecided (see below).
- Do not copy TeamBuildr's enterprise Calendar/Program/Offset model — Calendar here is a UI over per-athlete `ScheduledWorkout`, not a new scheduling domain.
- Keep the UI lightweight and low-friction; this spec intentionally does not prescribe visual design, only structure.

---

## 4. Explicitly Deferred / Not Implemented

- **Client invite/onboarding mechanism** — undecided. `/coach/clients` can only list existing connections (`GET /athletes`); it cannot create one. `CoachAthlete` relationships are currently seed-only. See `docs/mvp-specification.md`, "Deferred — Not Yet Specified: Client Invite / Onboarding."
- **Voice / Video / AI** — deferred per `docs/mvp-specification.md` Story 5/6 and §4/§5 (Out of Scope / Future Video Flow). No route in this document reflects them.
- **No Calendar domain object or endpoint** — `/coach/calendar` is served entirely by existing `Workout`/`ScheduledWorkout` endpoints (extended per `go-backend-api-contract-v0.1.md` §3.5/V0.5). There is no `calendars` table and no `/calendar` API resource.
- **Exercise Library slice boundaries** — no Exercise edit/archive, video, description, tags, categories, Warm-Up/Cooldown type, SAQ, Circuit, Questionnaire, Health, progressions, PR behavior, assets, Workout Builder, or System exercise seed implementation.

---

## 5. Explicitly Not This

- Not a dashboard-first IA (no `/coach` landing page with athlete list + workout list as parallel primary panels).
- Not TeamBuildr's team-scale Calendar/Program/athlete-subscription/offset model.
- Not a large global Coach navigation system or enterprise toolbar; Exercise Library is a single secondary Calendar action once implemented.
- Not unfinished Workout Library navigation.
- Not a native mobile app (Athlete and Coach mobile experience is PWA, per `docs/mvp-specification.md` §2 Platform Boundary).
