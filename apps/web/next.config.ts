import type { NextConfig } from "next";

const mobileLanIp = process.env.MOBILE_LAN_IP;

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Hides the on-screen dev-mode route indicator (the "N ... Issue" pill).
  // Dev-only; compile/runtime errors still surface in the terminal/console.
  devIndicators: false,
  // A phone reaches the dev server through the Mac's LAN address. Next.js
  // otherwise blocks its client chunks/HMR as cross-origin dev resources,
  // leaving a page that renders HTML but is not interactive.
  // 127.0.0.1 / localhost are required for iOS Simulator Capacitor WKWebView
  // (`server.url: http://127.0.0.1:3000`). An empty list lets HTML load while
  // blocking client JS, so the login form native-GET-submits as `/login?`.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    ...(mobileLanIp ? [mobileLanIp] : []),
  ],
  // Proxies browser calls to the Go API so the frontend never makes a
  // cross-origin request (avoids needing CORS support on the Go API in this
  // phase — see AGENTS.md §13/Phase 1 approved decisions). Backend base URL
  // is local-only for now; revisit before any real deployment.
  async rewrites() {
    const backendBaseUrl =
      process.env.BACKEND_BASE_URL ?? "http://localhost:8080";

    return [
      {
        source: "/backend/:path*",
        destination: `${backendBaseUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
