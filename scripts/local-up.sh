#!/usr/bin/env bash
# Start the LOCAL stack and point the iOS Capacitor shell at it.
#
#   ./scripts/local-up.sh
#
# This is the command to use for local verification. A plain Xcode Run
# after `npx cap sync` without APP_TARGET=local silently loads
# staging (see apps/web/capacitor.config.ts).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGDIR="${TMPDIR:-/tmp}/pumploop-local"
mkdir -p "$LOGDIR"
cd "$ROOT"

listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_port() {
  local port="$1" name="$2" seconds="${3:-60}"
  local i=0
  while [ "$i" -lt "$seconds" ]; do
    if listening "$port"; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "error: $name did not listen on :$port within ${seconds}s" >&2
  echo "  log: $LOGDIR" >&2
  return 1
}

echo "==> PostgreSQL (Docker :5433)"
docker compose up -d
wait_port 5433 postgres 30

echo "==> Firebase Auth Emulator (:9099, performance-coach-local)"
if listening 9099; then
  echo "    already listening"
else
  nohup npx --yes firebase-tools emulators:start --only auth \
    --project performance-coach-local --config firebase.json \
    >"$LOGDIR/firebase.log" 2>&1 &
  echo $! >"$LOGDIR/firebase.pid"
  wait_port 9099 "auth emulator" 60
fi

echo "==> Seed emulator emails (idempotent, local only)"
curl -fsS -X POST \
  'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/performance-coach-local/accounts:batchCreate' \
  -H 'Authorization: Bearer owner' \
  -H 'Content-Type: application/json' \
  --data '{"allowOverwrite":true,"sanityCheck":true,"users":[{"localId":"TpTGZt93aPZIha0zs80999gpkxi2","email":"coach@local.test","emailVerified":true,"rawPassword":"LocalPass123!"},{"localId":"OB1m9kbNaYgmTmQT7i7pSc7Rgl43","email":"student1@local.test","emailVerified":true,"rawPassword":"LocalPass123!"}]}' \
  >/dev/null

echo "==> Go API (:8080, Auth Emulator)"
if listening 8080; then
  echo "    already listening"
else
  cd "$ROOT/apps/api"
  nohup env \
    DATABASE_URL='postgres://performance:performance@localhost:5433/performance_coach?sslmode=disable' \
    FIREBASE_PROJECT_ID=performance-coach-local \
    FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
    PORT=8080 \
    go run ./cmd/api \
    >"$LOGDIR/api.log" 2>&1 &
  echo $! >"$LOGDIR/api.pid"
  disown || true
  cd "$ROOT"
  wait_port 8080 "go api" 60
fi
curl -fsS --max-time 5 http://127.0.0.1:8080/health >/dev/null

echo "==> Next.js (:3000, Auth Emulator, local API rewrite)"
if listening 3000; then
  echo "    already listening"
else
  echo "    opening a real Terminal window so Next is not killed when the agent shell exits"
  osascript <<EOF
tell application "Terminal"
  activate
  do script "cd '$ROOT/apps/web' && exec env NEXT_PUBLIC_FIREBASE_PROJECT_ID=performance-coach-local NEXT_PUBLIC_FIREBASE_API_KEY=fake-api-key NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 BACKEND_BASE_URL=http://localhost:8080 npm run dev -- --hostname 127.0.0.1 -p 3000"
end tell
EOF
  wait_port 3000 "next" 90
fi
curl -fsS --max-time 8 -o /dev/null http://127.0.0.1:3000/login

echo "==> Capacitor iOS config → http://127.0.0.1:3000 (does not edit capacitor.config.ts)"
(
  cd "$ROOT/apps/web"
  APP_TARGET=local npx cap sync ios
)

"$ROOT/scripts/local-status.sh"
echo "Logs: $LOGDIR"
echo "iOS Simulator: cd apps/web && npm run ios:local"
echo "Xcode Run on a physical iPhone will NOT hit this Mac at 127.0.0.1."
