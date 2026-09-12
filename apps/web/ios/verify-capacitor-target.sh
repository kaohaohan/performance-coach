#!/bin/sh
# Reject a Capacitor URL that does not match the active native build type.
# This is intentionally invoked by Xcode as a build phase and is also safe
# to run directly before Archive (see docs/ios-release-runbook.md).
set -eu

configuration=${1:?usage: verify-capacitor-target.sh <Debug|Release> <capacitor.config.json>}
config_path=${2:?usage: verify-capacitor-target.sh <Debug|Release> <capacitor.config.json>}
production_url='https://dontworkout.vercel.app'

if [ ! -f "$config_path" ]; then
  echo "error: Capacitor config not found: $config_path" >&2
  exit 1
fi

target_url=$(/usr/bin/plutil -extract server.url raw "$config_path" 2>/dev/null) || {
  echo "error: could not read server.url from $config_path" >&2
  exit 1
}

case "$configuration" in
  Release)
    if [ "$target_url" != "$production_url" ]; then
      echo "error: Release must use $production_url, but Capacitor is configured for $target_url." >&2
      echo "error: Run APP_TARGET=production npx cap sync ios from apps/web, then rebuild." >&2
      exit 1
    fi
    ;;
  Debug)
    if [ "$target_url" = "$production_url" ]; then
      echo "error: Debug must not use production. Re-sync with APP_TARGET=staging or APP_TARGET=local." >&2
      exit 1
    fi
    ;;
  *)
    echo "error: unsupported Xcode configuration: $configuration" >&2
    exit 1
    ;;
esac

echo "Capacitor target verified for $configuration: $target_url"
