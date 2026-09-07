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

- ~~**The system seed list is not in this repository.**~~ **RESOLVED 2026-09-07.**
  The catalog was found on the unmerged branch `origin/claude/system-exercise-seed-wk3iv9`
  (single commit `67b1a4e`, no PR ever opened): `apps/api/seeds/system_exercises_v1.sql`,
  **134 SYSTEM exercises**. All seven names visible in the founder's screenshot appear in
  it, so the database was almost certainly seeded from this file by hand. It is now
  cherry-picked onto this branch (`8e3ac69`) and is the source of truth the translation
  map is checked against. Measured against it, the original hand-guessed map covered
  **20/134 (15%)** and contained **12 keys matching no real row** (e.g. `deadlift` when
  the catalog says `Conventional Deadlift`; `hip thrust` vs `Barbell Hip Thrust`) — all
  since removed. **RESOLVED 2026-09-07.** Founder ran
  `SELECT name FROM exercises WHERE owner_coach_id IS NULL ORDER BY name;` against
  staging. Diffed both directions against the seed: **134/134 exact match**,
  no extras, no missing rows, no case-only duplicates. The live SYSTEM catalog
  is this seed; a row the tests cannot see is no longer an open risk.

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
- **Completeness enforcement.** `exercise-names.test.ts` reads
  `apps/api/seeds/system_exercises_v1.sql` and asserts: exactly one `INSERT`; every
  non-comment line in the `VALUES`…`ON CONFLICT` region parses (an unreadable row fails
  rather than being skipped); exactly 134 names, unique under `lower()`; every seed name
  has a translation; no map key lacks a seed row; every key is already in lookup form;
  every value contains a Han character unless declared in `KEPT_ENGLISH`; no stale
  `KEPT_ENGLISH` entry; and **no two exercises share one Chinese name** — that last one
  is a correctness bug, not a cosmetic one, since a coach picking a collided row sends a
  *different* English name on the wire.

  The parser is anchored whole-line rather than a scan. An unanchored
  `/'([^']+)', NULL/g` fails *silently*: on a future SQL-escaped name like
  `'Farmer''s Walk'` it resyncs on the second quote and yields `s Walk` while the row
  count still looks right. Verified: the old form produces `s Walk`, the anchored form
  produces `Farmer's Walk`.

  This is the only test in `apps/web` that reads from disk, and it deliberately reaches
  into `apps/api`. Copying the 134 names into `apps/web` to buy a *compile-time* check
  would create the second, drifting list this test exists to prevent, and would put
  domain data in the frontend (AGENTS.md §4). `resolveJsonModule` would not help either —
  it widens string values to `string`, giving no key checking at all. `next build` never
  touches the path, so no deploy depends on it.

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
| 5 — complete the translation map | Done | Seed found and cherry-picked (`8e3ac69`). All **134** names translated, 12 dead keys removed, ordered to mirror the seed's own equipment blocks so the two files diff by eye. Full table in §6. Founder 2026-09-07: `Clean Pull` → **高翻拉** (was 上膊拉); `Cable Pull-Through` stays **纜繩前拉**. |
| 6 — enforce completeness | Done | `exercise-names.test.ts` reads the seed and asserts 9 properties (see §2). Each was verified by deliberate sabotage — a deleted translation, an invented key, a copy-pasted English value, an unparseable seed row, and a duplicated Chinese name each turn the suite red. |
| 7 — staging SQL reconciliation | Done | Founder query vs seed: **134/134 exact match both directions**. |

## 5. Outcome

Not yet verified in a browser against a deployed environment. Per README.md
"Testing a Deployed (Non-Local) Environment", that check belongs on the
`staging` branch alias, not a PR preview URL.

Deliberately out of scope: decision D4's persisted workout name
(`docs/tasks/2026-09-03-workout-name-fallback-locale.md`), the App Store
zh-Hant listing, and any change to how names are stored or compared.

## 6. 術語審閱表（founder 簽核用）

134 筆全數列出。規則：品牌／人名保留英文，動作部分翻中文（2026-09-07 決定）。

Founder 2026-09-07 已確認：`Clean Pull` → 高翻拉；`Cable Pull-Through` 維持 纜繩前拉。


### 槓鈴 Barbell（25）

| English | 繁中 |
|---|---|
| Back Squat | 背蹲舉 |
| Front Squat | 前蹲舉 |
| Box Squat | 箱上蹲 |
| Pause Squat | 停頓蹲 |
| Zercher Squat | Zercher 深蹲 |
| Barbell Split Squat | 槓鈴分腿蹲 |
| Barbell Reverse Lunge | 槓鈴後跨弓箭步 |
| Conventional Deadlift | 傳統硬舉 |
| Sumo Deadlift | 相撲硬舉 |
| Romanian Deadlift | 羅馬尼亞硬舉 |
| Stiff-Leg Deadlift | 直腿硬舉 |
| Barbell Hip Thrust | 槓鈴臀推 |
| Barbell Glute Bridge | 槓鈴臀橋 |
| Bench Press | 臥推 |
| Incline Bench Press | 上斜臥推 |
| Close-Grip Bench Press | 窄握臥推 |
| Floor Press | 地板臥推 |
| Overhead Press | 過頭推舉 |
| Push Press | 借力推舉 |
| Barbell Row | 槓鈴划船 |
| Pendlay Row | Pendlay 划船 |
| Good Morning | 早安式 |
| Hang High Pull | 懸垂高拉 |
| Clean Pull | 高翻拉 |
| Snatch-Grip Deadlift | 抓舉握硬舉 |

### 啞鈴 Dumbbell（25）

| English | 繁中 |
|---|---|
| Dumbbell Bench Press | 啞鈴臥推 |
| Incline Dumbbell Bench Press | 上斜啞鈴臥推 |
| Dumbbell Floor Press | 啞鈴地板臥推 |
| Dumbbell Fly | 啞鈴飛鳥 |
| Dumbbell Shoulder Press | 啞鈴肩推 |
| Arnold Press | Arnold 推舉 |
| Dumbbell Lateral Raise | 啞鈴側平舉 |
| Dumbbell Front Raise | 啞鈴前平舉 |
| Dumbbell Rear Delt Raise | 啞鈴後三角平舉 |
| One-Arm Dumbbell Row | 單手啞鈴划船 |
| Chest-Supported Dumbbell Row | 胸靠啞鈴划船 |
| Dumbbell Pullover | 啞鈴仰臥拉舉 |
| Dumbbell Goblet Squat | 啞鈴高腳杯深蹲 |
| Dumbbell Front Squat | 啞鈴前蹲舉 |
| Dumbbell Split Squat | 啞鈴分腿蹲 |
| Dumbbell Bulgarian Split Squat | 啞鈴保加利亞分腿蹲 |
| Dumbbell Reverse Lunge | 啞鈴後跨弓箭步 |
| Dumbbell Walking Lunge | 啞鈴行走弓箭步 |
| Dumbbell Romanian Deadlift | 啞鈴羅馬尼亞硬舉 |
| Single-Leg Dumbbell Romanian Deadlift | 單腿啞鈴羅馬尼亞硬舉 |
| Dumbbell Step-Up | 啞鈴登階 |
| Dumbbell Hip Thrust | 啞鈴臀推 |
| Dumbbell Biceps Curl | 啞鈴二頭彎舉 |
| Hammer Curl | 錘式彎舉 |
| Dumbbell Triceps Extension | 啞鈴三頭伸展 |

### 纜繩 Cable（21）

| English | 繁中 |
|---|---|
| Cable Chest Press | 纜繩胸推 |
| Cable Fly | 纜繩飛鳥 |
| Cable Incline Fly | 纜繩上斜飛鳥 |
| Cable Row | 纜繩划船 |
| Seated Cable Row | 坐姿纜繩划船 |
| One-Arm Cable Row | 單手纜繩划船 |
| Cable Lat Pulldown | 纜繩滑輪下拉 |
| Straight-Arm Pulldown | 直臂下拉 |
| Cable Face Pull | 纜繩臉拉 |
| Cable Lateral Raise | 纜繩側平舉 |
| Cable Front Raise | 纜繩前平舉 |
| Cable Rear Delt Fly | 纜繩後三角飛鳥 |
| Cable Biceps Curl | 纜繩二頭彎舉 |
| Cable Hammer Curl | 纜繩錘式彎舉 |
| Cable Triceps Pushdown | 纜繩三頭下壓 |
| Cable Overhead Triceps Extension | 纜繩過頭三頭伸展 |
| Cable Pull-Through | 纜繩前拉 |
| Cable Wood Chop | 纜繩劈砍 |
| Cable Pallof Press | 纜繩 Pallof 推 |
| Cable Hip Abduction | 纜繩髖外展 |
| Cable Hip Adduction | 纜繩髖內收 |

### 徒手 Bodyweight（24）

| English | 繁中 |
|---|---|
| Push-Up | 伏地挺身 |
| Incline Push-Up | 上斜伏地挺身 |
| Decline Push-Up | 下斜伏地挺身 |
| Pull-Up | 引體向上 |
| Chin-Up | 反手引體向上 |
| Neutral-Grip Pull-Up | 中立握引體向上 |
| Inverted Row | 反向划船 |
| Bodyweight Squat | 徒手深蹲 |
| Split Squat | 分腿蹲 |
| Bulgarian Split Squat | 保加利亞分腿蹲 |
| Reverse Lunge | 後跨弓箭步 |
| Walking Lunge | 行走弓箭步 |
| Step-Up | 登階 |
| Single-Leg Squat | 單腿深蹲 |
| Pistol Squat | 手槍蹲 |
| Glute Bridge | 臀橋 |
| Single-Leg Glute Bridge | 單腿臀橋 |
| Nordic Hamstring Curl | 北歐腿彎舉 |
| Calf Raise | 提踵 |
| Single-Leg Calf Raise | 單腿提踵 |
| Plank | 棒式 |
| Side Plank | 側棒式 |
| Dead Bug | 死蟲式 |
| Bird Dog | 鳥狗式 |

### 器械 Machine（25）

| English | 繁中 |
|---|---|
| Leg Press | 腿推舉 |
| Hack Squat | 哈克深蹲 |
| Pendulum Squat | 鐘擺深蹲 |
| Belt Squat | 腰帶深蹲 |
| Leg Extension | 腿伸展 |
| Seated Leg Curl | 坐姿腿彎舉 |
| Lying Leg Curl | 俯臥腿彎舉 |
| Standing Leg Curl | 站姿腿彎舉 |
| Hip Abduction Machine | 髖外展機 |
| Hip Adduction Machine | 髖內收機 |
| Glute Drive | 臀推機 |
| Chest Press Machine | 胸推機 |
| Incline Chest Press Machine | 上斜胸推機 |
| Shoulder Press Machine | 肩推機 |
| Lat Pulldown Machine | 滑輪下拉機 |
| Seated Row Machine | 坐姿划船機 |
| High Row Machine | 高位划船機 |
| Low Row Machine | 低位划船機 |
| Pec Deck | 蝴蝶機 |
| Reverse Pec Deck | 反向蝴蝶機 |
| Assisted Pull-Up | 輔助引體向上 |
| Biceps Curl Machine | 二頭彎舉機 |
| Triceps Extension Machine | 三頭伸展機 |
| Seated Calf Raise | 坐姿提踵 |
| Standing Calf Raise | 站姿提踵 |

### Hammer Strength（14）

| English | 繁中 |
|---|---|
| Hammer Strength Iso-Lateral Bench Press | Hammer Strength 單邊臥推 |
| Hammer Strength Iso-Lateral Incline Press | Hammer Strength 單邊上斜推 |
| Hammer Strength Iso-Lateral Decline Press | Hammer Strength 單邊下斜推 |
| Hammer Strength Iso-Lateral Shoulder Press | Hammer Strength 單邊肩推 |
| Hammer Strength Iso-Lateral Wide Chest | Hammer Strength 單邊寬握胸推 |
| Hammer Strength Iso-Lateral Row | Hammer Strength 單邊划船 |
| Hammer Strength Iso-Lateral High Row | Hammer Strength 單邊高位划船 |
| Hammer Strength Iso-Lateral Low Row | Hammer Strength 單邊低位划船 |
| Hammer Strength Iso-Lateral Front Lat Pulldown | Hammer Strength 單邊滑輪下拉 |
| Hammer Strength Ground Base Jammer | Hammer Strength 推舉架 |
| Hammer Strength Ground Base Squat | Hammer Strength 深蹲架 |
| Hammer Strength Ground Base High Pull | Hammer Strength 高拉架 |
| Hammer Strength Linear Leg Press | Hammer Strength 直線腿推舉 |
| Hammer Strength Hack Squat | Hammer Strength 哈克深蹲 |
