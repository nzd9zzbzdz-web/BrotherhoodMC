import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Character renders and gallery photos post the raw image through a
      // Server Action. Headroom over the 10MB gallery cap so an oversized file
      // is refused by the action with a readable error rather than by the
      // framework with a truncated-body failure.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
