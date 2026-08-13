# DontWorkout — MVP Specification

Status: V0.1

Target: 2026-08-16

Source of truth: `docs/PRODUCT.md`

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

**Calendar (`/coach/calendar`) is the Coach's primary workspace on Web/Desktop.** Workout creation, workout scheduling, and reviewing completed training all happen from the Calendar. Client management (`/coach/clients`) and the workout library (`/coach/workouts`) are secondary tools reached from it, not separate primary destinations. There is no Coach dashboard as a landing page.

Route/navigation detail lives in `docs/frontend-ui-spec.md`; this document defines product behavior only.

---

## **Deferred — Not Yet Specified: Client Invite / Onboarding**

> **Status: mechanism undecided. Not implemented. This section exists to make the gap explicit, not to describe a solved feature.**
> 

The Coach's first step is conceptually "invite or create a Client," but V0.1 has no signup or invite flow. `CoachAthlete` relationships and Athlete accounts are currently created by manual seed only (see `go-backend-api-contract-v0.1.md` §3.4). `/coach/clients` in V0.1 can only *list* already-connected athletes (`GET /athletes`) — it cannot create the relationship.

Before this can ship, the following need a product decision (out of scope for this document to resolve):

- How does a Coach add a new Client — invite link, email, manual creation, code?
- Does the Athlete need to accept, or is the relationship coach-created unilaterally?
- Does an Athlete account get created at invite time, or only at first login?

Do not treat `/coach/clients` as feature-complete until this is resolved.

---

# **Story 1 — Coach Builds and Assigns a Workout from the Calendar** (`/coach/calendar`)

## **Given**

A user is authenticated as a Coach and is using the web interface. The Coach's primary workspace is the Calendar.

## **When**

The Coach selects a date on the Calendar, then either creates a new workout or selects an existing one from the workout library, and assigns it to one or more connected athletes.

Example:

```
Calendar → 2026-08-14

Create Workout: Monday Lower
  Back Squat
  4 × 5
  Target RPE 8

Assign to: Kevin
```

## **Then**

Two things are persisted, in order:

1. If a new workout was created, it is persisted as a `Workout` template and also appears in the Coach's workout library (`/coach/workouts`).
2. The workout is scheduled to each selected athlete on the chosen date as a `ScheduledWorkout`, and appears on the Calendar for that date.

Refreshing the page does not remove the workout or the schedule.

## **Acceptance Criteria**

- Coach can reach workout creation/selection from a date on the Calendar.
- Coach can enter workout name, at least one exercise, target sets, and target reps or a text prescription (e.g. `AMAP`), with optional target RPE.
- Coach can select one or more connected athletes and confirm the date.
- Workout persists in the workout library after refresh.
- ScheduledWorkout persists on the Calendar after refresh.
- Workout belongs to the Coach who created it.
- Coach cannot schedule a workout to an unrelated (unconnected) athlete.
- Athlete cannot create, edit, or schedule Coach workouts.
- The workout library (`/coach/workouts`) remains available as a secondary tool for reusing an existing workout without starting from the Calendar.
- Full workout creation on mobile is not required.
- **Backend implementation is unchanged by this framing**: workout creation (`POST /workouts`) and scheduling (`POST /scheduled-workouts`) remain two separate operations. The Calendar is a frontend flow over both — not a new domain object (see `go-backend-api-contract-v0.1.md` §7.5).

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

Kevin opens the mobile/PWA training interface.

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

- Athlete sees workouts scheduled to them.
- Athlete does not see another athlete’s workouts.
- Today’s scheduled workout appears prominently.
- Athlete can open the workout.
- Athlete can start the workout session.
- Mobile UI prioritizes today’s training over secondary features.

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
- User who recorded the set

Example:

```json
{
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
2. The parsed command contains training data only; application context supplies the active `scheduledWorkoutExerciseId` before calling the backend SetLog endpoint.
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