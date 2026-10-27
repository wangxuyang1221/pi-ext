import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test, vi } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createPiFastModeExtension } from "../src/index.js";
import { getUserConfigPath } from "../src/config.js";

const entryType = "pi-fast-mode-session";
function fixture(manager: SessionManager, agentDir: string, env: Record<string, string> = {}, flag = false) {
  const handlers = new Map<string, any>();
  const commands = new Map<string, any>();
  const events = new EventEmitter();
  const pi = { on: (name: string, handler: any) => handlers.set(name, handler), events,
    registerFlag() {}, getFlag: () => flag,
    registerCommand: (name: string, command: any) => commands.set(name, command),
    appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data) };
  createPiFastModeExtension({ agentDir, extensionDir: agentDir, env } as any)(pi as any);
  const ctx = { cwd: manager.getCwd(), sessionManager: manager, model: { provider: "openai-codex", id: "unlisted" },
    hasUI: true, ui: { setStatus() {}, setWidget() {}, notify: vi.fn() } };
  return { ctx, events, start: () => handlers.get("session_start")({}, ctx),
    command: (arg: string) => commands.get("fast").handler(arg, ctx),
    shutdown: () => handlers.get("session_shutdown")({}, ctx),
    request: () => handlers.get("before_provider_request")({ payload: { input: [] } }, ctx) };
}

test("persists child initial true and false before any assistant without shared writes", async () => {
  const root = await mkdtemp(join(process.cwd(), ".fast-child-"));
  try {
    const agentDir = join(root, "agent"), path = getUserConfigPath(agentDir);
    await mkdir(dirname(path), { recursive: true });
    const bytes = '{"enabled":false,"targets":[],"sentinel":"preserve"}\n';
    await writeFile(path, bytes);
    for (const enabled of [true, false]) {
      const file = join(root, `${enabled}.jsonl`);
      await writeFile(file, "");
      const manager = SessionManager.open(file, root);
      const child = fixture(manager, agentDir, { PI_SUBAGENT_PARENT: "{}", PI_SUBAGENT_LAUNCH: JSON.stringify({ fast: enabled }) });
      await child.start();
      expect(manager.getEntries().filter(e => e.type === "custom").filter(e => e.customType === entryType).at(-1)?.data)
        .toEqual({ sessionId: manager.getSessionId(), enabled });
      expect(await readFile(file, "utf8")).toContain(`"enabled":${enabled}`);
      expect(manager.buildSessionContext().messages).toEqual([]);
      expect(child.request()?.service_tier).toBe(enabled ? "priority" : undefined);
      await child.shutdown();
      expect(await readFile(path, "utf8")).toBe(bytes);
      expect(child.ctx.ui.notify).not.toHaveBeenCalled();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("restores the last child command across reload and resume even without launch environment", async () => {
  const root = await mkdtemp(join(process.cwd(), ".fast-child-"));
  try {
    const agentDir = join(root, "agent"), path = getUserConfigPath(agentDir), file = join(root, "session.jsonl");
    await mkdir(dirname(path), { recursive: true });
    const bytes = '{"enabled":true,"targets":[]}\n';
    await writeFile(path, bytes);
    await writeFile(file, "");
    const env = { PI_SUBAGENT_PARENT: "{}", PI_SUBAGENT_LAUNCH: '{"fast":true}' };
    let manager = SessionManager.open(file, root);
    let child = fixture(manager, agentDir, env);
    await child.start();
    await child.command("off");
    expect(child.request()).toBeUndefined();
    expect(manager.buildSessionContext().messages).toEqual([]);
    await child.shutdown();
    child = fixture(manager, agentDir, env, true);
    await child.start();
    expect(child.request()).toBeUndefined();
    await child.shutdown();
    manager = SessionManager.open(file, root);
    child = fixture(manager, agentDir, {}, true);
    await child.start();
    expect(child.request()).toBeUndefined();
    await child.command("on");
    expect(child.request()?.service_tier).toBe("priority");
    await child.shutdown();
    expect(await readFile(path, "utf8")).toBe(bytes);
    expect(child.ctx.ui.notify).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reports the actual switch over the event contract even on an unmatched model", async () => {
  const { readFastState } = await import("../../subagent/src/fast-state.js");
  const root = await mkdtemp(join(process.cwd(), ".fast-child-"));
  try {
    const manager = SessionManager.inMemory(root);
    const getEntries = vi.spyOn(manager, "getEntries");
    const rootSession = fixture(manager, join(root, "agent"));
    rootSession.ctx.model = { provider: "other", id: "unmatched" };
    await rootSession.start();
    expect(await readFastState(rootSession.events as any)).toBe(false);
    getEntries.mockClear();
    await rootSession.command("on");
    expect(rootSession.request()).toBeUndefined();
    expect(await readFastState(rootSession.events as any)).toBe(true);
    await rootSession.command("off");
    expect(await readFastState(rootSession.events as any)).toBe(false);
    for (let index = 0; index < 20; index++) rootSession.request();
    expect(getEntries).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});
