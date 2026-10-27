import assert from "node:assert/strict";
import type { Provider, Tool } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { Type } from "typebox";
import { test, vi } from "vitest";

import { registerSubagentTools } from "../src/tools.js";

for (const provider of [deepseekProvider(), openaiCodexProvider()]) {
  test(`preserves strict read variants in ${provider.id} request payloads`, async () => {
    const tools: Tool[] = [];
    registerSubagentTools({ on() { return () => {}; }, registerTool: (tool) => { tools.push(tool); } }, {} as never);
    const read = tools.find((tool) => tool.name === "subagent_read");
    assert.ok(read);
    assert.ok(Type.IsUnion(read.parameters));
    const schema = read.parameters;
    assert.equal(schema.anyOf.length, 3);
    // Reconstruct the previous object union to guard against provider-side rewrites.
    const previousTools = tools.map((tool) => tool === read
      ? { ...tool, parameters: Type.Union(schema.anyOf) }
      : tool);
    const previousPayload = await capturePayload(provider, previousTools);
    const payload = await capturePayload(provider, tools);
    assert.equal(payload.tools.length, 6);
    const functions = payload.tools.map((tool) => tool.function ?? tool);
    for (const tool of functions) {
      assert.equal(tool.parameters.type, "object", `${tool.name} must have an object root`);
    }
    const serializedRead = functions.find((tool) => tool.name === "subagent_read");
    assert.ok(serializedRead);
    assert.deepEqual(serializedRead.parameters, JSON.parse(JSON.stringify(schema)));
    assert.equal(serializedRead.strict, provider.id === "openai-codex" ? null : false);
    delete serializedRead.parameters.type;
    assert.deepEqual(payload.tools, previousPayload.tools, "Only the read schema root type may change");
  });
}

async function capturePayload(provider: Provider, tools: Tool[]) {
  const model = provider.getModels()[0];
  assert.ok(model);
  const claims = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "schema-test" },
  })).toString("base64url");
  const fetch = vi.fn(async () => { throw new Error("Network access is forbidden in schema tests"); });
  let captured: { tools?: Array<Record<string, any>>; input?: Array<Record<string, any>> } | undefined;
  const result = await provider.stream(model, normalizeContext({
    messages: [{ role: "user", content: "Schema test", timestamp: 0 }],
    tools,
  }), {
    // This synthetic token only satisfies local Codex account-ID parsing.
    apiKey: `e30.${claims}.signature`,
    transport: "sse",
    maxRetries: 0,
    fetch,
    onPayload(payload) {
      captured = JSON.parse(JSON.stringify(payload));
      throw new Error("Payload captured before transport");
    },
  }).result();
  assert.ok(captured, result.errorMessage);
  assert.match(result.errorMessage ?? "", /Payload captured before transport/u);
  assert.equal(fetch.mock.calls.length, 0);
  return { ...captured, tools: [...(captured.tools ?? []),
    ...(captured.input ?? []).flatMap(item => item.type === "additional_tools" || item.type === "tool_search_output" ? item.tools : [])] };
}
