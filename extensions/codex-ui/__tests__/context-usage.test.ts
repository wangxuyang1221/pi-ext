import assert from "node:assert/strict";
import { test } from "vitest";
import { SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fauxProvider } from "@earendil-works/pi-ai";
import { createContextUsageReader } from "../src/context-usage.js";

test("animation reads reuse persisted context until the branch or model limits change", () => {
  const manager = SessionManager.inMemory();
  let model = fauxProvider().getModel();
  let reads = 0;
  const ctx = { sessionManager: manager, get model() { return model; }, getContextUsage() {
    reads++; return { tokens: reads, contextWindow: model.contextWindow!, percent: reads };
  } } as Pick<ExtensionContext, "sessionManager" | "model" | "getContextUsage">;
  const read = createContextUsageReader(ctx);
  const first = read();
  for (let i = 0; i < 100; i++) assert.equal(read(), first);
  assert.equal(reads, 1);
  const id = manager.appendMessage({ role: "user", content: "new context", timestamp: 0 });
  assert.equal(read()?.tokens, 2);
  manager.appendContextEdit(id, { content: "edited" });
  assert.equal(read()?.tokens, 3);
  manager.branch(id); assert.equal(read()?.tokens, 4);
  manager.appendCompaction("summary", id, 100); assert.equal(read()?.tokens, 5);
  model = { ...model }; assert.equal(read()?.tokens, 6);
  model.contextWindow = 12345; assert.equal(read()?.tokens, 7);
  const replacement = createContextUsageReader(ctx); assert.equal(replacement()?.tokens, 8);
});

test("virtual routing and hosts without the revision accessor always read current context", () => {
  let reads = 0;
  const ctx = { sessionManager: SessionManager.inMemory(), model: { ...fauxProvider().getModel(), api: "pi-virtual" },
    getContextUsage() { reads++; return undefined; },
  } as Pick<ExtensionContext, "sessionManager" | "model" | "getContextUsage">;
  const read = createContextUsageReader(ctx);
  read(); read(); assert.equal(reads, 2);
  ctx.model = undefined; read(); assert.equal(reads, 3);
  ctx.model = fauxProvider().getModel();
  ctx.sessionManager = {} as ExtensionContext["sessionManager"];
  read(); read(); assert.equal(reads, 5);
});
