import { mkdtemp, rm, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { writeFile, mkdir } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import goalExtension, { registerGoal } from "../src/index.js";
import { GoalStore } from "../src/storage.js";
import { GoalContent } from "../src/content.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function harness(config?: unknown) {
  const root = await mkdtemp(resolve(".goal-command-test-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const disk = new GoalStore(resolve(root, "goals"));
  const manager = SessionManager.create(process.cwd(), resolve(root, "sessions"));
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
  const events = new Map<string, (event: unknown, ctx: ExtensionCommandContext) => Promise<void>>();
  const notify = vi.fn();
  const confirm = vi.fn(async () => true);
  const appendEntry = vi.fn((name, data) => { manager.appendCustomEntry(name, data); });
  const bus = new EventEmitter();
  let activeTools = ["read", "other_extension", "get_goal", "create_goal", "update_goal"];
  const pi = { getActiveTools: () => activeTools, setActiveTools: (names: string[]) => { activeTools = names; }, events: { on: (name, handler) => { bus.on(name, handler); return () => bus.off(name, handler); }, emit: (name, data) => bus.emit(name, data) }, registerTool: vi.fn(), sendMessage: vi.fn(), registerCommand: (name, command) => commands.set(name, command), on: (name, handler) => { const previous = events.get(name); events.set(name, async (event, ctx) => { await previous?.(event, ctx); return handler(event, ctx); }); }, appendEntry } as unknown as ExtensionAPI;
  const ctx = { mode: "tui", model: { provider: "openai-codex" }, hasUI: true, cwd: process.cwd(), sessionManager: manager, isIdle: () => true, ui: { notify, confirm, select: vi.fn(), editor: vi.fn(), setStatus: vi.fn() } } as unknown as ExtensionCommandContext;
  registerGoal(pi, disk, { config, temporaryRoot: root });
  await events.get("session_start")!({}, ctx);
  cleanups.push(() => events.get("session_shutdown")!({}, ctx));
  return { pi, commands, root, disk, manager, notify, confirm, appendEntry, ctx, events, recover: () => commands.get("goal-recover")!.handler("", ctx), run: (args: string) => commands.get("goal")!.handler(args, ctx) };
}

it.each(["reload", "fork", "budget", "complete", "no-model", "no-ui"])("does not offer automatic restoration for %s", async kind => {
  const h = await harness();
  await h.run("Saved state"); await h.run("pause");
  await h.events.get("session_shutdown")!({}, h.ctx);
  const saved = (await h.disk.records())[0]!;
  if (kind === "budget") { saved.goal!.tokenBudget = 10; saved.goal!.tokensUsed = 10; await h.disk.commit(saved); }
  if (kind === "complete") { saved.goal!.status = "complete"; await h.disk.commit(saved); }
  if (kind === "no-model") Object.assign(h.ctx, { model: undefined });
  if (kind === "no-ui") Object.assign(h.ctx, { hasUI: false });
  h.confirm.mockClear(); vi.mocked(h.pi.sendMessage).mockClear();
  await h.events.get("session_start")!({ reason: kind === "reload" || kind === "fork" ? kind : "resume" }, h.ctx);
  await h.events.get("resources_discover")!({ reason: "startup" }, h.ctx);
  expect(h.confirm).not.toHaveBeenCalled();
  expect(h.pi.sendMessage).not.toHaveBeenCalled();
});
it.each(["shutdown", "replace", "revision", "budget", "no-model"])("rejects a restored confirmation overtaken by %s", async kind => {
  const h = await harness();
  await h.run("Stale confirmation"); await h.run("pause");
  await h.events.get("session_shutdown")!({}, h.ctx);
  await h.events.get("session_start")!({ reason: "resume" }, h.ctx);
  vi.mocked(h.pi.sendMessage).mockClear();
  h.confirm.mockImplementationOnce(async () => {
    if (kind === "shutdown") await h.events.get("session_shutdown")!({}, h.ctx);
    else if (kind === "no-model") Object.assign(h.ctx, { model: undefined });
    else {
      const row = (await h.disk.records())[0]!;
      if (kind === "replace") row.goal!.goalId = "replacement";
      if (kind === "revision") row.revision++;
      if (kind === "budget") { row.goal!.tokenBudget = 10; row.goal!.tokensUsed = 10; }
      await h.disk.commit(row);
    }
    return true;
  });
  await h.events.get("resources_discover")!({ reason: "startup" }, h.ctx);
  expect((await h.disk.records())[0]!.goal!.status).toBe("paused");
  expect(h.pi.sendMessage).not.toHaveBeenCalled();
});
it("resumes a confirmed restored goal through the initialized scheduler exactly once", async () => {
  const h = await harness();
  await h.run("Resume saved"); await h.run("pause");
  await h.events.get("session_shutdown")!({}, h.ctx);
  vi.mocked(h.pi.sendMessage).mockClear();
  await h.events.get("session_start")!({ reason: "resume" }, h.ctx);
  await h.events.get("resources_discover")!({ reason: "startup" }, h.ctx);
  expect((await h.disk.records())[0]!.goal!.status).toBe("active");
  expect(h.pi.sendMessage).toHaveBeenCalledTimes(1);
  await h.events.get("resources_discover")!({ reason: "startup" }, h.ctx);
  expect(h.pi.sendMessage).toHaveBeenCalledTimes(1);
});
it("offers restored stopped goals a cancellable confirmation only after initialization", async () => {
  const h = await harness();
  await h.run("Restore confirmation"); await h.run("pause");
  await h.events.get("session_shutdown")!({}, h.ctx);
  vi.mocked(h.pi.sendMessage).mockClear(); h.confirm.mockClear();
  h.confirm.mockResolvedValueOnce(false);
  await h.events.get("session_start")!({ reason: "resume" }, h.ctx);
  const before = (await h.disk.records())[0]!;
  expect(h.confirm).not.toHaveBeenCalled();
  await h.events.get("resources_discover")?.({ reason: "startup" }, h.ctx);
  expect(h.confirm).toHaveBeenCalledTimes(1);
  expect((await h.disk.records())[0]).toEqual(before);
  expect(h.pi.sendMessage).not.toHaveBeenCalled();
  await h.events.get("resources_discover")?.({ reason: "reload" }, h.ctx);
  expect(h.confirm).toHaveBeenCalledTimes(1);
});
it("assigns managed child tasks under a non-Codex provider", async () => {
  const h = await harness(); await h.run("Managed gate");
  Object.assign(h.ctx, { model: { provider: "other" } });
  const task = { parentSessionId: h.manager.getSessionId(), directory: resolve(h.root, "reports"), promises: [] as Promise<string | undefined>[] };
  h.pi.events.emit("pi-ext:goal:subagent-task", task);
  expect((await Promise.all(task.promises)).filter(Boolean)).toHaveLength(1);
  expect((await h.disk.records())[0]!.goal!.childUsage).toHaveLength(1);
});
it("accounts non-Codex root work against an existing active goal", async () => {
  const h = await harness(); await h.run("Supported only");
  Object.assign(h.ctx, { model: { provider: "other" } });
  await h.events.get("model_select")!({}, h.ctx);
  await h.events.get("context")!({ messages: [{ role: "user", content: "Unrelated provider work" }] }, h.ctx);
  const message = { role: "assistant", provider: "other", model: "fixture", timestamp: 1, responseId: "unsupported", content: [], stopReason: "stop", usage: { input: 5, output: 5 } };
  await h.events.get("message_start")!({ message }, h.ctx);
  await h.events.get("message_end")!({ message }, h.ctx);
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(10);
});
it("hides mutating tools without a selected model and rejects direct calls while preserving local stops", async () => {
  const h = await harness();
  Object.assign(h.ctx, { model: { provider: "openai-codex" } });
  await h.events.get("model_select")!({}, h.ctx);
  await h.run("Supported goal");
  const tools = new Map(vi.mocked(h.pi.registerTool).mock.calls.map(([tool]) => [tool.name, tool]));
  Object.assign(h.ctx, { model: undefined });
  await h.events.get("model_select")!({}, h.ctx);
  expect(h.pi.getActiveTools()).toEqual(["read", "other_extension", "get_goal"]);
  const saved = (await h.disk.records())[0]!;
  for (const [name, args] of [["create_goal", { objective: "Unsupported" }], ["update_goal", { status: "complete" }]] as const) {
    await expect(tools.get(name)!.execute("call", args, undefined, undefined, h.ctx)).rejects.toThrow(/requires a selected model/);
  }
  const result = await tools.get("get_goal")!.execute("read", {}, undefined, undefined, h.ctx);
  expect((result.details as any).goal.objective).toBe("Supported goal");
  expect((await h.disk.records())[0]).toEqual(saved);
  await h.run("Replacement not supported");
  expect((await h.disk.records())[0]).toEqual(saved);
  await h.run("pause");
  expect((await h.disk.records())[0]!.goal!.status).toBe("paused");
  await h.run("clear");
  expect((await h.disk.records())[0]!.goal).toBeNull();
  Object.assign(h.ctx, { model: { provider: "openai-codex" } });
  await h.events.get("model_select")!({}, h.ctx);
  expect(h.pi.getActiveTools()).toEqual(["read", "other_extension", "get_goal", "create_goal", "update_goal"]);
});
it.each(["create_goal", "get_goal", "update_goal"])("does not reactivate externally disabled %s on model switches", async name => {
  const h = await harness();
  await h.run("Keep tool choices");
  h.pi.setActiveTools(h.pi.getActiveTools().filter(tool => tool !== name));
  Object.assign(h.ctx, { model: { provider: "private-model" } });
  await h.events.get("model_select")!({}, h.ctx);
  expect(h.pi.getActiveTools()).not.toContain(name);
  expect(h.pi.getActiveTools()).toContain("other_extension");
});

it.each(["create_goal", "get_goal", "update_goal"])("requires explicit resume after %s recovers, including input, edit and reload", async name => {
  const h = await harness();
  Object.assign(h.ctx, { abort: vi.fn(), signal: new AbortController().signal });
  await h.run("Tool recovery");
  await h.events.get("context")!({ messages: [{ role: "custom", ...vi.mocked(h.pi.sendMessage).mock.calls[0]![0] }] }, h.ctx);
  vi.mocked(h.pi.sendMessage).mockClear();
  const tools = h.pi.getActiveTools();
  h.pi.setActiveTools(tools.filter(tool => tool !== name));
  await h.events.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "More work remains" }] }] }, h.ctx);
  expect(h.pi.sendMessage).not.toHaveBeenCalled();
  const gated = (await h.disk.records())[0]!;
  expect(gated.goal).toMatchObject({ status: "active", toolRecoveryRequired: true });
  expect(h.notify.mock.calls.some(([text]) => String(text).includes(`Missing goal tools: ${name}`))).toBe(true);
  await h.run("resume");
  expect(h.pi.sendMessage).not.toHaveBeenCalled();
  expect(h.pi.getActiveTools()).not.toContain(name);
  h.pi.setActiveTools(tools);
  await h.events.get("input")!({ source: "interactive", text: "Ordinary input" }, h.ctx);
  await h.events.get("message_end")!({ message: { role: "user", content: "Ordinary input" } }, h.ctx);
  Object.assign(h.ctx, { model: { provider: "other" } });
  await h.events.get("model_select")!({}, h.ctx);
  vi.mocked(h.ctx.ui.editor).mockResolvedValueOnce("Edited goal");
  await h.run("edit");
  await h.events.get("session_shutdown")!({}, h.ctx);
  await h.events.get("session_start")!({ reason: "reload" }, h.ctx);
  await h.events.get("context")!({ messages: [{ role: "user", content: "Another input" }] }, h.ctx);
  await h.events.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Still more work" }] }] }, h.ctx);
  expect(h.pi.sendMessage).not.toHaveBeenCalled();
  expect((await h.disk.records())[0]!.goal).toMatchObject({ goalId: gated.goal!.goalId, toolRecoveryRequired: true, status: "active" });
  await h.run("");
  expect(h.notify.mock.calls.at(-1)?.[0]).toContain("explicit /goal resume");
  await h.run("resume");
  expect((await h.disk.records())[0]!.goal!.toolRecoveryRequired).toBeUndefined();
  expect(h.pi.sendMessage).toHaveBeenCalledTimes(1);
});

it("does not repeat recovery writes or notices at unchanged lifecycle checkpoints", async () => {
  const h = await harness();
  await h.run("Stable recovery observation");
  h.pi.setActiveTools(h.pi.getActiveTools().filter(name => name !== "get_goal"));
  await h.events.get("model_select")!({}, h.ctx);
  const saved = (await h.disk.records())[0]!;
  const commits = vi.spyOn(h.disk, "commit");
  h.notify.mockClear();
  for (let i = 0; i < 20; i++) {
    await h.events.get("model_select")!({}, h.ctx);
    await h.events.get("before_agent_start")!({}, h.ctx);
  }
  expect(commits).not.toHaveBeenCalled();
  expect(h.notify).not.toHaveBeenCalled();
  expect((await h.disk.records())[0]).toEqual(saved);
});

it("releases the goal writer when saving reload tool choices fails", async () => {
  const h = await harness();
  await h.run("Reload cleanup");
  h.pi.setActiveTools(h.pi.getActiveTools().filter(name => name !== "get_goal"));
  await h.events.get("model_select")!({}, h.ctx);
  h.appendEntry.mockImplementationOnce(() => { throw new Error("Tool choice mirror failure"); });
  await h.events.get("session_shutdown")!({ reason: "reload" }, h.ctx);
  const record = (await h.disk.records())[0]!;
  const reopened = await h.disk.openSession(record);
  expect(reopened.snapshot.goal!.toolRecoveryRequired).toBe(true);
  await reopened.close();
  expect(h.notify.mock.calls.some(([text]) => String(text).includes("Tool choice mirror failure"))).toBe(true);
});

it("does not offer a saved-goal dialog as a substitute for explicit tool recovery", async () => {
  const h = await harness();
  await h.run("Gated saved goal");
  h.pi.setActiveTools(h.pi.getActiveTools().filter(name => name !== "get_goal"));
  await h.run("pause");
  await h.events.get("session_shutdown")!({}, h.ctx);
  h.pi.setActiveTools([...h.pi.getActiveTools(), "get_goal"]);
  h.confirm.mockClear();
  await h.events.get("session_start")!({ reason: "resume" }, h.ctx);
  await h.events.get("resources_discover")!({ reason: "startup" }, h.ctx);
  expect(h.confirm).not.toHaveBeenCalled();
  expect((await h.disk.records())[0]!.goal).toMatchObject({ status: "paused", toolRecoveryRequired: true });
});

it("materializes long TUI goals and restores their editable text after reopening", async () => {
  const h = await harness();
  const text = "Long objective 🧭\n".repeat(400);
  await h.run(text);
  await h.run("pause");
  const saved = (await h.disk.records())[0]!;
  expect(saved.goal!.content).toBeDefined();
  expect([...saved.goal!.objective].length).toBeLessThanOrEqual(4000);
  await h.events.get("session_shutdown")!({}, h.ctx);
  await h.events.get("session_start")!({}, h.ctx);
  const beforeCancel = await h.disk.records();
  vi.mocked(h.ctx.ui.editor).mockResolvedValueOnce(undefined);
  await h.run("edit");
  expect(await h.disk.records()).toEqual(beforeCancel);
  vi.mocked(h.ctx.ui.editor).mockResolvedValueOnce(`${text}Edited`);
  await h.run("edit");
  expect(h.ctx.ui.editor).toHaveBeenCalledWith("Edit goal", text.trim());
  const edited = (await h.disk.records())[0]!.goal!;
  expect(edited).toMatchObject({ goalId: saved.goal!.goalId, status: "paused", tokensUsed: 0 });
  expect(await new GoalContent(resolve(h.disk.root, "content"), h.root).expand(edited)).toBe(`${text}Edited`);
});

it("asks before reading native paste attachments and copies only the selected image", async () => {
  const h = await harness();
  const source = resolve(h.root, "pi-clipboard-12345678-1234-4123-8123-123456789abc.png");
  const text = `Inspect ${source}`;
  vi.mocked(h.ctx.ui.select).mockResolvedValueOnce("Keep as text");
  await h.run(text);
  expect(h.ctx.ui.select).toHaveBeenCalledWith(expect.stringContaining(source), ["Copy attachment", "Keep as text", "Cancel"]);
  expect((await h.disk.records())[0]!.goal!.objective).toBe(text);
  await h.run("clear");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGPk0Y1iIAUwkaSaYVQDcYCJSHVwMKqBGEByKAEA9NsAs1GX4RQAAAAASUVORK5CYII=", "base64");
  await writeFile(source, png);
  vi.mocked(h.ctx.ui.select).mockResolvedValueOnce("Copy attachment");
  await h.run(text);
  expect((await h.disk.records())[0]!.goal!.content!.attachments).toHaveLength(1);
  await rm(source);
  vi.mocked(h.ctx.ui.editor).mockImplementationOnce(async (_title, value) => value);
  await h.run("edit");
  expect(h.notify.mock.calls.at(-1)?.[0]).toBe("Goal updated.");
});

it("preserves saved content across cancelled attachment selection and failed record commits", async () => {
  const h = await harness();
  const text = "Existing long objective ".repeat(300);
  await h.run(text);
  const saved = (await h.disk.records())[0]!;
  const files = new GoalContent(resolve(h.disk.root, "content"), h.root);
  const directoryNames = await readdir(files.root);
  const source = resolve(h.root, "pi-clipboard-12345678-1234-4123-8123-123456789abc.png");
  vi.mocked(h.ctx.ui.select).mockResolvedValueOnce("Cancel");
  await h.run(`Replacement ${source}`);
  expect((await h.disk.records())[0]).toEqual(saved);
  h.disk.beforeRename = () => { throw new Error("Record write failure"); };
  await h.run("Replacement text ".repeat(500));
  expect(await readdir(files.root)).toEqual(directoryNames);
  expect(await files.expand(saved.goal!)).toBe(text.trim());
  expect(h.notify.mock.calls.at(-1)?.[0]).toContain("Record write failure");
  h.disk.beforeRename = undefined;
  await h.run("");
  expect(h.notify.mock.calls.at(-1)?.[0]).toContain("Existing long objective");
});

it("retains content after an uncertain post-rename failure instead of deleting committed files", async () => {
  const h = await harness();
  await h.run("Previous");
  vi.mocked(h.pi.sendMessage).mockClear();
  const original = h.disk.commit.bind(h.disk);
  vi.spyOn(h.disk, "commit").mockImplementationOnce(async (...args) => { await original(...args); throw new Error("Post-rename sync failure"); });
  const text = "Uncertain but committed ".repeat(250);
  await h.run(text);
  const saved = (await h.disk.records())[0]!;
  expect(saved.goal!.content).toBeDefined();
  expect(await new GoalContent(resolve(h.disk.root, "content"), h.root).expand(saved.goal!)).toBe(text.trim());
  expect(h.notify.mock.calls.at(-1)?.[0]).toContain("Post-rename sync failure");
  expect(h.pi.sendMessage).not.toHaveBeenCalled();
});

it("does not install an independent goal loop or tools inside a managed child", () => {
  const previous = process.env.PI_SUBAGENT_PARENT;
  process.env.PI_SUBAGENT_PARENT = JSON.stringify({ sessionId: "root" });
  try {
    const pi = { on: vi.fn(), registerCommand: vi.fn(), registerTool: vi.fn() };
    goalExtension(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.registerCommand).not.toHaveBeenCalled();
    expect(pi.on).not.toHaveBeenCalled();
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENT_PARENT;
    else process.env.PI_SUBAGENT_PARENT = previous;
  }
});

it("attributes managed reports before completion and ignores replaced goal late reports", async () => {
  const h = await harness({ maxGoalTokenBudget: 100 });
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, isIdle: () => false, signal: new AbortController().signal, abort: vi.fn() });
  await h.run("Child work");
  await h.events.get("context")!({ messages: [] }, h.ctx);
  const directory = resolve(h.root, "reports");
  await mkdir(directory);
  const request = { parentSessionId: h.manager.getSessionId(), directory, promises: [] as Promise<string | undefined>[] };
  h.pi.events.emit("pi-ext:goal:subagent-task", request);
  expect(request.promises).toHaveLength(1);
  const sourceId = await request.promises[0]!;
  expect(sourceId).toBeTypeOf("string");
  await writeFile(resolve(directory, `${sourceId}.json`), JSON.stringify({ sourceId, tokens: 110, missing: false }));
  await h.run("");
  expect((await h.disk.records())[0]!.goal).toMatchObject({ tokensUsed: 110, status: "budget_limited" });
  await h.run("");
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(110);
  expect(vi.mocked(h.pi.sendMessage).mock.calls.filter(([message]) => message.customType === "pi-ext-goal-budget")).toHaveLength(1);
  const finishingTask = { ...request, promises: [] as Promise<string | undefined>[] };
  h.pi.events.emit("pi-ext:goal:subagent-task", finishingTask);
  expect(await finishingTask.promises[0]).toBeTypeOf("string");
  await h.run("Replacement");
  await writeFile(resolve(directory, `${sourceId}.json`), JSON.stringify({ sourceId, tokens: 200, missing: false }));
  await h.run("");
  expect((await h.disk.records())[0]!.goal).toMatchObject({ objective: "Replacement", tokensUsed: 0 });
});

it("charges normalized usage once, steers one wrap-up, and retains 110 against budget 100", async () => {
  const h = await harness({ maxGoalTokenBudget: 100 });
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, isIdle: () => false, signal: new AbortController().signal, abort: vi.fn() });
  await h.run("Budget fixture");
  const emit = async (name: string, event: unknown) => h.events.get(name)?.(event, h.ctx);
  const message = { role: "assistant", provider: "openai-codex", api: "openai-codex-responses", model: "fixture", timestamp: 1, responseId: "response-1", content: [{ type: "toolCall", name: "bash", id: "work", arguments: {} }], stopReason: "toolUse", usage: { input: 80, output: 20, cacheRead: 40, cacheWrite: 0, reasoning: 8, totalTokens: 140 } };
  await emit("context", { messages: [{ role: "user", content: "Work" }] });
  await emit("message_start", { message });
  await emit("message_end", { message });
  expect((await h.disk.records())[0]!.goal).toMatchObject({ tokensUsed: 100, status: "budget_limited" });
  await emit("message_end", { message: structuredClone(message) });
  const reminders = vi.mocked(h.pi.sendMessage).mock.calls.filter(([message]) => message.customType === "pi-ext-goal-budget");
  expect(reminders).toHaveLength(1);
  expect(reminders[0]![1]).toEqual({ deliverAs: "steer" });
  await emit("context", { messages: [{ role: "custom", ...reminders[0]![0] }] });
  const final = { ...message, timestamp: 2, responseId: "response-2", content: [{ type: "text", text: "Wrapped up" }], stopReason: "stop", usage: { ...message.usage, input: 7, output: 3 } };
  await emit("message_start", { message: final });
  await emit("message_end", { message: final });
  await emit("agent_end", { messages: [message, final] });
  await emit("agent_settled", {});
  expect((await h.disk.records())[0]!.goal).toMatchObject({ tokensUsed: 110, status: "budget_limited" });
  expect(h.ctx.abort).not.toHaveBeenCalled();
  expect(vi.mocked(h.pi.sendMessage).mock.calls).toHaveLength(2);
  await emit("context", { messages: [{ role: "user", content: "Unrelated later work" }] });
  const later = { ...final, timestamp: 3, responseId: "response-later" };
  await emit("message_start", { message: later });
  await emit("message_end", { message: later });
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(110);
});

it.each(["pause", "model-paused", "blocked", "abort", "complete", "usage_limited"])("preserves budget stop precedence through %s", async action => {
  const h = await harness({ maxGoalTokenBudget: 10 });
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, isIdle: () => false, signal: new AbortController().signal, abort: vi.fn() });
  await h.run("Budget precedence");
  await h.events.get("context")!({ messages: [] }, h.ctx);
  const message = { role: "assistant", provider: "openai-codex", model: "fixture", timestamp: 1, responseId: "cross", content: [], stopReason: "stop", usage: { input: 8, output: 2 } };
  await h.events.get("message_start")!({ message }, h.ctx);
  await h.events.get("message_end")!({ message }, h.ctx);
  if (action === "pause") { await h.run("pause"); expect(h.notify.mock.calls.at(-1)?.[0]).toContain("budget_limited"); }
  else if (action === "abort" || action === "usage_limited") {
    await h.events.get("agent_end")!({ messages: [{ ...message, stopReason: action === "abort" ? "aborted" : "error", errorMessage: "usage_limit_reached" }] }, h.ctx);
    Object.assign(h.ctx, { isIdle: () => true });
    await h.events.get("agent_settled")!({}, h.ctx);
  } else {
    const tool = vi.mocked(h.pi.registerTool).mock.calls.find(([tool]) => tool.name === "update_goal")![0];
    const result = await tool.execute("id", { status: action === "model-paused" ? "paused" : action }, undefined, undefined, h.ctx);
    expect((result.details as any).goal.status).toBe(action === "complete" ? "complete" : "budget_limited");
  }
  expect((await h.disk.records())[0]!.goal).toMatchObject({ tokensUsed: 10, status: action === "complete" || action === "usage_limited" ? action : "budget_limited" });
});

it("advances stopped child baselines across reload and resume without backcharging", async () => {
  const h = await harness();
  await h.run("Child baseline");
  const directory = resolve(h.root, "reports"); await mkdir(directory);
  const task = { parentSessionId: h.manager.getSessionId(), directory, promises: [] as Promise<string | undefined>[] };
  h.pi.events.emit("pi-ext:goal:subagent-task", task);
  const sourceId = await task.promises[0];
  const report = async (tokens: number) => writeFile(resolve(directory, `${sourceId}.json`), JSON.stringify({ sourceId, tokens, missing: false }));
  await report(10); await h.run("pause");
  await h.events.get("session_shutdown")!({}, h.ctx);
  await report(50);
  await h.events.get("session_start")!({ reason: "reload" }, h.ctx);
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(10);
  await report(60); await h.run("resume");
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(10);
  await report(65); await h.run("");
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(15);
});
it("settles observed child reports before a runtime abort freezes the goal", async () => {
  const h = await harness();
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, isIdle: () => false, signal: new AbortController().signal, abort: vi.fn() });
  await h.run("Stop checkpoint");
  await h.events.get("context")!({ messages: [] }, h.ctx);
  const directory = resolve(h.root, "reports"); await mkdir(directory);
  const task = { parentSessionId: h.manager.getSessionId(), directory, promises: [] as Promise<string | undefined>[] };
  h.pi.events.emit("pi-ext:goal:subagent-task", task);
  const sourceId = await task.promises[0];
  // Suppress watcher callbacks during an outstanding command, just as during a modal UI.
  let release!: () => void;
  vi.mocked(h.ctx.ui.editor).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(undefined); }));
  const editing = h.run("edit");
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await writeFile(resolve(directory, `${sourceId}.json`), JSON.stringify({ sourceId, tokens: 20, missing: false }));
  await h.events.get("agent_end")!({ messages: [{ role: "assistant", content: [], stopReason: "aborted" }] }, h.ctx);
  release(); await editing;
  expect((await h.disk.records())[0]!.goal).toMatchObject({ status: "paused", tokensUsed: 20 });
});
it("keeps late child usage frozen after budget wrap-up even during unrelated work", async () => {
  const h = await harness({ maxGoalTokenBudget: 10 });
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, isIdle: () => false, signal: new AbortController().signal, abort: vi.fn() });
  await h.run("Budget child");
  await h.events.get("context")!({ messages: [] }, h.ctx);
  const directory = resolve(h.root, "reports");
  await mkdir(directory);
  const task = { parentSessionId: h.manager.getSessionId(), directory, promises: [] as Promise<string | undefined>[] };
  h.pi.events.emit("pi-ext:goal:subagent-task", task);
  const sourceId = await task.promises[0];
  const report = async (tokens: number) => writeFile(resolve(directory, `${sourceId}.json`), JSON.stringify({ sourceId, tokens, missing: false }));
  await report(10); await h.run("");
  await report(15); await h.run("");
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(15);
  await h.events.get("agent_settled")!({}, h.ctx);
  await report(50); await h.run("");
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(15);
  expect((await h.disk.records())[0]!.goal!.childUsage![0]!.tokens).toBe(50);
});
it("flushes already-observed root usage before a user pause freezes accounting", async () => {
  const h = await harness(); await h.run("Observed usage");
  Object.assign(h.ctx, { isIdle: () => false, signal: new AbortController().signal, abort: vi.fn() });
  await h.events.get("context")!({ messages: [] }, h.ctx);
  const message = { role: "assistant", provider: "openai-codex", model: "fixture", timestamp: 1, responseId: "buffered", content: [], stopReason: "stop", usage: { input: 5, output: 5 } };
  await h.events.get("message_start")!({ message }, h.ctx);
  h.disk.beforeRename = () => { throw new Error("Temporary disk failure"); };
  await h.events.get("message_end")!({ message }, h.ctx);
  h.disk.beforeRename = undefined;
  await h.run("pause");
  expect((await h.disk.records())[0]!.goal).toMatchObject({ status: "paused", tokensUsed: 10 });
});
it("does not charge a pre-pause response after the same goal resumes", async () => {
  const h = await harness();
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, isIdle: () => false, signal: new AbortController().signal, abort: vi.fn() });
  await h.run("Activation fence");
  await h.events.get("context")!({ messages: [] }, h.ctx);
  const old = { role: "assistant", provider: "openai-codex", model: "fixture", responseId: "old-activation", timestamp: 1, content: [], stopReason: "stop", usage: { input: 80, output: 20 } };
  await h.events.get("message_start")!({ message: old }, h.ctx);
  await h.run("pause");
  await h.run("resume");
  await h.events.get("context")!({ messages: [] }, h.ctx);
  await h.events.get("message_end")!({ message: old }, h.ctx);
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(0);
  const fresh = { ...old, timestamp: 2, responseId: "new-activation", usage: { input: 3, output: 7 } };
  await h.events.get("message_start")!({ message: fresh }, h.ctx);
  await h.events.get("message_end")!({ message: fresh }, h.ctx);
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(10);
});
it("does not attribute a replaced goal's in-flight response to its replacement", async () => {
  const h = await harness();
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, isIdle: () => false, signal: new AbortController().signal, abort: vi.fn() });
  await h.run("Old goal");
  const message = { role: "assistant", provider: "openai-codex", model: "fixture", responseId: "old-flight", timestamp: 1, content: [], stopReason: "stop", usage: { input: 80, output: 20 } };
  await h.events.get("context")!({ messages: [] }, h.ctx);
  await h.events.get("message_start")!({ message }, h.ctx);
  await h.run("Replacement");
  await h.events.get("message_end")!({ message }, h.ctx);
  expect((await h.disk.records())[0]!.goal).toMatchObject({ objective: "Replacement", tokensUsed: 0 });
});

it("retries an uncommitted usage checkpoint once without doubling the receipt", async () => {
  const h = await harness();
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, isIdle: () => false, signal: new AbortController().signal, abort: vi.fn() });
  await h.run("Checkpoint failure");
  const message = { role: "assistant", provider: "openai-codex", model: "fixture", responseId: "retry-receipt", timestamp: 1, content: [], stopReason: "stop", usage: { input: 80, output: 20 } };
  await h.events.get("context")!({ messages: [] }, h.ctx);
  await h.events.get("message_start")!({ message }, h.ctx);
  h.disk.beforeRename = () => { throw new Error("Injected accounting failure"); };
  await h.events.get("message_end")!({ message }, h.ctx);
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(0);
  h.disk.beforeRename = undefined;
  await h.events.get("context")!({ messages: [] }, h.ctx);
  await h.events.get("message_end")!({ message }, h.ctx);
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(100);
});

it("does not charge a committed response again when its host message was not flushed before reload", async () => {
  const h = await harness();
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, isIdle: () => false, signal: new AbortController().signal, abort: vi.fn() });
  await h.run("Durable receipt");
  const message = { role: "assistant", provider: "openai-codex", model: "fixture", responseId: "durable-response", timestamp: 1, content: [], stopReason: "stop", usage: { input: 80, output: 20 } };
  await h.events.get("context")!({ messages: [] }, h.ctx);
  await h.events.get("message_start")!({ message }, h.ctx);
  await h.events.get("message_end")!({ message }, h.ctx);
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(100);
  await h.events.get("session_shutdown")!({}, h.ctx);
  await h.events.get("session_start")!({}, h.ctx);
  await h.events.get("context")!({ messages: [] }, h.ctx);
  await h.events.get("message_start")!({ message }, h.ctx);
  await h.events.get("message_end")!({ message }, h.ctx);
  expect((await h.disk.records())[0]!.goal!.tokensUsed).toBe(100);
});

it("rejects a null configuration rather than silently removing its limit", async () => {
  const h = await harness(null);
  await h.run("Must not create");
  expect((await h.disk.records())[0]?.goal ?? null).toBeNull();
  expect(h.notify.mock.calls.some(([message]) => String(message).includes("configuration"))).toBe(true);
});

it("applies configured budgets to command and tool creation without parsing budget flags", async () => {
  const h = await harness({ maxGoalTokenBudget: 100 });
  Object.assign(h.ctx, { model: { provider: "openai-codex" } });
  await h.run("--budget 999");
  expect((await h.disk.records())[0]!.goal).toMatchObject({ objective: "--budget 999", tokenBudget: 100 });
  await h.run("clear");
  await h.events.get("context")!({ messages: [] }, h.ctx);
  const tools = new Map(vi.mocked(h.pi.registerTool).mock.calls.map(([tool]) => [tool.name, tool]));
  await expect(tools.get("create_goal")!.execute("id", { objective: "Above", token_budget: 101 }, undefined, undefined, h.ctx)).rejects.toThrow(/maximum/);
  expect((await h.disk.records())[0]!.goal).toBeNull();
});

it("rejects stale model mutations after goal replacement or session shutdown", async () => {
  const h = await harness();
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, abort: vi.fn() });
  await h.run("Old");
  await h.events.get("context")!({ messages: [{ role: "user", content: "Work" }] }, h.ctx);
  const tools = new Map(vi.mocked(h.pi.registerTool).mock.calls.map(([tool]) => [tool.name, tool]));
  await h.run("Replacement");
  const saved = (await h.disk.records())[0];
  await expect(tools.get("update_goal")!.execute("id", { status: "complete" }, undefined, undefined, h.ctx)).rejects.toThrow(/stale/i);
  await expect(tools.get("create_goal")!.execute("id", { objective: "Late objective" }, undefined, undefined, h.ctx)).rejects.toThrow(/stale/i);
  expect((await h.disk.records())[0]).toEqual(saved);
  await h.events.get("session_shutdown")!({}, h.ctx);
  await expect(tools.get("update_goal")!.execute("id", { status: "blocked" }, undefined, undefined, h.ctx)).rejects.toThrow(/stale/i);
  expect((await h.disk.records())[0]).toEqual(saved);
});
it("checks authoritative storage before forming a goal request and cancels an invalid owned continuation", async () => {
  const h = await harness();
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, abort: vi.fn() });
  await h.run("Objective");
  const queued = vi.mocked(h.pi.sendMessage).mock.calls[0]![0];
  vi.spyOn(h.disk, "read").mockRejectedValueOnce(new Error("Unreadable authoritative file"));
  await h.events.get("context")!({ messages: [{ role: "custom", ...queued }] }, h.ctx);
  expect(h.ctx.abort).toHaveBeenCalledTimes(1);
  expect(h.notify.mock.calls.at(-1)?.[0]).toContain("Unreadable authoritative file");
});
it("refreshes status across providers without a Codex warning or a new request", async () => {
  const h = await harness();
  await h.run("Visible objective");
  vi.mocked(h.pi.sendMessage).mockClear();
  Object.assign(h.ctx, { model: { provider: "other" } });
  await h.events.get("model_select")!({ model: h.ctx.model }, h.ctx);
  expect(h.ctx.ui.setStatus).toHaveBeenLastCalledWith("goal", expect.stringContaining("active"));
  await h.events.get("model_select")!({ model: h.ctx.model }, h.ctx);
  expect(h.notify.mock.calls.some(([text]) => String(text).includes("OpenAI Codex"))).toBe(false);
  await h.run("");
  expect(h.notify.mock.calls.at(-1)?.[0]).toContain("/goal resume");
  expect(h.notify.mock.calls.at(-1)?.[0]).not.toContain("Storage only");
  await h.run("clear");
  expect(h.ctx.ui.setStatus).toHaveBeenLastCalledWith("goal", undefined);
  expect(h.pi.sendMessage).not.toHaveBeenCalled();
});
it("does not revive automatic execution after a failed authoritative pause", async () => {
  const h = await harness();
  Object.assign(h.ctx, { model: { provider: "openai-codex" }, abort: vi.fn() });
  await h.run("Original");
  const before = (await h.disk.records())[0]!;
  await h.events.get("context")!({ messages: [{ role: "custom", ...vi.mocked(h.pi.sendMessage).mock.calls[0]![0] }] }, h.ctx);
  vi.mocked(h.pi.sendMessage).mockClear();
  h.disk.beforeRename = () => { throw new Error("Disk full"); };
  await h.run("pause");
  expect((await h.disk.records())[0]).toEqual(before);
  await h.events.get("context")!({ messages: [{ role: "user", content: "Other work" }] }, h.ctx);
  await h.events.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop", content: [] }] }, h.ctx);
  expect(h.pi.sendMessage).not.toHaveBeenCalled();
  h.disk.beforeRename = undefined;
  await h.run("resume");
  expect(h.pi.sendMessage).toHaveBeenCalledTimes(1);
  expect(vi.mocked(h.ctx.ui.setStatus).mock.calls.at(-1)?.[1]).not.toContain("storage error");
});
it("rejects old command closures after shutdown without reopening a writer", async () => {
  const h = await harness();
  await h.run("Original");
  const before = await h.disk.records();
  await h.events.get("session_shutdown")!({}, h.ctx);
  await expect(h.run("Stale replacement")).rejects.toThrow(/stale/i);
  expect(await h.disk.records()).toEqual(before);
});

it("does not acquire a writer when shutdown overtakes an asynchronous bind", async () => {
  const h = await harness();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const read = h.disk.records.bind(h.disk);
  vi.spyOn(h.disk, "records").mockImplementationOnce(async () => { await barrier; return read(); });
  const opening = h.run("");
  await h.events.get("session_shutdown")!({}, h.ctx);
  release();
  await expect(opening).rejects.toThrow(/changed|stale/i);
  expect(await h.disk.records()).toEqual([]);
  const other = await h.disk.openSession({ ownerSessionId: h.manager.getSessionId(), cwd: process.cwd(), sessionFile: h.manager.getSessionFile()! });
  await other.close();
});

it("explicitly clones the current authoritative snapshot with a durable launch gate", async () => {
  const h = await harness();
  await h.run("Current objective");
  const source = (await h.disk.records())[0]!;
  source.goal = { ...source.goal!, tokenBudget: 500, tokensUsed: 123, elapsedSeconds: 8.5 };
  await h.disk.commit(source);
  vi.mocked(h.ctx.ui.select).mockImplementation(async (_title, choices) => choices[1]);
  h.ctx.waitForIdle = vi.fn(async () => {});
  const reload = vi.fn(async () => {});
  h.ctx.fork = vi.fn(async (_id, options) => {
    await h.events.get("session_shutdown")!({}, h.ctx);
    const manager = SessionManager.create(process.cwd(), resolve(h.root, "sessions"));
    await options?.withSession?.({ ...h.ctx, sessionManager: manager, reload } as never);
    return { cancelled: false };
  });
  await h.commands.get("goal-fork")!.handler("", h.ctx);
  const records = await h.disk.records();
  expect(records).toHaveLength(2);
  expect(records.find(row => row.recordId === source.recordId)).toEqual(source);
  const child = records.find(row => row.recordId !== source.recordId)!;
  expect(child.goal).toEqual(source.goal);
  expect(child.goal?.status).toBe("active");
  expect(child.continuationDeferral).toBe(true);
  expect(h.ctx.fork).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ position: "at" }));
  expect(reload).toHaveBeenCalledTimes(1);
});

it("only explicit interactive input releases inherited gating and preserves the stop state", async () => {
  const h = await harness();
  const source = await h.disk.openSession({ ownerSessionId: "source", cwd: process.cwd(), sessionFile: resolve(h.root, "source.jsonl") });
  const saved = await source.replace("Paused inherited", source.snapshot);
  saved.goal!.status = "paused";
  await source.close();
  const target = await h.disk.openSession({ ownerSessionId: h.manager.getSessionId(), cwd: process.cwd(), sessionFile: h.manager.getSessionFile()! });
  const inherited = await target.inherit(saved);
  await target.close();
  await h.run("");
  await h.events.get("input")!({ source: "extension", text: "Injected" }, h.ctx);
  expect(await h.disk.read(inherited.recordId)).toEqual(inherited);
  await h.events.get("input")!({ source: "interactive", text: "Continue" }, h.ctx);
  const released = (await h.disk.read(inherited.recordId))!;
  expect(released.continuationDeferral).toBe(false);
  expect(released.goal).toEqual(inherited.goal);
  await h.events.get("input")!({ source: "interactive", text: "Again" }, h.ctx);
  expect(await h.disk.read(inherited.recordId)).toEqual(released);
});

it("does not replace a goal after shutdown interrupts its confirmation dialog", async () => {
  const h = await harness();
  await h.run("Original");
  const saved = await h.disk.records();
  h.confirm.mockImplementationOnce(async () => {
    await h.events.get("session_shutdown")!({}, h.ctx);
    return true;
  });
  await h.run("Must not replace");
  expect(await h.disk.records()).toEqual(saved);
});

it("rejects a failed authoritative checkpoint before invoking fork", async () => {
  const h = await harness();
  await h.run("Source");
  const saved = (await h.disk.records())[0]!;
  h.ctx.waitForIdle = vi.fn(async () => {});
  h.ctx.fork = vi.fn();
  vi.mocked(h.ctx.ui.select).mockImplementation(async (_title, choices) => choices[1]);
  vi.spyOn(h.disk, "read").mockRejectedValueOnce(new Error("Checkpoint read failure"));
  await h.commands.get("goal-fork")!.handler("", h.ctx);
  expect(h.ctx.fork).not.toHaveBeenCalled();
  expect(await h.disk.read(saved.recordId)).toEqual(saved);
  expect(h.notify.mock.calls.at(-1)?.[0]).toContain("Checkpoint read failure");
});

it("keeps deferral on write failure without swallowing user input", async () => {
  const h = await harness();
  const source = await h.disk.openSession({ ownerSessionId: "source", cwd: process.cwd(), sessionFile: resolve(h.root, "source.jsonl") });
  const saved = await source.replace("Source", source.snapshot);
  await source.close();
  const target = await h.disk.openSession({ ownerSessionId: h.manager.getSessionId(), cwd: process.cwd(), sessionFile: h.manager.getSessionFile()! });
  const inherited = await target.inherit(saved);
  await target.close();
  await h.run("");
  h.disk.beforeRename = () => { throw new Error("Gate write failure"); };
  expect(await h.events.get("input")!({ source: "interactive", text: "User input" }, h.ctx)).toBeUndefined();
  expect(await h.disk.read(inherited.recordId)).toEqual(inherited);
  expect(h.notify.mock.calls.at(-1)?.[0]).toContain("Gate write failure");
  h.disk.beforeRename = undefined;
});

it("does not report write failures as success and retries a failed history mirror", async () => {
  const h = await harness();
  h.disk.beforeRename = () => { throw new Error("disk full"); };
  await h.run("Not saved");
  expect(await h.disk.records()).toEqual([]);
  expect(h.appendEntry).not.toHaveBeenCalled();
  expect(h.notify.mock.calls.at(-1)).toEqual([expect.stringContaining("disk full"), "error"]);
  h.disk.beforeRename = undefined;
  h.appendEntry.mockImplementationOnce(() => { throw new Error("mirror unavailable"); });
  await h.run("Saved independently");
  expect((await h.disk.records())[0]?.goal?.objective).toBe("Saved independently");
  expect(h.notify.mock.calls.some(([text, level]) => level === "warning" && text.includes("mirror failed"))).toBe(true);
  await h.run("");
  expect(h.appendEntry).toHaveBeenCalledTimes(2);
});

it("confirms replacement and parses only whole trimmed control words", async () => {
  const h = await harness();
  await h.run("Original");
  const before = (await h.disk.records())[0]!;
  h.confirm.mockResolvedValueOnce(false);
  await h.run("Replacement");
  expect((await h.disk.records())[0]).toEqual(before);
  await h.run(" pause now ");
  const after = (await h.disk.records())[0]!;
  expect(after.goal?.objective).toBe("pause now");
  expect(after.goal?.goalId).not.toBe(before.goal?.goalId);
  await h.run(" pause ");
  expect((await h.disk.records())[0]?.goal).toMatchObject({ goalId: after.goal!.goalId, objective: "pause now", status: "paused" });
});

it("recovers a pre-reply goal into one replacement session without sending a prompt", async () => {
  const h = await harness();
  const lost = await h.disk.openSession({ ownerSessionId: "lost-session", cwd: process.cwd(), sessionFile: resolve(h.root, "missing.jsonl") });
  const saved = await lost.replace("Lost objective", lost.snapshot);
  await lost.close();
  vi.mocked(h.ctx.ui.select).mockImplementation(async (_title, options) => options[0]);
  let replacement: SessionManager | undefined;
  h.ctx.newSession = vi.fn(async options => {
    await h.events.get("session_shutdown")!({}, h.ctx);
    replacement = SessionManager.create(process.cwd(), resolve(h.root, "sessions"));
    const fresh = { ...h.ctx, sessionManager: replacement, reload: vi.fn(async () => {}) } as ExtensionCommandContext;
    await options?.setup?.(replacement);
    await options?.withSession?.(fresh as never);
    return { cancelled: false };
  });
  await h.recover();
  expect(h.confirm).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("cannot restore"));
  expect(h.ctx.newSession).toHaveBeenCalledTimes(1);
  const rows = await h.disk.records();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.recordId).toBe(saved.recordId);
  expect(rows[0]?.ownerSessionId).toBe(replacement!.getSessionId());
  expect(rows[0]?.goal).toEqual(saved.goal);
});

it("creates, summarizes and clears without calling a model; mirrors follow authoritative commits", async () => {
  const h = await harness();
  await h.run("Ship it");
  expect((await h.disk.records())[0]?.goal?.objective).toBe("Ship it");
  expect(h.appendEntry).toHaveBeenCalledTimes(1);
  await h.run("");
  expect(h.notify.mock.calls.at(-1)?.[0]).toContain("Ship it");
  await h.run("clear");
  expect((await h.disk.records())[0]?.goal).toBeNull();
});
