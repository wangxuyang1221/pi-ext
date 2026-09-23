import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPiFastModeExtension } from "../src/index.js";
import {
  DEFAULT_CONFIG,
  getProjectConfigPath,
  getUserConfigPath,
} from "../src/config.js";
import { STATUS_KEY } from "../src/types.js";

type FakePi = {
  registerFlag: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  getFlag: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

type RegisteredCommand = {
  description?: string;
  handler: (args: string, ctx: any) => Promise<void>;
};

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-openai-fast-mode-ext-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function createFakePi(fastFlag = false): {
  pi: FakePi;
  handlers: Map<string, Function[]>;
  commands: Map<string, RegisteredCommand>;
} {
  const handlers = new Map<string, Function[]>();
  const commands = new Map<string, RegisteredCommand>();

  const pi: FakePi = {
    registerFlag: vi.fn(),
    registerCommand: vi.fn((name: string, options: RegisteredCommand) => {
      commands.set(name, options);
    }),
    getFlag: vi.fn((name: string) => (name === "fast" ? fastFlag : undefined)),
    on: vi.fn((event: string, handler: Function) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
  };

  return { pi, handlers, commands };
}

function makeCtx(
  cwd: string,
  model: { provider: string; id: string } | undefined = undefined,
) {
  return {
    cwd,
    model,
    hasUI: true,
    mode: "tui",
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
    },
  };
}

type TestContext = ReturnType<typeof makeCtx>;

function expectFastIndicatorShown(ctx: TestContext): void {
  expect(ctx.ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, "fast");
  expect(ctx.ui.setWidget).toHaveBeenLastCalledWith(STATUS_KEY, undefined, {
    placement: "belowEditor",
  });
}

function expectFastIndicatorHidden(ctx: TestContext): void {
  expect(ctx.ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
  expect(ctx.ui.setWidget).toHaveBeenLastCalledWith(STATUS_KEY, undefined, {
    placement: "belowEditor",
  });
}

async function runHandler(
  handlers: Map<string, Function[]>,
  eventName: string,
  event: unknown,
  ctx: unknown,
) {
  const handler = handlers.get(eventName)?.[0];
  expect(handler, `missing ${eventName} handler`).toBeTypeOf("function");
  return await handler!(event, ctx);
}

describe("piFastModeExtension registration", () => {
  it("registers the fast flag, fast command, and lifecycle hooks", () => {
    const { pi, handlers, commands } = createFakePi();

    createPiFastModeExtension({
      extensionDir: "/global/pi-openai-fast-mode/src",
      agentDir: "/agent",
    })(pi as any);

    expect(pi.registerFlag).toHaveBeenCalledWith("fast", {
      description: "Start with Fast Mode enabled",
      type: "boolean",
      default: false,
    });
    expect(commands.has("fast")).toBe(true);
    expect(commands.get("fast")?.description).toContain(
      "/fast [on|off|toggle]",
    );

    expect([...handlers.keys()].sort()).toEqual([
      "before_provider_request",
      "message_end",
      "model_select",
      "session_shutdown",
      "session_start",
    ]);
  });
});

describe("piFastModeExtension runtime behavior", () => {
  it.each([
    { reason: "startup", enabled: true },
    { reason: "startup", enabled: false },
    { reason: "reload", enabled: true },
    { reason: "reload", enabled: false },
  ])("refreshes persisted targets on $reason while preserving enabled=$enabled", async ({ reason, enabled }) => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    const configPath = getUserConfigPath(agentDir);
    await mkdir(join(agentDir, "extensions", "pi-openai-fast-mode"), {
      recursive: true,
    });
    await mkdir(cwd, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        enabled,
        targets: [
          { provider: "openai", model: "old-model", serviceTier: "flex" },
        ],
      }),
      "utf8",
    );

    const { pi, handlers } = createFakePi(false);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai-codex", id: "gpt-6-astra" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason },
      ctx,
    );

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      enabled,
      targets: DEFAULT_CONFIG.targets,
    });
    if (enabled) {
      expectFastIndicatorShown(ctx);
    } else {
      expectFastIndicatorHidden(ctx);
    }
  });

  it("--fast enables, persists, shows status, and mutates matching payloads", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });

    const { pi, handlers } = createFakePi(true);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai", id: "gpt-5.4" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );

    expectFastIndicatorShown(ctx);
    expect(
      JSON.parse(await readFile(getUserConfigPath(agentDir), "utf8")),
    ).toMatchObject({
      enabled: true,
    });

    const mutated = await runHandler(
      handlers,
      "before_provider_request",
      {
        type: "before_provider_request",
        payload: { model: "gpt-5.4", messages: [] },
      },
      ctx,
    );

    expect(mutated).toEqual({
      model: "gpt-5.4",
      messages: [],
      service_tier: "priority",
    });
  });

  it("/fast, /fast on, and /fast toggle persist expected enabled states", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });

    const { pi, handlers, commands } = createFakePi(false);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai", id: "gpt-5.4" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );

    await commands.get("fast")!.handler("", ctx);
    expect(
      JSON.parse(await readFile(getUserConfigPath(agentDir), "utf8")),
    ).toMatchObject({
      enabled: true,
    });
    expectFastIndicatorShown(ctx);

    await commands.get("fast")!.handler("toggle", ctx);
    expect(
      JSON.parse(await readFile(getUserConfigPath(agentDir), "utf8")),
    ).toMatchObject({
      enabled: false,
    });
    expectFastIndicatorHidden(ctx);

    await commands.get("fast")!.handler("on", ctx);
    expect(
      JSON.parse(await readFile(getUserConfigPath(agentDir), "utf8")),
    ).toMatchObject({
      enabled: true,
    });
    expectFastIndicatorShown(ctx);
  });

  it("/fast off persists disabled state and hides status", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });

    const { pi, handlers, commands } = createFakePi(true);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai", id: "gpt-5.4" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );

    await commands.get("fast")!.handler("off", ctx);

    expectFastIndicatorHidden(ctx);
    expect(
      JSON.parse(await readFile(getUserConfigPath(agentDir), "utf8")),
    ).toMatchObject({
      enabled: false,
    });

    const unchanged = await runHandler(
      handlers,
      "before_provider_request",
      { type: "before_provider_request", payload: { model: "gpt-5.4" } },
      ctx,
    );

    expect(unchanged).toBeUndefined();
  });

  it("invalid /fast arguments notify usage without changing state", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });

    const { pi, handlers, commands } = createFakePi(false);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai", id: "gpt-5.4" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );
    await commands.get("fast")!.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Usage: /fast [on|off|toggle]",
      "error",
    );
    expectFastIndicatorHidden(ctx);
  });

  it("project-local package installs persist to project state instead of user state", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    const extensionDir = join(cwd, ".pi", "npm", "pi-openai-fast-mode", "src");
    await mkdir(extensionDir, { recursive: true });

    const { pi, handlers } = createFakePi(true);
    createPiFastModeExtension({ extensionDir, agentDir })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai-codex", id: "gpt-5.5" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );

    expect(
      JSON.parse(await readFile(getProjectConfigPath(cwd), "utf8")),
    ).toMatchObject({
      enabled: true,
    });
    await expect(
      readFile(getUserConfigPath(agentDir), "utf8"),
    ).rejects.toThrow();
  });

  it.each(["openai", "openai-codex"])("keeps GPT-6 Astra status and request tier in sync on %s", async (provider) => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });

    const { pi, handlers, commands } = createFakePi(true);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const model = { provider, id: "gpt-6-astra" };
    const ctx = makeCtx(cwd, model);
    const payload = { model: model.id, input: [], service_tier: "auto" };
    const request = (context: TestContext = ctx) => runHandler(
      handlers,
      "before_provider_request",
      { type: "before_provider_request", payload },
      context,
    );

    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );
    expectFastIndicatorShown(ctx);
    expect(await request()).toEqual({ ...payload, service_tier: "priority" });
    expect(payload.service_tier).toBe("auto");

    await commands.get("fast")!.handler("off", ctx);
    expectFastIndicatorHidden(ctx);
    expect(await request()).toBeUndefined();

    await commands.get("fast")!.handler("on", ctx);
    expectFastIndicatorShown(ctx);
    expect(await request()).toEqual({ ...payload, service_tier: "priority" });

    const unmatchedCtx = {
      ...ctx,
      model: { provider, id: "gpt-6-astra-unknown" },
    };
    await runHandler(
      handlers,
      "model_select",
      { type: "model_select", model: unmatchedCtx.model },
      unmatchedCtx,
    );
    if (provider === "openai-codex") {
      expectFastIndicatorShown(unmatchedCtx);
      expect(await request(unmatchedCtx)).toEqual({ ...payload, service_tier: "priority" });
    } else {
      expectFastIndicatorHidden(unmatchedCtx);
      expect(await request(unmatchedCtx)).toBeUndefined();
    }

    await runHandler(
      handlers,
      "model_select",
      { type: "model_select", model },
      ctx,
    );
    expectFastIndicatorShown(ctx);
    expect(await request()).toEqual({ ...payload, service_tier: "priority" });
  });

  it.each(["gpt-6-sol", "gpt-6-luna", "gpt-7-unlisted"]) (
    "requests Fast for openai-codex/%s without a configured target",
    async (id) => {
      const root = await makeTempDir();
      const cwd = join(root, "project");
      const agentDir = join(root, "agent");
      await mkdir(cwd, { recursive: true });

      const { pi, handlers, commands } = createFakePi(true);
      createPiFastModeExtension({ extensionDir: join(root, "global", "src"), agentDir })(pi as any);
      const ctx = makeCtx(cwd, { provider: "openai-codex", id });
      await runHandler(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
      expectFastIndicatorShown(ctx);
      expect(await runHandler(handlers, "before_provider_request", {
        type: "before_provider_request", payload: { model: id, input: [] },
      }, ctx)).toEqual({ model: id, input: [], service_tier: "priority" });
      expect((await readFile(getUserConfigPath(agentDir), "utf8"))).not.toContain(id);

      await commands.get("fast")!.handler("off", ctx);
      expectFastIndicatorHidden(ctx);
      expect(await runHandler(handlers, "before_provider_request", {
        type: "before_provider_request", payload: { model: id, input: [] },
      }, ctx)).toBeUndefined();
    },
  );

  it("excludes only the rejected Codex model for the rest of the session", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });
    const { pi, handlers } = createFakePi(true);
    createPiFastModeExtension({ extensionDir: join(root, "global", "src"), agentDir })(pi as any);
    const model = { provider: "openai-codex", id: "gpt-7-unlisted" };
    const ctx = makeCtx(cwd, model);
    const request = (context = ctx) => runHandler(handlers, "before_provider_request", {
      type: "before_provider_request", payload: { model: context.model.id, input: [] },
    }, context);
    await runHandler(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
    expect(await request()).toMatchObject({ service_tier: "priority" });
    const error = { role: "assistant", provider: model.provider, model: model.id,
      stopReason: "error", errorMessage: "Codex API error: service_tier priority is not supported for this model" };
    expect(await runHandler(handlers, "message_end", { type: "message_end", message: error }, ctx)).toBeUndefined();
    expect(error.stopReason).toBe("error");
    expectFastIndicatorHidden(ctx);
    expect(ctx.ui.notify).toHaveBeenCalledExactlyOnceWith(
      "Fast mode is not supported for openai-codex/gpt-7-unlisted. This request failed. Retry to use standard mode for this model in this session.",
      "warning",
    );
    expect(await request()).toBeUndefined();
    await runHandler(handlers, "message_end", { type: "message_end", message: error }, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(getUserConfigPath(agentDir), "utf8")).enabled).toBe(true);

    const otherCtx = makeCtx(cwd, { provider: "openai-codex", id: "gpt-6-sol" });
    await runHandler(handlers, "model_select", { type: "model_select", model: otherCtx.model }, otherCtx);
    expectFastIndicatorShown(otherCtx);
    expect(await request(otherCtx)).toMatchObject({ service_tier: "priority" });

    await runHandler(handlers, "session_start", { type: "session_start", reason: "new" }, ctx);
    expectFastIndicatorShown(ctx);
    expect(await request()).toMatchObject({ service_tier: "priority" });
  });

  it.each([
    "429 rate limit exceeded",
    "Network error: connection reset",
    "HTTP 400: invalid input field",
    "Codex API error: service_tier priority is temporarily unavailable",
  ])("keeps requesting Fast after an unrelated or ambiguous error: %s", async (errorMessage) => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    await mkdir(cwd, { recursive: true });
    const { pi, handlers } = createFakePi(true);
    createPiFastModeExtension({ extensionDir: join(root, "global", "src"), agentDir: join(root, "agent") })(pi as any);
    const ctx = makeCtx(cwd, { provider: "openai-codex", id: "gpt-7-unlisted" });
    await runHandler(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const request = () => runHandler(handlers, "before_provider_request", {
      type: "before_provider_request", payload: { model: ctx.model!.id, input: [] },
    }, ctx);
    expect(await request()).toMatchObject({ service_tier: "priority" });
    await runHandler(handlers, "message_end", { type: "message_end", message: {
      role: "assistant", provider: "openai-codex", model: ctx.model!.id,
      stopReason: "error", errorMessage,
    } }, ctx);
    expect(await request()).toMatchObject({ service_tier: "priority" });
    expectFastIndicatorShown(ctx);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("recognizes an explicit unsupported_service_tier code", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    await mkdir(cwd, { recursive: true });
    const { pi, handlers } = createFakePi(true);
    createPiFastModeExtension({ extensionDir: join(root, "global", "src"), agentDir: join(root, "agent") })(pi as any);
    const ctx = makeCtx(cwd, { provider: "openai-codex", id: "gpt-7-unlisted" });
    await runHandler(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const request = () => runHandler(handlers, "before_provider_request", {
      type: "before_provider_request", payload: { model: ctx.model!.id },
    }, ctx);
    expect(await request()).toMatchObject({ service_tier: "priority" });
    await runHandler(handlers, "message_end", { type: "message_end", message: {
      role: "assistant", provider: "openai-codex", model: ctx.model!.id,
      stopReason: "error", errorMessage: "Codex error: unsupported_service_tier",
    } }, ctx);
    expect(await request()).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
  });

  it("does not exclude a model unless this session requested Fast for it", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    await mkdir(cwd, { recursive: true });
    const { pi, handlers } = createFakePi(true);
    createPiFastModeExtension({ extensionDir: join(root, "global", "src"), agentDir: join(root, "agent") })(pi as any);
    const ctx = makeCtx(cwd, { provider: "openai-codex", id: "gpt-7-unlisted" });
    await runHandler(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
    await runHandler(handlers, "message_end", { type: "message_end", message: {
      role: "assistant", provider: "openai-codex", model: ctx.model!.id,
      stopReason: "error", errorMessage: "service_tier priority is not supported for this model",
    } }, ctx);
    expectFastIndicatorShown(ctx);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("model_select updates whether the status is visible", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });

    const { pi, handlers } = createFakePi(true);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai", id: "gpt-5.4" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );

    await runHandler(
      handlers,
      "model_select",
      { type: "model_select", model: { provider: "openai", id: "gpt-4" } },
      { ...ctx, model: { provider: "openai", id: "gpt-4" } },
    );

    expect(ctx.ui.setStatus).toHaveBeenCalledWith(STATUS_KEY, "fast");
    expect(ctx.ui.setWidget.mock.calls.every((call) => call[1] === undefined)).toBe(
      true,
    );
    expectFastIndicatorHidden(ctx);
  });
});
