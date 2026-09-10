import { expect, it } from "vitest";
import { goalCapability } from "../src/capability.js";

it.each([
  ["tui", "openai-codex", "/session.jsonl", false, true],
  ["tui", "other", "/session.jsonl", false, false],
  ["rpc", "openai-codex", "/session.jsonl", false, false],
  ["json", "openai-codex", "/session.jsonl", false, false],
  ["print", "openai-codex", "/session.jsonl", false, false],
  ["tui", "openai-codex", undefined, false, false],
  ["tui", "openai-codex", "/session.jsonl", true, false],
])("gates goal execution in %s/%s with persistence %s and child %s", (mode, provider, file, child, allowed) => {
  const ctx = { mode, model: { provider }, sessionManager: { getSessionFile: () => file } };
  expect(goalCapability(ctx as never, Boolean(child)).supported).toBe(allowed);
});
