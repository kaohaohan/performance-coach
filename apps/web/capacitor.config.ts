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
};

export default config;
