# Task: Voice B2 — Post-session catch-up logging by voice

- Date opened: 2026-09-10
- Related contract sections: AGENTS.md §3 (MVP Scope), §4 (Architecture Boundaries), §5 (Prescription vs Actual), §6 (API Contract Discipline), §16 (AI/LLM Safety Contract); `docs/go-backend-api-contract-v0.1.md` §3.5 (`PUT /scheduled-workouts/{id}`), §3.8 (SetLog write path), §3.9 (Voice Command)
- Size (S/M/L/XL, per AGENTS.md §7): **L**
- Status: **Draft — awaiting approval. Not implemented.**

## 0. What this is not

B2 is the coach at the end of the day saying what actually happened, because during training nobody touched the phone.

> 「我今天剛做了三組四下的臥推，然後兩組四下一百公斤的深蹲。」

B2 is **not**:

- **Story 5 / Story 6, or API contract §3.9.** Those describe one utterance landing on one already-selected planned set. B2 has no selected card, covers several exercises at once, and must work out what each one was.
- **B1 (`2026-09-10-voice-b1-live-setlog.md`).** B1 is push-to-talk mid-set with the target card visible on screen. The two features share no prompt, no schema and no write path. Reusing B1's prompt here would leave it with no exercise to attach to; reusing B2's prompt in B1 would make it start guessing between bench and squat while the coach is standing at the rack. **The B2 model and prompt must never be used for B1.**
- AI-generated programming. The model records what was said and nothing else. A bench press spoken without a weight ends up with an empty weight field. See §1 "Red line".
- Continuous listening, superset and circuit handling, rest timers, logging for several athletes at once, or a follow-up voice correction conversation. All explicitly out of scope for v1. Mistakes are fixed by hand on the draft.
- A new write path. Persistence goes through `PUT /api/v1/scheduled-workouts/{id}`, `POST /api/v1/scheduled-workouts/{id}/session` and `POST /api/v1/sessions/{id}/set-logs`, all unchanged.

Shared with B1: the recorder, speech-to-text, the `voice` entitlement, the strict-decode discipline and the show-the-transcript failure path. Nothing else.

---

## 1. Feasibility Analysis

### Problem / trigger

B1 assumes the coach operates the app during training. Many coaches will not, and the ones who most need the product are the ones whose hands are busiest. Today their only option is to sit down afterwards and type an entire session into the calendar builder, which is slow enough that the session simply never gets recorded. An unrecorded session breaks the core loop at its last step: the coach has nothing to review.

B2 addresses that directly, and by the test in `docs/mvp-specification.md` §6 it qualifies: it reduces friction in `Coach → Schedule → Athlete → Train → Log → Review`. It does not add a new training concept.

### Red line (AGENTS.md §3)

`AI-generated workouts` is out of scope in AGENTS.md §3 and spec §5. B2 sits closer to that line than B1 does, because B2 produces whole exercises rather than single numbers. The line is held by one rule:

> The model may only emit values the coach actually spoke. A prescription the coach did not state is `null` and reaches the coach as an empty field. The model must never fill a weight from the athlete's history, from the previous session, from a template, or from training convention.

In the worked example, 「三組四下的臥推」 yields three sets of four reps with **no load**. That empty field is the feature behaving correctly, not a defect.

### Market positioning (brief)

Solo-lifter voice diaries (SLAB, SayLift, Liftly, RepTalk, RepLog — the last with Traditional Chinese and TWD pricing) already parse "bench 100 for 5". They all require the exercise name in the sentence and they all write straight to a personal log. Coach platforms (TeamBuildr, TrainHeroic, TrueCoach) do not attempt structured voice logging at all; Strong and Hevy optimise tapping instead. Forge listens continuously and identifies exercises unaided.

Our wedge is the stopping point. B2 does resolve exercise names, but it stops at a **draft the coach confirms**, against a library the coach already owns and against a session that was already scheduled. Competitors resolve names into a write; we resolve names into a review screen. That is what makes name resolution acceptable for a coach recording someone else's training, where a wrong guess is not just a wrong personal note but wrong data about a client.

### The constraint that shapes everything

Three facts in the current contract, taken together, determine the design:

1. `POST /sessions/{id}/set-logs` requires the session to be `ACTIVE`. A `COMPLETED` session returns 409 and is permanently read-only (contract §3.8).
2. `PUT /scheduled-workouts/{id}` is allowed **only while no `workout_sessions` row exists**. Once a session has been started, the snapshot is permanently read-only (contract §3.5).
3. `set_logs.scheduled_workout_exercise_id` is NOT NULL and must belong to the session's scheduled workout. Even an `EXTRA` log needs one. An exercise that is not in the snapshot cannot be logged at all.

So the only window in which the coach can both *reconcile the plan with what really happened* and *log actuals* is **before a session has been started**. That window is also the realistic one: a coach who never opened the app during training never pressed Start, so no session row exists.

### Options considered

1. **Voice creates the Workout and SetLogs directly.** Model output leads to writes.
2. **Voice fills a draft; the coach confirms; the existing endpoints are then called in the existing order.**
3. **Continuous listening throughout the session**, transcribing in the background.

### Trade-offs

| | Option 1 (direct write) | Option 2 (draft, confirm) | Option 3 (continuous) |
| --- | --- | --- | --- |
| AGENTS.md §16 compliance | Violates it — model output reaches persistence | Satisfied by construction | Would still need Option 2's confirmation step |
| Chinese numeral errors | Land in the database silently | Caught by a human before any write | Land in the database, worse — more of them |
| Wrong exercise match | Silently creates a junk library entry (see Risks) | Shown as unresolved, coach picks | Same as Option 1 |
| New UI required | Almost none | A draft review screen | A draft review screen plus session-long capture |
| Battery, privacy, cost | Low | Low | High on all three |
| Fits current API window | No — needs writes after the fact | Yes, no contract change | No |

### Selected option and why

**Option 2.**

Option 1 is not merely riskier, it is forbidden: AGENTS.md §16 requires that model output pass through validation and business logic and never own a write path. More concretely, `PUT /scheduled-workouts/{id}` accepts `exercises[].name` and the Go service resolves it with `exercise.FindOrCreateVisible` (`apps/api/internal/exercise/exercise.go:148`), which **creates a private exercise when the name does not match**. Passing an unconfirmed transcription straight through would let one mis-heard word permanently add 「背推」 to that coach's library, with no undo route in the product. The confirmation step is what stands between speech-to-text error and library corruption.

Option 3 is out of scope by an explicit product decision and is not revisited here.

### Scope decision: which session does a catch-up target?

Per the constraint above, **v1 targets a `ScheduledWorkout` for that athlete and date that has no `workout_sessions` row yet.** One branch, not two.

- A `COMPLETED` session is out of scope. Writing to one requires relaxing the read-only rule in contract §3.8, which is a real contract change and a separate decision.
- An already-`ACTIVE` session is also out of scope for v1. Its snapshot is already frozen, so the plan can no longer be reconciled with what happened, and B2 would degrade into "log actuals against a plan that may not match" — a different and smaller feature.
- A day with **no** scheduled workout at all is out of scope for v1. It would require creating a reusable `Workout` template from speech, which is much closer to the AI-generated-workouts red line and deserves its own evaluation.

Entry point: the coach opens an athlete's day in the calendar that has a scheduled workout and no session, and chooses catch-up. The precondition is visible before the coach speaks, exactly as B1's focused card is.

### Risks & unknowns

| Risk | Assessment |
| --- | --- |
| **Silent exercise-library pollution.** `FindOrCreateVisible` creates on miss, and the product has no delete-exercise route. | The central risk. Mitigated by resolving names client-side against `GET /api/v1/exercises?q=` and requiring explicit coach confirmation before any name is submitted. Creating a new exercise must be a deliberate tap, reusing `createOrResolveExercise` from `apps/web/app/coach/calendar/exercise-creation.ts`. |
| **Multi-step commit with no transaction.** Confirming a draft performs `PUT` snapshot, then start session, then N set-log writes, then optionally complete. A failure midway leaves a partially applied catch-up. | No single-request equivalent exists and inventing one is a contract change. Mitigation: keep the draft after submit, mark each row applied as it succeeds, and make retry resume from the first unapplied row. Starting a session is already resume-idempotent (§3.5). Document the limitation rather than hide it; revisit only if it bites in practice. |
| **Plan-versus-actual honesty.** A catch-up writes planned sets that mirror what was reported, then logs actuals equal to them. AGENTS.md §5 requires prescription and actual to stay distinct. | Accepted with eyes open. For a session nobody planned in detail, what was done *is* the best available record of what was prescribed, and both rows still exist independently so later edits cannot rewrite history. The alternative — log everything as `EXTRA` — was rejected because `scheduled_workout_exercises.target_sets` is NOT NULL with a `reps or note` check, so a zero-planned-set exercise cannot be created; `EXTRA` logs would still need a snapshot exercise to hang from. |
| **Chinese numerals and mixed script.** Same underlying risk as B1, but multiplied by the number of exercises in one utterance. | Confirmation is mandatory, never optional. The draft screen shows every parsed number next to the transcript. |
| **Reps are mandatory server-side.** `reps` is NOT NULL (contract §3.8), and a planned set needs `reps` or `prescriptionNote`. 「三組臥推」 with no rep count cannot be submitted. | Design rule: a set missing reps is marked incomplete and blocks submission of that exercise until the coach types it. This is the same posture as an unresolved name — a normal state, not an error. |
| **Long utterance, long output.** Several exercises in one breath produces a larger structured response than B1 ever does. | Cap the number of exercises per utterance (suggest 8) and reject beyond it with the transcript shown, rather than truncating silently. |
| **Model provider undecided.** No AI SDK in `go.mod` or `package.json` today. | Decided in B1 sub-task 2 and reused. The prompt and schema are separate; the provider is shared. |

### Dependencies / blockers

1. **B1 sub-tasks 1, 2 and 5 should land first.** The recorder, the speech-to-text step, the entitlement gate and the strict-decode convention are shared. B2 duplicating them would guarantee drift. B2 is otherwise independent of B1's session-page work.
2. **Voice entitlement** is one entitlement covering both features, decided in B1 §2. B2 adds no second paid item.
3. **Documentation drift, blocking nothing.** AGENTS.md §5 still describes `ScheduledWorkoutPlannedSet` and `WorkoutExerciseSetOverride` as "approved but not yet implemented", while `migrations/0002_planned_set_prescription.up.sql` created both and the Go services read them. B2 writes planned sets, so the wording should be corrected. Two lines; noted in B1 as riding along with its first sub-task.

---

## 2. Technical Design

### Affected files/components

| Path | Change |
| --- | --- |
| `apps/web/app/coach/calendar/catchup-draft.ts` | **New.** Catch-up draft type, reducer, localStorage persistence |
| `apps/web/app/coach/calendar/catchup-resolution.ts` | **New.** Name resolution against the library, pure and unit-testable |
| `apps/web/app/coach/calendar/catchup-submit.ts` | **New.** Ordered commit sequence with per-row applied state |
| `apps/web/app/coach/calendar/page.tsx` | Catch-up entry point on an eligible day |
| `apps/web/app/coach/calendar/catchup-review.tsx` | **New.** Draft review screen |
| `apps/web/app/api/voice/session-catchup/route.ts` | **New.** Speech-to-text plus B2 parse, strict validation, entitlement check |
| `apps/web/lib/voice/session-catchup-schema.ts` | **New.** B2 schema and strict validator, separate from B1's |

No Go changes. No migration. No API contract change.

### Data flow

```
Coach opens an athlete's day that has a ScheduledWorkout and no session
  → records one utterance
  → POST /api/voice/session-catchup   (multipart: audio only, no session context)
      → verify caller via GET /api/v1/me, check the voice entitlement
      → speech-to-text                       → transcript
      → LLM with the B2 prompt                → candidate JSON
      → strict validation (unknown field ⇒ reject, any *id key ⇒ reject)
  → client builds a CatchUpDraft
  → for each spoken exercise name: GET /api/v1/exercises?q=<name>
        exactly one match   → resolved, prefilled
        several matches     → unresolved, coach picks from the candidates
        no match            → unresolved, coach may create via createOrResolveExercise
  → coach reviews the draft: names, sets, reps, load, RPE; fixes anything by hand
  → coach confirms
      → PUT  /api/v1/scheduled-workouts/{id}          (reconcile the snapshot)
      → POST /api/v1/scheduled-workouts/{id}/session  (start; resume-idempotent)
      → POST /api/v1/sessions/{id}/set-logs           (once per set, in order)
      → POST /api/v1/sessions/{id}/complete           (optional, coach's choice)
```

Nothing is written until the coach confirms. The model's output reaches a draft object and a review screen, never PostgreSQL, which is what AGENTS.md §16 requires.

### Which existing draft type the output targets

**The prescription half reuses `DraftExercise` from `apps/web/app/coach/calendar/workout-draft.ts`. The actuals half is new.**

That split is deliberate and worth stating plainly, because "reuse the existing draft" is only half true:

- `DraftExercise` already carries `exercise: {id, name, scope}`, `setCount`, `prescriptionMode`, the `default*` fields, `unit` and sparse `overrides`. That is exactly the shape `PUT /scheduled-workouts/{id}` expects (`exercises[].name` plus `plan.setCount` / `plan.defaults` / `plan.overrides`), and it is string-typed for form editing, which is what a review screen needs. Reusing it means the catch-up review screen and the calendar builder agree on what an exercise plan is, and the existing `build-transaction.ts` conversion to the API body can be reused rather than reimplemented.
- `WorkoutBuilderDraftContent` as a whole is **not** reused. It is keyed by `(sourceAthleteId, scheduledDate)` for authoring a *new* workout and carries `extraAthleteIds`, `sessionKind` and `editTarget` — assignment concepts a catch-up does not have. A catch-up targets one existing `scheduledWorkoutId` for one athlete.
- Nothing existing represents **actuals as a draft**. `SetLog` is a persisted server shape, not an editable form. So B2 adds `CatchUpActualSet`, a string-typed sibling of the set-log form state in the session page.

```ts
// apps/web/app/coach/calendar/catchup-draft.ts
import type { DraftExercise } from "./workout-draft";

export type CatchUpActualSet = {
  position: number;      // matches the planned position it will be logged against
  reps: string;          // required before submit; empty blocks that exercise
  load: string;          // may stay empty — an unspoken weight is not invented
  rpe: string;           // may stay empty
};

export type CatchUpResolution =
  | { state: "RESOLVED"; exerciseId: string; name: string }
  | { state: "AMBIGUOUS"; spokenName: string; candidates: Exercise[] }
  | { state: "UNMATCHED"; spokenName: string };

export type CatchUpExercise = {
  spokenName: string;            // exactly what was heard, never discarded
  resolution: CatchUpResolution;
  plan: DraftExercise;           // reused prescription shape
  actuals: CatchUpActualSet[];   // one per planned position
  applied: boolean;              // set true as its logs commit, for retry
};

export type CatchUpDraft = {
  version: 1;
  scheduledWorkoutId: string;
  athleteId: string;
  scheduledDate: string;
  transcript: string;            // shown next to the draft throughout review
  exercises: CatchUpExercise[];
  savedAt: string;
};
```

The draft persists to localStorage under the same conventions as `workout-draft.ts` (coach-scoped key, no token, no credential), so a coach who is interrupted mid-review does not lose the utterance.

### Output schema (strict, no identifiers, separate from B1's)

```jsonc
{
  "transcript": "我今天剛做了三組四下的臥推 然後兩組四下一百公斤的深蹲",
  "exercises": [
    {
      "spokenName": "臥推",      // string only — never an id
      "sets": [
        { "reps": 4, "load": null, "unit": null, "rpe": null },
        { "reps": 4, "load": null, "unit": null, "rpe": null },
        { "reps": 4, "load": null, "unit": null, "rpe": null }
      ]
    },
    {
      "spokenName": "深蹲",
      "sets": [
        { "reps": 4, "load": 100, "unit": "kg", "rpe": null },
        { "reps": 4, "load": 100, "unit": "kg", "rpe": null }
      ]
    }
  ]
}

// The model's only permitted way to decline:
{ "transcript": "<whatever was heard>", "exercises": [] }
```

Validator rules, enforced in code and covered by tests rather than merely requested in the prompt:

- **Any key matching `/id$/i`, anywhere, is a validation failure.** The model cannot know a UUID and must not guess one (API contract §3.9 establishes this rule for B1; it applies with more force here).
- Unknown fields are rejected outright — strict decode, as §3.9 requires.
- `spokenName` is a verbatim fragment of the transcript. It is never treated as an exercise identity by the model, only as a search string by the client.
- The model **expands** repetitions into explicit sets: 「三組四下」 becomes three set objects. Set count is never a separate field the model could disagree with itself about.
- `load` and `unit` travel together; `load` present with `unit` null fails validation.
- `null` means unspoken. There is no other meaning, and the prompt says so explicitly.
- `reps` may be `null` in model output; the coach supplies it before submit.
- More than 8 exercises, or more than 20 sets in one exercise, fails validation with the transcript shown.
- No athlete name, no date, no workout name. The target is chosen by the coach in the UI, never by the model.

### Name resolution (the coach decides, always)

For each `spokenName`, in order, the client calls the existing `GET /api/v1/exercises?q=<spokenName>`. `exercise.ListForCoach` already does case-insensitive substring search and orders system before private, then by earlier match position, then by **this coach's own usage count**, then alphabetically. That usage ordering is doing real work here: a coach who programs bench press weekly gets their bench press ranked first for free, with no tags, no embeddings and no similarity model.

| Result | Draft state | UI |
| --- | --- | --- |
| Exactly one visible match | `RESOLVED` | Name shown normally, plan prefilled |
| Several matches | `AMBIGUOUS` | Marked amber, candidate list, coach taps one |
| No match | `UNMATCHED` | Marked amber, coach picks from a full library search or creates a new private exercise through `createOrResolveExercise` |

**Unresolved is a normal state, not an error.** A draft with two resolved exercises and one amber row is a valid, useful screen; only the amber rows block submission. No fuzzy matching, no phonetic matching and no model-side matching in v1 — if the string does not match, a human decides. Once we have real transcripts we can measure whether anything smarter is warranted.

### Commit sequence

Submission is blocked until every exercise is `RESOLVED` and every set has reps. Then:

1. `PUT /api/v1/scheduled-workouts/{id}` with the reconciled snapshot, built from the reused `DraftExercise` plans via the existing calendar conversion. Refused with 409 if a session appeared in the meantime, which is the correct answer — reload and tell the coach.
2. `POST /api/v1/scheduled-workouts/{id}/session` to start. Idempotent resume by contract §3.5.
3. `POST /api/v1/sessions/{id}/set-logs` once per set, in planned-position order, each carrying `kind: "PLANNED"` and the `scheduledWorkoutPlannedSetId` returned by step 1's fresh snapshot. Mark each exercise `applied` as its sets land.
4. `POST /api/v1/sessions/{id}/complete` only if the coach chooses to close the session now.

Steps 1 to 4 are not atomic and cannot be made so without a contract change. On failure the draft survives with its `applied` flags, the coach sees which exercises landed, and retry resumes at the first unapplied row. This limitation is stated in the UI, not buried.

### Entitlement (flag only — no payment design)

Identical to B1 and deliberately not a second product: one `voice` entitlement, checked in the route handler by resolving the caller through `GET /api/v1/me` and consulting the server-side allowlist. The UI hides the catch-up entry point when the entitlement is absent, but the route handler is the gate, because it is what spends money on model calls. Payments, subscription screens and billing integration remain out of scope (AGENTS.md §3).

### Failure modes

| Failure | Detected where | Behaviour |
| --- | --- | --- |
| No audio or silence | Client, before upload | Never call the model. Inline hint |
| Caller not entitled | Route handler | 403, entry point hidden, no model call |
| Speech-to-text empty or noise | Route handler | Return an empty `exercises` array with the transcript |
| Unknown field, an identifier, or an out-of-range value | Strict validator | Reject wholesale, show the transcript, build no draft. Never partially apply |
| Zero exercises parsed | Client | Show the transcript, offer the normal manual builder |
| Exercise name ambiguous or unmatched | Client | Amber row, coach resolves. Not an error |
| Reps missing on a set | Client | That exercise blocks submit until filled |
| A session appeared before submit | Go API, 409 on the `PUT` | Reload the day, explain, keep the draft |
| Any commit step fails midway | Client | Keep the draft with `applied` flags, show what landed, offer resume |
| Provider timeout or error | Route handler | Generic error, transcript shown when one exists, draft untouched |

Every row keeps the same invariant as B1: **nothing is persisted without confirmation, the raw text stays visible, and the draft stays editable by hand.**

### Chinese test utterances (Taiwanese gym speech)

| Utterance | Expected parse | Note |
| --- | --- | --- |
| 「我今天剛做了三組四下的臥推，然後兩組四下一百公斤的深蹲」 | 臥推 ×3 sets, 4 reps, **no load**; 深蹲 ×2 sets, 4 reps, 100 kg | The worked example. The empty bench load is correct behaviour |
| 「bench 一百、五下，做三組」 | spokenName "bench", 3 sets, 100 kg, 5 reps | Mixed script resolves through library search, not through the model |
| 「一百五、五下」 | ambiguous load | Prefill and mark. Never silently choose 150 or 105 |
| 「一百零五公斤，五下」 | load 105 | Chinese zero must not become 1005 |
| 「深蹲一百公斤五下，RPE 七」 | 深蹲, 100 kg, 5 reps, RPE 7 | Full utterance |
| 「這組力竭，八下」 | reps 8, rpe null | 力竭 must not become RPE 10. That is inference |
| 「跟上禮拜一樣」 | zero exercises | Relative reference, out of scope by the red line |
| 「臥推做了三組」 | 臥推, 3 sets, reps null | Blocks submit until the coach types reps. Not an error |
| 「今天 Kevin 練得不錯」 | zero exercises | No numbers, nothing to log |

### Frontend state/UI impact

A catch-up entry point appears on a calendar day that has a scheduled workout and no session, for entitled coaches. The review screen is new. The calendar's existing builder, its draft, and the session page are untouched — B2 adds a parallel flow rather than modifying the authoring path, which keeps the blast radius small and keeps `page.tsx` (already 2195 lines) from growing further.

### Backward compatibility

No persisted shape changes. A coach without the entitlement sees today's calendar exactly. A catch-up produces rows indistinguishable from a manually built and manually logged session, which is the point.

---

## 3. Estimate

- Size: **L**
- Sub-task breakdown (required for L, per AGENTS.md §7). Each is independently verifiable and stays within the 5-file guidance.

1. **Schema and strict validator.** `session-catchup-schema.ts` plus unit tests covering every rule and every utterance in the table above. No UI, no network, no model. *(S)*
2. **Parse route, text input only.** `route.ts` accepting text, B2 prompt, structured output, validation, entitlement gate. Reuses B1's provider. Verified by tests and curl. *(M)*
3. **Draft model and name resolution.** `catchup-draft.ts` and `catchup-resolution.ts`, with the three resolution states, as pure logic under test. *(M)*
4. **Review screen.** `catchup-review.tsx` plus the calendar entry point: transcript alongside the draft, amber unresolved rows, manual editing of every field. *(M)*
5. **Commit sequence.** `catchup-submit.ts`: ordered writes, `applied` tracking, resumable retry, 409 handling. *(M)*
6. **Recording.** Swap the text box for B1's shared recorder. Small, because the recorder already exists. *(S)*

Sub-tasks 1 to 5 deliver the entire feature by typing. Only sub-task 6 involves a microphone. As with B1, if the work stops early nothing is half-built and nothing is wasted.

---

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Task Doc approved | Not Started | Awaiting review. Open decisions in §5 |
| B1 sub-tasks 1, 2, 5 landed | Not Started | Shared recorder, speech-to-text, entitlement |
| 1. Schema + strict validator | Not Started | |
| 2. Parse route (text in), entitlement gate | Not Started | Reuses B1's provider |
| 3. Draft model + name resolution | Not Started | Reuses `DraftExercise`; adds `CatchUpActualSet` |
| 4. Review screen + calendar entry point | Not Started | |
| 5. Commit sequence + resumable retry | Not Started | |
| 6. Recording | Not Started | Reuses B1's recorder |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

---

## 5. Open decisions for the approval review

1. **The not-yet-started-only scope.** §1 rules out completed sessions, already-active sessions and days with nothing scheduled. Confirm that a coach who never opens the app during training genuinely leaves no session row, since the whole design rests on it.
2. **Plan mirroring actual.** Writing planned sets equal to what was reported is the only way to log a catch-up under the current schema. Confirm this is acceptable against AGENTS.md §5, or accept that catch-up is impossible until the contract changes.
3. **Non-atomic commit.** Accept the documented resumable-retry limitation, or treat a single-request catch-up endpoint as a prerequisite contract change (which would be a Go task and a contract revision, not this task).
4. **Creating exercises from a catch-up.** Allow `createOrResolveExercise` inside the review screen, or force unmatched names to be resolved against the existing library only? Allowing creation is proposed, because a coach recording a real session should not be blocked by a missing library entry, but it is the one place B2 can still add rows to the library.
