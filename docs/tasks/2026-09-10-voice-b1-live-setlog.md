# Task: Voice B1 — Live SetLog capture during an ACTIVE session

- Date opened: 2026-09-10
- Related contract sections: AGENTS.md §3 (MVP Scope), §4 (Architecture Boundaries), §5 (Prescription vs Actual), §6 (API Contract Discipline), §16 (AI/LLM Safety Contract); `docs/go-backend-api-contract-v0.1.md` §3.8 (SetLog write path), §3.9 (Voice Command); `docs/mvp-specification.md` Story 5/6
- Size (S/M/L/XL, per AGENTS.md §7): **L**
- Status: **Draft — awaiting approval. Not implemented.**

## 0. What this is not

B1 is the coach speaking *while standing next to the athlete*, mid-set, hands busy.

B1 is **not**:

- **B2 (`2026-09-10-voice-b2-session-catchup.md`)** — after-the-fact recall of a whole training session. B2 has no focused card and must resolve exercise names; B1 has a focused card and deliberately ignores exercise names.
- Continuous listening for the whole session (the Forge model). B1 is push-to-talk, one utterance, one result.
- AI-generated programming. The model never invents a prescription, a load, or a rep count that was not spoken. See §1 "Red line".
- A new SetLog write path. All persistence goes through the existing `POST /api/v1/sessions/{id}/set-logs`, `PATCH /api/v1/set-logs/{id}`, `DELETE /api/v1/set-logs/{id}`.
- Name-to-entity resolution. Exercise names and athlete names inside the sentence are natural-language redundancy and are discarded, per API contract §3.9.

B1 and B2 share the microphone, the speech-to-text step, the voice entitlement check, the strict schema validator, and the "show the raw transcript on failure" behaviour. They share **nothing else**: separate prompts, separate output schemas, separate parse routes, separate write paths. A B2-shaped prompt used in B1 would start guessing which exercise the coach meant, which is exactly the failure B1 is designed to make impossible.

---

## 1. Feasibility Analysis

### Problem / trigger

During live training the coach's hands are on the athlete, on a barbell, or on a clipboard. Manual SetLog entry (`apps/web/app/session/[id]/page.tsx`) requires focusing a card, typing load, typing reps, typing RPE, and tapping **Log Set**. `docs/mvp-specification.md` §6 already states the principle this violates:

> During live training: the coach should spend as little time as possible operating the software.

The core loop is stable — scheduling, planned-set snapshots, sessions and SetLog writes are all shipped and in use — which is the precondition AGENTS.md §3 sets for starting voice work.

### Why the existing spec is not enough on its own

Story 5/6 and API contract §3.9 already describe voice SetLog. They were written before the session UI existed. Three things are now known that the spec does not cover, and this task narrows the spec accordingly:

1. §3.9 says voice applies to "the current active session + active exercise", but the shipped UI has **no session-level notion of an active exercise**. `activeTarget(exercise)` in `page.tsx` resolves an active *set* per exercise, independently, for every exercise on screen. Which exercise a bare utterance belongs to is currently undefined. §2 pins it down.
2. §3.9 specifies `UPDATE_PREVIOUS_SET` and `DELETE_PREVIOUS_SET`, but the web app has **no manual edit or delete affordance at all** — `page.tsx` only ever calls `POST`. Shipping those two actions by voice first would make voice the only way to fix a mistyped set, which contradicts the product decision that manual entry stays free forever. See "Dependencies".
3. §3.9 defines "previous set" by `createdAt`, but the SetLog response deliberately omits `createdAt` (contract §3.8). §2 redefines it against a field the client actually holds.

### Red line (AGENTS.md §3)

`AI-generated workouts` is explicitly out of scope in AGENTS.md §3 and `docs/mvp-specification.md` §5. B1 stays on the correct side of that line by one rule, which belongs in the prompt, in the schema, and in the tests:

> The model transcribes and structures. It does not decide anything. Any field the coach did not say is emitted as `null`. The model must never carry a value forward from a previous set, from the prescription, or from training convention.

### Market positioning (brief)

| Product | Voice posture |
| --- | --- |
| TeamBuildr / TrainHeroic / TrueCoach | Coach-facing, manual entry. Voice, where present, is a comment or note, not a structured SetLog. |
| Strong / Hevy | Highly optimised manual tapping. Essentially no structured voice logging. |
| SLAB / SayLift / Liftly / RepTalk / RepLog | Solo-lifter voice diaries. RepLog ships Traditional Chinese and TWD pricing. All of them generally require the exercise name inside the sentence. |
| Forge (trainwithforge.fit) | Closest to the live-coaching moment, but listens for the whole session and must identify the exercise itself. |

Our wedge is structural, not model quality: **the prescription already exists in our database before the coach speaks.** The planned set is on screen and selected. B1 therefore does not need to identify an exercise at all, which is the single hardest and most error-prone part of every competitor's voice feature. B2 is where name resolution enters, and even there it stops at a draft for confirmation.

### Options considered

1. **Text input → LLM → structured → prefill.** A text box, no microphone. Proves the schema, the validator, the prefill target and the failure path.
2. **Record audio → server-side speech-to-text → LLM → structured → prefill.** Two model hops, an intermediate transcript.
3. **Record audio → single multimodal model (Gemini / GPT-4o audio) → structured → prefill.** One hop, structured output still mandatory.

### Trade-offs

| | Option 1 (text) | Option 2 (STT then LLM) | Option 3 (multimodal audio) |
| --- | --- | --- | --- |
| Ships the coach-facing value | No — nobody types mid-set | Yes | Yes |
| Failure transparency | Raw text always available | Transcript always available to show the coach | Transcript only if the model is asked for one, and it is then unverifiable |
| Debuggability | Trivial | Two separately testable seams | One opaque seam |
| Chinese numeral risk | None | Concentrated in the STT step, measurable in isolation | Distributed, harder to attribute |
| Latency | Lowest | Two round trips | One round trip |
| Cost per utterance | Lowest | Higher | Middle |
| iOS dependency | None | Microphone permission + TestFlight cycle | Same |

### Selected option and why

**Option 2, reached through Option 1 as the first implementation milestone.**

Option 1 is not a competing product decision; it is the first three sub-tasks of Option 2 with the microphone left off. Everything hard (the schema, the strict validator, the focus rule, the prefill target, the failure path, the entitlement gate) is provable without touching audio, and every one of those pieces survives unchanged when the microphone is attached. That ordering is also what AGENTS.md §7 asks for: independently verifiable slices.

Option 3 is rejected for v1, not permanently. The deciding factor is the failure path. B1's contract with the coach is that when parsing fails, the coach sees **what the system heard** and fixes the form by hand. With a separate speech-to-text step that transcript is a real artifact. With a single multimodal call, any transcript the model returns is generated alongside the answer rather than being the input to it, so it cannot be trusted as an explanation of what went wrong. Option 3 becomes worth measuring once we have a labelled set of Taiwanese gym utterances from real B1 usage, and the schema is deliberately identical so swapping the parse step is a contained change.

### Risks & unknowns

| Risk | Assessment |
| --- | --- |
| **Chinese numeral recognition.** 「一百五」 may mean 150 or 105 depending on the gym. 「一百零五」, 「再加五公斤」, 「跟剛剛一樣」 are all common and all ambiguous or relative. | This is the main product risk and it is not solvable by a better prompt. It is why prefill-then-confirm is mandatory and auto-submit is banned in v1. Relative utterances ("same as before", "add 5kg") are **out of scope for v1**: they require carrying a prior value forward, which the red line forbids. The model emits `null` and the coach types. |
| **Silent library pollution.** Not applicable to B1 — B1 never touches the exercise library. Recorded here because it *is* a live risk in B2. | No action. |
| **First route handler in the repo.** `apps/web` currently has zero `route.ts` files and talks to Go through the `/backend` rewrite in `next.config.ts`. B1 introduces server-side execution in the Next tier. | Contained: the handler holds a provider key and calls out; it never reaches PostgreSQL. Consistent with contract §3.9, which already places speech-to-text and parsing in Next. |
| **Vercel request body limit.** Audio uploads to a serverless function are capped (4.5 MB on the default runtime). | A single push-to-talk utterance is seconds long. Cap client-side recording duration (suggest 15s) and use a compressed codec. Verify during sub-task 5. |
| **WKWebView microphone.** The iOS shell loads the deployed staging origin (`capacitor.config.ts`), so route handlers are reachable, but `getUserMedia` needs `NSMicrophoneUsageDescription` in `Info.plist` and a new TestFlight build. | Real schedule dependency, not a code risk. Do not bet on the Web Speech API inside WKWebView. |
| **Model provider not yet chosen.** `go.mod` and `package.json` contain no AI SDK today. | Deliberately deferred to the Technical Design of sub-task 2. The schema is provider-neutral. |

### Dependencies / blockers

1. **Manual edit and delete must exist before voice edit and delete.** Manual entry is free forever; voice is paid. If `UPDATE_PREVIOUS_SET` and `DELETE_PREVIOUS_SET` ship first by voice, a non-paying coach has no way to correct a set at all. Sub-task 4 therefore adds a minimal manual correction affordance on a completed set card, wired to the already-specified `PATCH`/`DELETE /set-logs/{id}`. This is the first client use of either endpoint. It is in scope for B1 and it is not optional.
2. **iOS microphone permission** plus a TestFlight cycle, before sub-task 5 can be accepted on a phone.
3. **Voice entitlement source** must be decided at §2 approval. This task proposes an environment-variable allowlist and no schema change.
4. **Documentation drift, blocking nothing.** AGENTS.md §5 still lists `WorkoutExerciseSetOverride` and `ScheduledWorkoutPlannedSet` as "approved but not yet implemented". `migrations/0002_planned_set_prescription.up.sql` created both tables and `internal/scheduledworkout`, `internal/workoutsession` and `internal/workout` all read them. B1 depends on planned sets being real, so the stale wording should be corrected. It is a two-line edit to AGENTS.md §5 and can ride along with sub-task 1; it does not justify a broader AGENTS.md rewrite.

---

## 2. Technical Design

### Affected files/components

| Path | Change |
| --- | --- |
| `apps/web/app/session/[id]/page.tsx` | Session-level focus state, voice button, prefill application, voice-filled field marking, manual correction affordance |
| `apps/web/app/api/voice/live-setlog/route.ts` | **New.** Speech-to-text plus parse, strict validation, entitlement check |
| `apps/web/lib/voice/live-setlog-schema.ts` | **New.** Schema, strict validator, pure, unit-testable |
| `apps/web/lib/voice/entitlement.ts` | **New.** Allowlist lookup, server-side only |
| `apps/web/lib/voice/recorder.ts` | **New.** Push-to-talk capture, duration cap, silence rejection |
| `apps/web/ios/App/App/Info.plist` | `NSMicrophoneUsageDescription` |
| `AGENTS.md` §5 | Two-line correction of the stale planned-set status |

No Go changes. No migration. No API contract change. That is the point of the design: B1 is an input adapter in front of endpoints that already exist and already validate.

### Data flow

```
Coach presses and holds the mic on the focused set card
  → recorder captures audio, rejects empty/silent capture locally
  → POST /api/voice/live-setlog  (multipart: audio + focus context)
      → route handler verifies caller by forwarding the bearer token to GET /api/v1/me
      → route handler checks voice entitlement           (403 if absent)
      → speech-to-text                                    → transcript
      → LLM with the B1 prompt, structured output          → candidate JSON
      → strict schema validation (unknown field ⇒ reject) → VoiceLiveResult
  → client applies non-null fields onto the focused card's existing form state
  → coach reads the card, edits anything, taps the existing Log Set
      → POST /api/v1/sessions/{id}/set-logs   (unchanged, ID-bearing, authorised)
```

The model output never reaches PostgreSQL. It reaches a React form. That satisfies AGENTS.md §16 without a separate write path, because the write path is the one the manual UI already uses.

### The focus rule (pinned — the model never chooses)

The model is not told which exercise is focused and cannot influence it. Focus is resolved entirely on the client, before recording starts, and the resolved identifiers are sent to the route handler as context and echoed back so the client can detect a stale application.

```
focusedExercise :=
  1. the exercise the coach last interacted with in this session
     (extend the existing selectedTargets write in page.tsx to also set
      a new session-level focusedExerciseId), if it still has an
      incomplete planned target;
  2. otherwise the first exercise in session.exercises order that has an
     incomplete planned target;
  3. otherwise the first exercise in session.exercises order.

focusedTarget := activeTarget(focusedExercise)   // existing function, unchanged

if focusedTarget is undefined:
     the utterance targets the EXTRA form of focusedExercise (kind = EXTRA)
```

`activeTarget` already implements "the card the coach tapped, else the first incomplete planned set", so rule 3 of §3.9 is satisfied by existing code. The only genuinely new state is `focusedExerciseId`, which lifts that logic from per-exercise to per-session.

The mic button renders **only on the focused card**. The coach can always see, before speaking, exactly where the result will land. Ambiguity is resolved by a visible UI affordance, never by the model.

### "Previous set" (redefined against available data)

API contract §3.9 defines it by `createdAt`. The SetLog response omits `createdAt` (contract §3.8), so the client cannot apply that definition. B1 defines:

> **previous set** = the SetLog with the highest `setNumber` among the focused exercise's `setLogs` in the current session.

`setNumber` is server-assigned actual chronology within `(session, exercise)`, which is precisely the ordering §3.9 intended. This is a client-side definition only; no contract change.

### Output schema (strict, no identifiers)

Decoding is strict in both tiers: unknown field ⇒ reject, per §3.9. The model is given this schema as structured output and is told, in the prompt and again in the schema description, that omitted means unspoken.

```jsonc
// action = CREATE_SET_LOG
{
  "action": "CREATE_SET_LOG",
  "transcript": "一百公斤五下 RPE 七",
  "sets": [                       // length 1 in the base case
    {
      "load": 100,                // number | null   — null = not spoken
      "unit": "kg",               // "kg" | "lb" | null — null unless load present
      "reps": 5,                  // integer | null  — null = not spoken
      "rpe": 7                    // number | null   — null = not spoken
    }
  ]
}

// action = UPDATE_PREVIOUS_SET
{
  "action": "UPDATE_PREVIOUS_SET",
  "transcript": "剛剛不是一百，是一百零五",
  "changes": { "load": 105, "unit": "kg", "reps": null, "rpe": null }
}

// action = DELETE_PREVIOUS_SET
{ "action": "DELETE_PREVIOUS_SET", "transcript": "上一組刪掉" }

// action = UNPARSEABLE  — the model's only permitted way to decline
{ "action": "UNPARSEABLE", "transcript": "<whatever was heard>" }
```

Hard rules, enforced by the validator and covered by tests, not merely requested in the prompt:

- **No identifier of any kind may appear.** Any key matching `/id$/i` anywhere in the payload is a validation failure. The model cannot know a UUID; asking for one only produces a hallucination (§3.9).
- No exercise name, no athlete name, no date field. B1 performs no name-to-entity resolution.
- `reps` may be `null` in the model output even though the API requires it. The gap is closed by the coach at the card, not by the model.
- `load` and `unit` travel together. `load` present with `unit` null is a validation failure.
- `rpe` outside 1–10, `reps` below 1, or negative `load` is a validation failure.
- `sets` longer than the number of remaining incomplete planned sets in the focused exercise is truncated **client-side** with a visible notice. The model is never told how many sets remain, so it cannot pad to fit.

`sets` is an array purely so that "三組都做完了，一百公斤五下、五下、四下" fills the next three cards in order. It is the same action, the same prompt and the same schema as the single-set case, not a second mode. It is a stretch goal (sub-task 7) and can be dropped without affecting anything else.

### Applying a result to the form (the plan-prefill tension)

`formForPlannedSet(target)` already prefills load and reps from the **prescription** when a card becomes active. That is pre-existing manual UI behaviour and it predates voice; it is not model inference and it stays.

To keep the two clearly separated:

- The client applies **only non-null** fields from the model output onto the existing form state. Fields the coach did not speak keep whatever the manual prefill put there.
- Every field written by voice is visually marked (suggest a small mic glyph on the field label) until the coach edits or submits it. The coach can therefore see at a glance which numbers came from their mouth and which came from the plan.
- No auto-submit in v1, under any confidence, for any action.

For `UPDATE_PREVIOUS_SET` and `DELETE_PREVIOUS_SET` the equivalent of "prefill" is: the target completed set card expands into the manual correction affordance from sub-task 4, pre-filled with the proposed change (or, for delete, showing a confirm strip). The coach confirms. Same rule: voice proposes, the coach commits.

### Entitlement (flag only — no payment design)

Payments and subscriptions are out of scope (AGENTS.md §3, spec §5). This task therefore designs the **gate**, not the purchase.

- One entitlement, `voice`, shared by B1 and B2. Not two products.
- Source of truth for v1: an environment-variable allowlist of application user ids, read only by the Next route handlers. No migration, no Go change, no contract change, no new dependency.
- The route handler resolves the caller by forwarding the caller's bearer token to the existing `GET /api/v1/me` and reading the returned application user id, then checks the allowlist. Rejecting an unentitled caller costs one call to an endpoint that already exists.
- The UI hides the mic when not entitled, but the UI is not the gate. The route handler is the gate, because a client check is bypassable and the route handler is what spends money on model calls.
- Explicit follow-up, out of scope here: when payments arrive, the entitlement moves into the Go API as a real user attribute and the allowlist is deleted. Nothing else in B1 changes.

### Failure modes (one path for all of them)

| Failure | Detected where | Behaviour |
| --- | --- | --- |
| No audio captured, or below the silence threshold | Client, before upload | Never call the model. Inline hint, form untouched |
| Recording exceeds the duration cap | Client | Stop, keep what was captured, warn |
| Caller not entitled | Route handler | 403, mic hidden, no model call |
| Speech-to-text returns empty or noise | Route handler | Return `UNPARSEABLE` with the transcript |
| Model returns an unknown field, an identifier, or an invalid value | Strict validator | Return `UNPARSEABLE` with the transcript. Never partially apply |
| Model returns valid JSON but every field is null | Client | Show the transcript, apply nothing |
| Reps still empty after applying | Client | Card stays unsubmittable; existing manual validation message applies |
| `UPDATE`/`DELETE` with no previous set in the focused exercise | Client | Show the transcript, explain there is nothing to change |
| Session is not ACTIVE | Client, and the Go API as the real boundary | Mic not rendered; a stale client attempt is refused by the existing 409 |
| Provider timeout or error | Route handler | Single generic error, transcript shown when one exists, form editable |

Every row ends the same way: **nothing is persisted, the raw text is visible, and the form remains editable by hand.** That invariant is the acceptance criterion, not a nicety.

### Chinese test utterances (Taiwanese gym speech)

These belong in the validator and prompt test suite from sub-task 1 onward, as text, long before audio exists.

| Utterance | Expected parse | Note |
| --- | --- | --- |
| 「一百公斤五下，RPE 七」 | load 100, unit kg, reps 5, rpe 7 | Baseline |
| 「一百五、五下」 | **ambiguous** | Must not silently pick 150 or 105. Prefill load, mark it, let the coach confirm. Track accuracy here as a headline metric |
| 「一百零五」 | load 105, reps null | Partial utterance is normal, not an error |
| 「bench 一百、五下」 | load 100, reps 5 | "bench" discarded — B1 does no name resolution |
| 「這組力竭，八下」 | reps 8, load null, rpe null | "力竭" must **not** become RPE 10. That is inference |
| 「跟剛剛一樣」 | `UNPARSEABLE` | Relative reference, out of scope for v1 by the red line |
| 「再加五公斤」 | `UNPARSEABLE` | Same |
| 「剛剛不是一百，是一百零五」 | UPDATE_PREVIOUS_SET, load 105 | Story 6 |
| 「上一組刪掉」 | DELETE_PREVIOUS_SET | Story 6 |
| 「Kevin 深蹲一百公斤五下」 | load 100, reps 5 | Name and exercise discarded per §3.9 |

### Frontend state/UI impact

New client state in `page.tsx`: `focusedExerciseId`, a per-form `voiceFilledFields` marker set, and recording state. The existing `forms`, `selectedTargets` and `extraOpen` maps are reused as-is; voice writes through the existing `updateForm`. `handleLogSet` is not modified — a voice-prefilled card submits through exactly the same function as a hand-typed one, which is what makes "same final data shape as manual logging" true by construction rather than by testing.

### Backward compatibility

None required. Nothing persisted changes shape. A coach without the entitlement sees precisely today's UI.

---

## 3. Estimate

- Size: **L**
- Sub-task breakdown (required for L, per AGENTS.md §7). Each is independently verifiable; each stops at 5 files or fewer.

1. **Schema and strict validator.** `live-setlog-schema.ts` plus unit tests covering every rule in §2 and every Chinese utterance in the table. No UI, no network, no model. *(S)*
2. **Parse route, text input only.** `route.ts` accepting text, calling the model with structured output, validating, returning `VoiceLiveResult`. Provider chosen here. Entitlement gate included. Verified by tests and curl, not by UI. *(M)*
3. **Focus rule and prefill.** `focusedExerciseId`, a temporary text box on the focused card, apply non-null fields, mark voice-filled fields. End of this sub-task the feature is fully usable by typing. *(M)*
4. **Manual correction affordance.** Edit and delete on a completed set card, wired to the existing `PATCH`/`DELETE /set-logs/{id}`. Free for everyone. Prerequisite for sub-task 6. *(M)*
5. **Recording and speech-to-text.** `recorder.ts`, duration cap, silence rejection, multipart upload, `Info.plist`, TestFlight build. Replaces the text box with the mic. *(M)*
6. **UPDATE and DELETE by voice.** Route them into the sub-task 4 affordance as proposals. *(S)*
7. **Stretch: multiple sets in one utterance.** Sequential fill with client-side truncation. Droppable. *(S)*

Sub-tasks 1 to 3 deliver the whole of Option 1 and de-risk everything expensive. If the project stops after sub-task 3, nothing is wasted and nothing half-built is shipped.

---

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Task Doc approved | Not Started | Awaiting review. Open decisions listed in §5 |
| 1. Schema + strict validator | Not Started | |
| 2. Parse route (text in), entitlement gate | Not Started | Model provider decision lands here |
| 3. Focus rule + prefill + voice-filled marking | Not Started | Feature complete by typing at this point |
| 4. Manual edit/delete affordance | Not Started | Blocks sub-task 6. Free tier |
| 5. Recorder + speech-to-text + iOS permission | Not Started | Needs a TestFlight cycle |
| 6. UPDATE / DELETE by voice | Not Started | Depends on 4 |
| 7. Stretch: multi-set utterance | Not Started | Droppable |
| AGENTS.md §5 planned-set wording fix | Not Started | Two lines, rides with sub-task 1 |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

---

## 5. Open decisions for the approval review

1. **Entitlement source.** Environment-variable allowlist as proposed, or wait for a real user attribute? The allowlist avoids a migration and a contract change.
2. **Model provider and speech-to-text provider.** Deferred to sub-task 2 by design, but the key must exist in Vercel before that sub-task starts.
3. **Sub-task 4 scope.** Manual edit and delete is genuinely useful on its own and arguably belongs in its own Task Doc. Keeping it inside B1 is proposed because B1's `UPDATE`/`DELETE` actions are meaningless without it.
4. **Ambiguity display for 「一百五」.** Prefill the more likely reading and mark it, or leave the field empty and show the transcript? Proposal is prefill-and-mark, because an empty field costs the coach the whole utterance.

## 6. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups:
