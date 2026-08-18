import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
