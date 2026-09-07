# Task: Localize Exercise names for display without forking the catalog

- Date opened: 2026-09-07
- Related contract sections: AGENTS.md §5 (Database Rules — Prescription vs Actual), §6 (API Contract Discipline), §7 (sizing), §9 (task docs), §23 (Founder Constraint); `docs/go-backend-api-contract-v0.1.md` §3.4/§4; `docs/tasks/2026-08-27-i18n-zh-tw.md`
- Size (S/M/L/XL, per AGENTS.md §7): **L** (9 display call sites + 3 search call sites + 1 new module; exceeds §7's 5-file guidance, so the sub-task breakdown in §3 is mandatory)

Audited source of truth: `staging` @ `c15361f` (the merged zh-TW localization, PR #18).

Trigger: after PR #18 shipped 繁中 to staging, the Exercise Library (`/coach/exercises`)
still rendered every system Exercise in English — "Bench Press", "Romanian
Deadlift", "Back Squat" — inside an otherwise fully Chinese screen. The founder
asked whether the database should simply store Chinese names instead.

## 1. Feasibility Analysis

### The constraint that decides this

An Exercise's **name is its identity**, not merely its label. Three independent
places in the shipped system rely on that:

| Evidence | What it means |
|---|---|
| `apps/api/migrations/0001_init_schema.up.sql:33` | `UNIQUE INDEX unique_system_exercise_name ON exercises (lower(name)) WHERE owner_coach_id IS NULL` |
| `apps/api/internal/exercise/exercise.go:188` `findVisibleByName` | The API resolves an Exercise by `lower(name)`, find-or-create |
| `apps/web/app/coach/calendar/page.tsx` `buildExercisesPayload` | The client sends `name` on the wire — **never** `exerciseId` |

`docs/go-backend-api-contract-v0.1.md:362` states the rule outright: 「同名即同
identity」. So if the UI displayed 「背蹲舉」 and submitted that string, the API
would not match the system row `Back Squat`; it would create a *private
duplicate*, and each coach's training history would split across two rows that
mean the same movement.

A second, independent constraint: `scheduled_workout_exercises.exercise_name`
(`0001_init_schema.up.sql:93`) is a **snapshot** frozen at schedule time — the
deliberate Prescription-vs-Actual rule in AGENTS.md §5. Renaming a catalog row
does not and must not retroactively rewrite already-scheduled work.

### Options considered

1. **Translate the rows in the database** — `UPDATE exercises SET name = …`.
2. **Display-only translation in the frontend** — the DB, the wire, and every
   comparison stay English; a map converts English → 繁中 at paint time.
3. **Proper schema i18n** — `exercise_translations` (or a `name_i18n` JSONB),
   the API returns a locale-appropriate name, and snapshots move from storing a
   frozen name to storing `exercise_id` + resolving at display.

### Trade-offs

- **Option 1** is one SQL statement, but the system catalog is **shared by every
  coach** and carries no per-coach language. Translating it makes the product
  Chinese-only, irreversibly in practice, and leaves every existing snapshot in
  English — producing a permanently mixed UI rather than a translated one. It is
  a one-way door bought for a few minutes of work.
- **Option 2** touches no schema, no API contract, no migration, and nothing
  persisted, so it is fully reversible and cannot corrupt identity. It keeps
  both languages live simultaneously — the actual requirement, since English is
  retained per PR #18. Its cost: the map is display metadata that must be kept
  in step with the seed catalog, and only names it knows are translated.
- **Option 3** is the correct end state, but it changes the API contract (§6),
  needs a migration, and forces a decision on the snapshot rule (§5). That is
  XL, and §23 says not to let it block user validation.

### Selected option and why

**Option 2**, chosen by the founder on 2026-09-07.

It gets 繁中 Exercise names in front of the pilot coaches now, at zero risk to
data identity and with no one-way door. Option 3 stays the intended long-term
fix and is *unblocked* by this work — nothing here has to be undone first,
because no stored value changes.

### Risks & unknowns

- **The system seed list is not in this repository.** `docs/mvp-specification.md:156`
  and `docs/frontend-ui-spec.md:99` both put "System exercise seed
  implementation" out of scope, and no migration inserts these rows — they were
  inserted directly into the database. The map is therefore seeded from the rows
  visible in the founder's screenshot plus standard barbell/bodyweight
  movements. **An unknown name falls back to its English name**, i.e. exactly
  today's behavior, so an incomplete map degrades gracefully and is never a
  regression. Completing it needs the real catalog: `SELECT name FROM exercises
  WHERE owner_coach_id IS NULL ORDER BY name;`
- **Inline creation can still mint a Chinese duplicate.** If a coach types
  「臥推」 into the Calendar picker's create box while the system row `Bench
  Press` exists, `exercise-creation.ts` compares against raw names, finds no
  match, and creates a private 「臥推」. Mitigated but not eliminated: the picker
  now *finds* `Bench Press` when the coach types 「臥推」, so the natural path is
  to add the existing row rather than create one. A real fix belongs to option 3.
- Search moved client-side (see §2), so the server's match-position ranking no
  longer applies to picker results.

### Dependencies / blockers

None. Independent of `docs/tasks/2026-09-03-workout-name-fallback-locale.md`
(decision D4, the persisted `"Sep 3 Workout"` name), which is a separate,
already-filed task and is deliberately untouched here.

## 2. Technical Design

- **Affected files/components**
  - New: `apps/web/lib/i18n/exercise-names.ts`, `apps/web/lib/i18n/exercise-names.test.ts`
  - Display: `app/coach/exercises/page.tsx`, `app/coach/workouts/page.tsx`,
    `app/coach/calendar/page.tsx`, `app/coach/calendar/day-card.tsx`,
    `app/coach/calendar/duplicate-day-panel.tsx`, `app/session/[id]/page.tsx`,
    `app/today/page.tsx`
- **Schema changes:** none.
- **API changes:** none. No route, request shape, response shape, status code,
  or authorization rule is touched (§6).
- **Data flow.** The API keeps returning English names. `localizeExerciseName(name, locale)`
  is applied at the 9 JSX sites that paint a name, and nowhere else. Every value
  that is *stored, sent, or compared* keeps the original string:
  `buildExercisesPayload`'s `name:`, the create-Exercise request body, and
  `exercise-creation.ts`'s duplicate comparison are all deliberately untouched.
- **Module shape.** React-free with `locale` as a parameter, matching `dates.ts`
  and `errors.ts` — `node --test` strips TypeScript types but cannot parse JSX,
  so logic in a `.tsx` file is untestable in this repo. Keyed by
  `lower(trim(name))`, the same key the database index and the API comparison
  use, so display cannot drift from server behavior.
- **Search.** Previously each picker sent `?q=` to the server, which matches the
  stored English name — so 「臥推」 could never reach the row named `Bench Press`.
  The three search call sites now fetch the whole visible catalog once and
  filter client-side with `matchesExerciseQuery`, which matches the English name
  **or** the localized display name. Consequences, accepted: the per-keystroke
  request and its 275 ms debounce disappear (fewer round-trips), and the
  server's match-position ranking no longer orders picker results — the base
  ordering from `ListForCoach` (system-first, coach's usage count, alphabetical)
  is preserved because the unfiltered list is what gets fetched. The catalog is
  the system seed plus one coach's private Exercises, which the MVP keeps small.
- **Backward compatibility / backfill.** None required — no stored value
  changes. Reverting the change restores English display exactly.

## 3. Estimate

- Size: **L**
- Sub-tasks:
  1. Core module + unit tests (`exercise-names.ts`, `.test.ts`)
  2. Display call sites (9)
  3. Client-side search so a 繁中 query matches an English row (3 call sites)
  4. Verification (lint / tsc / build / `npm test`)

## 4. Progress Tracker

| Sub-task | Status | Notes |
|---|---|---|
| 1 — core module + tests | Done | `lib/i18n/exercise-names.ts` + 9 assertions. Covers the load-bearing negative case: an unknown name returns byte-identical. |
| 2 — display call sites | Done | 9 sites across 7 files. Verified by grep that every `localizeExerciseName(` call is inside JSX and that no payload/comparison uses it. |
| 3 — client-side search | Done | `/coach/exercises`, Workouts picker, Calendar picker. `?q=` removed from all three; the find-or-create search at `calendar/page.tsx` (`exercise-creation`) deliberately still queries the raw name — it is identity resolution, not display. |
| 4 — verification | Done | `npm run lint` clean; `npx tsc --noEmit` clean; `npm run build` clean (15 routes, `/privacy` + `/support` still static `○`); `npm test` **146 pass / 0 fail** (137 before, +9 new). |
| 5 — complete the translation map | **Not Started** | Needs the real system catalog from the database (query in §1). Until then, unlisted names render in English — a graceful fallback, not a regression. |

## 5. Outcome

Not yet verified in a browser against a deployed environment. Per README.md
"Testing a Deployed (Non-Local) Environment", that check belongs on the
`staging` branch alias, not a PR preview URL.

Deliberately out of scope: decision D4's persisted workout name
(`docs/tasks/2026-09-03-workout-name-fallback-locale.md`), the App Store
zh-Hant listing, and any change to how names are stored or compared.
