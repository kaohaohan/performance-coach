# Task: Stop persisting a locale-baked default workout name

- Date opened: 2026-09-03
- Related contract sections: AGENTS.md §6 (API Contract Discipline), §7 (sizing), §9 (task docs); `docs/go-backend-api-contract-v0.1.md` §3.5; `docs/tasks/2026-08-27-i18n-zh-tw.md` (decision D4)
- Size (S/M/L/XL, per AGENTS.md §7): **M**

Audited source of truth: `claude/performancecoa-chinese-switch-9n35mk` @ the merged
zh-TW localization work.

Trigger: decision **D4** in `docs/tasks/2026-08-27-i18n-zh-tw.md`, raised by that
task's Calendar sub-task and deliberately left open. The founder's call on
2026-09-03 was: leave the English fallback in place for now, and fix it properly
in a task that is allowed to touch the API contract. This is that task.

## 1. Feasibility Analysis

- Problem / trigger: when a Coach saves a scheduled workout without typing a
  name, `apps/web/app/coach/calendar/page.tsx` (`fallbackWorkoutName`,
  ~line 308) generates `"Sep 3 Workout"` **on the client** and sends it as the
  workout's real name. The API stores it. From then on it is data, not display
  copy:
  - it is shown to the Athlete, who may be on another device in another
    language;
  - it never re-renders in the reader's locale;
  - it is the only user-visible string in the app that the zh-TW localization
    could not fix, and it is `en-US`-formatted regardless of who created it.

  It is also wrong in a way that predates i18n: an English-speaking coach and
  an English-speaking athlete still get a name frozen at creation time, so a
  workout copied to another date keeps the original date in its name.

- Options considered:
  1. **Leave it English forever.** Consistent for every reader; permanently
     wrong-feeling for a 繁中 coach.
  2. **Localize at write time** — the coach's locale decides the stored string.
  3. **Persist no name; localize at display time.** The client sends no name
     (or an explicit null); every surface that renders a workout falls back to
     a localized, date-derived label computed from `scheduledDate` in the
     *reader's* locale.
  4. **Persist a structured marker** (e.g. `nameSource: "auto"` alongside the
     generated name) so readers can choose to re-derive it.

- Trade-offs (per option):
  1. Zero work, zero risk, and the reason D4 was parked rather than closed. It
     does not fix the copied-workout staleness either.
  2. Actively worse than (1). A 繁中 coach creates `"9月3日 課表"` and an
     English-reading athlete is stuck with it — the same defect, now pointed at
     whoever did not create the workout. Rejected outright.
  3. Correct in both locales and for both parties, and it fixes the stale-date
     problem for free because the label is derived at render time. Costs an API
     contract change (name becomes optional) and a decision about existing rows.
  4. Keeps the stored name as a cache and adds a flag. More moving parts than
     (3) for the same outcome, and it leaves the wrong string in the database
     where some other reader will eventually render it.

- Selected option and why: **Option 3.** It is the only option that is right
  for both the coach and the athlete simultaneously, and per AGENTS.md §22 it
  removes the problem rather than adding a layer that manages it. The API
  change is small and additive.

- Risks & unknowns:
  - **The API currently requires a name.** `POST /scheduled-workouts` and
    `POST /workouts` validate it (`exercises[0].name is required` and the
    workout's own `name`). Making it optional is an API contract change and
    needs `docs/go-backend-api-contract-v0.1.md` updated per AGENTS.md §6.
  - **Existing rows already carry generated English names.** They are
    indistinguishable from names a coach actually typed — `"Sep 3 Workout"` is
    a name a human could have entered. A backfill cannot safely reverse them.
    Recommendation: do not backfill; new rows get the new behaviour and old
    ones keep their stored name. Needs confirming before implementation.
  - Reusable Workout **templates** and **ScheduledWorkouts** both have names.
    This task should scope which of the two is in play; the fallback today is
    only generated on the Calendar's scheduling path.
  - Any surface that sorts, searches or groups by workout name (Workout
    History, the Calendar's "from saved" picker) must keep working when the
    stored name is empty.

- Dependencies / blockers:
  - None. The zh-TW localization work is merged and its `lib/i18n/dates.ts`
    already provides the locale-aware date formatting this task's display
    fallback needs.

## 2. Technical Design

Deliberately left for the planning session that picks this up — per AGENTS.md
§10 this document was written alongside the decision, not alongside an
implementation, and §9 keeps evaluation (section 1) separate from design.

What that session must settle:

- Wire shape: omit `name`, send `null`, or send `""`? Pick one and make the Go
  validator and the contract doc agree.
- Where the display fallback lives: it belongs next to `lib/i18n/dates.ts` as a
  `workoutDisplayName(workout, locale)` helper so Calendar, Today, Session and
  Workout History all resolve it identically.
- Whether reusable Workout templates are in scope or only ScheduledWorkouts.
- The existing-rows decision above.

## 3. Estimate

- Size: **M** (API validation + contract doc + one shared frontend helper +
  the four surfaces that render a workout name).

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Task Doc — feasibility | Done | This document; records the D4 decision of 2026-09-03 |
| Technical Design (§2) | Not Started | Needs a planning session per AGENTS.md §10 |
| Implementation | Not Started | Blocked on the design above |
| Verification | Not Started | |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`. Keep this table
current — do not write it once and abandon it.

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups:
