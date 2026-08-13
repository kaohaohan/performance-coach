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

---

# **Story 1 — Coach Creates a Workout**

## **Given**

A user is authenticated as a Coach and is using the web interface.

## **When**

The Coach creates a workout containing:

- Workout name
- Exercise
- Target sets
- Target reps
- Target RPE

Example:

```
Workout: Monday Lower

Back Squat
4 × 5
Target RPE 8
```

## **Then**

The workout is persisted and appears in the Coach’s workout list.

Refreshing the page does not remove the workout.

## **Acceptance Criteria**

- Coach can create a workout from the web interface.
- Coach can enter workout name.
- Coach can add at least one exercise.
- Exercise can contain target sets, reps, and RPE.
- Target reps may be a number or a text prescription (e.g. `AMAP`).
- Workout persists after page refresh.
- Workout belongs to the Coach who created it.
- Athlete cannot create or edit Coach workouts.
- Full workout creation on mobile is not required.

---

# **Story 2 — Coach Schedules a Workout**

## **Given**

The Coach has:

- An existing workout
- An existing Coach–Athlete relationship

Example:

```
Workout: Monday Lower
Athlete: Kevin
```

## **When**

The Coach selects:

- Workout
- Athlete
- Scheduled training date

and presses **Schedule Workout**.

## **Then**

The system creates a ScheduledWorkout record.

Example:

```
Workout: Monday Lower
Athlete: Kevin
Scheduled Date: 2026-08-13
```

## **Acceptance Criteria**

- Coach can select one existing workout.
- Coach can select one or more athletes.
- Coach can select a training date.
- Scheduled workout persists after refresh.
- Coach cannot schedule a workout to an unrelated athlete.
- UI uses the wording `Schedule Workout`.
- Backend may represent this domain object as `ScheduledWorkout`.

---

# **Story 3 — Athlete Sees Today’s Workout**

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

# **Story 4 — Coach or Athlete Manually Logs a Set**

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

# **Story 7 — Coach Reviews Completed Training**

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
2. Coach creates `Monday Lower`.
3. Coach adds `Back Squat — 4 × 5 @ RPE 8`.
4. Coach schedules the workout to Kevin for today.
5. Kevin logs in on mobile/PWA.
6. Kevin sees `Monday Lower` under Today’s Workout.
7. Kevin starts the WorkoutSession.
8. Kevin manually records at least one SetLog.
9. Data persists after refresh.
10. Coach opens Kevin’s completed session on the web.
11. Coach sees Kevin’s recorded results and planned prescription.

If this core flow does not work end-to-end, V0.1 is not complete.

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