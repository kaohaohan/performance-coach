import type { CapacitorConfig } from "@capacitor/cli";

// Phase I1 (skeleton only): no `server.url` yet. The native shell currently
// loads the bundled `capacitor-shell/index.html` placeholder. Pointing the
// shell at the deployed web app is Phase I2's job — see
// docs/ios-capacitor-shell.md (or the Phase 0 report) for why.
const config: CapacitorConfig = {
  appId: "com.performancecoach.app",
  appName: "Performance Coach",
  webDir: "capacitor-shell",
};

export default config;
