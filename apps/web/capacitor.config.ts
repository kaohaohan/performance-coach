import type { CapacitorConfig } from "@capacitor/cli";

// Phase I2 (Option B): WKWebView loads the fixed Vercel staging alias for
// the `staging` git branch instead of the bundled `capacitor-shell/index.html`
// placeholder. See docs/tasks/2026-08-23-ios-capacitor-staging-webview.md.
const config: CapacitorConfig = {
  appId: "com.performancecoach.app",
  appName: "Performance Coach",
  webDir: "capacitor-shell",
  server: {
    url: "https://performance-coach-git-staging-kaohaohans-projects.vercel.app",
  },
  plugins: {
    // Only Google is bundled. The plugin enables every provider by default,
    // which would link the Facebook and Twitter SDKs into the binary for
    // sign-in methods this app does not offer — dead dependency surface that
    // also drags in privacy-manifest obligations. Apple stays off until Sign
    // in with Apple is actually in scope.
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
  },
};

export default config;
