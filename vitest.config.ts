import { defineConfig } from "vitest/config";

if (process.env.PI_TEST_ISOLATED !== "1") {
  throw new Error("Run tests through pnpm test so configuration and credentials are isolated.");
}

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "offline", include: ["extensions/**/__tests__/**/*.test.ts", "test-support/__tests__/**/*.test.ts"] } },
    ],
    mockReset: true,
    testTimeout: 15_000,
    hookTimeout: 10_000,
  },
});
