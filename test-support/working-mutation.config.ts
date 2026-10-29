import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

if (process.env.PI_TEST_ISOLATED !== "1") throw new Error("Run mutation tests through pnpm test");

// Mutator uses dependency-sharing overlays. Keep Vite writes out of node_modules
// and use --configLoader runner so the config is not bundled in a shared cache.
export default defineConfig({
  root: process.cwd(),
  cacheDir: resolve(process.cwd(), `.mutation-vite-${process.pid}`),
  test: {
    cache: false,
    environment: "node",
    include: ["extensions/codex-ui/__tests__/{token-rate,token-rate-provider,json-units,working,working-session,context-usage,footer,goal-footer}.test.ts"],
    testTimeout: 15000,
  },
});
