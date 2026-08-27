import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapacitorConfig } from "@capacitor/cli";

// Which URL the WKWebView loads is selected by NAME, not by editing this file.
//
//   APP_TARGET=local   npx cap sync ios     -> http://127.0.0.1:3000
//   npx cap sync ios                        -> staging (the committed default)
//
// The URLs themselves live in config/app-targets.json, which is the single
// source of truth shared with apps/web/scripts/ios-local.sh and
// scripts/local-status.sh. Add or change an environment there, never here and
// never in a script.
//
// Normal use: `npm run ios:local` (Simulator, local stack) or `./scripts/local-up.sh`
// from the repo root. Because the committed default is staging, pressing Run in
// Xcode — or any `cap sync` without APP_TARGET — always produces a staging build,
// even while a local dev server is up on :3000. `./scripts/local-status.sh`
// prints which one the generated iOS config currently carries.
type AppTarget = { url: string; cleartext?: boolean };
type AppTargetsFile = { default: string; targets: Record<string, AppTarget> };

function resolveServer(): AppTarget {
  const path = join(__dirname, "config", "app-targets.json");
  const file = JSON.parse(readFileSync(path, "utf8")) as AppTargetsFile;
  const name = process.env.APP_TARGET ?? file.default;
  const target = file.targets[name];
  if (!target) {
    throw new Error(
      `capacitor.config: unknown APP_TARGET "${name}". ` +
        `Known targets: ${Object.keys(file.targets).join(", ")} (see ${path}).`,
    );
  }
  // Only the keys Capacitor understands — `note` is documentation.
  return target.cleartext
    ? { url: target.url, cleartext: true }
    : { url: target.url };
}

const config: CapacitorConfig = {
  appId: "com.pumpslate.app",
  appName: "PumpLoop",
  webDir: "capacitor-shell",
  server: resolveServer(),
  plugins: {
    // Google and Apple are bundled. The plugin enables every provider by
    // default, which would link the Facebook and Twitter SDKs into the
    // binary for sign-in methods this app does not offer — dead dependency
    // surface that also drags in privacy-manifest obligations. Apple is on
    // for App Review Guideline 4.8 (docs/tasks/2026-08-25-ios-apple-signin.md);
    // the native plugin rejects Apple initialize/login unless this is true.
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: true,
        twitter: false,
      },
    },
  },
};

export default config;
