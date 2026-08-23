# Task: Guard against accidentally scheduling the same workout twice

- Date opened: 2026-08-23
- Related contract sections: §6 API Contract Discipline, §7 Task Sizing, §8 Phase Gate, §17 Verification Rules
- Size (S/M/L/XL, per AGENTS.md §7): M — split into C1 (backend) and C2 (frontend)

## 1. Feasibility Analysis

**Problem / trigger**

Found while manually testing the new Copy Workout wizard: copying Aug 16's training
*onto Aug 16* produced two identical `Aug 16 Workout` rows on the same day for the
same athlete, silently.

This is not a Copy-wizard bug. `scheduled_workouts` has **no uniqueness constraint**
on `(coach_id, athlete_id, scheduled_date, workout_id)` — only two non-unique
indexes (`0001_init_schema.up.sql:82-87`) — and `scheduledworkout.Create` inserts
unconditionally. The pre-existing "Existing Workout → Assign" path
(`page.tsx` `handleAssign`) has exactly the same hole; assigning the same workout to
the same athlete on the same day twice has always produced duplicates. Copy just
made it easy to hit by accident, because the wizard's source and target dates
default to the same day.

**Options considered**

1. **Do nothing.** Document it and rely on the coach noticing.
2. **Frontend-only pre-check in the Copy wizard.** Compare the target date's existing
   assignments before PASTE and warn.
3. **Backend guard on `POST /scheduled-workouts`, hard block.** Reject any duplicate
   with `409`, no override.
4. **Backend guard, warn-then-override.** Reject duplicates with `409` by default;
   allow the client to retry with an explicit `allowDuplicates: true` after the
   coach confirms.
5. **Database `UNIQUE` constraint.**

**Trade-offs**

- Option 1: zero cost, but the failure is silent and lands on the athlete's `/today`.
- Option 2: only closes the Copy entrance; `handleAssign` stays open. Also racy — the
  check and the write are separate round trips — and a pure-frontend guard is
  unenforceable by definition.
- Option 3: closes both entrances at the source. But scheduling the same workout
  twice in one day is **not inherently wrong** — a two-a-day (AM/PM) session is a
  real coaching pattern. A hard block removes a legitimate capability to fix an
  accident, and offers the coach no way forward when they meant it.
- Option 4: same enforcement point as 3, but the coach keeps the capability behind an
  explicit confirmation. Costs one new optional request field and one new error path.
- Option 5: strongest guarantee, but it makes two-a-days *impossible* rather than
  merely deliberate, and would need a migration plus a decision about existing
  duplicate rows already in the database. Strictly worse than 4 for this requirement.

**Selected option and why**

**Option 4** (owner decision, 2026-08-23). It guards the API itself, so both the Copy
wizard and the older Assign path are covered by one change, and it treats "same
workout twice on one day" as *suspicious, not forbidden* — which matches how coaches
actually train athletes. The duplicate check runs inside the existing transaction,
against the same rows the insert will touch, so it cannot be raced the way a
frontend pre-check can.

**Risks & unknowns**

- Existing duplicate rows are untouched. This prevents new accidents; it does not
  clean up history. Deliberately out of scope — deleting scheduled training is not a
  capability this system has at all yet (there is no DELETE route).
- `allowDuplicates` is a request-level flag, not per-athlete. Batch-scheduling a
  workout to five athletes where only one already has it will, on override, insert
  for all five — but the four non-duplicates were going to be inserted regardless,
  and the one duplicate is exactly what the coach just confirmed. No information is
  lost.

**Dependencies / blockers**

None. No migration, no schema change.

## 2. Technical Design

**API changes** (`docs/go-backend-api-contract-v0.1.md` §3.5 + §4 updated):

`POST /api/v1/scheduled-workouts` gains one **optional** request field:

```json
{ "workoutId": "...", "athleteIds": ["..."], "scheduledDate": "2026-08-16",
  "allowDuplicates": false }
```

Omitted or `false` (the default, so **existing clients are unaffected in the
non-duplicate case**): if any requested athlete already has this same `workoutId` on
this same `scheduledDate` from this coach, the whole batch is rejected with
`409 CONFLICT` and a message naming the affected athletes. Consistent with the
endpoint's existing all-or-nothing behavior for unconnected athletes — no partial
scheduling.

`true`: the check is skipped entirely and duplicates are created as before.

Error envelope shape is unchanged (`{error:{code,message}}`); the affected athlete
names are carried in `message`, since the envelope has no structured details field
and inventing one for this single case is not warranted.

**Data flow**

Check runs inside `Create`'s existing transaction, after
`lookupConnectedAthletes` (so it only considers athletes that passed authorization,
and can name them) and before the insert loop.

**Backward compatibility**

`allowDuplicates` is optional and defaults to the guarding behavior. The only
behavior change for an existing client is that a request which *would have silently
duplicated* now returns 409 instead. That is the point of the change.

## 3. Estimate

- Size: M
- Sub-tasks:
  1. **C1 — backend**: `scheduledworkout.go`, `cmd/api/main.go`, integration tests, contract doc.
  2. **C2 — frontend**: surface the 409 as a confirmation in both the Copy wizard and the Assign path, and retry with `allowDuplicates: true` on confirm.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Task Doc | Done | This document |
| C1 — `scheduledworkout.Create` duplicate check + `DuplicateScheduleError` | Done | Check runs inside the existing transaction, after `lookupConnectedAthletes` |
| C1 — handler: `allowDuplicates` field + 409 mapping | Done | Reuses the codebase's existing `CONFLICT` code; athlete names carried in `message` |
| C1 — integration tests | Done | 5 new tests; full `go test -p 1 ./...` green, `go vet` and `gofmt` clean |
| C1 — `docs/go-backend-api-contract-v0.1.md` §3.5/§4 | Done | |
| C2 — frontend confirm + override retry | Done | One shared `ConfirmDialog` serves both the Copy wizard and the older Assign path |
| Verification — automated | Done | Go suite green; web `lint` / `tsc --noEmit` / `build` all clean |
| Verification — manual against local stack | Done | Reproduced the original report end-to-end: duplicate → 409 and **no row written**; different date → 201; `allowDuplicates: true` → 201. Test rows cleaned up afterwards. |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

## 5. Outcome (filled at completion)

- **Final status:** Implemented and verified, backend and frontend. Behaves as designed against the exact case that triggered the task.
- **Deviations from plan:** None to the design. One bug caught during implementation worth recording: passing `handleAssign` directly as an `onClick` handler made React's `MouseEvent` the `allowDuplicates` argument — truthy — which would have silently disabled the guard on every Assign click. Caught by `tsc`; both call sites now wrap in an arrow function. The same shape had already bitten `openWorkoutEditor` earlier in this branch.
- **Follow-ups:**
  - `docs/go-backend-api-contract-v0.1.md` §4's matrix row for `POST /scheduled-workouts` is edited here in its **four-column** form, because this branch is cut from `origin/main`. PR #5 rewrites that same table to six columns. Whichever lands second will conflict on that one row — trivial to resolve, but expect it.
  - Existing duplicate rows are untouched by design. There is still no way to delete a scheduled workout; if that capability is ever added, cleaning up historical duplicates becomes possible.
