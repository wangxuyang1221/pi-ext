import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { prepare } from "./prepare.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

test("prepared production Goal tools load with their runtime dependencies", async () => {
  await mkdir(join(repo, ".tmp"), { recursive: true });
  const root = await mkdtemp(join(repo, ".tmp/goal-tool-ui-prepare-"));
  try {
    await prepare(repo, root);
    const tools = await import(pathToFileURL(join(root, "goal/tools.js")).href);
    assert.equal(typeof tools.registerGoalTools, "function");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
