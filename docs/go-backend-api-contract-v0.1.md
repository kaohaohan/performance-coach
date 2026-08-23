# DontWorkout — Go Backend API Contract (V0.1)

Status: **V0.8 — implemented.** Planned-set contract shipped in migration `0002_planned_set_prescription`; onboarding and invite codes in `0003_coach_invite_codes`.

Target: 2026-08-16

對應文件: MVP Specification, Frontend UI Spec

Stack: Go (net/http or chi) + pgx/sqlc + PostgreSQL · Auth: Firebase Auth (JWT)

Repo: 先用 neutral codename（如 `performance-coach`），品牌定案後再 rename module path

> V0.8 變更（D1c — structured logging，`docs/deployment-architecture-v0.2.md` §12）：所有 response 新增 `X-Request-Id` header，純附加，不影響任何既有 route/request/response shape/status code，錯誤 body 仍是 `{"error":{"code","message"}}`。詳見上方 Base 一節。
>

> V0.7 architecture decision: V0.1 uses a hybrid planned-set model. Workout templates author exercise defaults plus sparse per-position overrides; scheduling resolves them into fully expanded, immutable planned-set snapshot rows; normal SetLogs explicitly reference one snapshot planned set while `setNumber` remains actual chronology. Extra SetLogs are allowed without a planned-set reference; incomplete planned positions have no SetLog and no persisted skipped row.

> V0.7 scope decision: this controlled pilot revises the existing `/api/v1` contract through one coordinated frontend/backend migration. Do not add `/api/v2`, dual-read, dual-write, or legacy deprecation machinery. The code and initial migration remain scalar until an implementation phase is separately approved; this document defines the target contract for that phase.

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
- Response header `X-Request-Id`：V0.8 新增，每個 response（含 timeout/503）都會帶。純附加，不改變任何既有 route/request/response shape/status code；一律由伺服器產生，不採信 inbound 的 `X-Request-Id`。用於對照 Cloud Logging 中對應的請求日誌（`docs/deployment-architecture-v0.2.md` §12）。錯誤格式（下方）維持 `{"error":{"code","message"}}` 不變，請求 id 不進入 body。

## Authentication

### Route protection modes

每條 route 屬於下列三種之一：

| Mode | Middleware 行為 | Route |
| --- | --- | --- |
| **Public** | 不檢查 `Authorization` | health check、`GET /invite-codes/{code}/preview` |
| **Firebase-authenticated (app account optional)** | 驗 JWT 取 `uid`；**不要求** `users` 有對應 row | `POST /coach-signup`、`POST /invite-codes/{code}/redeem` |
| **Application-user authenticated** | 驗 JWT 取 `uid` → 查 `users` 得 internal user + role；查不到 → `401 UNAUTHENTICATED` | 其餘所有 endpoint |

Firebase-authenticated (app account optional) 的 route **不得**因為 `users` 沒有 row 就回 `401`：這兩條 endpoint 同時要服務「還沒有帳號」與「已經有帳號」兩種 caller，前者是它們的正常輸入。

### Caller states

權限矩陣（§4）以下列四種 caller state 表達：

| Caller state | 判定 |
| --- | --- |
| **Unauthenticated** | 無 `Authorization` header，或 token 無效 |
| **Firebase-authenticated, no app account** | Token 驗證通過，`users` 尚無對應 row |
| **Coach** | Token 通過且 `users.role = COACH` |
| **Athlete** | Token 通過且 `users.role = ATHLETE` |

**Authentication ≠ Authorization。**Firebase 只負責「你是誰」，application identity（`users.id`）與角色權限一律由本系統決定。Role 於建立帳號時決定，之後永不變更。

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
WorkoutExercise           { id, workoutId, exerciseId, setCount, defaults, loadUnit?, position }
WorkoutExerciseSetOverride { id, workoutExerciseId, plannedPosition, reps?|prescriptionNote?|load?|rpe? }
ScheduledWorkout          { id, workoutId, coachId, athleteId, scheduledDate }
ScheduledWorkoutExercise  { id, scheduledWorkoutId, exerciseId, exerciseName, targetLoadUnit?, position }  // snapshot parent
ScheduledWorkoutPlannedSet { id, scheduledWorkoutExerciseId, plannedPosition, reps?|prescriptionNote?, load?, rpe? } // resolved snapshot
WorkoutSession            { id, scheduledWorkoutId, athleteId, status: ACTIVE|COMPLETED, startedAt, completedAt }
SetLog                    { id, sessionId, scheduledWorkoutExerciseId, scheduledWorkoutPlannedSetId?, setNumber, load?, unit?, reps, rpe, loggedByUserId, createdAt }
```

### 2.1 Approved planned-set semantics and representation

- For an exercise with `N` sets, its **effective** plan contains exactly `N` ordered planned positions, numbered `1..N`.
- The **authoring model** has exercise-level property defaults plus sparse, property-specific per-position overrides. A position with no override for a property inherits that default. Builder defaults are uniform shorthand: one reps value or text prescription, one load plus unit, and one RPE may apply to every position. The Coach must not be required to enter N repeated values for uniform work.
- An individual position may override one or more inherited default values without becoming an all-or-nothing override object. For example, it can override reps while inheriting load and RPE. Planned-set position is separate from `WorkoutExercise.position`, which orders exercises within a Workout.
- Entering individual-set editing for an inherited property starts from that position's current effective value; changing it creates an explicit override. Changing a default updates only positions inheriting that property. Clearing an override restores inheritance from the current default.
- V0.1 supports only inherited or explicit-value override states. It has no explicit-none override. An omitted override property inherits; an override property with a value replaces only that property.
- An effective planned position expresses numeric reps **or** text prescription, optional numeric planned load, and optional planned RPE. One optional `kg`/`lb` planned load unit belongs to the WorkoutExercise and is shared by its default load and every load override. Per-position unit overrides and mixed planned units are not supported. Changing the exercise unit changes the unit of every effective planned load without numeric conversion. Actual SetLog unit remains independent.
- Template persistence keeps defaults plus sparse overrides. Scheduling resolves all `1..N` positions and persists normalized `ScheduledWorkoutPlannedSet` snapshot rows; Athlete-facing reads use these rows and do not expose authoring provenance.
- Scheduling freezes the **effective** planned positions for every athlete snapshot. A later Workout-template default or override edit must not change an existing ScheduledWorkout.
- A normal SetLog explicitly references one frozen `ScheduledWorkoutPlannedSet`. `setNumber` is still generated by the server as actual logging chronology and is not inferred to equal planned position. At most one SetLog in a session may reference a given planned set.
- An extra actual SetLog has no planned-set reference and is reported as EXTRA. A planned position with no SetLog remains incomplete; V0.1 does not create skipped rows.

The target wire shapes are defined below. No migration or code change is authorized merely by this contract update.

## 核心概念

**Exercise vs WorkoutExercise**

- `Exercise` = 「Back Squat」這個動作本身
- `WorkoutExercise` = Back Squat 在某份課表裡的 prescription（4×5 @ RPE 8）

**動作庫的擁有權**

- `ownerCoachId = NULL` → 系統 seed 的公用目錄
- `ownerCoachId = 某教練` → 該教練的私有動作（其他教練看不到、名稱不互相衝突）

**Prescription snapshot（含欄位優先權規則）**

排程當下把 WorkoutExercise 複製成 ScheduledWorkoutExercise。之後教練改課表模板，**不會污染已發生的訓練歷史**。

> **Snapshot 欄位優先於 Exercise current state。**所有歷史顯示（Today view、session 詳情、plan vs actual）一律讀 `scheduled_workout_exercises.exercise_name/target_load_unit` 與其 `scheduled_workout_planned_sets` resolved targets，**永不 join 回現行 `exercises` 或 `workout_exercises` 取名稱或處方**。保留的 `exercise_id` 唯一用途是 analytics / 跨課表動作歷史關聯（例如「Back Squat 的負荷趨勢」）。動作事後改名，歷史顯示不變，這是 by design。
> 

```
Workout ──1:N──> WorkoutExercise ──N:1──> Exercise (公用或私有)
   │
   └──> ScheduledWorkout ──1:N──> ScheduledWorkoutExercise  ← prescription (凍結)
                │
                └──> WorkoutSession ──1:N──> SetLog          ← actual
```

`SetLog` 仍掛在 `ScheduledWorkoutExercise` 的 session context 下；normal SetLog 另外以 `scheduledWorkoutPlannedSetId` 明確連到 frozen planned position。Extra SetLog 保留 exercise context，但 planned-set reference 為 null。

**Prescription 的模糊性**

Authoring defaults and each effective snapshot position contain exactly one of numeric `reps` or `prescriptionNote`（"AMAP"、"30 sec"、"10–12"）— naming deliberately stays broader than reps because a text prescription is not an actual metric. SetLog validation remains reps-based in §3.8.

---

# 3. Endpoints

> **Implemented contract.** The shapes in this section match the shipped `/api/v1` implementation after migrations `0002_planned_set_prescription` and `0003_coach_invite_codes`. There is no parallel V2 contract.

## 3.1 Me

### GET /me

```json
{ "id": "...", "name": "Kevin", "role": "ATHLETE" }
```

### POST /api/v1/coach-signup — Firebase-authenticated (app account optional)

自助建立 Coach 帳號，取代「由 operator 手動執行 bootstrap」作為產品路徑；bootstrap 僅保留給緊急/維運用途。

Request：

```json
{ "name": "Kao" }
```

Response `200`：

```json
{ "id": "...", "name": "Kao", "role": "COACH" }
```

| 情況 | 結果 |
| --- | --- |
| 該 Firebase uid 尚無 `users` row | 建立 `role = COACH` 的帳號 |
| 已存在且 `role = COACH` | 冪等回傳既有 row，**不覆寫 `name`** |
| 已存在且 `role = ATHLETE` | `409 CONFLICT` |
| 建立路徑上 `name` 為空或超過 80 字元 | `400 INVALID_ARGUMENT` |

`name` 僅在建立路徑必填；既有 coach 重複呼叫可省略。
Firebase uid 只取自已驗證 token；request body 不含也不接受 `firebaseUid`、`role` 或任何 id。

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
    {
      "name": "Back Squat",
      "plan": {
        "setCount": 5,
        "defaults": { "reps": 10, "load": 80, "unit": "kg", "rpe": 8 },
        "overrides": [
          { "position": 3, "reps": 8 },
          { "position": 5, "load": 90, "rpe": 9 }
        ]
      }
    },
    {
      "name": "Push Up",
      "plan": {
        "setCount": 1,
        "defaults": { "prescriptionNote": "AMAP" },
        "overrides": []
      }
    }
  ]
}
```

驗證：

- `name` 非空；`exercises` 至少 1 筆
- `plan.setCount` 為正整數；建立 exactly `1..setCount` 個 effective planned positions
- `plan.defaults.reps` 與 `plan.defaults.prescriptionNote` **恰好一個存在**；reps 為正整數，note trim 後非空
- `plan.defaults.load` 選填且需 `>= 0`；任何 default/override load 存在時，`plan.defaults.unit` 必填且只能是 `kg` 或 `lb`
- `plan.defaults.unit` 是整個 WorkoutExercise 的 planned unit；override 不接受 `unit`
- default/override `rpe` 選填，範圍 1–10
- `overrides[].position` 必須唯一且介於 `1..setCount`
- 一筆 override 至少包含 `reps`、`prescriptionNote`、`load`、`rpe` 之一；若覆寫 prescription，`reps` 與 `prescriptionNote` 恰好一個存在
- override 欄位省略或為 null 都代表 inheritance/clear-override；null **不**代表 explicit no-target。Response 省略 inherited properties，空 override row 必須移除

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
      "plan": {
        "setCount": 5,
        "defaults": { "reps": 10, "load": 80, "unit": "kg", "rpe": 8 },
        "overrides": [
          { "position": 3, "reps": 8 },
          { "position": 5, "load": 90, "rpe": 9 }
        ]
      },
      "position": 1
    },
    {
      "workoutExerciseId": "...",
      "exerciseId": "...",
      "name": "Push Up",
      "plan": {
        "setCount": 1,
        "defaults": { "prescriptionNote": "AMAP" },
        "overrides": []
      },
      "position": 2
    }
  ]
}
```

Coach-facing Workout responses return authoring metadata (`defaults + overrides`) so future template editing can preserve inheritance. They do not replace this with expanded rows. Array order still determines exercise `position`; planned `overrides[].position` is a different ordinal inside that exercise.

### GET /workouts — Coach only

只回傳 `coachId = 呼叫者` 的清單。

### GET /workouts/{workoutId} — Coach only（owner）

### PATCH /workouts/{workoutId} — Coach only（owner）

**可自由修改**，包含已被排程過的 workout。因為 prescription 已 snapshot，歷史不受影響。

### DELETE /workouts/{workoutId} — Coach only（owner）

Soft delete（`archived_at`）。已封存的 workout 不出現在清單，也不可再排程。V0.1 不 hard delete Workout；`scheduled_workouts.workout_id` 的 FK 不使用 `ON DELETE CASCADE`，避免刪除模板時破壞既有排程與歷史 snapshot。

---

## 3.4 Coach–Athlete Relationship

關係由**邀請碼**建立：Coach 產生可重複使用的碼，Athlete 自行兌換。Coach 無法單方面建立關係。Seed 僅供測試與維運。

### POST /invite-codes — Coach only

Request：

```json
{ "description": "Fall squad", "expiresInDays": 30 }
```

`description` 與 `expiresInDays` 皆可為 `null` 或省略；`expiresInDays` 省略時預設 30。

Response `201`：

```json
{
  "id": "...",
  "code": "...",
  "description": "Fall squad",
  "status": "ACTIVE",
  "expiresAt": "...",
  "revokedAt": null,
  "createdAt": "..."
}
```

`status` ∈ `ACTIVE` / `EXPIRED` / `REVOKED`，於讀取時依 `expiresAt` 與 `revokedAt` 推導，不儲存。
非 Coach → `403 FORBIDDEN`。

### GET /invite-codes — Coach only

回傳呼叫者自己的碼，`createdAt` 由新到舊。非 Coach → `403 FORBIDDEN`。

### POST /invite-codes/{id}/revoke — Coach only（owner）

冪等。撤銷為 **forward-only**：阻止後續兌換，不解除已加入的 Athlete。
非 owner 或不存在 → 一律 `404 NOT_FOUND`，不區分兩者。

### GET /invite-codes/{code}/preview — Public

供 Athlete 在加入前確認對象。

Response `200`：

```json
{ "code": "...", "coachName": "Kao", "description": "Fall squad" }
```

**不含任何 id**（無 `coachId`、無 invite id）。
未知 / 格式錯誤 / 已過期 / 已撤銷 → 一律 `404 NOT_FOUND`，因此本 endpoint 無法用來確認某個碼是否曾經存在。

### POST /invite-codes/{code}/redeem — Firebase-authenticated (app account optional)

Request：

```json
{ "name": "Kevin" }
```

`name` 僅在需要建立新 `users` row 時必填。

Response `200`：

```json
{
  "user": { "id": "...", "name": "Kevin", "role": "ATHLETE" },
  "coach": { "name": "Kao" }
}
```

| 情況 | 結果 |
| --- | --- |
| 尚無 `users` row | 建立 `role = ATHLETE` 並連結該 coach |
| 已是 Athlete、尚未連結 | 建立連結 |
| 已是 Athlete、已連結同一 coach | 冪等成功，不重複建立 |
| 已是 Coach（含兌換自己的碼） | `403 FORBIDDEN` |
| 碼無效（同 preview 的四種情況） | `404 NOT_FOUND` |

一位 Athlete 可連結多位 Coach。既有 row 的 `name` 與 `role` 一律原樣讀回，永不覆寫。

### DELETE /athletes/{athleteId} — Coach only（connected）

`204 No Content`。只刪除 `coach_athletes` 關係，**不刪 `users` row、不動 Firebase 帳號、不動訓練紀錄**。
未連結、不存在、或 `athleteId` 非合法 UUID → 一律 `404 NOT_FOUND`。

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
  "scheduledDate": "2026-08-14",
  "allowDuplicates": false
}
```

`allowDuplicates`：**選填**，預設 `false`（即預設會擋）。見下方檢查 3。

Service 層檢查（依序）：

1. workout 存在、未封存、且 `workout.coachId == caller.id` → 否則 404
2. `athleteIds` 非空、無重複；**每一個** athleteId 都有 `CoachAthlete(caller, athleteId)` 關係 → 任一不符回 `403 FORBIDDEN`（全有全無，不做部分成功）
3. **V0.9 新增｜重複排程防呆**：`allowDuplicates` 為 `false`（或省略）時，若任一 athlete 已有**同一 coach、同一 workout、同一日期**的排程 → `409 CONFLICT`，`message` 會列出這些 athlete 的名字。與檢查 2 一致採全有全無：整批拒絕，不做部分排程。

   這是**防呆，不是 domain rule**。同一天排同一份 workout 兩次是合法的訓練安排（例如 AM/PM 兩堂），所以 client 可以在讓教練確認後、帶 `allowDuplicates: true` 重送同一請求來完成排程。也正因如此，`scheduled_workouts` **刻意沒有**對應的資料庫 UNIQUE constraint — 那會讓合法情境變成不可能，而不只是需要確認。

   檢查在 Create 既有的同一個 transaction 內、對即將寫入的同一批 row 執行，因此不像前端預先檢查那樣可被 race。四個維度缺一不可：換日期、換 athlete、換 workout、換 coach 都不算重複（另一位 coach 把共用 template 排給同一位 athlete 的同一天是各自獨立的排程，且不得向任一方洩漏對方的排程）。

   已存在的重複資料不受影響 — 本檢查只防止新的意外，不清理歷史（系統目前也沒有刪除排程的能力）。

通過後先 deterministic resolve 每個 template exercise 的 defaults + sparse overrides，得到 exactly `1..setCount` effective positions。於 **同一 transaction** 內，對每個 athlete：建立一筆 `scheduled_workouts` → 建立 snapshot exercise（含 frozen `exercise_name` 與 planned unit）→ 建立完整 resolved `ScheduledWorkoutPlannedSet` rows。每位 athlete 都有自己的 snapshot row IDs。

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
        "plan": {
          "sets": [
            { "scheduledWorkoutPlannedSetId": "...", "position": 1, "reps": 10, "load": 80, "unit": "kg", "rpe": 8 },
            { "scheduledWorkoutPlannedSetId": "...", "position": 2, "reps": 10, "load": 80, "unit": "kg", "rpe": 8 },
            { "scheduledWorkoutPlannedSetId": "...", "position": 3, "reps": 8, "load": 80, "unit": "kg", "rpe": 8 },
            { "scheduledWorkoutPlannedSetId": "...", "position": 4, "reps": 10, "load": 80, "unit": "kg", "rpe": 8 },
            { "scheduledWorkoutPlannedSetId": "...", "position": 5, "reps": 10, "load": 90, "unit": "kg", "rpe": 9 }
          ]
        },
        "position": 1
      }
    ]
  }
]
```

Coach template responses use numeric `plan.setCount`; scheduled responses use `exercises[].plan.sets` as the ordered frozen effective array. Every planned set has exactly one of `reps` or `prescriptionNote`; `load` and `unit` are both present or both omitted.

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

### GET /scheduled-workouts/{id} — Coach only

**V0.6 新增**：讀取單一 ScheduledWorkout 的展開 snapshot（含 exercises 與 resolved planned sets），僅限擁有者 coach（`coachId != caller.id` → `404 NOT_FOUND`，同上）。存在的唯一理由是給 Coach Calendar 的 Edit 動作 prefill 表單——上面 `GET /scheduled-workouts`（list）刻意不含 exercises,單筆 detail 沒有其他讀取路徑。Response 與 POST 相同的單一元素形狀，差別是 `session` 反映實際狀態（可能非 null）而不是固定 `null`。

### PUT /scheduled-workouts/{id} — Coach only

**V0.6 新增**：修正意外指派錯誤的排程。Coach 只能編輯**尚未開始訓練**（`workout_sessions` 尚無對應 row）的自己的 ScheduledWorkout；一旦 `ACTIVE` 或 `COMPLETED`，一律 `409 CONFLICT`，永久唯讀。這是修正意外指派的**唯一**入口 — 絕不透過編輯 reusable Workout template 再重新 snapshot 所有 athlete 來達成同樣效果（那會靜默改到其他 athlete、甚至其他日期的排程）。

Request body 沿用 POST /workouts 的 per-exercise 形狀（`exercises[].name` + `plan`），**沒有頂層 `name`**：ScheduledWorkout 本身沒有名稱欄位，顯示名稱一律 join 自 reusable Workout（見上方 GET 回應範例），本 endpoint 不觸碰它。

```json
{
  "exercises": [
    {
      "name": "Back Squat",
      "plan": {
        "setCount": 4,
        "defaults": { "reps": 8, "load": 100, "unit": "kg", "rpe": 8 },
        "overrides": []
      }
    }
  ]
}
```

Service 層檢查（依序）：

1. caller 必須是 COACH → 否則 403
2. `id` 必須是合法 UUID → 否則 400
3. `exercises` 非空、每個 `name` 非空、每個 `plan` 通過與 POST /workouts 相同的 prescription 驗證規則 → 否則 400（在任何 DB 存取前完成，與 POST /scheduled-workouts 的既有順序原則一致）
4. ScheduledWorkout 存在且 `coachId == caller.id` → 否則 `404 NOT_FOUND`（resource-scoping，非 role check，不透露它屬於另一個 coach——與 §3.5 既有慣例一致）
5. 尚無 `workout_sessions` row（無論 `ACTIVE` 或 `COMPLETED`）→ 否則 `409 CONFLICT`

第 4-5 步與所有寫入都在**同一個 transaction**內完成：先以 `SELECT ... FOR UPDATE` 鎖住該 ScheduledWorkout row，再檢查 session；驗證失敗或任何寫入失敗都不留下部分寫入。這個鎖同時是併發保護——若一個 `POST .../session`（開始訓練）在編輯中途才嘗試 `INSERT`，會被同一 row 上的 foreign key 鎖擋住，直到本次編輯 commit 或 rollback 為止，athlete 因此永遠不會看到「編輯到一半」的 snapshot。

通過後刪除該 ScheduledWorkout 既有的 `scheduled_workout_planned_sets` 與 `scheduled_workout_exercises` row，重新以請求內容 resolve 並寫入新的 snapshot（`exercise_name`、`position`、frozen unit、resolved planned sets 的語意與 POST /scheduled-workouts 完全相同）。**只動這一筆 ScheduledWorkout**：既不動 reusable Workout template，也不動同一 template 指派給其他 athlete（或同一 athlete其他日期）的 ScheduledWorkout。

Response `200`：與 POST /scheduled-workouts 陣列中單一元素相同的形狀（展開後的新 snapshot；`session` 固定 `null`，因為能編輯就代表尚未開始訓練）。

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
        "plan": {
          "sets": [
            { "scheduledWorkoutPlannedSetId": "...", "position": 1, "reps": 10, "load": 80, "unit": "kg", "rpe": 8 },
            { "scheduledWorkoutPlannedSetId": "...", "position": 2, "reps": 10, "load": 80, "unit": "kg", "rpe": 8 },
            { "scheduledWorkoutPlannedSetId": "...", "position": 3, "reps": 8, "load": 80, "unit": "kg", "rpe": 8 }
          ]
        },
        "position": 1
      }
    ],
    "session": null
  }
]
```

`session` 非 null 時代表已開始/完成，前端據此顯示 Start / Resume / Done。

**注意：**行動端記錄 normal SetLog 同時送 active `scheduledWorkoutExerciseId` 與該 target 的 `scheduledWorkoutPlannedSetId`，不是 `exerciseId`。Extra SetLog 沒有 planned-set ID。

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
      "plan": {
        "sets": [
          { "scheduledWorkoutPlannedSetId": "11111111-1111-4111-8111-111111111111", "position": 1, "reps": 5, "load": 100, "unit": "kg", "rpe": 8 },
          { "scheduledWorkoutPlannedSetId": "22222222-2222-4222-8222-222222222222", "position": 2, "reps": 5, "load": 100, "unit": "kg", "rpe": 8 },
          { "scheduledWorkoutPlannedSetId": "33333333-3333-4333-8333-333333333333", "position": 3, "reps": 5, "load": 100, "unit": "kg", "rpe": 8 }
        ]
      },
      "setLogs": [
        { "id": "...", "kind": "PLANNED", "scheduledWorkoutPlannedSetId": "11111111-1111-4111-8111-111111111111", "plannedPosition": 1, "setNumber": 1, "load": 100, "unit": "kg", "reps": 5, "rpe": 7, "loggedByUserId": "..." },
        { "id": "...", "kind": "EXTRA", "setNumber": 4, "load": 90, "unit": "kg", "reps": 5, "rpe": 8, "loggedByUserId": "..." }
      ]
    }
  ]
}
```

`plan` 與 `name` 直接取自 snapshot — 無論教練事後如何修改模板或動作名稱，此回應永遠反映當日實際處方。Normal logs use `scheduledWorkoutPlannedSetId` for association; `plannedPosition` is a response convenience. EXTRA logs have neither field. Missing planned positions are found by comparing `plan.sets` with PLANNED logs; no SKIPPED row exists.

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
  "kind": "PLANNED",
  "scheduledWorkoutPlannedSetId": "...",
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
  "kind": "PLANNED",
  "scheduledWorkoutPlannedSetId": "...",
  "reps": 12,
  "rpe": 8
}
```

Request（extra actual set）：

```json
{
  "scheduledWorkoutExerciseId": "...",
  "kind": "EXTRA",
  "load": 90,
  "unit": "kg",
  "reps": 5,
  "rpe": 8
}
```

Service 層規則：

1. session 存在且 ACTIVE → 否則 404 / 409
2. caller 是該 session 的 athlete 或 connected coach → 否則 404
3. `scheduledWorkoutExerciseId` 屬於該 session 的 scheduled_workout → 否則 `400 INVALID_ARGUMENT`
4. `kind` 必須為 `PLANNED` 或 `EXTRA`：
    - `PLANNED` 必須提供 `scheduledWorkoutPlannedSetId`，且該 planned set 屬於同一個 `scheduledWorkoutExerciseId`；同一 session 不得已有 SetLog 指向該 planned set
    - `EXTRA` 必須省略 `scheduledWorkoutPlannedSetId`；extra 不受 prescribed set count 限制
5. 驗證 actual fields：
    - `reps >= 1` 整數，**必填**（V0.1 僅支援 reps-based logging）
    - `load` **選填**；有值時 `load >= 0` 且 `unit` 必填 ∈ {kg, lb}；`load` 為 null 時 `unit` 必須也是 null
    - `rpe` 選填，1–10
6. `setNumber` 由 server 計算（見下），只代表同 session + exercise 的 actual logging chronology，不信任 client，也不等同 planned position
7. `loggedByUserId = caller.id`

Response `201`：完整 SetLog，欄位固定為：

```json
{
  "id": "...",
  "kind": "PLANNED",
  "scheduledWorkoutPlannedSetId": "...",
  "plannedPosition": 1,
  "setNumber": 1,
  "load": 100,
  "unit": "kg",
  "reps": 5,
  "rpe": 7,
  "loggedByUserId": "..."
}
```

EXTRA response 回傳 `kind: "EXTRA"`，省略 `scheduledWorkoutPlannedSetId` 與 `plannedPosition`。`load`/`unit`/`rpe` 仍為選填。不回傳 `createdAt`、`sessionId`、`scheduledWorkoutExerciseId` — 呼叫端已知道這三者（分別來自 URL 與 request body），不重複於 response。

### setNumber 併發處理

DB 端：

```sql
UNIQUE (session_id, scheduled_workout_exercise_id, set_number)
```

Application 端：於 transaction 內取 `MAX(set_number) + 1` 後 insert；撞上 unique violation（SQLSTATE `23505`，且限定命中 `set_logs_session_id_scheduled_workout_exercise_id_set_numbe_key` 這個 constraint）則 retry。

**Retry 語意：**一次初始嘗試 + 最多三次額外的整筆 transaction 重試（共至多四次 insert 嘗試）。每次重試都是全新的 transaction，不是同一個 transaction 內迴圈——PostgreSQL 的 transaction 在任何 statement 出錯（含這裡預期的 unique violation）後即進入 aborted 狀態，之後的 statement 都會被拒絕，必須 rollback 才能繼續；因此每次重試皆為 `BEGIN` → 重新計算 `MAX(set_number) + 1` → `INSERT` → `COMMIT`/`ROLLBACK` 的完整循環,不使用 SAVEPOINT。只有命中上述 constraint 名稱的 23505 才視為預期的 setNumber 競爭而重試；任何其他錯誤（含撞到其他 unique constraint，例如 id/pkey 碰撞）一律直接回傳，不可被重試邏輯吞掉。

每次重試的 transaction 內，於計算 `MAX(set_number) + 1` 之前，先以 `SELECT status FROM workout_sessions WHERE id = $1 FOR SHARE` 重新確認 session 仍為 `ACTIVE`；若併發轉為 `COMPLETED`，本次 insert 需中止並回傳 `409 CONFLICT`，而不是寫入一筆屬於已完成 session 的 SetLog。

unique constraint 是正確性底線，不能只靠應用層計數。

Normal SetLog insert 另外受 partial unique `(session_id, scheduled_workout_planned_set_id) WHERE ... IS NOT NULL` 保護。兩個 request 同時 claim 同一 planned set 時，這不是 setNumber race，不做上述 retry；回 `409 CONFLICT`。不同 planned sets 同時 logging 若只撞 setNumber unique，保留同一 planned-set ID 重新計算 chronology 後 retry。EXTRA 的 planned-set ID 為 null，不受 partial unique 限制。

### PATCH /set-logs/{setLogId}

部分更新。V0.1 只允許更新 actual `load`/`unit`/`reps`/`rpe`；`kind`、planned-set association、exercise association、`setNumber`、`loggedByUserId` 不可變。未提及 actual 欄位不動；更新後仍須滿足 load/unit 配對規則。授權同上，且 session 必須 ACTIVE。

### DELETE /set-logs/{setLogId}

對應「刪掉上一組」。授權同上，session 必須 ACTIVE。刪除 normal log 後該 planned set 可再被 logging；新 SetLog 取得新的 server chronology `setNumber`，不重用被刪除的 number。

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

- **LLM 輸出不含任何 ID**（它不可能知道 DB 的 UUID，要求它輸出只會得到幻覺）。Next.js 層注入 client 端目前 active exercise 的 `scheduledWorkoutExerciseId`，以及選中的 `scheduledWorkoutPlannedSetId` 或 explicit EXTRA kind，才打 Go
- **語音永遠只作用於當前 active session + active exercise**。語句中出現的動作名稱或人名（「Kevin 深蹲…」）視為自然冗餘，一律忽略、不做 name→entity 匹配；名稱解析屬 future extension
- `CREATE_SET_LOG` → 注入 ID 後 `POST /sessions/{id}/set-logs`
- `UPDATE_PREVIOUS_SET` → 前端持有「最近一筆 setLogId」→ `PATCH /set-logs/{id}`
- `DELETE_PREVIOUS_SET` → `DELETE /set-logs/{id}`
- schema 驗證失敗 → 顯示原文讓使用者手動修正，**不落地**（LLM never writes directly to the database）

「previous set」= 目前 active session + active exercise 中 `createdAt` 最新的一筆，僅存在於 client context。AI 無法指定任意歷史紀錄。

---

# 4. 權限矩陣 (Authorization Matrix)

四種 caller state 的定義見 §1 Authentication。Coach / Athlete 欄位中的 owner、connected 條件與其失敗碼直接寫在格內；endpoint 專屬的冪等性與衝突行為寫在 Constraints 欄。

| Endpoint | Unauthenticated | Firebase, no app account | Coach | Athlete | Constraints / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /invite-codes/{code}/preview` | ✅ | ✅ | ✅ | ✅ | 除 health check 外唯一公開的 product endpoint；未知/格式錯/過期/已撤銷一律 `404`；回應不含任何 id |
| `POST /coach-signup` | ❌ 401 | ✅ 建立 COACH | ✅ 冪等回既有，不覆寫 `name` | ❌ 409 CONFLICT | `name` 僅建立路徑必填（≤ 80）；role 永不變更 |
| `POST /invite-codes/{code}/redeem` | ❌ 401 | ✅ 建立 ATHLETE 並連結 | ❌ 403 FORBIDDEN（含自己的碼） | ✅ 冪等連結 | 可連結多位 Coach；既有 row 的 `name`/`role` 不覆寫；無效碼 `404` |
| `POST /invite-codes` | ❌ 401 | ❌ 401 | ✅ `201` | ❌ 403 | `expiresInDays` 省略時預設 30 |
| `GET /invite-codes` | ❌ 401 | ❌ 401 | ✅ 僅自己的 | ❌ 403 | `createdAt` 由新到舊 |
| `POST /invite-codes/{id}/revoke` | ❌ 401 | ❌ 401 | ✅ owner；非 owner ❌ 404 | ❌ 403 | 冪等；forward-only，不解除已加入者 |
| `DELETE /athletes/{athleteId}` | ❌ 401 | ❌ 401 | ✅ connected；未連結 ❌ 404 | ❌ 403 | `204`；只解除關係，保留帳號與訓練紀錄；非法 UUID 亦回 `404` |
| `GET/POST /exercises` | ❌ 401 | ❌ 401 | ✅ 公用 + 自己的；POST 僅建自己的 private Exercise | ❌ 403 | — |
| `POST /workouts` | ❌ 401 | ❌ 401 | ✅ | ❌ 403 | — |
| `GET/PATCH/DELETE /workouts/{id}` | ❌ 401 | ❌ 401 | ✅ owner；非 owner ❌ 404 | ❌ 404 | — |
| `GET /athletes` | ❌ 401 | ❌ 401 | ✅ | ❌ 403 | — |
| `POST /scheduled-workouts` | ❌ 401 | ❌ 401 | ✅ 且每個 athlete 都需 connected | ❌ 403 | 任一 athlete 未連結則整批拒絕，不做部分排程；已排同一 workout + 同一日期 → `409`，除非帶 `allowDuplicates: true`，見 §3.5 |
| `GET /scheduled-workouts` | ❌ 401 | ❌ 401 | ✅ 僅回自己建立的排程 | ❌ 403 | `athleteId` 選填；未連結該 athlete → `404`，見 §3.5 |
| `GET /scheduled-workouts/{id}` | ❌ 401 | ❌ 401 | ✅ owner；非 owner ❌ 404 | ❌ 404 | 單筆展開 snapshot，供 Coach Calendar 的 Edit 表單 prefill；list 刻意不含 exercises |
| `PUT /scheduled-workouts/{id}` | ❌ 401 | ❌ 401 | ✅ owner 且尚未開始訓練 | ❌ 404 | 一旦有 `workout_sessions` row（ACTIVE 或 COMPLETED）→ `409 CONFLICT`，永久唯讀，見 §3.5 |
| `GET /me/scheduled-workouts` | ❌ 401 | ❌ 401 | ➖ 回自己的 = 空 | ✅ | 無關聯的 application user 得到空清單 |
| `POST .../session (start)` | ❌ 401 | ❌ 401 | ✅ connected；未連結 ❌ 404 | ✅ | 重複呼叫 resume 既有 ACTIVE session，不建立第二個 |
| `POST /sessions/{id}/complete` | ❌ 401 | ❌ 401 | ✅ connected；未連結 ❌ 404 | ✅ | — |
| `GET /sessions/{id}` | ❌ 401 | ❌ 401 | ✅ connected；未連結 ❌ 404 | ✅ | — |
| `POST /sessions/{id}/set-logs` | ❌ 401 | ❌ 401 | ✅ connected；未連結 ❌ 404 | ✅ | 併發 claim 同一 planned set → `409`，見 §3.8 |
| `PATCH/DELETE /set-logs/{id}` | ❌ 401 | ❌ 401 | ✅ connected；未連結 ❌ 404 | ✅ | — |

矩陣即 service 層的測試清單：每列至少三個 test case（允許、拒絕、404 隱藏）。

---

# 5. Persistence semantics the API relies on

> Table、欄位、constraint 與 index 的 canonical owner 是 `docs/database-schema-relationships.md`（§3 現行 shape、§6 integrity rules）。本節不重述 schema，只記錄 API 行為所依賴的持久化語意。

- `workout_sessions.scheduled_workout_id` 唯一 → 一個 ScheduledWorkout 最多一個 session；`POST /scheduled-workouts/{id}/session` 的 start/resume 冪等以此兜底。
- `set_logs (session_id, scheduled_workout_exercise_id, set_number)` 唯一 → `setNumber` 正確性的最終邊界，不能只靠應用層計數；併發處理見 §3.8。
- planned-set partial unique → 同一 session 不能對同一 frozen target 建立兩筆 normal actual log；兩個 request 同時 claim 同一 planned set 時回 `409 CONFLICT`。EXTRA log 的 planned-set reference 為 null，不受此限制。
- Service **必須**驗證 `scheduled_workout_planned_set_id` 屬於同一個 `scheduled_workout_exercise_id` 與同一 session snapshot。這是服務層規則，資料庫不強制。
- `load` 與 `unit` 同進同出 → 只給其中一方的 SetLog 寫入回 `400 INVALID_ARGUMENT`。
- `reps` not null → V0.1 僅支援 reps-based logging。

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

# 7. Approved architecture and future extensions

> 原則：V0.1 schema 要做到的是「未來不會卡死」，不是「現在就支援所有未來功能」。
> 

## 7.1 Planned-set prescription — implemented

V0.1 uses the hybrid design defined in §2 and in `docs/database-schema-relationships.md` §3.1: template authoring stores exercise defaults plus sparse overrides; scheduling persists fully resolved frozen planned-set rows; normal SetLogs explicitly reference one frozen row and extra SetLogs have a null reference. Skipped rows and explicit-none overrides are not part of V0.1. One planned load unit belongs to each WorkoutExercise.

This contract deliberately revises the existing `/api/v1` scalar shapes rather than adding `/api/v2`. Frontend, backend, and migration must land as a coordinated controlled-pilot change. The implementation must not introduce dual-read or dual-write compatibility branches.

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
