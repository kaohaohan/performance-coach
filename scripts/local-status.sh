#!/usr/bin/env bash
# Print whether this checkout is wired to LOCAL or STAGING.
# Never prints secret values.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CAP_JSON="$ROOT/apps/web/ios/App/App/capacitor.config.json"
TARGETS_FILE="$ROOT/apps/web/config/app-targets.json"
# URLs are never hard-coded here — they come from app-targets.json, the same
# file capacitor.config.ts and apps/web/scripts/ios-local.sh read.
STAGING_HINT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["targets"]["staging"]["url"].split("://",1)[-1])' "$TARGETS_FILE")"

listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

cap_url="(missing $CAP_JSON)"
if [ -f "$CAP_JSON" ]; then
  cap_url="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("server",{}).get("url",""))' "$CAP_JSON")"
fi

login_code="$(curl -sS -o /dev/null --max-time 3 -w '%{http_code}' http://127.0.0.1:3000/login || echo down)"

api_ok=0
if curl -fsS --max-time 3 http://127.0.0.1:8080/health >/dev/null 2>&1; then
  api_ok=1
fi

echo
echo "============================================================"
# Resolve the generated URL back to a target NAME defined in app-targets.json,
# so adding an environment there needs no change in this script.
cap_target="$(python3 - "$TARGETS_FILE" "$cap_url" <<'PY'
import json, sys
path, url = sys.argv[1], sys.argv[2]
data = json.load(open(path))
for name, t in data["targets"].items():
    if t["url"].rstrip("/") == url.rstrip("/"):
        print(name.upper(), t.get("note", ""), sep="\t")
        break
else:
    print("UNKNOWN", "", sep="\t")
PY
)"
cap_note="${cap_target#*$'\t'}"
cap_target="${cap_target%%$'\t'*}"

echo "  iOS WKWebView TARGET:  $cap_target"
echo "  Capacitor URL:         $cap_url"
[ -n "$cap_note" ] && echo "  $cap_note"
if [[ "$cap_target" == "STAGING" ]]; then
  echo "  If you meant local:    run  ./scripts/local-up.sh"
  echo "  Do not press Xcode Run without that script."
fi
echo "------------------------------------------------------------"
echo "  Next.js  :3000     $(listening 3000 && echo LISTEN || echo DOWN)   login HTTP $login_code"
echo "  Go API   :8080     $(listening 8080 && echo LISTEN || echo DOWN)   health $([[ $api_ok -eq 1 ]] && echo ok || echo fail)"
echo "  Auth emu :9099     $(listening 9099 && echo LISTEN || echo DOWN)   project performance-coach-local"
echo "  Postgres :5433     $(listening 5433 && echo LISTEN || echo DOWN)"
echo "============================================================"
echo
echo "Browser local login:  http://127.0.0.1:3000/login"
echo "Staging web (do not use for local): https://$STAGING_HINT"
echo
echo "Local email accounts (Auth Emulator, not Apple / not staging):"
echo "  coach@local.test       / LocalPass123!"
echo "  student1@local.test    / LocalPass123!"
echo

if [[ "$cap_target" == "STAGING" ]]; then
  exit 2
fi
exit 0
