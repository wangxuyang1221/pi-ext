import { rm } from "node:fs/promises";

const outputDirectories = [
  new URL("../extensions/codex-compact/dist/", import.meta.url),
  new URL("../extensions/openai-fast-mode/dist/", import.meta.url),
  new URL("../extensions/codex-ui/dist/", import.meta.url),
  new URL("../extensions/mcp/dist/", import.meta.url),
  new URL("../extensions/permissions/dist/", import.meta.url),
  new URL("../extensions/subagent/dist/", import.meta.url),
  new URL("../extensions/goal/dist/", import.meta.url),
];

await Promise.all(
  outputDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
);
