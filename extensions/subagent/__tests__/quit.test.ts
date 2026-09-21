import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { createSubagentQuitSession } from "../src/quit.js";

type Capacity = { active: number; pending: number; limit: number; available: number };

const capacity = (active: number, pending = 0): Capacity => ({
  active,
  pending,
  limit: 3,
  available: Math.max(0, 3 - active - pending),
});

const listing = (active: number, pending = 0, diagnostics?: Array<{ agentId: string; reason: string }>) => ({
  agents: Array.from({ length: active }, (_, index) => ({ agentId: `child-${index + 1}` })),
  capacity: capacity(active, pending),
  ...(diagnostics ? { diagnostics } : {}),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fixture(options: { mode?: string; idle?: boolean } = {}) {
  let factory: ((...args: any[]) => any) | undefined;
  let editor: any;
  let idle = options.idle ?? true;
  const notifications: Array<{ message: string; level: string }> = [];
  const selected: Array<{ title: string; choices: string[] }> = [];
  const choices: Array<string | undefined> = [];
  const submitted: string[] = [];
  const input: string[] = [];
  const base = {
    text: "draft @skill-name",
    labelState: { active: true },
    onSubmit: undefined as ((text: string) => void) | undefined,
    getText() { return this.text; },
    getExpandedText() { return this.text.replace("@skill-name", "expanded skill"); },
    setText(text: string) { this.text = text; },
    handleInput(data: string) { input.push(data); },
    render() { return [this.text]; },
    invalidate() {},
    submit(text: string) { this.onSubmit?.(text); },
  };
  factory = () => base;
  const ui = {
    getEditorComponent: vi.fn(() => factory),
    setEditorComponent: vi.fn((next: typeof factory) => { factory = next; }),
    setEditorText: vi.fn((text: string) => editor?.setText(text)),
    select: vi.fn(async (title: string, items: string[]) => {
      selected.push({ title, choices: items });
      return choices.shift();
    }),
    notify: vi.fn((message: string, level: string) => notifications.push({ message, level })),
  };
  const ctx = {
    mode: options.mode ?? "tui",
    ui,
    sessionManager: { getSessionId: () => "parent-a" },
    isIdle: vi.fn(() => idle),
    abort: vi.fn(() => { idle = true; }),
    shutdown: vi.fn(),
  };
  const lists: Array<ReturnType<typeof listing> | Error | Promise<ReturnType<typeof listing>>> = [];
  const closes: Array<undefined | Error | Promise<unknown>> = [];
  const manager = {
    list: vi.fn(async (_sessionId: string, _signal?: AbortSignal) => {
      const value = lists.shift();
      if (value instanceof Error) throw value;
      return await value!;
    }),
    close: vi.fn(async (_sessionId: string, _target: string, _signal?: AbortSignal) => {
      const value = closes.shift();
      if (value instanceof Error) throw value;
      return await value;
    }),
  };
  const session = createSubagentQuitSession(ctx as never, manager as never);
  session.installEditor();
  if (factory) {
    editor = factory({}, {}, {});
    editor.onSubmit = (text: string) => submitted.push(text);
  }
  return {
    base,
    choices,
    closes,
    ctx,
    editor,
    input,
    lists,
    manager,
    notifications,
    selected,
    session,
    submitted,
    ui,
  };
}

async function submitQuit(f: ReturnType<typeof fixture>, text = "/quit") {
  f.editor.submit(text);
  await vi.waitFor(() => {
    assert.equal(f.manager.list.mock.settledResults.length > 0, true);
  });
  await new Promise(resolve => setTimeout(resolve, 0));
}

test("composes with the existing editor and forwards non-quit input", () => {
  const f = fixture();

  assert.equal(f.editor.getText(), "draft @skill-name");
  assert.equal(f.editor.getExpandedText(), "draft expanded skill");
  assert.deepEqual(f.editor.labelState, { active: true });
  f.editor.handleInput("\u0004");
  f.editor.submit("regular prompt");

  assert.deepEqual(f.input, ["\u0004"]);
  assert.deepEqual(f.submitted, ["regular prompt"]);
  assert.equal(f.manager.list.mock.calls.length, 0);
});

test("does not install an editor outside TUI mode", () => {
  const f = fixture({ mode: "json" });

  assert.equal(f.ui.setEditorComponent.mock.calls.length, 0);
  f.editor.submit("/quit");
  assert.deepEqual(f.submitted, ["/quit"]);
  assert.equal(f.manager.list.mock.calls.length, 0);
});

test("quits without a choice when no live or starting subagent exists", async () => {
  const f = fixture({ idle: false });
  f.lists.push(listing(0));

  await submitQuit(f, "  /quit  ");

  assert.deepEqual(f.selected, []);
  assert.equal(f.ctx.abort.mock.calls.length, 1);
  assert.equal(f.ctx.shutdown.mock.calls.length, 1);
  assert.equal(f.editor.getText(), "");
});

test.each([
  { choice: "End session", closes: 1 },
  { choice: "Leave temporarily", closes: 0 },
])("handles $choice for a live subagent", async ({ choice, closes }) => {
  const f = fixture({ idle: false });
  f.choices.push(choice);
  f.lists.push(listing(1), listing(0));
  f.closes.push(undefined);

  await submitQuit(f);

  assert.deepEqual(f.selected, [{
    title: "Leave this session?",
    choices: ["End session", "Leave temporarily"],
  }]);
  assert.equal(f.ctx.abort.mock.calls.length, 1);
  assert.equal(f.manager.close.mock.calls.length, closes);
  if (closes) assert.deepEqual(f.manager.close.mock.calls[0]?.slice(0, 2), ["parent-a", "all"]);
  assert.equal(f.ctx.shutdown.mock.calls.length, 1);
});

test("Escape keeps the session and permits another quit", async () => {
  const f = fixture();
  f.choices.push(undefined, "End session");
  f.lists.push(listing(1), listing(1), listing(0));
  f.closes.push(undefined);

  await submitQuit(f);
  assert.equal(f.ctx.abort.mock.calls.length, 0);
  assert.equal(f.ctx.shutdown.mock.calls.length, 0);

  await submitQuit(f);
  assert.equal(f.manager.close.mock.calls.length, 1);
  assert.equal(f.ctx.shutdown.mock.calls.length, 1);
});

test("reports an unreliable query and succeeds on retry", async () => {
  const f = fixture();
  f.lists.push(
    listing(1, 0, [{ agentId: "child-a", reason: "tmux query failed" }]),
    listing(0),
  );

  await submitQuit(f);
  assert.equal(f.ctx.shutdown.mock.calls.length, 0);
  assert.match(f.notifications[0]?.message ?? "", /Could not verify subagent status.*child-a.*tmux query failed/u);

  await submitQuit(f);
  assert.equal(f.ctx.shutdown.mock.calls.length, 1);
});

test("keeps Pi open when startup is pending and can close it after retry", async () => {
  const f = fixture();
  f.choices.push("End session");
  f.lists.push(listing(0, 1), listing(1), listing(0));
  f.closes.push(undefined);

  await submitQuit(f);
  assert.equal(f.ctx.shutdown.mock.calls.length, 0);
  assert.match(f.notifications[0]?.message ?? "", /startup is still in progress/u);

  await submitQuit(f);
  assert.equal(f.manager.close.mock.calls.length, 1);
  assert.equal(f.ctx.shutdown.mock.calls.length, 1);
});

test("keeps Pi open after partial cleanup and retries remaining agents", async () => {
  const f = fixture({ idle: false });
  f.choices.push("End session", "End session");
  f.lists.push(listing(2), listing(1), listing(0));
  f.closes.push(new Error("child-b close failed"), undefined);

  await submitQuit(f);
  assert.equal(f.ctx.abort.mock.calls.length, 1);
  assert.equal(f.ctx.shutdown.mock.calls.length, 0);
  assert.match(f.notifications[0]?.message ?? "", /Could not end the session.*child-b close failed/u);

  await submitQuit(f);
  assert.equal(f.manager.close.mock.calls.length, 2);
  assert.equal(f.ctx.abort.mock.calls.length, 1);
  assert.equal(f.ctx.shutdown.mock.calls.length, 1);
});

test("runs at most one quit flow per editor", async () => {
  const f = fixture();
  const pending = deferred<ReturnType<typeof listing>>();
  f.lists.push(pending.promise);
  f.choices.push("Leave temporarily");

  f.editor.submit("/quit");
  f.editor.submit("/quit");
  assert.equal(f.manager.list.mock.calls.length, 1);
  pending.resolve(listing(1));
  await vi.waitFor(() => assert.equal(f.ctx.shutdown.mock.calls.length, 1));

  assert.equal(f.manager.list.mock.calls.length, 1);
  assert.equal(f.ui.select.mock.calls.length, 1);
});

test("invalidates an in-flight quit before a replacement session can use its context", async () => {
  const f = fixture();
  const pending = deferred<ReturnType<typeof listing>>();
  f.lists.push(pending.promise);

  f.editor.submit("/quit");
  assert.equal(f.manager.list.mock.calls.length, 1);
  const signal = f.manager.list.mock.calls[0]?.[1] as AbortSignal;
  f.session.invalidate();
  assert.equal(signal.aborted, true);
  pending.resolve(listing(0));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(f.ui.select.mock.calls.length, 0);
  assert.equal(f.ctx.abort.mock.calls.length, 0);
  assert.equal(f.ctx.shutdown.mock.calls.length, 0);
  assert.deepEqual(f.notifications, []);
});

test("does not treat cleanup as confirmed when the verification list is non-empty", async () => {
  const f = fixture();
  f.choices.push("End session");
  f.lists.push(listing(1), listing(1));
  f.closes.push(undefined);

  await submitQuit(f);

  assert.equal(f.ctx.shutdown.mock.calls.length, 0);
  assert.match(f.notifications[0]?.message ?? "", /cleanup could not be confirmed/u);
});
