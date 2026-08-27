#!/usr/bin/env bash
# Install + run the iOS app in a Simulator against a named target.
#
# Usage:
#   npm run ios:local                          # target "local", booted Simulator
#   npm run ios:local -- <simulator-udid>      # target "local", that Simulator
#   APP_TARGET=staging npm run ios:local       # any target defined in config/app-targets.json
#
# No URL is hard-coded here. The target name selects a URL from
# apps/web/config/app-targets.json, which capacitor.config.ts reads too, so
# there is exactly one place to change or add an environment.
#
# What it does, every time, so the app can never be silently pointed at the
# wrong environment:
#   1. Resolves the target URL from config/app-targets.json (default: local).
#   2. For a loopback target, starts the Next.js dev server if it isn't
#      already up (see repo-root README.md "Local Backend Startup" for the
#      Postgres / Firebase Auth Emulator / Go API it expects alongside it).
#   3. Force-uninstalls any existing build from the Simulator first, so a
#      stale WKWebView cache from a previous run can never linger.
#   4. Builds and installs with APP_TARGET exported for this one invocation.
#      Nothing is written back to capacitor.config.ts, so there is nothing to
#      remember to revert and nothing for `git status` to catch.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_TARGET="${APP_TARGET:-local}"
TARGETS_FILE="config/app-targets.json"

read -r TARGET_URL TARGET_NOTE <<EOF
$(python3 - "$TARGETS_FILE" "$APP_TARGET" <<'PY'
import json, sys
path, name = sys.argv[1], sys.argv[2]
data = json.load(open(path))
t = data["targets"].get(name)
if not t:
    sys.exit(f'unknown APP_TARGET "{name}". Known: {", ".join(data["targets"])} (see {path}).')
print(t["url"], t.get("note", ""))
PY
)
EOF

SIM="${1:-}"
if [ -z "$SIM" ]; then
  SIM="$(xcrun simctl list devices | grep -m1 '(Booted)' | grep -oE '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}' || true)"
fi
if [ -z "$SIM" ]; then
  echo "error: no booted Simulator found and no UDID given." >&2
  echo "  usage: npm run ios:local -- <simulator-udid>" >&2
  echo "  list devices: xcrun simctl list devices" >&2
  exit 1
fi

echo
echo "============================================================"
echo "  iOS TARGET: $(echo "$APP_TARGET" | tr '[:lower:]' '[:upper:]')  $TARGET_URL"
[ -n "$TARGET_NOTE" ] && echo "  $TARGET_NOTE"
echo "  Scoped to this install only; capacitor.config.ts is untouched."
echo "============================================================"
echo
echo "Simulator: $SIM"

case "$TARGET_URL" in
  http://127.0.0.1:*|http://localhost:*)
    if ! curl -fsS -o /dev/null --max-time 3 "$TARGET_URL" 2>/dev/null; then
      echo "Starting next dev on $TARGET_URL..."
      (npx next dev > /tmp/pumploop-ios-local-next.log 2>&1 &)
      ready=0
      for _ in $(seq 1 40); do
        if curl -fsS -o /dev/null --max-time 3 "$TARGET_URL" 2>/dev/null; then
          ready=1
          break
        fi
        sleep 0.5
      done
      if [ "$ready" -ne 1 ]; then
        echo "error: next dev did not come up within 20s — see /tmp/pumploop-ios-local-next.log" >&2
        exit 1
      fi
    else
      echo "Dev server already up at $TARGET_URL."
    fi
    ;;
esac

echo "Removing any existing install on $SIM (clears WKWebView cache)..."
xcrun simctl uninstall "$SIM" com.pumpslate.app 2>/dev/null || true

echo "Building + installing ($APP_TARGET) on $SIM..."
APP_TARGET="$APP_TARGET" npx cap run ios --target "$SIM"

echo "Done. App is running against $TARGET_URL on $SIM."
