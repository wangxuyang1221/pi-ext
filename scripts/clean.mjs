import { rm } from "node:fs/promises";

for (const plugin of ["codex-ui", "claude-code-ui"]) {
  await rm(new URL(`../extensions/${plugin}/dist/`, import.meta.url), { recursive: true, force: true });
}
