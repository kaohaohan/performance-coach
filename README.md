# Performance Coach

## Local Backend Startup

Start these in order:

### 1. PostgreSQL (Docker)

```
docker compose up -d
```

Postgres is available at `localhost:5433` (mapped from the container's internal `5432`; the host port is `5433`, not `5432`, to avoid conflicting with a local Homebrew PostgreSQL install).

### 2. Firebase Auth Emulator

```
firebase emulators:start --only auth --project performance-coach-local
```

Requires the Firebase CLI (`npx firebase-tools` works without installing it globally). `performance-coach-local` is not a real Firebase project — it's a placeholder id used only to satisfy the Admin SDK's config while token verification is redirected to the local emulator. The emulator's port (`9099`) comes from the root-level `firebase.json`; no `.firebaserc` is used.

### 3. Environment variables

Copy the variables from `.env.example` into your shell environment (e.g. `export $(cat .env.example | xargs)`, or load them however your shell/tooling prefers). At minimum the Go API requires:

- `DATABASE_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_AUTH_EMULATOR_HOST`

`FIREBASE_AUTH_EMULATOR_HOST` must only be set in local development. When it's set, the Firebase Admin SDK verifies ID tokens against the local emulator instead of real Firebase — it must be unset in any staging/production environment, or authentication would silently accept emulator-issued tokens.

### 4. Go API

```
cd apps/api
go run .
```

The API listens on `localhost:8080` by default (override with `PORT`).

## Ports

| Service | Port |
| --- | --- |
| PostgreSQL (Docker) | `localhost:5433` |
| Firebase Auth Emulator | `localhost:9099` |
| Go API | `localhost:8080` (default) |

## Migrations

`apps/api/migrations/` contains plain SQL files (e.g. `0001_init_schema.up.sql`). They are **not** applied automatically on API startup — apply them manually against the target database (e.g. with `psql`) before starting the API for the first time. There is no migration CLI wired into this repo yet.
