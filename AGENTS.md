# Performance Coach — AI Engineering Agent Contract

This file is the repository-level development contract for all AI coding agents.

It applies to frontend, backend, database, cloud infrastructure, and AI integration work.

Primary goal: ship a real-user MVP quickly without sacrificing correctness, scope discipline, or architectural consistency.

---

## 1. Required Reading

Before implementing any feature, read only:

1. AGENTS.md
2. docs/mvp-specification.md
3. docs/go-backend-api-contract-v0.1.md when backend/API work is involved
4. docs/database-schema-relationships.md when data/schema work is involved
5. Files directly related to the task being modified

Do not scan the whole repository unless required.

If additional context is needed, state:

> Need to inspect `<file>` because `<reason>`.

Then read only that file.

---

## 2. Product Source of Truth

The MVP core loop is:

```
Coach
  ↓
Create Workout
  ↓
Schedule Athlete
  ↓
Athlete Opens Workout
  ↓
WorkoutSession
  ↓
SetLog
  ↓
Coach Reviews Results
```

Voice logging and video/AI analysis are enhancements to this loop.

Before proposing or implementing anything, ask:

> Does this reduce friction or complete the core loop?

If not, it belongs in the backlog.

---

## 3. MVP Scope Rules

The current MVP prioritizes:

- Coach authentication
- Athlete authentication
- Coach–Athlete relationship
- Workout creation
- Workout scheduling
- Athlete Today's Workout
- WorkoutSession
- Manual SetLog
- Coach review
- Voice SetLog if core loop is already stable

The following are currently out of scope:

- Nutrition
- Payments
- Messaging
- Social feed
- Leaderboards
- Wearables
- Organization management
- Team administration
- Advanced periodization
- Calendar programming
- AI-generated workouts
- Custom ML models
- Advanced biomechanics
- Native iOS
- Native Android

Do not silently add out-of-scope functionality.

---

## 4. Architecture Boundaries

Current architecture:

```
Next.js PWA
     │
     ▼
Go API
     │
     ├── PostgreSQL
     │
     └── Object Storage (future media)
                │
                ▼
          AI Service / Gemini
```

**Responsibilities:**

**Next.js**

Responsible for:

- UI
- Client state
- User interaction
- Calling backend APIs

Do not place core business rules only in frontend code.

**Go API**

Responsible for:

- Authentication verification
- Authorization
- Validation
- Business logic
- Database operations
- API contracts

**PostgreSQL**

Responsible for:

- Structured relational data
- Referential integrity
- Training records
- Relationships

**Object Storage**

Responsible for:

- Video
- Audio
- Images

Do not store large media binaries directly in PostgreSQL.

**AI Models**

AI output is untrusted input.

AI must never directly mutate application state.

Required pattern:

```
User Input
  ↓
AI
  ↓
Structured Command
  ↓
Schema Validation
  ↓
Business Validation
  ↓
Authorization
  ↓
Persistence
```

---

## 5. Database Rules

The relational model is intentional.

Do not replace PostgreSQL with a NoSQL database without an explicit architecture decision.

Current domain concepts include:

```
User
CoachAthleteRelationship
Exercise
Workout
WorkoutExercise
ScheduledWorkout
WorkoutSession
SetLog
```

Future entities may include:

```
VideoAsset
AIReview
PlannedSet
WorkoutItem
Organization
```

Future entities must not be implemented until required by an approved task.

**Relationship Principle**

Do not store many-to-many relationships as ID arrays when a relational join table is appropriate.

Example:

```
Coach N:N Athlete
  ↓
CoachAthleteRelationship
```

**Prescription vs Actual**

Keep planned training separate from completed training.

```
WorkoutExercise  = prescription
SetLog           = actual performance
```

Actual training history must never be silently changed because a workout template was later edited.

---

## 6. API Contract Discipline

The backend API contract is defined in:

`docs/go-backend-api-contract-v0.1.md`

Do not change an existing:

- route
- request shape
- response shape
- status code
- authorization rule

without explicitly identifying the contract change first.

If frontend implementation requires a backend contract change:

1. Stop.
2. Explain the required contract change.
3. Update the contract before implementing both sides.

Do not silently make frontend and backend disagree.

---

## 7. Task Sizing

One task should represent one independently verifiable change.

Preferred task sizes:

```
S   < 2 hours
M   2–4 hours
L   4–8 hours
XL  must be split
```

A single implementation task should usually modify no more than 5 files.

If more than 5 files are required:

1. Stop.
2. Explain why.
3. Split the work into ordered sub-tasks.

Typical full-stack split:

1. Schema / migration
2. Repository / data access
3. Service / business logic
4. Handler / API
5. Frontend integration
6. End-to-end verification

Do not implement all phases at once unless explicitly requested.

---

## 8. Phase Gate Protocol

For non-trivial tasks, always start with:

**Phase 0 — Read-Only Inspection**

Allowed:

- Read required documentation
- Inspect relevant code
- Run `git status`
- Run `git diff`
- Identify current implementation state

Not allowed:

- Editing files
- Creating files
- Installing dependencies
- Running migrations
- Changing environment configuration

At the end of Phase 0, report:

1. Current task
2. Relevant spec / acceptance criteria
3. Current implementation state
4. Files likely to change
5. Proposed next phase

Then stop.

Do not continue until the user approves.

---

## 9. Small Task Exception

Phase Gate may be skipped only when all are true:

- Maximum 2 files changed
- No database schema changes
- No API contract changes
- No authentication/authorization changes
- No cloud/infrastructure changes
- No AI contract changes
- Acceptance criteria are explicit
- Verification is straightforward

Examples:

- Copy change
- Styling fix
- Small isolated component correction
- Documentation typo

---

## 10. Working Tree Safety

Before editing:

```
git status
git diff
```

Do not overwrite unrelated user or agent changes.

If unrelated changes exist:

- Leave them untouched
- Stage only files belonging to the current task

Never use destructive Git commands unless explicitly requested.

Do not automatically:

```
git reset --hard
git clean -fd
force push
rewrite history
```

---

## 11. Environment Safety

Never expose or commit:

- API keys
- Firebase credentials
- Database passwords
- GCP service credentials
- Gemini/OpenAI secrets
- Production tokens

Secrets belong in environment variables.

`.env` must not be committed.

`.env.example` may contain variable names and safe local placeholders only.

---

## 12. Database Safety

For local development:

- PostgreSQL runs locally through Docker unless otherwise specified.
- Migrations must be reproducible.
- Schema changes require migration files.
- Never manually modify production data.

Before destructive schema operations:

1. Explain the operation.
2. Explain potential data loss.
3. Wait for explicit approval.

Do not automatically:

```
DROP DATABASE
DROP TABLE
TRUNCATE
DELETE without scoped conditions
reset production DB
```

---

## 13. Cloud Safety

Do not modify production cloud resources unless explicitly requested.

This includes:

- Cloud Run
- Cloud SQL
- GCS
- IAM
- DNS
- Firebase production settings
- Production environment variables

Local development comes first.

Deployment comes only after the local core loop works.

---

## 14. AI / LLM Safety Contract

Voice and video AI are adapters around the application domain.

They do not own domain logic.

Example:

```
Voice
  ↓
Transcript
  ↓
Structured Workout Command
  ↓
Validator
  ↓
SetLog Service
```

Manual and AI-generated SetLogs must pass through the same business logic.

Do not create a separate database-writing pathway only for AI.

AI responses must use structured output whenever possible.

Store enough metadata for later evaluation, including where applicable:

```
model
prompt_version
raw_output
parsed_output
created_at
```

Future AIReview should support:

```
ACCEPT
EDIT
REJECT
```

Coach corrections must be preserved when implemented.

---

## 15. Verification Rules

Never mark work complete because:

> "The code looks correct."

Verification must match the change.

**Go**

At minimum:

```
go fmt ./...
go test ./...
```

When available:

```
go vet ./...
```

**Next.js**

At minimum:

```
npm run lint
```

Also run relevant tests when they exist.

**Database**

For migration changes:

- Migration applies successfully
- Relevant constraints exist
- Migration can be recreated from a clean local database

**API**

Verify:

- Happy path
- Invalid input
- Unauthorized access
- Forbidden access when relevant

Use the smallest relevant test set first.

---

## 16. Definition of Done

A task is complete only when:

1. Acceptance criteria are satisfied.
2. Relevant tests/checks pass.
3. No unrelated files were modified.
4. Documentation is updated if the contract changed.
5. Git diff has been reviewed.
6. Remaining risks are reported.

Do not call work complete if verification failed.

---

## 17. Documentation Rules

Update documentation only when necessary.

Update `mvp-specification.md` when:

- User-visible scope changes
- Acceptance criteria change
- Core product flow changes

Update `go-backend-api-contract-v0.1.md` when:

- API routes change
- Request/response contracts change
- Authorization behavior changes

Update `database-schema-relationships.md` when:

- Tables change
- Relationships change
- Constraints change
- Schema semantics change

Do not rewrite unrelated documentation.

---

## 18. Output Discipline

Do not restate the entire architecture after every task.

Report only what changed.

Do not paste entire files unless explicitly requested.

Prefer:

```
apps/api/internal/session/service.go
- Added authorization check for athlete session access.
```

over reproducing the whole file.

---

## 19. Completion Report

At the end of each approved implementation phase, report only:

**Completed**

Phase / task completed.

**Files Changed**

List paths.

**Verification**

Commands run and results.

**Risks / Decisions**

Only unresolved items.

**Next**

One proposed next phase.

Then stop.

---

## 20. Engineering Principle

Optimize for:

```
Correct
  ↓
Simple
  ↓
Testable
  ↓
Shippable
```

Not:

```
Clever
  ↓
Abstract
  ↓
Future-proof everything
```

The MVP should leave reasonable extension points without implementing future features prematurely.

---

## 21. Founder Constraint

This repository exists to validate a real product, not merely demonstrate engineering complexity.

When choosing between:

- A technically elegant feature

and

- A smaller implementation that gets the product into a real user's hands sooner

prefer the smaller implementation unless it creates unacceptable technical risk.

Do not let engineering sophistication delay user validation.
