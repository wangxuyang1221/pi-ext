import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["extensions/**/__tests__/**/*.test.ts"],
    mockReset: true,
    testTimeout: 15_000,
    hookTimeout: 10_000,
  },
});
