import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Next 16 refuses a LOCAL next/image src carrying a query string unless
    // its pathname is listed here, to stop the optimizer being pointed at
    // arbitrary URLs. Every piece of club art is served from our own
    // org-scoped routes with `?v=<updatedAt>`, which is what makes the
    // response safely `immutable` and what makes a re-upload land on a new
    // URL. That version is a timestamp, so an exact `search` match is
    // impossible and it has to be omitted; the pathname is pinned to routes
    // this app owns, which is where the real restriction lives.
    //
    // Listing ANYTHING here blocks every local path that is not listed, so
    // the shipped art directories have to be enumerated too. Adding a new
    // public/ folder that feeds next/image means adding it here.
    localPatterns: [
      { pathname: "/api/orgs/**" },
      { pathname: "/brand/**", search: "" },
      { pathname: "/gallery/**", search: "" },
      { pathname: "/maps/**", search: "" },
    ],
  },
  experimental: {
    serverActions: {
      // Character renders and gallery photos post the raw image through a
      // Server Action. Vercel rejects any function request body over 4.5MB at
      // the platform, before this setting or the action is reached, so the old
      // 12mb was unreachable and every cap above it advertised a size that
      // could never arrive. Sits just under the platform ceiling with headroom
      // over the 4MB action caps, so an oversized file is still refused by the
      // action with a readable error rather than by the framework.
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
