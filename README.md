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
go run ./cmd/api
```

The API listens on `localhost:8080` by default (override with `PORT`).

## iPhone / Mobile LAN Local Testing

Use this flow when a phone on the same Wi-Fi needs to open the local app. Do not use the normal `localhost` frontend setup for this test.

### Rules that must stay aligned

- **Two-minute stop rule:** any foreground command, verification, startup check, shutdown attempt, or approval wait that has not completed within 120 seconds must be stopped. Report what timed out instead of waiting or repeatedly retrying it.
- Detached local services (`screen` sessions for Next.js, the API, and Firebase) are intentionally long-running and are the only exception. Their startup must still be verified within 120 seconds. If the expected listener is not ready by then, stop that exact session/process and report the failure.
- The phone opens the Mac's LAN address, for example `http://192.168.1.114:3001`. On a phone, `127.0.0.1` and `localhost` mean the phone itself.
- The browser-side Firebase emulator host must use the Mac's LAN IP: `<MAC_LAN_IP>:9099`.
- The Go API runs on the Mac and must use `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`.
- Both frontend and API must use `performance-coach-local`. A token minted for another Firebase project is rejected by the API.
- Do not rely on `apps/web/.env.local` for mobile local testing. It may contain non-local Firebase values; the command below explicitly overrides every required public Firebase value.
- Auth emulator accounts are in memory unless emulator export/import is configured. Restarting the Auth emulator can leave PostgreSQL users present while Firebase has zero login accounts. Re-run the account seed below after an emulator restart.
- A tunnel for the Next.js port alone is insufficient: the phone must also be able to reach the Auth emulator host used by the frontend.

### Start the complete mobile-local stack

Run all commands from the repository root. First resolve the Mac's current Wi-Fi IP:

```sh
MOBILE_LAN_IP="$(ipconfig getifaddr en0)"
echo "$MOBILE_LAN_IP"
```

If that prints nothing, find the active Wi-Fi interface with `ifconfig` and use its IPv4 address. The IP can change when the Mac reconnects to Wi-Fi, so do not reuse an old address without checking it.

Start PostgreSQL and the Auth emulator in detached sessions:

```sh
docker compose up -d
screen -dmS pc-firebase npx --yes firebase-tools emulators:start --only auth --project performance-coach-local --config firebase.json
```

Seed the two local-only login accounts. This command is idempotent for these two emulator UIDs and does not touch production Firebase or PostgreSQL:

```sh
curl -fsS -X POST \
  'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/performance-coach-local/accounts:batchCreate' \
  -H 'Authorization: Bearer owner' \
  -H 'Content-Type: application/json' \
  --data '{"allowOverwrite":true,"sanityCheck":true,"users":[{"localId":"TpTGZt93aPZIha0zs80999gpkxi2","email":"coach@local.test","emailVerified":true,"rawPassword":"LocalPass123!"},{"localId":"OB1m9kbNaYgmTmQT7i7pSc7Rgl43","email":"student1@local.test","emailVerified":true,"rawPassword":"LocalPass123!"}]}'
```

Start the API with the safe local environment, then start Next.js with an explicit LAN origin and Firebase emulator host:

```sh
screen -dmS performance-coach-api /bin/zsh -lc 'set -a; source .env.example; set +a; cd apps/api; go run ./cmd/api'

cd apps/web
screen -dmS performance-coach-mobile /bin/zsh -lc \
  "env MOBILE_LAN_IP=${MOBILE_LAN_IP} NEXT_PUBLIC_FIREBASE_PROJECT_ID=performance-coach-local NEXT_PUBLIC_FIREBASE_API_KEY=fake-api-key NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=${MOBILE_LAN_IP}:9099 BACKEND_BASE_URL=http://localhost:8080 npm run dev -- --hostname 0.0.0.0 -p 3001"
cd ../..
```

`MOBILE_LAN_IP` also feeds Next.js `allowedDevOrigins`. Without it, the server may return the initial HTML while blocking client JavaScript, producing a page that appears loaded but whose login form does not work correctly.

Do not leave a foreground `npm run dev`, build, test, `curl`, or permission request waiting while diagnosing the mobile environment. Use detached sessions for servers, check their ports promptly, and enforce the two-minute stop rule above.

### Verify before touching the phone

Do not report the mobile environment ready until all three listeners exist and the LAN login URL returns successfully:

```sh
lsof -nP -iTCP:3001 -iTCP:8080 -iTCP:9099 -sTCP:LISTEN
curl -fsS http://127.0.0.1:8080/health
curl -fsSI "http://${MOBILE_LAN_IP}:3001/login"
screen -ls
```

Expected phone URL and local-only credentials:

```text
http://<MAC_LAN_IP>:3001/login

Coach:   coach@local.test
Athlete: student1@local.test
Password for both: LocalPass123!
```

The phone and Mac must be on the same Wi-Fi. If the phone still shows `ERR_CONNECTION_FAILED`, re-check the current LAN IP, confirm `*:3001` is listening, disable a phone/Mac VPN temporarily, and check whether the macOS firewall is blocking incoming Node connections.

If the page opens but login says the credentials are incorrect, the Auth emulator was probably restarted without accounts; re-run the seed command. If login succeeds in Firebase but the app returns `UNAUTHENTICATED`, restart the Go API with `.env.example` so it verifies tokens through `127.0.0.1:9099` for `performance-coach-local`.

If Next.js shows a hydration overlay whose attribute diff contains `__gcrremoteframetoken` or `__gcruniqueid`, those attributes were injected by the remote Chrome testing layer before React hydrated; they are not application data. The root layout and login form intentionally suppress warnings for those injected attributes. Reload once after the current source has compiled. Do not spend time changing Calendar state or Firebase configuration for this warning.

If `npm run dev` exits with “Another next dev server is already running,” first verify that no listener and no mobile screen session exist:

```sh
lsof -nP -iTCP:3001 -sTCP:LISTEN
screen -ls
```

Only when both confirm the server is gone, remove the generated stale lock and start the frontend again:

```sh
rm apps/web/.next/dev/lock
```

To stop the detached mobile-local services later:

```sh
screen -S performance-coach-mobile -X quit
screen -S performance-coach-api -X quit
screen -S pc-firebase -X quit
```

After stopping a session, confirm its listener disappeared. If it is still present, identify only that listener's PID with `lsof`; do not delete locks or start another server until the exact stale process is stopped. Apply the two-minute stop rule to shutdown and permission waits as well.

## Ports

| Service | Port |
| --- | --- |
| PostgreSQL (Docker) | `localhost:5433` |
| Firebase Auth Emulator | `localhost:9099` |
| Go API | `localhost:8080` (default) |
| Next.js mobile LAN frontend | `<MAC_LAN_IP>:3001` |

## Migrations

`apps/api/migrations/` contains plain SQL files (e.g. `0001_init_schema.up.sql`). They are **not** applied automatically on API startup — a Cloud Run instance must never race another instance to mutate schema. Apply them with the `migrate` entrypoint instead:

```bash
DATABASE_URL=postgres://performance:performance@localhost:5433/performance_coach?sslmode=disable \
  go run ./apps/api/cmd/migrate
```

It applies every pending `*.up.sql` file in order inside a transaction, records each applied version and a checksum of its content in a `schema_migrations` ledger table, and refuses to run if an already-applied migration's on-disk content has changed (edit history is never allowed — add a new migration file instead). Point `DATABASE_URL` at a scratch/local database first to validate a new migration before running it anywhere else.

## Bootstrap

`go run ./apps/api/cmd/bootstrap` creates the intentional pilot `users` and `coach_athletes` rows described by a reviewed, non-secret JSON manifest (never passwords, ID tokens, or service-account material):

```bash
DATABASE_URL=... BOOTSTRAP_MANIFEST_PATH=./manifest.json go run ./apps/api/cmd/bootstrap
```

```json
{
  "users": [
    {"firebaseUid": "...", "name": "Coach Name", "role": "COACH"},
    {"firebaseUid": "...", "name": "Athlete Name", "role": "ATHLETE"}
  ],
  "relationships": [
    {"coachFirebaseUid": "...", "athleteFirebaseUid": "..."}
  ]
}
```

It is idempotent: re-running with the same manifest upserts users by `firebaseUid` and skips relationships that already exist. It never runs schema migrations itself, and never requires `FIREBASE_PROJECT_ID`.
