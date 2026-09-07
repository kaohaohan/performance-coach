import type { CapacitorConfig } from "@capacitor/cli";

// Public App Store 1.0: WKWebView loads Vercel Production, not the staging
// alias. Production web/API/database were promoted and smoke-verified first
// (docs/ios-release-runbook.md § "Public App Store 1.0", steps 1-6) before
// this switch — see docs/tasks/2026-08-23-ios-capacitor-staging-webview.md
// for the original staging-alias rationale this supersedes for release
// builds. Do not merge this onto staging until production has been smoked;
// every subsequent TestFlight/Debug build from staging would otherwise talk
// to production.
const config: CapacitorConfig = {
  appId: "com.pumpslate.app",
  appName: "PumpLoop",
  webDir: "capacitor-shell",
  server: {
    url: "https://dontworkout.vercel.app",
  },
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
