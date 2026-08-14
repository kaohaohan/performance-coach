import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
