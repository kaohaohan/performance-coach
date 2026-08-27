# Task: Athlete Today — relative date labels (Yesterday/Today/Tomorrow)

- Date opened: 2026-08-27
- Related contract sections: none (frontend-only, no API/schema change)
- Size (S/M/L/XL, per AGENTS.md §7): S

Filed as a follow-up during the App Store 1.0 production promotion smoke test
(`docs/ios-release-runbook.md` → "Public App Store 1.0"). Explicitly deferred
past that release — no production code changed for this task. Not a bug: the
underlying date computation (`todayLocalISODate()` in
`apps/web/app/today/page.tsx`) is correct; this is a labeling/UX request.

## 1. Feasibility Analysis

- Problem / trigger: On the Athlete Today page (`apps/web/app/today/page.tsx`),
  every non-today date currently renders the same generic label ("Training"
  in the header, "No Workout Scheduled" in the empty state), and the
  "jump back to today" control is a pill literally labeled "Today" that only
  appears when viewing a different date — easy to misread as a status badge
  asserting "this date is today" rather than a navigation action. Founder
  request: label relative days explicitly (Yesterday/Today/Tomorrow) and
  rename the jump-back control so it can't be misread as a status claim.
- Options considered:
  1. Keep the current two-state label (`today` vs. everything else called
     "Training"), only rename the jump button.
  2. Add a small relative-label helper covering yesterday/today/tomorrow,
     falling back to a formatted date (e.g. `displayDate()`, already present
     in this file) for everything further out; rename the jump control.
- Trade-offs:
  1. Cheaper, but doesn't address the actual ask — Yesterday/Tomorrow still
     wouldn't be distinguished from any other day.
  2. Matches the request exactly; small, local, no new dependencies —
     `shiftLocalDate()` already in this file can derive yesterday/tomorrow
     for the comparison.
- Selected option and why: **Option 2.** It's the actual request and is a
  small, self-contained change.
- Risks & unknowns:
  - Confirm whether the Coach Calendar's own `todayLocalISODate()` copies
    (`apps/web/app/coach/calendar/calendar-date.ts` and a third duplicate
    inline in `apps/web/app/coach/calendar/page.tsx`) should get the same
    relative-label treatment, or whether this is Athlete-Today-only. Founder
    request as filed was specific to the Athlete Today screen; confirm scope
    before touching the Coach Calendar.
  - `apps/web/app/today/page.tsx`, `apps/web/app/coach/calendar/calendar-date.ts`,
    and `apps/web/app/coach/calendar/page.tsx` each define their own
    `todayLocalISODate()` — pre-existing duplication, not introduced by this
    task. Worth a look at whether this task is a reasonable time to
    consolidate into one shared helper (e.g. `calendar-date.ts` exported and
    reused), but that's a separate reuse decision, not required to ship the
    label change.
- Dependencies / blockers: none. No API, schema, or production-infra
  involvement.

## 2. Technical Design

- Affected files/components: `apps/web/app/today/page.tsx` (scope per the
  request; see the open question above on the Coach Calendar screens).
- Frontend state/UI impact:
  - Header label (currently `{selectedDate === today ? "Today" : "Training"}`,
    `apps/web/app/today/page.tsx` line 135) becomes a small helper returning
    `"Yesterday"` / `"Today"` / `"Tomorrow"` / a formatted date (reuse the
    existing `displayDate()` in this file) for anything further out.
  - Empty-state heading (currently `{selectedDate === today ? "No Workout Today" : "No Workout Scheduled"}`,
    line 154) — decide whether to extend to "No Workout Yesterday" /
    "No Workout Tomorrow" or keep the current today/other split for that
    specific string; not explicitly requested, flag for confirmation.
  - The jump-back control (`apps/web/app/today/page.tsx` line 141,
    `{selectedDate !== today && <button onClick={() => setSelectedDate(today)}>Today</button>}`)
    renamed to **"Back to Today"** per the request, so its label reads as an
    action, not a status.
- No schema, API, or backward-compatibility impact — purely client-rendered
  label text.

## 3. Estimate

- Size: S

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Implementation | Not Started | Deliberately deferred past the 2026-08-27 App Store 1.0 promotion |

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups:
