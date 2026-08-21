import type { NextConfig } from "next";

const mobileLanIp = process.env.MOBILE_LAN_IP;

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // A phone reaches the dev server through the Mac's LAN address. Next.js
  // otherwise blocks its client chunks/HMR as cross-origin dev resources,
  // leaving a page that renders HTML but is not interactive.
  allowedDevOrigins: mobileLanIp ? [mobileLanIp] : [],
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
