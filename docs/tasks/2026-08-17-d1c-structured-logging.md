# Task: D1c — structured logging

- Date opened: 2026-08-17
- Related contract sections: docs/deployment-architecture-v0.2.md §12 (Observability), §13 (Verification checklist); AGENTS.md §19 (contract doc updates)
- Size (S/M/L/XL, per AGENTS.md §7): L (3 ordered S sub-tasks; only D1c-1 approved so far)

## 1. Feasibility Analysis

- Problem / trigger: §12 requires JSON logs to stdout with `severity`, request IDs echoed via `X-Request-Id`, and redaction rules, "before D3c, not after an incident." Phase 0 inspection (this session, prior turn) found the API using `log.Println`/`log.Printf` everywhere, no request-scoped logging at all, and two concrete defects: every 500 path discards `err` and logs nothing, and `internal/db` wraps raw `url.Parse` errors that embed the full DSN (including password) into `log.Fatal`.
- Options considered:
  1. Adopt a third-party structured logging library (zap, zerolog).
  2. Use the standard library's `log/slog` (Go 1.21+, already available at go.mod's `go 1.26.5`) with a `ReplaceAttr` remap to Cloud Logging's expected keys/severity names.
  3. Keep `log.Printf` but manually format JSON strings per call site.
- Trade-offs:
  1. No new capability §12 requires that `slog` lacks; adds a dependency and go.sum churn for a floor-level requirement (AGENTS §22: prefer simple/testable over future-proofing).
  2. Zero new dependencies (verified: `go.mod` already targets `go 1.26.5`, well past `slog`'s introduction). Verified via a scratchpad probe that `slog.NewJSONHandler` + `ReplaceAttr` produces exactly the shape needed (`{"time":...,"level":"INFO","msg":...}` → remap to `severity`/`message`).
  3. No new dependency, but hand-formatting JSON per call site is error-prone (exactly the kind of implicit-transaction-style trap that caused the D1b DSN leak) and impossible to test cleanly.
- Selected option and why: `log/slog` (2). It is the standard library, already available, and its `ReplaceAttr` hook does precisely the key remapping §12 needs without any custom JSON marshaling.
- Risks & unknowns:
  - `http.TimeoutHandler` (added D1b, `cmd/api/main.go`) drops headers set on the *inner* `ResponseWriter` on timeout, so the logging middleware must wrap **outside** `TimeoutHandler`, not inside `mux`. Verified with a scratchpad `httptest` probe (see Phase 0 report): headers set on the outer writer survive both the timeout and happy paths; headers set by the inner handler do not survive a timeout.
  - `slog`'s default level names are `INFO`/`WARN`/`ERROR` — Cloud Logging wants `WARNING`, not `WARN`. Verified via probe; handled in `ReplaceAttr`.
  - The API never reads `schema_migrations` today; a naive boot-time lookup could turn an operational nicety into a new startup-failure mode. Decision (owner, this turn): best-effort only, must never fail startup.
- Dependencies / blockers: none. Builds on D1b's `internal/migrate` (ledger table) and `internal/db`/`cmd/api` from D1b.

## 2. Technical Design

- Affected files/components (D1c-1 only — see §3 for the full 3-phase breakdown):
  - `apps/api/internal/logging/logging.go` (new)
  - `apps/api/internal/logging/logging_test.go` (new)
  - `apps/api/cmd/api/main.go`
  - `apps/api/internal/migrate/migrate.go` (adds `LatestAppliedVersion`, best-effort ledger read for boot logging)
  - `docs/go-backend-api-contract-v0.1.md` (documents the additive `X-Request-Id` response header)
- Data flow:
  - `logging.New(io.Writer) *slog.Logger` builds a JSON logger with `severity`/`message` keys and Cloud Logging severity names.
  - `logging.Middleware(logger)` wraps the **outermost** handler (outside `http.TimeoutHandler`): generates a request ID (`uuid.NewString()`, inbound `X-Request-Id` is ignored per decision below), sets it as the `X-Request-Id` response header immediately, attaches a request-scoped `*slog.Logger` (with `request_id` bound via `.With(...)`) to the request context, wraps the `ResponseWriter` to capture the final status code, and emits one summary log line per request after `next.ServeHTTP` returns — at `INFO`/`WARNING`/`ERROR` by status class (`<400`/`<500`/`>=500`).
  - `/health` and `/ready` requests that succeed (`status < 400`) are not logged, to avoid Cloud Run's constant probe traffic drowning real signal; a failing `/ready` (503) still logs, at `ERROR` (>=500 falls out of the same status-class rule already — no special case needed).
  - `logging.FromContext(ctx)` returns the request-scoped logger for handler code (not yet consumed by handlers in D1c-1 — that starts in D1c-2, which also makes 500 paths log their error).
  - `main()` builds the base logger first, before `config.LoadAPI()`, so a config-load failure is itself reported as one structured `ERROR` line instead of a plain-text `log.Fatal`. `run()` logs boot facts once after the DB pool and Firebase verifier are ready: resolved port, `db_ping: "ok"`, Firebase project ID, and the migration ledger version via the new best-effort `migrate.LatestAppliedVersion` (returns `ok=false, err=nil` — not an error — both when no migrations have run and when the ledger table itself does not exist yet, e.g. `undefined_table`/`42P01`; a real query error is logged at `WARNING` but does not abort startup).
- API changes: additive only. New response header `X-Request-Id` on every response (including the existing 503 timeout body). The JSON error envelope (`{"error":{"code","message"}}`) is unchanged — confirmed unchanged by test. No route, request shape, or authorization rule changes.
- State transitions: n/a.
- Frontend state/UI impact: none.
- Backward compatibility: fully additive; no existing behavior changes for any client.

## 3. Estimate

- Size: L
- Sub-task breakdown (ordered; each S per AGENTS §7):
  1. **D1c-1** (this approval): `internal/logging` package + wiring into `cmd/api/main.go` + best-effort ledger version read + contract doc's additive header note. *Files: 5 — at the AGENTS §7 cap, not over it.*
  2. **D1c-2** (not yet approved): make 500s observable — `internal/authn/authn.go` and `cmd/api/main.go`'s 13 `default:` branches log the discarded `err` via `logging.FromContext(r.Context())`; close the DSN-leak defect in `internal/db/{db,dsn}.go` (stop interpolating the raw parse error verbatim).
  3. **D1c-3** (not yet approved): convert `cmd/migrate/main.go` and `cmd/bootstrap/main.go` to the same JSON logger (both are short-lived jobs, not HTTP servers, so no middleware — just `logging.New` + structured calls); record D1c completion in `docs/deployment-architecture-v0.2.md`.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| D1c-1 — logging package + cmd/api wiring | Done | `go fmt`/`go vet`/`go test` clean; manually verified against local Postgres — successful `/health` unlogged, failing/401 request logged at correct severity with `X-Request-Id` matching the log's `request_id`, `migration_version` present/absent correctly on a migrated vs. unmigrated database |
| D1c-2 — error-path visibility + DSN leak fix | Done | `go fmt`/`go vet`/`go test` clean (unit + integration against local Postgres). `authn.WriteInternalError` now logs every discarded 500-path error, correlated by `request_id`; `internal/db`'s DSN parse-error leak closed (`ErrUnparsableDSN`), with a regression test guarding the still-safe `pgxpool.ParseConfig` path too |
| D1c-3 — migrate/bootstrap loggers + doc completion | Done | `go fmt`/`go vet`/`go test` clean (unit + integration). Manually ran all four happy/fatal paths (migrate ×2, bootstrap ×2) against local Postgres and confirmed valid one-object-per-line JSON with correct `severity`. Found and fixed a second, previously-uncovered DSN-leak path in `internal/db.NewPool` during this verification (see Deviations) |

## 5. Outcome (filled at completion)

- Final status: **D1c complete** (D1c-1, D1c-2, D1c-3 all Done). §12's logging floor (JSON/stdout, `severity`, request-ID correlation, redaction) is implemented across all three entrypoints and verified locally, per docs/deployment-architecture-v0.2.md §11's D1c acceptance ("verify locally before any cloud phase"). §12's *Alerting* subsection and the §13 checklist line about a deliberately-triggered alert are Cloud Monitoring configuration, not implementable locally — out of scope for D1c, carried forward to D2/D4 (flagged in the original Phase 0 report).
- Deviations from plan:
  - **A second DSN-leak path, not caught by D1c-2**, was found during D1c-3's manual verification (running `cmd/migrate`/`cmd/bootstrap` against a deliberately garbage `DATABASE_URL`, as the task's own verification step asked for). D1c-2 closed the leak in `net/url.Parse` failures (`AssertSafeSSLMode`/`ErrUnparsableDSN`) and confirmed `pgxpool.ParseConfig` redacts the password for a *recognized* `postgres://` URL with bad semantic content (e.g. invalid `sslmode`). It missed a third case: a string `net/url.Parse` accepts (it is lenient enough to treat almost anything without a recognized scheme as a bare relative path) but that is not a valid postgres DSN at all — `pgxpool.ParseConfig` then falls back to its libpq keyword/value parser, fails to tokenize it, and embeds the **raw input unredacted**, credentials included. Confirmed empirically (`internal/db/zzz_probe_test.go`, scratch file, removed after use) before fixing. Fixed in `internal/db/db.go`: `NewPool` no longer propagates `pgxpool.ParseConfig`'s error text under any circumstance (`ErrInvalidDatabaseConfig`, mirroring `ErrUnparsableDSN`'s reasoning) — regardless of whether pgx happens to redact in a given failure mode. Regression test added: `TestNewPoolRejectsUnparsablePoolConfigWithoutLeaking`.
  - Also found and fixed, unrelated to logging: `internal/migrate/migrate_integration_test.go`'s `TestUpRefusesChangedHistoricalMigration` (from D1b) tampers a checksum in the shared `performance_coach_test` database's ledger and never cleans up, which surfaced as a spurious real error when `cmd/migrate` was run against that database during this session's manual verification. Repaired by hand (`DROP SCHEMA public CASCADE` + re-migrate) — the test file itself was not modified, since fixing that test's hygiene is unrelated to D1c's scope. Flagged as a follow-up below.
- Follow-ups (not part of D1c, listed for whoever picks up D2+):
  - `internal/migrate/migrate_integration_test.go`'s `TestUpRefusesChangedHistoricalMigration` should reset the schema in a `t.Cleanup` (or equivalent) instead of leaving `performance_coach_test` in a tampered state after the test run.
  - §12's Alerting requirement (≥1 alert, deliberately triggered once) is Cloud Monitoring configuration — belongs to D2 (foundation) / D4 (Cloud Run deploy), not implementable until those resources exist.
  - The §13 checklist lines about logs actually arriving in **Cloud Logging** (as opposed to stdout locally) can only be confirmed after D4's first Cloud Run deploy.
