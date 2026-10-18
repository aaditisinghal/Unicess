import type { NextConfig } from "next";

// The running Unicess server: sign-in, the portal, the live dashboard and the agent files live there.
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Pinned to this folder, so Turbopack ignores the server's lockfile one level up.
  turbopack: { root: process.cwd() },
  // Links people already have to this site (/login, /llms.txt, ...) land on the live app.
  async redirects() {
    return ["/login", "/portal", "/live", "/llms.txt", "/.well-known/agent.json"].map((source) => ({
      source,
      destination: `${APP_URL}${source}`,
      permanent: false,
    }));
  },
};

export default nextConfig;
