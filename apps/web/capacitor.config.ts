import type { CapacitorConfig } from "@capacitor/cli";

// Phase I2 (Option B): WKWebView loads the fixed Vercel staging alias for
// the `staging` git branch instead of the bundled `capacitor-shell/index.html`
// placeholder. See docs/tasks/2026-08-23-ios-capacitor-staging-webview.md.
const config: CapacitorConfig = {
  appId: "com.pumpslate.app",
  appName: "PumpLoop",
  webDir: "capacitor-shell",
  server: {
    url: "https://performance-coach-git-staging-kaohaohans-projects.vercel.app",
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
