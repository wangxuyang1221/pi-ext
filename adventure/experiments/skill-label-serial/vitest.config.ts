import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["adventure/experiments/skill-label-serial/editor.test.ts"],
    mockReset: true,
    testTimeout: 15_000,
    hookTimeout: 10_000,
  },
});
