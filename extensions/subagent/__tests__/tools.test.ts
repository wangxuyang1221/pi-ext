import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { registerSubagentTools } from "../src/tools.js";

const expectedNames = [
  "subagent_spawn",
  "subagent_resume",
  "subagent_prompt",
  "subagent_list",
  "subagent_read",
  "subagent_wait",
  "subagent_close",
  "subagent_forget",
];

test("registers the fixed public subagent tool surface", () => {
  const registered: Array<Record<string, unknown>> = [];
  const pi = {
    registerTool(tool: Record<string, unknown>) {
      registered.push(tool);
    },
  };
  const manager = {
    spawn: vi.fn(),
    resume: vi.fn(),
    prompt: vi.fn(),
    list: vi.fn(),
    read: vi.fn(),
    wait: vi.fn(),
    close: vi.fn(),
    forget: vi.fn(),
  };

  registerSubagentTools(pi as never, manager as never);

  assert.deepEqual(registered.map((tool) => tool.name), expectedNames);
  for (const tool of registered) {
    assert.equal(tool.renderShell, "self");
    assert.equal(typeof tool.description, "string");
    assert.match(String(tool.description), /[\u3400-\u9fff]/u);
    assert.equal(typeof tool.promptSnippet, "string");
    assert.ok(Array.isArray(tool.promptGuidelines));
    assert.equal((tool.promptGuidelines as unknown[]).length, 1);
  }
});
