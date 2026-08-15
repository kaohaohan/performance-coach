# DontWorkout — Go Backend API Contract (V0.1)

Status: **V0.6 — current scalar contract + approved planned-set semantic addendum**

Target: 2026-08-16

對應文件: MVP Specification, Frontend UI Spec

Stack: Go (net/http or chi) + pgx/sqlc + PostgreSQL · Auth: Firebase Auth (JWT)

Repo: 先用 neutral codename（如 `performance-coach`），品牌定案後再 rename module path

> V0.6 documentation decision: V0.1 now requires uniform-first, ordered planned-set prescription semantics. `Sets = N` means N effective planned positions; defaults may apply to all positions and individual positions may be overridden. Planned reps or text prescription, load with unit, and RPE are separate from actual SetLogs. **This is not yet an API or storage design.** The concrete request/response representation, migration path, and SetLog-to-planned-position reference remain pending a separate architecture session. The endpoint examples below continue to describe the currently implemented scalar contract until that work is approved.

> V0.5 變更：`GET /scheduled-workouts` 實作為 Coach-only summary/list endpoint，`from`/`to` 必填、`athleteId` 選填。省略 `athleteId` 時回傳呼叫者跨所有已連結 athlete、指定日期範圍內的排程，供 Calendar 日/週檢視使用；提供 `athleteId` 但未連結時回 `404 NOT_FOUND`（刻意與 POST /scheduled-workouts 的 403 不一致，屬已知待清理項目）。Response 為 nested 摘要（`athlete{id,name}`、`workout{id,name}`、`session`），不含 exercises — 詳細處方與 SetLog 仍走 `GET /sessions/{id}`。純粹是既有 endpoint 的查詢維度放寬與回應格式明確化 — **不新增 domain object、不新增 endpoint**。詳見 §3.5、§7.5，對應 `docs/mvp-specification.md`「Navigation Principle」與 `docs/frontend-ui-spec.md`。
> 

> V0.4 變更（最後一輪 sanity check）：① 明確定義 snapshot 欄位優先於 Exercise current state ② 註明 exercise 同名衝突規則 ③ targetRepsNote → targetPrescriptionNote ④ SetLog.load/unit 改 nullable（bodyweight 動作）⑤ 「reps 永遠整數」改為 V0.1 範圍聲明
> 

> V0.3：exercises 私有動作庫（partial unique indexes）、AMAP 處方、batch scheduling、Future Architecture
> 

> V0.2：Exercise/WorkoutExercise 分離、prescription snapshot、set_number unique constraint、Voice 降級
> 

> **核心原則：Prescription 可以是模糊指令；actual performance 必須是結構化事實。**
> 

> V0.1 的 SetLog 僅支援 reps-based logging，故 `reps` 為必填整數；time/distance-based actual metrics（Plank 30 sec、Sprint 20 m）為 future extension，屆時擴充 metric 欄位而非放寬 reps。
> 

# 1. 通用約定 (Conventions)

## Base

- Base URL: `/api/v1`
- Content-Type: `application/json; charset=utf-8`
- 所有時間: RFC 3339 UTC（`2026-08-13T00:00:00Z`）；`scheduledDate` 為純日期 `2026-08-13`
- ID: UUID v4 (string)
- JSON 欄位: `camelCase`（Go struct 用 json tag 對應）

## Authentication

- 所有 endpoint（除 health check）都需要 `Authorization: Bearer <Firebase ID Token>`
- Go middleware 驗 JWT → 取 `uid` → 查 `users` 表得到 internal user + role
- 找不到 user → `401 UNAUTHENTICATED`

**Authentication ≠ Authorization。**Firebase 只負責「你是誰」，application identity（`users.id`）與角色權限一律由本系統決定。

## 錯誤格式（全 API 統一）

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "coach is not connected to this athlete"
  }
}
```

| HTTP | code | 使用時機 |
| --- | --- | --- |
| 400 | INVALID_ARGUMENT | JSON 解析失敗、欄位驗證失敗 |
| 401 | UNAUTHENTICATED | token 缺失/無效/過期 |
| 403 | FORBIDDEN | 已登入但無權操作該資源 |
| 404 | NOT_FOUND | 資源不存在（或無權看見 — 見下） |
| 409 | CONFLICT | 狀態衝突（如重複完成 session） |
| 422 | VALIDATION_FAILED | voice command schema 驗證失敗 |
| 500 | INTERNAL | 未預期錯誤（不外洩細節） |

**授權與隱私原則：**角色本身不允許呼叫某類 endpoint 時回 `403 FORBIDDEN`（例如 Athlete 呼叫 Coach-only 的 `POST /workouts`）；已具備該 endpoint 角色資格、但無權存取某一具體 resource 時回 `404 NOT_FOUND`，避免洩漏資源存在性。

## Go 分層

```
handler (decode/encode, status code)
   ↓
service (business rules + authorization)
   ↓
repository (sqlc generated, SQL only)
   ↓
PostgreSQL
```

授權判斷一律寫在 **service 層**，handler 與 repository 不做權限決策。

---

# 2. Domain Model

```
User                      { id, firebaseUid, name, role: COACH|ATHLETE }
CoachAthlete              { coachId, athleteId }              // N:N
Exercise                  { id, name, ownerCoachId? }         // null = 系統公用動作
Workout                   { id, coachId, name }                // 課表模板
WorkoutExercise           { id, workoutId, exerciseId, targetSets, targetReps?, targetPrescriptionNote?, targetRpe?, position }
ScheduledWorkout          { id, workoutId, coachId, athleteId, scheduledDate }
ScheduledWorkoutExercise  { id, scheduledWorkoutId, exerciseId, exerciseName, targetSets, targetReps?, targetPrescriptionNote?, targetRpe?, position }  // snapshot
WorkoutSession            { id, scheduledWorkoutId, athleteId, status: ACTIVE|COMPLETED, startedAt, completedAt }
SetLog                    { id, sessionId, scheduledWorkoutExerciseId, setNumber, load?, unit?, reps, rpe, loggedByUserId, createdAt }
```

### 2.1 Approved planned-set semantics; representation pending

The current model above is the implemented scalar model, not the final representation of the approved V0.1 programming behavior.

- For an exercise with `N` sets, its **effective** plan contains exactly `N` ordered planned positions, numbered `1..N`.
- The **authoring model** has exercise-level property defaults plus sparse, property-specific per-position overrides. A position with no override for a property inherits that default. Builder defaults are uniform shorthand: one reps value or text prescription, one load plus unit, and one RPE may apply to every position. The Coach must not be required to enter N repeated values for uniform work.
- An individual position may override one or more inherited default values without becoming an all-or-nothing override object. For example, it can override reps while inheriting load and RPE. Planned-set position is separate from `WorkoutExercise.position`, which orders exercises within a Workout.
- Entering individual-set editing for an inherited property starts from that position's current effective value; changing it creates an explicit override. Changing a default updates only positions inheriting that property. Clearing an override restores inheritance from the current default. Exact controls and persistence are pending.
- An effective planned position can express numeric reps **or** the existing text prescription capability, optional planned load paired with its unit (`kg` or `lb`), and optional planned RPE. A default text note such as `AMAP` can be inherited by all positions and individually overridden by note; this does not add duration/time actual metrics. Load overrides must preserve a valid load/unit pair; mixed-unit behavior remains pending design.
- The **effective planned prescription** is the deterministic result of resolving defaults and overrides for every planned position at save/build and scheduling time. Whether persistence keeps defaults plus sparse overrides, expands positions, or uses another representation remains undecided.
- Scheduling freezes the **effective** planned positions for every athlete snapshot. A later Workout-template default or override edit must not change an existing ScheduledWorkout.
- Actual SetLogs remain actual performance. Session execution must be able to associate an actual set with the corresponding frozen effective planned position, without overwriting its planned values. Athlete-facing targets need not expose whether a value was defaulted, inherited, or overridden.

This section does not select normalized rows, JSON/arrays, or any other persistence representation. It also does not select a final wire shape or resolve handling of skipped, extra, or repeated actual sets.

## 核心概念

**Exercise vs WorkoutExercise**

- `Exercise` = 「Back Squat」這個動作本身
- `WorkoutExercise` = Back Squat 在某份課表裡的 prescription（4×5 @ RPE 8）

**動作庫的擁有權**

- `ownerCoachId = NULL` → 系統 seed 的公用目錄
- `ownerCoachId = 某教練` → 該教練的私有動作（其他教練看不到、名稱不互相衝突）

**Prescription snapshot（含欄位優先權規則）**

排程當下把 WorkoutExercise 複製成 ScheduledWorkoutExercise。之後教練改課表模板，**不會污染已發生的訓練歷史**。

> **Snapshot 欄位優先於 Exercise current state。**所有歷史顯示（Today view、session 詳情、plan vs actual）一律讀 snapshot 的 `exercise_name` 與 target 欄位，**永不 join 回現行 `exercises` 表取名稱或處方**。保留的 `exercise_id` 唯一用途是 analytics / 跨課表動作歷史關聯（例如「Back Squat 的負荷趨勢」）。動作事後改名，歷史顯示不變，這是 by design。
> 

```
Workout ──1:N──> WorkoutExercise ──N:1──> Exercise (公用或私有)
   │
   └──> ScheduledWorkout ──1:N──> ScheduledWorkoutExercise  ← prescription (凍結)
                │
                └──> WorkoutSession ──1:N──> SetLog          ← actual
```

`SetLog` 掛在 `ScheduledWorkoutExercise` 而非 `Exercise`，因此目前可在 exercise level 做 plan vs actual 對齊。V0.6 已核准的 planned-set semantics 進一步要求每筆 actual 能對應 frozen planned position；其資料表示法仍待設計。

**Prescription 的模糊性**

`targetReps` 可為 null，此時 `targetPrescriptionNote` 存文字處方（"AMAP"、"30 sec"、"10–12"）— 命名刻意不叫 repsNote，因為 time/distance 處方不是 reps。SetLog 的驗證見 3.8。

---

# 3. Endpoints

> **Current implemented wire contract:** the request/response shapes in this section are scalar exercise-level prescriptions. They remain authoritative for the running application until the planned-set architecture is separately designed and approved. The V0.6 semantic decision above must not be implemented by silently changing `plan.sets` from a number to another type or otherwise breaking existing consumers.

## 3.1 Me

### GET /me

```json
{ "id": "...", "name": "Kevin", "role": "ATHLETE" }
```

---

## 3.2 Exercises（動作目錄）

### GET /api/v1/exercises?q=squat — Coach only

回傳「系統公用 + 呼叫者私有」的動作，供課表編輯 autocomplete 與 Exercise Library 使用。Athlete 呼叫時回 `403 FORBIDDEN`；永不回傳其他 Coach 的私有動作。

- SYSTEM exercise：`ownerCoachId = null`
- PRIVATE exercise：`ownerCoachId = caller.id`
- `q` 選填，先做 `strings.TrimSpace` 等價處理
- `q` 缺省、空字串、或只含空白時，回傳所有可見動作
- 非空 `q` 時，以名稱做 case-insensitive substring search
- 排序固定為：SYSTEM 優先、`lower(name)` 升冪、`id` 升冪

Response `200`：

```json
[
  { "id": "...", "name": "Back Squat", "scope": "SYSTEM" },
  { "id": "...", "name": "Tempo Back Squat", "scope": "PRIVATE" }
]
```

`scope` 是由 API 依 `ownerCoachId` 衍生的 presentation metadata，不是新的資料庫欄位。

V0.1 的 System exercise seed implementation 另列 follow-up；零筆 SYSTEM exercise 不得阻擋 private Exercise 的 list 或 creation。

### POST /api/v1/exercises — Coach only

Request：

```json
{ "name": "Tempo Back Squat" }
```

名稱正規化採 `strings.TrimSpace` 等價處理：去除首尾空白、保留內部空白、保留 trim 後的提交大小寫；名稱比較為 case-insensitive。成功時一律建立 `ownerCoachId = caller.id` 的 PRIVATE exercise。

Response `201`：

```json
{ "id": "...", "name": "Tempo Back Squat", "scope": "PRIVATE" }
```

**重名規則：**

- 若 SYSTEM 已有任一 trim/case-equivalent 名稱（例如 `Back Squat`、`back squat`、`  Back Squat  `），回 `409 CONFLICT`：`an exercise named "Back Squat" already exists in the system library`。不得建立 private duplicate。
- 若 caller 已有 trim/case-equivalent PRIVATE exercise，回 `409 CONFLICT`：`you already have a private exercise named "Tempo Back Squat"`。
- 不同 Coach 可各自擁有同名 PRIVATE exercise，因為 private uniqueness 以 owner Coach 為界。
- 不得暴露 PostgreSQL constraint name 或 raw database error。

**錯誤：**

| 情況 | Status | Code |
| --- | --- | --- |
| malformed JSON、缺少 `name`、或 `name` 為空/只含空白 | 400 | `INVALID_ARGUMENT` |
| Athlete 呼叫 GET 或 POST exercises | 403 | `FORBIDDEN` |
| SYSTEM 或 caller-private duplicate | 409 | `CONFLICT` |
| 未預期 query/persistence failure | 500 | `INTERNAL` |

### 建立規則（find-or-create）

`POST /workouts` 保持既有 find-or-create 行為：以 trim/case-insensitive matching 在（SYSTEM ∪ caller Coach 的 PRIVATE exercises）中搜尋；命中則沿用，未命中則**建為該教練的 private Exercise**。先前透過 `POST /exercises` 建立的 caller-private Exercise 必須被重用，而非重複建立。

> **同名衝突規則（V0.1）：**比對命中時 system exercise 優先，**不支援**建立與 system 同名的 private exercise（同名即同 identity）。教練要做變化版就取不同名稱（如 "Tempo Back Squat"）。未來若需「同名不同 identity」，將以 explicit `exerciseId` 傳入取代 name 比對，屬 future extension。
> 

### 唯一性（partial unique indexes）

```sql
-- 系統目錄內不重複
CREATE UNIQUE INDEX unique_system_exercise_name
ON exercises (lower(name))
WHERE owner_coach_id IS NULL;

-- 各教練自己的目錄內不重複；不同教練可同名
CREATE UNIQUE INDEX unique_coach_exercise_name
ON exercises (owner_coach_id, lower(name))
WHERE owner_coach_id IS NOT NULL;
```

（不用 `UNIQUE(lower(name), owner_coach_id)`：SQL 視 NULL 彼此不同，擋不住系統目錄重複。）

---

## 3.3 Workouts（Story 1）

### POST /workouts — Coach only

Request：

```json
{
  "name": "Monday Lower",
  "exercises": [
    { "name": "Back Squat", "targetSets": 4, "targetReps": 5, "targetRpe": 8 },
    { "name": "Push Up", "targetSets": 1, "targetPrescriptionNote": "AMAP" }
  ]
}
```

驗證：

- `name` 非空；`exercises` 至少 1 筆
- `targetSets` 正整數
- `targetReps` 與 `targetPrescriptionNote` **至少一個存在**；`targetReps` 若有值需為正整數
- `targetRpe` 選填，1–10

Service 於單一 transaction 內：find-or-create exercises → 建 workouts → 依陣列順序建 workout_exercises（`position` 由 server 給定）。

Response `201`：

```json
{
  "id": "...",
  "name": "Monday Lower",
  "exercises": [
    {
      "workoutExerciseId": "...",
      "exerciseId": "...",
      "name": "Back Squat",
      "plan": { "sets": 4, "reps": 5, "rpe": 8 },
      "position": 1
    },
    {
      "workoutExerciseId": "...",
      "exerciseId": "...",
      "name": "Push Up",
      "plan": { "sets": 1, "prescriptionNote": "AMAP" },
      "position": 2
    }
  ]
}
```

**`plan` 一律是巢狀物件**，不攤平成 target* 欄位。這有助於未來做 additive evolution，但不保證 planned-set 支援可以在不改變 contract 的情況下完成；最終相容策略待 architecture session 決定。

### GET /workouts — Coach only

只回傳 `coachId = 呼叫者` 的清單。

### GET /workouts/{workoutId} — Coach only（owner）

### PATCH /workouts/{workoutId} — Coach only（owner）

**可自由修改**，包含已被排程過的 workout。因為 prescription 已 snapshot，歷史不受影響。

### DELETE /workouts/{workoutId} — Coach only（owner）

Soft delete（`archived_at`）。已封存的 workout 不出現在清單，也不可再排程。V0.1 不 hard delete Workout；`scheduled_workouts.workout_id` 的 FK 不使用 `ON DELETE CASCADE`，避免刪除模板時破壞既有排程與歷史 snapshot。

---

## 3.4 Coach–Athlete Relationship

MVP 可先用 seed 建立關係，但查詢 endpoint 必須有：

### GET /athletes — Coach only

回傳與呼叫者有 CoachAthlete 關係的 athlete 清單（排程時的多選來源）。

---

## 3.5 Scheduling（Story 2）

### POST /scheduled-workouts — Coach only

**收陣列，一次排給多個 athlete**：

```json
{
  "workoutId": "...",
  "athleteIds": ["a1", "a2", "a3"],
  "scheduledDate": "2026-08-14"
}
```

Service 層檢查（依序）：

1. workout 存在、未封存、且 `workout.coachId == caller.id` → 否則 404
2. `athleteIds` 非空、無重複；**每一個** athleteId 都有 `CoachAthlete(caller, athleteId)` 關係 → 任一不符回 `403 FORBIDDEN`（全有全無，不做部分成功）

通過後於 **同一 transaction** 內，對每個 athlete：建立一筆 `scheduled_workouts` → 複製 snapshot exercises（含 `exercise_name` 與所有 target 欄位）。

**API 是 batch，資料是 atomic**：一筆 ScheduledWorkout = 一個 athlete 的一次排程。athleteIds 陣列不落地。

Response `201`：ScheduledWorkout 陣列（每人一筆，各含展開的 snapshot；`session` 固定為 `null`，因為排程當下尚未開始訓練）：

```json
[
  {
    "id": "...",
    "scheduledDate": "2026-08-14",
    "athlete": { "id": "...", "name": "Kevin" },
    "workout": { "id": "...", "name": "Monday Lower" },
    "session": null,
    "exercises": [
      {
        "scheduledWorkoutExerciseId": "...",
        "exerciseId": "...",
        "name": "Back Squat",
        "plan": { "sets": 4, "reps": 5, "rpe": 8 },
        "position": 1
      }
    ]
  }
]
```

`exercises[].plan` 與 `POST /workouts` 回應同形狀（巢狀物件；`targetPrescriptionNote` 類型的處方走 `plan.prescriptionNote`，此時 `plan.reps` 省略）— 見 §3.3。

**V0.1 不做 (workoutId, athleteId, scheduledDate) 去重**：同一 workout 可合法地在同一天排給同一 athlete 兩次以上（尚無 time-of-day/session slot 概念）；意外重複送出（idempotency）留待未來處理，本次不引入 unique constraint 或 409。

### GET /scheduled-workouts?from=&to=&athleteId= — Coach only

列出呼叫者（caller）自己建立的排程，一律以 `coachId = caller.id` 為界（不因本次調整而改變）。**這是 summary/list endpoint**：只回傳 Calendar 渲染所需的摘要欄位，不含 exercise prescription — 那屬於 `GET /sessions/{id}` 的職責，不在此重複。

- `from`、`to`：**必填**，以 `scheduled_date` 篩選的日期範圍（含首尾），格式為純日期（`2026-08-14`）。缺漏或無法解析 → `400 INVALID_ARGUMENT`；`to` 早於 `from` → 同樣 `400 INVALID_ARGUMENT`。
- `athleteId`：**選填**（V0.5 起）。有值時只回傳該 athlete 的排程，且該 athlete 必須與呼叫者存在 `CoachAthlete` 關係，否則 `404 NOT_FOUND`（不透露該 athlete 是否存在 — 見 §1 授權與隱私原則；**注意此處刻意與 §3.5 POST /scheduled-workouts 的 403 不一致，屬已知待清理項目，本次不擴大範圍處理**）。省略時回傳呼叫者在 `from`–`to` 範圍內、跨所有已連結 athlete 的排程 — 供 Coach Calendar 日/週檢視使用（見 `docs/frontend-ui-spec.md`）。

> **Calendar 是前端資訊架構（information architecture），建構在既有 `ScheduledWorkout` 模型之上。** 本次調整不新增 Calendar domain object，也不新增 endpoint，只放寬既有 endpoint 的查詢維度、並明確化其回應格式。授權規則不變（角色檢查仍是 403；本 endpoint 的 resource-scoping 檢查是 404）。詳見 §7.5。
> 

Response `200`（陣列，每筆為一個 ScheduledWorkout 摘要）：

```json
[
  {
    "id": "...",
    "scheduledDate": "2026-08-14",
    "athlete": { "id": "...", "name": "Kevin" },
    "workout": { "id": "...", "name": "Monday Lower" },
    "session": null
  },
  {
    "id": "...",
    "scheduledDate": "2026-08-14",
    "athlete": { "id": "...", "name": "Priya" },
    "workout": { "id": "...", "name": "Push Day" },
    "session": { "id": "...", "status": "ACTIVE" }
  }
]
```

`session`：`null` 代表該 ScheduledWorkout 尚未開始訓練；非 null（`{ id, status }`，`status` ∈ `ACTIVE`/`COMPLETED`）代表已開始或完成。前端（Calendar 日檢視、Coach review 列表）據此顯示每個 athlete 當日的完成狀態；要看實際 SetLog / plan vs actual 仍需另呼叫 `GET /sessions/{id}`。

---

## 3.6 Athlete Today View（Story 3）

### GET /me/scheduled-workouts?date=2026-08-13 — Athlete only

只回傳 `athleteId = caller` 的排程，exercises **一律來自 snapshot**（見第 2 節優先權規則）：

```json
[
  {
    "id": "...",
    "scheduledDate": "2026-08-13",
    "workoutName": "Monday Lower",
    "exercises": [
      {
        "scheduledWorkoutExerciseId": "...",
        "exerciseId": "...",
        "name": "Back Squat",
        "plan": { "sets": 4, "reps": 5, "rpe": 8 },
        "position": 1
      }
    ],
    "session": null
  }
]
```

`session` 非 null 時代表已開始/完成，前端據此顯示 Start / Resume / Done。

**注意：**行動端記錄 SetLog 用的是 `scheduledWorkoutExerciseId`，不是 `exerciseId`。

---

## 3.7 Workout Session（Story 3/4/7）

### POST /scheduled-workouts/{id}/session

開始訓練。允許：該排程的 athlete 本人，或其 connected coach；其他呼叫者 `404 NOT_FOUND`（不透露該 ScheduledWorkout 是否存在 — 見 §1）。`{id}` 格式錯誤 → `400 INVALID_ARGUMENT`。

Response body 固定為（不含 `athleteId`、`scheduledWorkoutId`、`startedAt`、`completedAt` — 完整 session detail 屬於 `GET /sessions/{sessionId}` 的職責，不在此重複）：

```json
{ "id": "...", "status": "ACTIVE" }
```

- 尚無 session → 建立新 session，HTTP **`201 Created`**，回傳上述 shape
- 已存在 ACTIVE session → 回傳既有 session（冪等，同一 shape），HTTP `200`
- 已 COMPLETED → 不重新啟動、不修改，`409 CONFLICT`

### POST /sessions/{sessionId}/complete

結束訓練。授權同上。COMPLETED 後 session 唯讀（SetLog 不可再增刪改），且不可再轉回 ACTIVE。

Response body 固定為（與 `POST .../session` 同一 `Session` shape，不含 `completedAt` — 理由同上，完整 detail 屬於 `GET /sessions/{sessionId}`）：

```json
{ "id": "...", "status": "COMPLETED" }
```

- ACTIVE → COMPLETED 成功 → HTTP `200`
- 已 COMPLETED → 不重複轉換、不修改 `completed_at` → `409 CONFLICT`

### GET /sessions/{sessionId}

回傳 plan vs actual（Story 7 的畫面直接用這支）：

```json
{
  "id": "...",
  "status": "COMPLETED",
  "athlete": { "id": "...", "name": "Kevin" },
  "exercises": [
    {
      "scheduledWorkoutExerciseId": "...",
      "name": "Back Squat",
      "plan": { "sets": 4, "reps": 5, "rpe": 8 },
      "setLogs": [
        { "id": "...", "setNumber": 1, "load": 100, "unit": "kg", "reps": 5, "rpe": 7, "loggedByUserId": "..." }
      ]
    }
  ]
}
```

`plan` 與 `name` 直接取自 snapshot — 無論教練事後如何修改模板或動作名稱，此回應永遠反映當日實際處方。

授權：athlete 本人或 connected coach，其他人 `404`。

---

## 3.8 Set Logging（Story 4 — 唯一寫入口）

### POST /sessions/{sessionId}/set-logs

**全系統唯一的 SetLog 寫入入口。**手動輸入、語音解析結果、未來 AI command 全部收斂到這支：

```
Manual UI ──┐
Voice parser ├──> POST /sessions/{id}/set-logs ──> validation ──> DB
AI command ──┘
```

Request（有負重）：

```json
{
  "scheduledWorkoutExerciseId": "...",
  "load": 100,
  "unit": "kg",
  "reps": 5,
  "rpe": 7
}
```

Request（bodyweight，如 push-up）：

```json
{
  "scheduledWorkoutExerciseId": "...",
  "reps": 12,
  "rpe": 8
}
```

Service 層規則：

1. session 存在且 ACTIVE → 否則 404 / 409
2. caller 是該 session 的 athlete 或 connected coach → 否則 404
3. `scheduledWorkoutExerciseId` 屬於該 session 的 scheduled_workout → 否則 `400 INVALID_ARGUMENT`
4. 驗證：
    - `reps >= 1` 整數，**必填**（V0.1 僅支援 reps-based logging）
    - `load` **選填**；有值時 `load >= 0` 且 `unit` 必填 ∈ {kg, lb}；`load` 為 null 時 `unit` 必須也是 null
    - `rpe` 選填，1–10
5. `setNumber` 由 server 計算（見下），不信任 client
6. `loggedByUserId = caller.id`

Response `201`：完整 SetLog，欄位固定為：

```json
{
  "id": "...",
  "setNumber": 1,
  "load": 100,
  "unit": "kg",
  "reps": 5,
  "rpe": 7,
  "loggedByUserId": "..."
}
```

僅此七欄（`load`/`unit`/`rpe` 為選填，省略時不出現）。不回傳 `createdAt`、`sessionId`、`scheduledWorkoutExerciseId` — 呼叫端已知道這三者（分別來自 URL 與 request body），不重複於 response。

### setNumber 併發處理

DB 端：

```sql
UNIQUE (session_id, scheduled_workout_exercise_id, set_number)
```

Application 端：於 transaction 內取 `MAX(set_number) + 1` 後 insert；撞上 unique violation（SQLSTATE `23505`，且限定命中 `set_logs_session_id_scheduled_workout_exercise_id_set_numbe_key` 這個 constraint）則 retry。

**Retry 語意：**一次初始嘗試 + 最多三次額外的整筆 transaction 重試（共至多四次 insert 嘗試）。每次重試都是全新的 transaction，不是同一個 transaction 內迴圈——PostgreSQL 的 transaction 在任何 statement 出錯（含這裡預期的 unique violation）後即進入 aborted 狀態，之後的 statement 都會被拒絕，必須 rollback 才能繼續；因此每次重試皆為 `BEGIN` → 重新計算 `MAX(set_number) + 1` → `INSERT` → `COMMIT`/`ROLLBACK` 的完整循環,不使用 SAVEPOINT。只有命中上述 constraint 名稱的 23505 才視為預期的 setNumber 競爭而重試；任何其他錯誤（含撞到其他 unique constraint，例如 id/pkey 碰撞）一律直接回傳，不可被重試邏輯吞掉。

每次重試的 transaction 內，於計算 `MAX(set_number) + 1` 之前，先以 `SELECT status FROM workout_sessions WHERE id = $1 FOR SHARE` 重新確認 session 仍為 `ACTIVE`；若併發轉為 `COMPLETED`（即使 V0.1 尚未實作 Complete Session），本次 insert 需中止並回傳 `409 CONFLICT`，而不是寫入一筆屬於已完成 session 的 SetLog。

unique constraint 是正確性底線，不能只靠應用層計數。

### PATCH /set-logs/{setLogId}

部分更新。只允許出現的欄位被更新；未提及欄位不動。更新後仍須滿足 load/unit 配對規則。授權同上，且 session 必須 ACTIVE。

### DELETE /set-logs/{setLogId}

對應「刪掉上一組」。授權同上，session 必須 ACTIVE。

---

## 3.9 Voice Command（Story 5/6）— Optional MVP Experiment

> **範圍聲明：**V0.1 的 P0 是 core training loop（create → schedule → start → log → complete → review）。**時間不足時，第一個移出 V0.1 demo 的是 Story 5/6，而不是 Go backend 或 core loop 的任何一環。**
> 

STT + LLM 解析放在 Next.js route handler；Go 只接收結構化結果。

LLM 輸出必須符合以下 schema，**strict decode（`DisallowUnknownFields`），多一個欄位就拒絕**：

```json
{ "action": "CREATE_SET_LOG", "load": 100, "unit": "kg", "reps": 5, "rpe": 7 }
```

```json
{ "action": "UPDATE_PREVIOUS_SET", "changes": { "load": 105 } }
```

```json
{ "action": "DELETE_PREVIOUS_SET" }
```

映射規則（在 Next.js 層做，再轉打 Go）：

- **LLM 輸出不含任何 ID**（它不可能知道 DB 的 UUID，要求它輸出只會得到幻覺）。Next.js 層注入 client 端「目前 active exercise」的 `scheduledWorkoutExerciseId` 後才打 Go
- **語音永遠只作用於當前 active session + active exercise**。語句中出現的動作名稱或人名（「Kevin 深蹲…」）視為自然冗餘，一律忽略、不做 name→entity 匹配；名稱解析屬 future extension
- `CREATE_SET_LOG` → 注入 ID 後 `POST /sessions/{id}/set-logs`
- `UPDATE_PREVIOUS_SET` → 前端持有「最近一筆 setLogId」→ `PATCH /set-logs/{id}`
- `DELETE_PREVIOUS_SET` → `DELETE /set-logs/{id}`
- schema 驗證失敗 → 顯示原文讓使用者手動修正，**不落地**（LLM never writes directly to the database）

「previous set」= 目前 active session + active exercise 中 `createdAt` 最新的一筆，僅存在於 client context。AI 無法指定任意歷史紀錄。

---

# 4. 權限矩陣 (Authorization Matrix)

| Endpoint | Coach (owner/connected) | Athlete (本人) | 無關使用者 |
| --- | --- | --- | --- |
| GET/POST /exercises | ✅ (公用+自己的；POST 僅建自己的 private Exercise) | ❌ 403 | ❌ 403 |
| POST /workouts | ✅ | ❌ 403 | ❌ 403 |
| GET/PATCH/DELETE /workouts/{id} | ✅ owner | ❌ 404 | ❌ 404 |
| GET /athletes | ✅ | ❌ 403 | ❌ 403 |
| POST /scheduled-workouts | ✅ 且每個 athlete 都需 connected | ❌ 403 | ❌ 403 |
| GET /scheduled-workouts | ✅ 僅回自己建立的排程（`athleteId` 選填；未連結該 athlete → 404，見 §3.5） | ❌ 403 | ❌ 403 |
| GET /me/scheduled-workouts | ➖ (回自己的=空) | ✅ | ✅ (空) |
| POST .../session (start) | ✅ connected | ✅ | ❌ 404 |
| POST /sessions/{id}/complete | ✅ connected | ✅ | ❌ 404 |
| GET /sessions/{id} | ✅ connected | ✅ | ❌ 404 |
| POST /sessions/{id}/set-logs | ✅ connected | ✅ | ❌ 404 |
| PATCH/DELETE /set-logs/{id} | ✅ connected | ✅ | ❌ 404 |

矩陣即 service 層的測試清單：每列至少三個 test case（允許、拒絕、404 隱藏）。

---

# 5. 資料表

> 下列為目前已實作的 schema shape，不是 V0.6 planned-set semantics 的最終 storage design。不得僅因這份文件的產品決策而修改 migration 或推定欄位/關聯。

```sql
users(id, firebase_uid unique, name, role, created_at)

coach_athletes(coach_id, athlete_id, primary key(coach_id, athlete_id))

exercises(id, name, owner_coach_id null, created_at)
  -- owner_coach_id NULL = 系統公用動作
  -- 唯一性用兩個 partial unique index（見 3.2）

workouts(id, coach_id, name, archived_at null, created_at)

workout_exercises(id, workout_id, exercise_id,
                  target_sets, target_reps null, target_prescription_note null,
                  target_rpe null, position)
  -- CHECK (target_reps IS NOT NULL OR target_prescription_note IS NOT NULL)
  -- UNIQUE (workout_id, position)

scheduled_workouts(id, workout_id, coach_id, athlete_id, scheduled_date, created_at)

scheduled_workout_exercises(id, scheduled_workout_id, exercise_id,
                            exercise_name, target_sets,
                            target_reps null, target_prescription_note null,
                            target_rpe null, position)
  -- prescription snapshot；顯示一律讀本表，exercise_id 僅供 analytics 關聯
  -- UNIQUE (scheduled_workout_id, position)

workout_sessions(id, scheduled_workout_id unique, athlete_id,
                 status, started_at, completed_at)

set_logs(id, session_id, scheduled_workout_exercise_id, set_number,
         load numeric null, unit text null, reps integer not null, rpe numeric null,
         logged_by_user_id, created_at)
  -- UNIQUE (session_id, scheduled_workout_exercise_id, set_number)
  -- CHECK ((load IS NULL) = (unit IS NULL))   -- load 與 unit 同進退
  -- reps not null：V0.1 僅支援 reps-based logging
```

重點：

- `workout_sessions.scheduled_workout_id` unique → 一個排程一個 session，start 冪等靠 constraint 兜底
- `set_logs` 三欄 unique 是 setNumber 正確性底線
- `set_logs` 的 CHECK 保證不會出現「有重量沒單位」或「有單位沒重量」的紀錄

---

# 6. 實作順序（對齊 8/16）

| # | 內容 | 對應 Story | 估時 |
| --- | --- | --- | --- |
| 1 | repo + migration + `/health`  • auth middleware + `/me` | — | 半天 |
| 2 | exercises seed（公用目錄）+ Workouts CRUD | Story 1 | 1 天 |
| 3 | Scheduling（batch + snapshot）+ Today view | Story 2/3 | 1 天 |
| 4 | Session + SetLog CRUD + plan vs actual | Story 4/7 | 1 天 |
| 5 | 跑 spec 的 end-to-end 驗收（去掉語音的 11 步） | — | 半天 |
| 6 | Voice 層（Next.js → Go endpoint） | Story 5/6 | 有剩才做 |

**斷點原則：**

1. Core loop 不得為 Voice 延誤。時間不足時，Story 5/6 直接移出 V0.1 demo。
2. 若週四結束時第 4 步仍未完成 → 剩餘部分改用 Next.js Route Handlers 收尾，Go 移至 refactor branch。順序不可顛倒。

---

# 7. Future Architecture（只記錄，V0.1 不實作）

> 原則：V0.1 schema 要做到的是「未來不會卡死」，不是「現在就支援所有未來功能」。
> 

## 7.1 Planned-set prescription — approved semantics, design pending

V0.1 product behavior now requires ordered planned-set positions, uniform defaults, individual overrides, prescribed load/unit, and planned-versus-actual alignment. For example, `100×5@7 / 105×5@8 / 110×3@9` must be representable as three distinct effective planned positions.

Possible implementations include normalized planned-set rows, structured values, or another relational representation. This contract deliberately does **not** choose one. In particular, do not assume `plan.sets` will become an array or that a future SetLog must use a particular foreign key before the architecture session defines compatibility, migration, and execution rules.

## 7.2 Time/distance-based actual metrics

V0.1 的 SetLog 僅支援 reps-based logging。未來支援 Plank 30 sec、Sprint 20 m、Bike 5 min 時，擴充方式是加 metric 欄位（如 `duration_seconds`、`distance_m`）並放寬「至少一種 actual metric 存在」的 CHECK，**而不是**把 reps 改成字串。

## 7.3 WorkoutItem abstraction

課表裡不是每個項目都是動作（Rest 2 min、Coach Note、Video）。未來若要支援：

```
workout_items(id, workout_id, type: EXERCISE|NOTE|REST|VIDEO, exercise_id null, position, config jsonb)
```

`type = EXERCISE` 才 reference exercise_id。**V0.1 只有 WorkoutExercise，不做 polymorphic item**；也不在 exercises 表上加 type 欄位。

## 7.4 同名不同 identity 的 exercise

V0.1 的 name find-or-create 規則下，system exercise 名稱優先且同名即同 identity。未來若需教練建立與 system 同名的私有變化版，改以 explicit `exerciseId` 傳入。

## 7.5 Program / Calendar

TeamBuildr 是 team-scale（Calendar 承載 program、athlete 訂閱 + offset）。我們的 1:1 場景用 per-athlete ScheduledWorkout 更正確，不採用 TeamBuildr 的 enterprise Calendar/Program/Offset model。

> **V0.5 更新（已確認為 V0.1 決策，非未來推測）：** Calendar 是 Coach 的 primary workspace，屬於前端 information architecture，直接建構在既有 `ScheduledWorkout` 模型之上 — 不是新的 domain object，也沒有新增 endpoint。因此唯一調整的是 §3.5 `GET /scheduled-workouts`：`athleteId` 改為選填，供 Calendar 日/週跨 athlete 檢視使用；資料語意（snapshot、授權）完全不變。路由與畫面詳見 `docs/frontend-ui-spec.md`；產品故事詳見 `docs/mvp-specification.md`「Navigation Principle」與 Story 1。
> 

## 7.6 明確不做（V0.1 Out of Scope 對齊）

Weightroom View、PR 追蹤 / Team Feed、Superset 分組、Track Volume/Reps 開關、Video、穿戴裝置。
