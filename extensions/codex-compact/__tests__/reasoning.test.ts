import { afterEach, expect, test, vi } from "vitest";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { createNativeCheckpoint } from "../src/remote-compaction.js";

const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.c`;
const model = getBuiltinModel("openai-codex", "gpt-5.6-sol")!;
async function capture(m = model, thinkingLevel: any = "off", basePayload?: any, activeModel = m) {
  let body: any;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"opaque"}}\n\ndata: {"type":"response.completed","response":{"id":"r"}}\n\n');
  });
  await createNativeCheckpoint({ model: m, input: [], allTools: [], activeToolNames: [], basePayload,
    ctx: { model: activeModel, thinkingLevel, cwd: process.cwd(), isProjectTrusted: () => false, getSystemPrompt: () => "",
      sessionManager: { getSessionId: () => "test" }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey, baseUrl: "https://example.test" }) } } as any });
  return body;
}
async function piReasoning(m: typeof model, level: any) {
  let body: any;
  const effective = clampThinkingLevel(m, level);
  await streamSimple(m, { messages: [] }, { apiKey, reasoning: effective === "off" ? undefined : effective,
    onPayload: payload => { body = payload; throw new Error("Stop before network"); } }).result();
  expect(body).toBeDefined();
  return body.reasoning;
}
afterEach(() => vi.unstubAllGlobals());

test.each([undefined, { model: model.id }, { model: model.id, reasoning: { effort: "high", summary: "auto" } }])(
  "omits reasoning when thinking is off even with cached settings: %j", async (basePayload) => {
    expect((await capture(model, "off", basePayload)).reasoning).toEqual(await piReasoning(model, "off"));
  },
);

test.each(["minimal", "low", "high", "xhigh", "max"])("matches Pi's effective reasoning for %s", async (level) => {
  expect((await capture(model, level)).reasoning).toEqual(await piReasoning(model, level));
});

test("clamps transition settings for the previous model instead of reusing the selected model's settings", async () => {
  const previous = { ...getBuiltinModel("openai-codex", "gpt-5.5")!, thinkingLevelMap: { minimal: null, xhigh: null, max: null } };
  const body = await capture(previous, "max", { model: model.id, reasoning: { effort: "max" }, service_tier: "priority", temperature: 0.7, text: { verbosity: "high" } }, model);
  expect(body.reasoning).toEqual(await piReasoning(previous, "max"));
  expect(body.reasoning.effort).toBe("high");
  expect(body.service_tier).toBeUndefined();
  expect(body.temperature).toBeUndefined();
  expect(body.text).not.toEqual({ verbosity: "high" });
});

test("omits reasoning for a non-reasoning model and preserves valid mapped payload settings otherwise", async () => {
  expect((await capture({ ...model, reasoning: false }, "high", { reasoning: { effort: "high" } })).reasoning).toBeUndefined();
  const mapped = { effort: "low", summary: "detailed" };
  expect((await capture(model, "minimal", { model: model.id, reasoning: mapped })).reasoning).toEqual(mapped);
});
