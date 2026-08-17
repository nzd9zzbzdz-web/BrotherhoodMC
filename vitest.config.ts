import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    // Rules tests and engine tests share the emulator — run serially.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // "server-only" is a Next.js guard — inert in tests.
      "server-only": resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
});
