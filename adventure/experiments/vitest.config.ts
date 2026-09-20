import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["adventure/experiments/**/*.test.ts"],
    testTimeout: 5_000,
  },
});
