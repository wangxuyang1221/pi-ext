import { isDeepStrictEqual } from "node:util";
import { performance } from "node:perf_hooks";
import { expect, test, vi } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getTestModel } from "./fixtures/models.js";
import { createBranchInputSnapshot, modelKey, NATIVE_COMPACTION_KIND } from "../src/native-compaction.js";
import { resolveRequestProjection } from "../src/request-projection.js";
import { readFileSync } from "node:fs";
const piVersion = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).devDependencies["@earendil-works/pi-ai"];

const work = vi.hoisted(() => ({ snapshots: 0, messages: 0, conversions: 0 }));
vi.mock("../src/native-compaction.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/native-compaction.js")>();
  const { convertToLlm } = await import("@earendil-works/pi-coding-agent");
  return { ...actual, createBranchInputSnapshot: (params: Parameters<typeof actual.createBranchInputSnapshot>[0]) => {
    work.snapshots++;
    return actual.createBranchInputSnapshot({ ...params, convertMessages: messages => {
      work.conversions++; work.messages += messages.length; return convertToLlm(messages);
    } });
  } };
});
const model = { ...getTestModel("openai-codex", "gpt-5.5")!, compat: { supportsAdditionalTools: true, supportsMidConvoSystemMessages: true } };
const tool = (name: string) => ({ name, description: name, parameters: { type: "object", properties: { value: { type: "string", description: "schema".repeat(100) } } } });
function fixture(count: number, tools: number) {
  const sm = SessionManager.inMemory(process.cwd());
  const declarations = Array.from({ length: tools }, (_, index) => tool(`tool_${index}`));
  const incremental = tools === count;
  sm.appendMessage({ role: "system", content: "head", toolsAdded: incremental ? declarations.slice(0, 1) : declarations.slice(0, -1), timestamp: 0 } as never);
  for (let index = 0; index < count; index++) {
    sm.appendMessage({ role: "user", content: index % 2 ? "same text" : `message ${index}`, timestamp: index });
    if (incremental && index > 0 && index < tools - 1) sm.appendMessage({ role: "system", content: "", toolsAdded: [declarations[index]], timestamp: index } as never);
    if (index === Math.floor(count / 2)) sm.appendCustomEntry(NATIVE_COMPACTION_KIND, { kind: NATIVE_COMPACTION_KIND, version: 2,
      modelKey: modelKey(model), replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }] });
  }
  sm.appendMessage({ role: "system", content: "later", toolsAdded: declarations.slice(-1), timestamp: count } as never);
  return { branch: sm.getBranch(), tools: declarations as any };
}

test.each(["hidden", "forced", "both"])("agrees with a bounded exhaustive policy oracle: %s", mode => {
  const params = fixture(4, 3);
  const actualPolicy = { hiddenNames: new Set(mode === "forced" ? [] : ["tool_1"]), ...(mode === "hidden" ? {} : { forcedPrompt: "Forced" }) };
  const actual = createBranchInputSnapshot({ ...params, projectionPolicy: actualPolicy }).view(model, "full-history");
  const payload = { instructions: actual.instructions!, tools: actual.tools! };
  const possible: unknown[] = [];
  // Enumeration is deliberately confined to three declaration names in this oracle.
  for (let mask = 0; mask < 8; mask++) for (const forced of [false, true]) {
    const hiddenNames = new Set([0, 1, 2].filter(bit => mask & (1 << bit)).map(bit => `tool_${bit}`));
    const snapshot = createBranchInputSnapshot({ ...params, projectionPolicy: { hiddenNames, ...(forced ? { forcedPrompt: payload.instructions } : {}) } });
    for (const kind of ["full-history", "pi-context", "effective"] as const) {
      const wire = snapshot.view(model, kind);
      if (isDeepStrictEqual(wire.items, actual.items) && wire.instructions === actual.instructions && isDeepStrictEqual(wire.tools, actual.tools)) possible.push(snapshot.view(model, "effective").items);
    }
  }
  expect(possible.length).toBeGreaterThan(0);
  const selected = resolveRequestProjection(params.branch, model, params.tools, actual.items, payload);
  const replay = createBranchInputSnapshot({ ...params, projectionPolicy: selected }).view(model, "effective").items;
  for (const candidate of possible) expect(replay).toEqual(candidate);
});

test.each([[1000, 10], [2000, 10], [4000, 10], [1000, 100], [1000, 1000], [2000, 2000], [4000, 4000]])("bounds policy conversion work for N=%i T=%i", (count, toolCount) => {
  const params = fixture(count, toolCount);
  const actual = createBranchInputSnapshot(params).view(model, "full-history");
  const durations: number[] = [];
  for (let run = 0; run < 4; run++) {
    work.snapshots = work.messages = work.conversions = 0;
    const start = performance.now();
    const policy = resolveRequestProjection(params.branch, model, params.tools, actual.items, { instructions: actual.instructions!, tools: actual.tools! });
    if (run > 0) durations.push(performance.now() - start);
    expect(policy.hiddenNames.size).toBe(0);
    expect(work.snapshots).toBeLessThanOrEqual(5);
    // One baseline view plus at most three views for each of four policies.
    expect(work.messages).toBeLessThanOrEqual(13 * params.branch.length);
    // Forced collapse adds one synthetic leading entry to each of its three views.
    expect(work.conversions).toBeLessThanOrEqual(13 * params.branch.length + 3);
  }
  console.info(JSON.stringify({ check: "projection-cost", node: process.version, pi: piVersion, count, toolCount, ...work,
    samplesMs: durations.map(ms => Math.round(ms)), processPeakRssKiB: process.resourceUsage().maxRSS }));
});
