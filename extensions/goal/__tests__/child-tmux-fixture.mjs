import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { offlineCodex, rawUsage, textStep, toolStep } from "./budget-fixtures.mjs";
import subagent from "../../subagent/dist/index.js";
import goal from "../dist/index.js";

// Loaded by the real CLI in its own tmux pane, with repository-local HOME and agent dirs.
export default async function fixtureExtension(pi) {
  const root = process.env.GOAL_CHILD_EVIDENCE;
  const packageRoot = process.env.GOAL_CHILD_PI;
  if (!root || !packageRoot) throw new Error("Missing isolated child fixture configuration");
  let networkAttempts = 0;
  globalThis.fetch = async () => { networkAttempts++; throw new Error("Offline tmux fixture forbids network"); };
  const aiRoot = resolve(packageRoot, "../pi-ai");
  const ai = await import(pathToFileURL(join(aiRoot, "dist/index.js")));
  const adapter = await import(pathToFileURL(join(aiRoot, "dist/api/openai-codex-responses.js")));
  const wait = async signal => {
    await writeFile(join(root, "child-requested"), String(process.pid));
    while (!existsSync(join(root, "child-release"))) await delay(10, undefined, { signal });
  };
  const steps = process.env.GOAL_CHILD_SCENARIO === "duplicate"
    ? [toolStep("fixture_noop", {}, rawUsage(), { wait, id: "tmux-child-response" }), textStep("Repeated receipt", rawUsage(), { id: "tmux-child-response" })]
    : [textStep("Child done", rawUsage(), { wait, id: "tmux-child-response" })];
  const fixture = offlineCodex(ai, adapter, steps);
  pi.registerProvider(fixture.provider);
  pi.registerTool({ name: "fixture_noop", label: "Noop", description: "Offline receipt replay step", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "Done" }] }) });
  subagent(pi);
  goal(pi);
  pi.on("session_start", async () => {
    await writeFile(join(root, "child-started.json"), JSON.stringify({ pid: process.pid, version: JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version }));
  });
  pi.on("agent_settled", async (_event, ctx) => {
    await writeFile(join(root, "child-settled.json"), JSON.stringify({ pid: process.pid, calls: fixture.calls(), networkAttempts, tools: pi.getActiveTools(), entries: ctx.sessionManager.getEntries() }, null, 2));
  });
}
