# DontWorkout — MVP Specification

Status: V0.1

Target: 2026-08-16

Source of truth: this document for product behavior; companion canonical documents define UI/IA, API contracts, and schema relationships.

## **1. Goal**

Build the minimum end-to-end coaching workflow:

**Coach creates workout → schedules it to an athlete → athlete executes → coach or athlete records training → coach reviews results.**

The first AI-native enhancement is voice-based training logging.

The MVP should follow the proven workflow of products such as TeamBuildr, while reducing the amount of manual interaction required during live coaching.

---

## **2. Platform Boundary**

### **Web / Desktop**

Used primarily for:

- Client management
- Workout creation
- Workout editing
- Scheduling workouts
- Reviewing completed training
- Reviewing athlete history

### **Mobile / PWA**

Used primarily for:

- Viewing today’s workout
- Coaching an athlete during a live session
- Athlete self-training
- Manual set logging
- Voice set logging
- Completing workouts
- Future video capture/upload

### **MVP Constraint**

Full workout programming on mobile is **out of scope** for V0.1.

The MVP follows this principle:

**Mobile supports live coaching and workout execution. Desktop is for programming and review in V0.1.**

### **Navigation Principle**

**Calendar (`/coach/calendar`) is the PRIMARY Coach programming workspace on Web/Desktop.** From a selected date and one-or-more selected Athletes, the Coach has two first-class paths: choose an existing saved Workout and assign it, or build a Workout inline and Build & Assign it. The Coach is not required to visit Workout Library before scheduling training. Client management (`/coach/clients`), Workout Library (`/coach/workouts`), and Exercise Library (`/coach/exercises`) are SECONDARY tools, not separate primary destinations. There is no Coach dashboard as a landing page.

**Workout Library (`/coach/workouts`) is the SECONDARY reusable-template tool.** Coaches can create saved Workout templates in advance, view saved Workout templates, and later reuse them from Calendar. It is optional pre-programming, not a prerequisite for Calendar scheduling.

**Exercise Library (`/coach/exercises`) is the SECONDARY Exercise-management tool for private Exercises.** The Calendar inline Workout Builder searches existing Exercises through `GET /api/v1/exercises?q=` and may create one missing private Exercise through the existing Exercise API without leaving the programming flow. Exercise Library remains the secondary surface for browsing and managing existing Exercises.

Route/navigation detail lives in `docs/frontend-ui-spec.md`; this document defines product behavior only.

---

## **Coach & Athlete Onboarding — Implemented (V0.1)**

> **Status: implemented.** This section defines product behavior only.
> Wire-level request/response detail belongs in
> `docs/go-backend-api-contract-v0.1.md`; screens and navigation belong in
> `docs/frontend-ui-spec.md`.

Firebase Auth is the only authentication system. An invite code is a **capability, never a credential** — it names which Coach an Athlete is joining, and nothing more. It never signs anyone in.

### **Coach account**

A Coach registers themselves; no operator step is involved. A login already registered as an Athlete cannot also become a Coach — a role is chosen once, at account creation, and never changes afterwards.

### **Coach invites an Athlete**

The Coach creates a **reusable** invite code and shares it as a join link or as a short code the Athlete can type in. One code can bring in any number of Athletes.

A code expires after 30 days by default, and the Coach may choose a different lifetime when creating it. A Coach can revoke a code at any time. Revocation is **forward-only**: it stops new Athletes from joining and never disconnects Athletes who already joined. The Coach can tell, for each of their codes, whether it is active, expired, or revoked.

A Coach sees and manages only their own codes and their own Athletes.

### **Athlete joins**

Opening a join link shows the Athlete who they are about to join — the Coach's name and the invite's description — before they commit to anything. The Athlete then creates an account or signs in without leaving the join flow, and arrives at Today.

The Athlete's account is created when they join, not when they are invited. There is no pending or placeholder Athlete: an Athlete exists only once a real person has joined. Joining is safe to repeat — following the same invite twice connects the Athlete once. An Athlete may be connected to more than one Coach.

A Coach account can never join another Coach, including through its own code.

Unknown, expired, and revoked codes are all reported the same way: the join flow cannot be used to discover whether a code ever existed.

### **Coach removes an Athlete**

A Coach can remove an Athlete, which ends the coaching relationship only. The Athlete keeps their account, their login, and their training history, and may be invited again later.

### **Account deletion (App Review 5.1.1(v))**

A Coach or Athlete can delete their own account from inside the app (Settings / Account). Deletion is not deactivation, not an email request, and not an external web form as the only method.

Deletion permanently ends that person's ability to sign in, and removes or anonymizes their personal account identity (`Deleted Coach` / `Deleted Athlete`). It must not corrupt the other party's legitimate historical training record:

- Performed sessions, set logs, and frozen snapshots stay.
- Unstarted future assignments are removed.
- Invite codes belonging to a deleting Coach are deleted.
- Coach-owned workouts and private exercises that history does not need are deleted; parent rows required by remaining FKs stay.
- An Athlete's ACTIVE session is left `ACTIVE` (mutation-blocked). The product does not fabricate `COMPLETED`. A future `ABANDONED` status is a separate decision.
- Calendar keeps historical rows for a deleted Athlete, labeled `Deleted Athlete`.
- Sign in with Apple accounts revoke Apple tokens as part of deletion. Re-auth must prove the **same** currently signed-in Firebase user (`reauthenticateWithCredential`).

A later sign-up with a new Firebase user creates a new empty account. It never restores the tombstone. A still-pending tombstone that still holds the old Firebase UID returns `409 ACCOUNT_DELETED` on coach-signup and invite redeem.

### **Acceptance Criteria**

- A Coach can register without operator involvement.
- A login already registered as an Athlete cannot register as a Coach.
- A Coach can create, list, and revoke reusable invite codes, and can tell whether each one is active, expired, or revoked.
- A revoked or expired code stops new Athletes joining and disconnects nobody.
- An Athlete with no prior account can join from an invite alone and reach Today in one uninterrupted flow.
- An Athlete who is already signed in can join without signing in again.
- Following the same invite twice connects the Athlete once.
- An Athlete may join more than one Coach.
- A Coach account cannot join via an invite code, including its own.
- Unknown, expired, and revoked codes are indistinguishable to the Athlete.
- A Coach sees and manages only their own codes and their own Athletes.
- Removing an Athlete ends the relationship and preserves the Athlete's account and training history.
- A Coach or Athlete can delete their own account in-app. After deletion they cannot sign in as that account, their display name is `Deleted Coach` or `Deleted Athlete`, and the counterparty still sees performed training history.
- Deleting an Athlete does not mark their ACTIVE sessions COMPLETED.
- A tombstoned Firebase identity cannot recreate the old backend user via coach-signup or invite redeem (`409 ACCOUNT_DELETED`).

### **Not in V0.1**

- ~~Google / Apple sign-in~~ — Google sign-in is implemented (web popup + native iOS), and Sign in with Apple is implemented on iOS for App Review Guideline 4.8 (see `docs/tasks/2026-08-25-ios-apple-signin.md`). No other social providers.
- A "Pending" Athlete state.
- Single-use codes, bulk upload, SMS or email delivery, Groups / Teams.
- Assigning workouts during onboarding.

---

# **Exercise Library — Coach Programming Support** (`/coach/exercises`)

The Coach may maintain a small Exercise Library used by Calendar and Workout Library programming. This is secondary tooling around the existing `Exercise` domain; it does not change the primary MVP loop or introduce a new domain object.

## **Acceptance Criteria**

- Coach can open the Exercise Library and see SYSTEM exercises plus MY EXERCISES (the caller Coach's private exercises).
- Coach can search visible exercises by name and create one private Exercise by name.
- A newly created private Exercise becomes available in the Calendar inline Workout Builder and Workout Library builder.
- Zero SYSTEM exercises does not block listing or creating private Exercises.
- Another Coach's private Exercise is invisible.
- Athlete cannot manage the Exercise Library.
- Edit/archive Exercise, media, descriptions, tags, categories, Warm-Up/Cooldown type, SAQ, Circuit, Questionnaire, Health, progressions, PR behavior, assets, and System exercise seed implementation remain out of scope for this slice.

---

# **Story 1 — Coach Builds and Assigns a Workout from the Calendar** (`/coach/calendar`)

## **Given**

A user is authenticated as a Coach and is using the web interface. The Coach's primary workspace is the Calendar.

## **When**

The Coach selects a date and one-or-more connected Athletes on the Calendar, then takes either first-class programming path:

```
Existing Workout
Calendar → date → Athlete(s) → choose saved Workout → Assign

Inline Build
Calendar → date → Athlete(s) → Build Workout → exercises / prescription → Build & Assign
```

The Coach is not required to visit Workout Library before either path.

Example:

```
Calendar → 2026-08-16
Athletes → Student 2, Student 3

Build Workout: Lower Strength A
  Back Squat — 3 × 5 @ RPE 8
  Romanian Deadlift — 3 × 8 @ RPE 8

Build & Assign
```

## **Then**

For the existing Workout path, the selected saved `Workout` is scheduled to each Athlete on the selected date.

For the inline Build path, V0.1 persists two things in order:

1. The frontend validates one Workout draft and calls `POST /api/v1/workouts` once. The returned `workout.id` is a normal saved Coach-owned `Workout` template: it appears in Workout Library and later in Choose Existing Workout. There is no ephemeral, scheduled-only, or one-off Workout domain in V0.1.
2. The frontend calls `POST /api/v1/scheduled-workouts` once with that `workout.id`, all selected `athleteIds`, and the selected `scheduledDate`. The batch creates one `ScheduledWorkout` plus a frozen `ScheduledWorkoutExercise` prescription snapshot for each Athlete.

Changing the saved Workout template later must not alter any previously scheduled prescription.

### **Build & Assign orchestration**

1. Coach selects a date.
2. Coach selects one-or-more Athletes.
3. Coach builds one Workout draft.
4. Frontend validates the draft.
5. Frontend calls `POST /api/v1/workouts` once.
6. Frontend stores the returned `workout.id`.
7. Frontend calls `POST /api/v1/scheduled-workouts` once:

   ```json
   {
     "workoutId": "...",
     "athleteIds": ["...", "..."],
     "scheduledDate": "YYYY-MM-DD"
   }
   ```

8. Scheduling snapshots the Workout prescription independently for every Athlete.
9. Frontend refreshes Calendar assignment state and Workout choices.

This creates one Workout template and one batch scheduling request, never one Workout per Athlete.

Refreshing the page does not remove the workout or the schedule.

## **Acceptance Criteria**

- Calendar is the primary Coach programming workspace; from a selected date and one-or-more selected connected Athletes, Coach can choose either path without first visiting Workout Library.
- Existing Workout path: Coach can choose a saved Workout and assign it to all selected Athletes.
- Inline Build path: Coach can enter one Workout name; add one-or-more existing Exercises using `GET /api/v1/exercises?q=`, or create one missing private Exercise through `POST /api/v1/exercises`; then define sets and a planned prescription. For each exercise, sets establish ordered planned set positions; the Coach can use a uniform default prescription or override individual positions.
- Build & Assign validates one draft, calls `POST /api/v1/workouts` once, stores the returned `workout.id`, then calls `POST /api/v1/scheduled-workouts` once with all selected Athlete IDs and the selected date. It does not create one Workout per Athlete.
- Workout persists in the workout library after refresh.
- ScheduledWorkout persists on the Calendar after refresh.
- Each Athlete receives an independent frozen ScheduledWorkoutExercise snapshot; later template edits do not alter previously scheduled prescriptions.
- Workout belongs to the Coach who created it.
- Coach cannot schedule a workout to an unrelated (unconnected) athlete.
- Athlete cannot create, edit, or schedule Coach workouts.
- **Removing a mistaken assignment:** a scheduled workout that has not been started can be removed from the Calendar day card, which calls `DELETE /api/v1/scheduled-workouts/{id}`. This is the only way to undo an accidental assignment. It removes exactly that one assignment: the reusable Workout template stays in the library, other Athletes scheduled from the same template are unaffected, and other workouts on the same Athlete's same date are unaffected. Once a WorkoutSession exists (`ACTIVE` or `COMPLETED`) the assignment is permanent and removal is refused with `409 CONFLICT`, because deleting it would destroy training the Athlete actually performed.
- **Discard Draft is not an undo.** The inline Build draft lives only in the Coach's browser (localStorage) until Build & Assign; Discard Draft clears that local draft and never issues a request, so it cannot remove — and has never created — a persisted ScheduledWorkout. Removing an already-assigned workout is the Remove action above.
- A successful assignment reports what was assigned (workout name, date, and how many Athletes) outside the builder, since Build & Assign closes the builder on success.
- Workout Library (`/coach/workouts`) remains the secondary reusable-template tool for creating templates in advance, viewing saved templates, and later reusing them from Calendar; it is not a prerequisite for Calendar scheduling.
- Full workout creation on mobile is not required.
- **Partial failure / retry:** `POST /api/v1/workouts` and `POST /api/v1/scheduled-workouts` are separate operations and are not atomic together. If Workout creation succeeds but scheduling fails, frontend preserves the created `workout.id`, selected date, selected Athletes, and builder state; reports “Workout was created, but it was not assigned”; and offers an explicit retry-assignment action. Retry calls only `POST /api/v1/scheduled-workouts` with the existing `workout.id`, never `POST /api/v1/workouts` again. Frontend must not blindly auto-retry after an ambiguous network failure: scheduled-workouts has no idempotency key and duplicate scheduling is structurally possible, so Coach explicitly retries after reviewing current Calendar state.
- **Prescription and programming scope:** V0.1 supports the planned-set semantics defined below: ordered planned positions, a uniform shorthand/default, individual overrides, planned reps or text prescription, planned load with one unit per WorkoutExercise, and planned RPE. Template authoring stores defaults plus sparse overrides; scheduling stores fully resolved frozen planned-set rows; normal SetLogs explicitly associate with a frozen planned set. Percentages, velocity, tempo, rest prescription, supersets, circuits, arbitrary custom properties, Programs, Calendar hierarchy, Parent Calendar, nested calendars, groups, team hierarchy, and enterprise scheduling architecture remain deferred.
- **Backend implementation is unchanged by this framing**: the Calendar composes existing `GET /api/v1/exercises?q=`, `POST /api/v1/workouts`, and `POST /api/v1/scheduled-workouts`; it is not a new domain object or transactional endpoint (see `go-backend-api-contract-v0.1.md` §7.5). Future one-off scheduled Workouts, a “Save as template” toggle, and ephemeral prescriptions are explicitly deferred.

### **V0.1 planned-set prescription and Builder behavior**

The product semantics and architecture are approved. Exact physical migration code remains pending implementation; canonical wire and conceptual schema shapes live in the API and database documents. No desktop matrix or mobile card layout is required.

The Calendar remains the primary Coach programming workspace:

```
Calendar
→ select date
→ select Athlete(s)
→ Build Workout
→ add Exercises
→ define Sets
→ define uniform prescription and optional per-set overrides
→ Build & Assign
```

Workout Library remains the secondary reusable-template workflow. This behavior must not be moved out of Calendar.

For each prescribed exercise:

1. The Coach chooses the number of sets first.
2. `Sets = N` establishes exactly `N` effective planned set positions, ordered `1..N`.
3. The default editing mode is **FAST / UNIFORM**: one reps value, one load plus unit, and one RPE value may each apply to all `N` positions. The Coach is not required to type `N` repeated values for a uniform prescription.
4. Each uniform value is an exercise-level **default** for its own property. A planned position without an explicit override for that property **inherits** the current default.
5. The Coach may then enter a per-set customization mode and override an individual property for an individual planned position. Overrides are property-specific, not an all-or-nothing set object. V0.1 has only two states for an overrideable property: inherited or explicit value; it does not support an explicit "no target" override.
6. When the Coach begins editing an inherited property on a position, the control is prefilled with that position's current **effective** value, not left blank. Changing that value creates an explicit override.
7. Changing a default updates every position still inheriting that property; existing explicit overrides remain unchanged. Clearing an individual override returns that property to inheriting the current default. The exact clear-control UI is not specified.

Case 1 — fully uniform:

```
Back Squat
Sets: 5
Reps: 10
Load: 80 kg
RPE: 8
```

is semantically equivalent to:

```
Set 1: 10 reps / 80 kg / RPE 8
Set 2: 10 reps / 80 kg / RPE 8
Set 3: 10 reps / 80 kg / RPE 8
Set 4: 10 reps / 80 kg / RPE 8
Set 5: 10 reps / 80 kg / RPE 8
```

Case 2 — reps overrides:

```
Default reps: 10
Set 4 reps override: 8
Set 5 reps override: 6

Effective reps: 10 / 10 / 10 / 8 / 6
```

Case 3 — independent property overrides:

```
Defaults:
Reps: 10
Load: 80 kg
RPE: 8

Set 3 reps override: 8
Set 5 load override: 90 kg
Set 5 RPE override: 9

Effective:
Set 1: 10 reps / 80 kg / RPE 8
Set 2: 10 reps / 80 kg / RPE 8
Set 3:  8 reps / 80 kg / RPE 8
Set 4: 10 reps / 80 kg / RPE 8
Set 5: 10 reps / 90 kg / RPE 9
```

Case 4 — changing a default preserves overrides:

```
Initial default reps: 10
Set 3 reps override: 8

Coach changes default reps to 12.

Effective reps: 12 / 12 / 8 / 12 / 12
```

Case 5 — clearing an override:

```
Default reps: 12
Set 3 reps override: 8

Coach clears the Set 3 reps override.

Effective Set 3 reps: 12 inherited
```

#### **Canonical invariants**

- **Cardinality and ordering:** an exercise prescribed for `N` sets has exactly `N` effective planned positions, each with a stable ordinal `1..N`. Planned-set position is distinct from exercise order inside a Workout.
- **Authoring model:** a Coach authors exercise-level defaults plus sparse, property-specific overrides. A default, inherited value, and explicit override are distinct authoring states even when they currently resolve to the same visible value.
- **Uniform shorthand and inheritance:** defaults are semantically applied to every planned position that has no override for that property. Uniform work therefore needs one entry per default, not N repeated entries.
- **Per-set override:** an individual position may independently override its reps or text instruction, numeric load, and/or RPE. Changing default reps must not affect a position with a reps override; it may still inherit load and RPE. V0.1 does not support an explicit-none override: clearing an override always resumes inheritance.
- **Edit prefill and clear:** opening an inherited property for editing begins with its effective value. Editing creates an override; clearing that override restores inheritance from the current default.
- **Effective prescription:** at save/build and at scheduling, every planned position has a deterministic resolved effective value where applicable. Defaults and sparse overrides are authoring semantics; the effective plan is the resolved prescription used for snapshot and execution.
- **Text prescriptions:** an effective position may use the existing text/non-numeric prescription capability (for example `AMAP`, `30 sec`, or `10–12`) instead of numeric reps. For example, a default note of `AMAP` produces `N` positions that inherit `AMAP` until a position explicitly overrides its note. This preserves current prescription expressiveness; it does not by itself add time/distance actual logging.
- **Load:** prescribed load is planned data, separate from actual load. Each WorkoutExercise has at most one planned load unit (`kg` or `lb`), shared by its default load and all numeric per-position load overrides. Mixed planned units inside one WorkoutExercise are not supported in V0.1. Changing the planned unit changes the unit for every effective planned load in that template exercise; the system performs no numeric conversion. Actual SetLog load/unit remain independent actual facts.
- **Planned versus actual:** an actual SetLog records what happened and never overwrites its plan. A normal SetLog explicitly associates with the corresponding frozen planned-set row; `setNumber` remains the server-assigned actual logging chronology and is not the association key.
- **Snapshot:** scheduling freezes the fully effective planned prescription for every position. Later edits to a reusable Workout template must not alter an already ScheduledWorkout.
- **Multi-athlete snapshot:** one Workout template and one batch scheduling request still create independent frozen ScheduledWorkout snapshots for every selected Athlete.
- **Athlete execution:** Athlete-facing execution shows the frozen effective target for each planned position. Whether a value originated as a default, inheritance, or override is a Coach authoring concern and is not required in the Athlete view.
- **Extra and incomplete work:** V0.1 allows extra actual SetLogs with no planned-set association. Review identifies them as EXTRA and shows no planned target. Planned positions with no SetLog remain incomplete; V0.1 does not persist explicit skipped rows.

Example — planned versus actual:

```
Planned Set 4: 8 reps / 85 kg / RPE 8
Actual Set 4:  7 reps / 85 kg / RPE 9
```

Both values must remain independently representable and understandable during execution and review.

V0.1 uses a hybrid representation: Workout templates store exercise defaults plus sparse position overrides, while ScheduledWorkout snapshots store fully resolved planned-set rows. The controlled pilot updates the existing `/api/v1` contract and frontend/backend together; it does not introduce `/api/v2`, dual-read, or dual-write compatibility layers.

---

# **Story 2 — Coach Runs a Live 1:1 Session** (`/session/[id]`)

## **Given**

A Coach has a ScheduledWorkout for a connected Athlete, and is physically training with that Athlete (in-person 1:1 coaching).

## **When**

The Coach opens the Athlete's scheduled workout — from the Calendar, or from the Athlete's Today view if viewed on the Coach's own device — and starts or resumes the WorkoutSession.

## **Then**

The Coach can log SetLogs on the Athlete's behalf for the duration of the session, using the same Training Session UI/domain the Athlete would use to log their own sets.

## **Acceptance Criteria**

- A connected Coach can start a WorkoutSession for an Athlete's ScheduledWorkout; reopening an already-`ACTIVE` session resumes it rather than erroring (idempotent, matching the backend contract).
- A connected Coach can log, edit, and delete SetLogs for an active session on the Athlete's behalf.
- Each SetLog records which user logged it (`loggedByUserId`) — Coach or Athlete.
- Coach and Athlete see the same session state if both are viewing it.
- Once the session is `COMPLETED`, it is read-only for both Coach and Athlete.
- **No new backend endpoint is required.** This story exercises existing session/set-log authorization: a connected Coach has the same access as the Athlete themself (see the API contract's authorization matrix, §4).

---

# **Story 3 — Athlete Sees Today’s Workout** (`/today`)

## **Given**

Kevin is authenticated as an Athlete.

Kevin has a workout scheduled for today.

## **When**

Kevin opens the mobile/PWA training interface. The view defaults to the Athlete's local current date, which remains the highest-priority view. Kevin may use lightweight previous/next day navigation to inspect a ScheduledWorkout that the Coach has already assigned for another nearby date, especially an upcoming workout scheduled in advance.

## **Then**

Kevin sees today’s workout.

Example:

```
TODAY

Monday Lower

Back Squat
4 × 5
Target RPE 8

[Start Workout]
```

## **Acceptance Criteria**

- Athlete lands on the local current date by default.
- Athlete can move to the previous or next date and return to Today.
- If the Coach schedules a workout for tomorrow, the Athlete can navigate to tomorrow and see that exact ScheduledWorkout.
- Empty-state wording reflects the selected date: Today uses "No Workout Today"; another date uses "No Workout Scheduled".
- Athlete sees only workouts scheduled to them; date navigation does not change Athlete isolation.
- Athlete does not see another athlete’s workouts.
- Today’s scheduled workout appears prominently.
- Athlete can open the workout.
- Athlete can start the workout session.
- Mobile UI prioritizes today’s training over secondary features.
- No new backend endpoint or Calendar domain object is introduced for date navigation.

---

# **Story 4 — Coach or Athlete Manually Logs a Set** (`/session/[id]`)

## **Given**

An active WorkoutSession exists.

The current exercise is:

```
Back Squat
```

The user may be:

- The Athlete performing the workout
- The Coach recording the Athlete’s workout during a live session

## **When**

The user manually enters:

```
Load: 100 kg
Reps: 5
RPE: 7
```

and saves the set.

## **Then**

The system creates a SetLog associated with:

- Correct athlete
- Correct WorkoutSession
- Correct exercise
- The selected frozen planned-set position for normal work, or the explicit EXTRA concept
- User who recorded the set

Example:

```json
{
  "kind": "PLANNED",
  "scheduledWorkoutPlannedSetId": "...",
  "plannedPosition": 1,
  "setNumber": 1,
  "load": 100,
  "unit": "kg",
  "reps": 5,
  "rpe": 7,
  "loggedByUserId": "..."
}
```

## **Acceptance Criteria**

- Athlete can manually record their own set.
- Coach can manually record a set for a connected athlete.
- SetLog belongs to the correct WorkoutSession.
- SetLog belongs to the correct exercise.
- A normal SetLog belongs to the selected frozen planned set; an EXTRA SetLog has no planned target.
- `setNumber` is server-assigned actual chronology, not the planned-set association.
- `loggedByUserId` is recorded.
- Set persists after refresh.
- Invalid values are rejected.
- Unrelated users cannot modify the session.

---

# **Story 5 — Coach or Athlete Logs a Set by Voice**

## **Given**

An active WorkoutSession exists.

The active exercise is Back Squat.

The current user may be either:

- Athlete
- Coach currently coaching that athlete

## **When**

The user presses the microphone button and says:

```
「第一組一百公斤五下，RPE 七。」
```

or:

```
「Kevin 深蹲一百公斤五下，RPE 七。」
```

> V0.1 voice commands always apply to the **currently active session + active exercise**. Athlete or exercise names spoken in the sentence are treated as natural-language redundancy only; V0.1 does **not** perform name-to-entity resolution.
> 

## **Then**

The system:

1. Records the audio.
2. Converts audio to text.
3. Converts the transcript into a structured command.
4. Validates the command.
5. Creates the SetLog only after validation succeeds.

Target structured command:

```json
{
  "action": "CREATE_SET_LOG",
  "load": 100,
  "unit": "kg",
  "reps": 5,
  "rpe": 7
}
```

The UI then displays:

```
Set 1
100 kg × 5
RPE 7
```

## **Acceptance Criteria**

- User can start and stop voice recording.
- Audio is converted into a transcript.
- Transcript is converted into structured JSON.
- LLM never writes directly to the database.
- Structured output passes schema validation.
- Business authorization is checked before persistence.
- Parsed result is visible to the user.
- User can manually correct incorrect parsing.
- Coach and Athlete use the same SetLog domain model.
- Voice logging produces the same final data shape as manual logging.

---

# **Story 6 — Voice Correction**

## **Given**

The latest SetLog in the active exercise is:

```
Back Squat

Set 1
100 kg × 5
RPE 7
```

## **When**

The user says:

```
「剛剛不是一百，是一百零五。」
```

## **Then**

The system generates a structured correction command:

```json
{
  "action": "UPDATE_PREVIOUS_SET",
  "changes": {
    "load": 105
  }
}
```

After validation, the SetLog becomes:

```
Set 1
105 kg × 5
RPE 7
```

The existing reps and RPE remain unchanged.

---

## **Delete Previous Set**

### **Given**

A valid previous SetLog exists in the current active WorkoutSession.

### **When**

The user says:

```
「刪掉上一組。」
```

## **Then**

The application identifies the most recent valid SetLog within the current workout context and requests its removal.

## **Acceptance Criteria**

- User can correct the previous set’s load.
- User can correct reps or RPE when explicitly stated.
- Existing fields remain unchanged when they are not mentioned.
- User can delete the previous set.
- Correction passes validation before database mutation.
- Correction applies only to the active athlete/session/exercise context.
- AI cannot arbitrarily modify unrelated historical records.

---

# **Story 7 — Coach Reviews Completed Training** (`/coach/calendar` → `/session/[id]`)

## **Given**

Kevin has completed at least one set in a WorkoutSession.

## **When**

The Coach opens Kevin’s completed workout from the web interface.

## **Then**

The Coach sees the planned prescription and actual performance.

Example:

```
Back Squat

Plan
4 × 5 @ RPE 8

Actual
Set 1   100 × 5   RPE 7
Set 2   105 × 5   RPE 8
Set 3   105 × 5   RPE 8
Set 4   110 × 4   RPE 9
```

## **Acceptance Criteria**

- Coach can see completed athlete training.
- Results belong to the correct athlete.
- Results belong to the correct WorkoutSession.
- Coach can distinguish planned vs actual performance.
- Athlete cannot access another athlete’s history.

---

# **3. MVP End-to-End Acceptance Test**

## **3.1 Core Loop Acceptance — Required for V0.1**

The MVP core loop is complete when this exact scenario works:

1. Coach logs in on the web interface.
2. From the Calendar (`/coach/calendar`), Coach selects today's date and creates `Monday Lower` (`Back Squat — 4 × 5 @ RPE 8`).
3. Coach assigns `Monday Lower` to Kevin for today, directly from the Calendar.
4. Kevin logs in on mobile/PWA.
5. Kevin sees `Monday Lower` on `/today`.
6. Kevin starts the WorkoutSession.
7. Kevin manually records at least one SetLog.
8. Data persists after refresh.
9. Coach opens Kevin's session from the Calendar.
10. Coach sees Kevin's recorded results and planned prescription.

If this core flow does not work end-to-end, V0.1 is not complete.

Steps 2–3 are two backend operations (`POST /workouts`, then `POST /scheduled-workouts`) presented as one Calendar-driven flow — see Story 1. No backend behavior changes because of this framing.

## **3.2 Voice Acceptance — Optional Stretch**

Voice is an optional MVP experiment and must not block shipment of the core loop.

Stretch acceptance:

1. During an active session and active exercise, the user records a SetLog by voice.
2. The parsed command contains training data only; application context supplies the active `scheduledWorkoutExerciseId` and selected `scheduledWorkoutPlannedSetId`, or explicitly chooses EXTRA, before calling the backend SetLog endpoint.
3. The user can correct the most recent SetLog by voice.
4. Invalid or ambiguous voice output does not mutate persistent data.

If Story 5/6 is not complete by the V0.1 deadline, it moves to the next iteration without changing V0.1 completion status.

---

# **4. Future Video Flow — Not Required for Core MVP**

Video is intentionally separated from the first core loop.

Future relationship:

```
WorkoutSession
      ↓
SetLog
      ↓
VideoAsset
      ↓
Object Storage
      ↓
AIReview
```

A future VideoAsset may contain:

```
id
set_log_id
object_key
mime_type
size_bytes
status
created_at
```

The actual video binary will be stored in object storage rather than the relational database.

Future AI review flow:

```
Video
↓
AI Review
↓
Coach

[Accept]
[Edit]
[Reject]
```

Video AI is not required for V0.1 launch.

---

# **5. Out of Scope**

The MVP does not include:

- Full workout programming on mobile
- Nutrition tracking
- Meal planning
- Payments
- Subscriptions
- Messaging/chat
- Feed
- Leaderboards
- Wearables
- Apple Health
- Garmin integration
- Readiness scores
- Team management
- Organization management
- Advanced periodization
- Complex templates
- AI-generated workouts
- Custom ML model training
- Advanced biomechanics analysis
- Native iOS application
- Native Android application

---

# **6. MVP Product Principle**

When evaluating a new feature, ask:

**Does this help complete or reduce friction in the Coach → Schedule → Athlete → Train → Log → Review loop?**

If the answer is no, it does not belong in V0.1.

During live training:

**The coach should spend as little time as possible operating the software.**

Voice is an input method into the existing training domain model, not a separate training system.

[DontWorkout — Go Backend API Contract (V0.1)](https://app.notion.com/p/DontWorkout-Go-Backend-API-Contract-V0-1-3ba6d86864ae815d8ec1df000119a02c?pvs=21)

[DontWorkout — Database Schema & Relationships](https://app.notion.com/p/DontWorkout-Database-Schema-Relationships-3bb6d86864ae81379417e4a43fcef7b9?pvs=21)
