import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { displayType } from "../src/index.js";
import * as fs from "node:fs/promises";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { CodexEditor } from "../../codex-ui/src/components.js";
import { decodeSnapshot } from "../src/protocol.js";
import { cleanup, deferred, lifecycleFixture, textOf } from "./lifecycle-fixture.js";
import { BLUE_PIXEL_PNG, RED_PIXEL_PNG } from "./png-fixture.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
beforeAll(() => initTheme("dark", false));
afterEach(async () => { vi.restoreAllMocks(); await cleanup(); });

it.each([
  ["steer", "$alpha $beta $alpha"], ["followUp", "$alpha $beta $alpha"],
  ["steer", "$alpha，继续 $beta. $alpha!"], ["followUp", "$alpha，继续 $beta. $alpha!"],
] as const)("consumes identical %s users independently with current files and their own images: %s", async (behavior, task) => {
  const h = await lifecycleFixture({ extraBefore: pi => {
    pi.on("message_end", event => event.message.role === "user"
      ? { message: { ...event.message, timestamp: event.message.timestamp + 1 } } : undefined);
  } });
  const entered = deferred(), release = deferred();
  h.faux.setResponses([async ctx => { entered.resolve(); await release.promise; return h.respond(ctx); }, h.respond]);
  const read = vi.mocked(fs.readFile); read.mockClear();
  const run = h.session.prompt("Initial task"); await entered.promise;
  const images = [RED_PIXEL_PNG, BLUE_PIXEL_PNG].map(data => ({ type: "image" as const, data, mimeType: "image/png" }));
  try {
    for (const image of images) await h.session.prompt(task, { streamingBehavior: behavior, images: [image] });
    expect(behavior === "steer" ? h.session.getSteeringMessages() : h.session.getFollowUpMessages()).toEqual([task, task]);
    expect(h.displays()).toHaveLength(0);
    expect(read.mock.calls.filter(([path]) => h.skills.some(skill => skill.filePath === path))).toHaveLength(0);
    writeFileSync(h.skills[0].filePath, "ALPHA_CONSUMPTION_VERSION");
  } finally { release.resolve(); }
  await run;
  const users = h.calls[1].filter(message => message.role === "user").slice(1);
  expect(users).toHaveLength(2);
  const snapshots = users.map(user => decodeSnapshot(textOf(user))!);
  expect(new Set(snapshots.map(s => s.requestId)).size).toBe(2);
  snapshots.forEach((s, i) => {
    expect(s.task).toBe(task); expect(s.skills.map(skill => skill.name)).toEqual(["alpha", "beta"]);
    expect(s.skills[0].body).toContain("ALPHA_CONSUMPTION_VERSION"); expect(users[i].content).toContainEqual(images[i]);
    expect(h.displays()[i].data).toEqual(s);
  });
  expect(read.mock.calls.filter(([path]) => h.skills.some(skill => skill.filePath === path))).toHaveLength(4);
  expect(h.sequence).toEqual(["user", "display", "user", "display", "user"]);
  expect(h.plain().match(/ \u{f01a7} alpha /gu)).toHaveLength(4);
  expect(h.plain().match(/ \u{f01a7} beta /gu)).toHaveLength(2);
  expect(JSON.stringify(users)).not.toContain("\u{f01a7}");
  const disk = readFileSync(h.session.sessionFile!, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(disk.filter(e => e.type === "message" && e.message.role === "user").slice(1).map(e => e.message)).toEqual(users);
  expect(h.errors).toEqual([]);
});

it.each(["error", "aborted"] as const)("persists the first user snapshot before a provider %s without rereading on resume", async stopReason => {
  const h = await lifecycleFixture(), entered = deferred(), release = deferred();
  h.faux.setResponses([async ctx => {
    h.calls.push(structuredClone(ctx.messages)); entered.resolve(); await release.promise;
    return fauxAssistantMessage("", { stopReason, errorMessage: "Fixture failure" });
  }]);
  const run = h.session.prompt("$alpha"); await entered.promise;
  try {
    expect(h.users()).toHaveLength(1); expect(h.displays()).toHaveLength(1);
    expect(existsSync(h.session.sessionFile!)).toBe(true);
    const entries = readFileSync(h.session.sessionFile!, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const user = entries.find(entry => entry.type === "message" && entry.message.role === "user");
    expect(decodeSnapshot(textOf(user.message))).toEqual(decodeSnapshot(textOf(h.users()[0].message)));
    expect(user.message.content).toEqual(h.calls[0].find(message => message.role === "user")!.content);
    expect(entries.filter(entry => entry.type === "message" && entry.message.role === "assistant")).toEqual([]);
  } finally { release.resolve(); }
  await run;
  const file = h.session.sessionFile!;
  expect(readFileSync(file, "utf8")).toContain("ALPHA_BODY");
  rmSync(h.skills[0].filePath); const read = vi.mocked(fs.readFile); read.mockClear();
  await h.runtime.newSession(); await h.runtime.switchSession(file);
  expect(h.rebuild()).toContain("[skill] alpha"); expect(h.users()).toHaveLength(1);
  expect(read.mock.calls.filter(([path]) => h.skills.some(skill => skill.filePath === path))).toHaveLength(0);
  expect(h.errors).toEqual([]);
});

it("keeps dequeue text clean and silently skips a skill deleted while queued", async () => {
  const h = await lifecycleFixture(), entered = deferred(), release = deferred();
  h.faux.setResponses([async ctx => { entered.resolve(); await release.promise; return h.respond(ctx); }, h.respond]);
  const run = h.session.prompt("Initial"); await entered.promise;
  try {
    await h.session.steer("$alpha"); await h.session.followUp("$beta");
    expect(h.session.clearQueue()).toEqual({ steering: ["$alpha"], followUp: ["$beta"] });
    await h.session.followUp("$alpha $beta"); rmSync(h.skills[0].filePath);
  } finally { release.resolve(); }
  await run;
  const user = h.calls[1].filter(m => m.role === "user").at(-1)!;
  expect(decodeSnapshot(textOf(user))?.skills.map(skill => skill.name)).toEqual(["beta"]);
  expect(h.plain()).not.toContain("[skill] alpha");
  expect(h.plain()).toContain("$alpha  \u{f01a7} beta "); expect(h.errors).toEqual([]);
});

it.each([undefined, "before", "after"] as const)("reloads and resumes disk snapshots without reads using editor order %s", async codex => {
  const h = await lifecycleFixture({ codex }); await h.session.prompt("用 $alpha $beta 调查");
  const original = readFileSync(h.session.sessionFile!, "utf8"), file = h.session.sessionFile!;
  h.skills.forEach(skill => rmSync(skill.filePath));
  const read = vi.mocked(fs.readFile); read.mockClear();
  for (let i = 0; i < 3; i++) {
    h.mode.editor.setText("Existing draft"); await h.reload();
    expect(h.mode.editor.getText()).toBe("Existing draft"); expect(h.wrappers).toHaveLength(1);
    if (codex) expect(h.mode.editor).toBeInstanceOf(CodexEditor);
    const display = h.rebuild(); expect(display).toContain("[skill] alpha"); expect(display).not.toContain("pi-ext/skill-mentions");
    expect(display).toContain(" \u{f01a7} alpha   \u{f01a7} beta ");
  }
  expect(readFileSync(file, "utf8")).toBe(original);
  await h.runtime.newSession(); await h.runtime.switchSession(file);
  expect(h.rebuild()).toContain("[skill] beta");
  h.mode.renderInitialMessages(); h.mode.editor.setText(""); h.mode.editor.handleInput("\x1b[A");
  expect(h.mode.editor.getText()).toBe("用 $alpha $beta 调查");
  expect(read.mock.calls.filter(([path]) => h.skills.some(skill => skill.filePath === path))).toHaveLength(0);
  expect(h.displays()).toHaveLength(1); expect(h.errors).toEqual([]);
});

it("retains cards when the real reload callback rebuilds the transcript before session_start", async () => {
  const h = await lifecycleFixture();
  await h.session.prompt("History $alpha");
  const completed = decodeSnapshot(textOf(h.users()[0].message))!;
  h.pi.appendEntry(displayType, { ...completed, requestId: "11111111-1111-4111-8111-111111111111", task: "Orphan $alpha" });
  const disk = readFileSync(h.session.sessionFile!, "utf8");
  rmSync(h.skills[0].filePath);
  const read = vi.mocked(fs.readFile); read.mockClear();
  await h.session.reload({ beforeSessionStart: () => {
    h.mode.setCustomEditorComponent(undefined);
    h.mode.rebuildChatFromMessages();
  } });
  // Do not rebuild after session_start: the actual CLI also keeps those components.
  expect(h.plain().match(/\[skill\] alpha/g)).toHaveLength(1);
  expect(h.plain()).not.toContain("Orphan");
  h.mode.editor.setText(""); h.mode.editor.handleInput("\x1b[A");
  expect(h.mode.editor.getText()).toBe("History $alpha");
  expect(readFileSync(h.session.sessionFile!, "utf8")).toBe(disk);
  expect(read.mock.calls.filter(([path]) => path === h.skills[0].filePath)).toHaveLength(0);
});

it("navigates a real user parent, hides its orphan, and forks/resumes without crossing branches", async () => {
  const h = await lifecycleFixture({ codex: "after" });
  await h.session.prompt("First $alpha"); await h.session.prompt("Second $beta");
  const file = h.session.sessionFile!, second = h.users()[1], oldLeaf = h.sm.getLeafId()!;
  const text = second.type === "message" ? textOf(second.message) : "";
  h.mode.editor.setText("Existing draft");
  const result = await h.session.navigateTree(second.id, { summarize: false });
  expect(h.sm.getLeafId()).toBe(second.parentId);
  expect(result.editorText).toBe(text);
  h.mode.editor.setText(result.editorText);
  expect(h.mode.editor.getText()).toBe("Second $beta");
  expect(h.rebuild()).toContain("[skill] alpha"); expect(h.plain()).not.toContain("[skill] beta");
  expect(h.plain()).toContain(" \u{f01a7} alpha "); expect(h.plain()).not.toContain(" \u{f01a7} beta ");
  await h.session.prompt("Alternate $alpha");
  expect(h.calls.at(-1)!.filter(m => m.role === "user").map(textOf).some(t => decodeSnapshot(t)?.task === "Second $beta")).toBe(false);
  await h.session.navigateTree(oldLeaf, { summarize: false });
  expect(h.rebuild()).toContain("[skill] beta"); expect(h.plain()).not.toContain("Alternate");
  h.pi.setLabel(oldLeaf, "restored");
  h.skills.forEach(skill => rmSync(skill.filePath));
  const read = vi.mocked(fs.readFile); read.mockClear();
  const fork = await h.runtime.fork(second.id);
  h.mode.editor.setText(fork.selectedText);
  expect(h.mode.editor.getText()).toBe("Second $beta");
  expect(h.rebuild()).toContain("[skill] alpha"); expect(h.plain()).not.toContain("[skill] beta");
  expect(h.plain()).toContain(" \u{f01a7} alpha "); expect(h.plain()).not.toContain(" \u{f01a7} beta ");
  await h.runtime.switchSession(file);
  expect(h.rebuild()).toContain("[skill] beta");
  expect(read.mock.calls.filter(([path]) => h.skills.some(skill => skill.filePath === path))).toHaveLength(0);
  expect(h.errors).toEqual([]);
});

it.each(["user", "assistant"] as const)("respects compaction retaining %s without repairing cards or reinjecting bodies", async keep => {
  const h = await lifecycleFixture(); await h.session.prompt("Old task $alpha $beta");
  const snapshot = decodeSnapshot(textOf(h.calls[0].find(m => m.role === "user")!))!;
  const entry = keep === "user" ? h.users()[0] : h.sm.getEntries().find(e => e.type === "message" && e.message.role === "assistant")!;
  h.setCompactFrom(entry.id); await h.session.compact();
  h.skills.forEach(skill => rmSync(skill.filePath));
  const read = vi.mocked(fs.readFile); read.mockClear();
  const before = h.sm.getEntries().length;
  await h.reload(); expect(h.rebuild()).not.toContain("[skill]"); expect(h.sm.getEntries()).toHaveLength(before);
  expect(h.plain().includes(" \u{f01a7} alpha ")).toBe(keep === "user");
  await h.session.prompt("Continue");
  const messages = h.calls.at(-1)!;
  expect(JSON.stringify(messages)).toContain("Fixture summary");
  const old = messages.filter(m => m.role === "user").map(m => decodeSnapshot(textOf(m))).find(Boolean);
  expect(old).toEqual(keep === "user" ? snapshot : undefined);
  expect(h.displays()).toHaveLength(1);
  expect(h.users().some(e => e.type === "message" && decodeSnapshot(textOf(e.message))?.requestId === snapshot.requestId)).toBe(true);
  expect(read.mock.calls.filter(([path]) => h.skills.some(skill => skill.filePath === path))).toHaveLength(0);
  expect(h.errors).toEqual([]);
});

it("restores interrupted JSONL with an orphan display and a truncated user without activating it", async () => {
  const h = await lifecycleFixture(); await h.session.prompt("Seed");
  let interrupted = "";
  const unsubscribe = h.session.subscribe(event => {
    if (event.type === "entry_appended" && event.entry.type === "custom" && event.entry.customType === displayType) {
      interrupted = readFileSync(h.session.sessionFile!, "utf8");
    }
  });
  await h.session.prompt("Interrupted $alpha"); unsubscribe();
  expect(interrupted).toContain(displayType); expect(interrupted).not.toContain('"role":"user","content":[{"type":"text","text":"<pi-ext');
  const file = join(h.cwd, "interrupted.jsonl");
  writeFileSync(file, interrupted + '{"type":"message","id":"broken');
  rmSync(h.skills[0].filePath);
  await h.runtime.switchSession(file);
  expect(h.displays()).toHaveLength(1); expect(h.rebuild()).not.toContain("[skill] alpha");
  await h.session.prompt("Continue");
  expect(JSON.stringify(h.calls.at(-1))).not.toContain("ALPHA_BODY");
  expect(h.errors).toEqual([]);
});

it("clones a completed branch with images and immutable snapshots", async () => {
  const h = await lifecycleFixture();
  const image = { type: "image" as const, data: RED_PIXEL_PNG, mimeType: "image/png" };
  await h.session.prompt("$alpha", { images: [image] });
  const original = h.users()[0]; rmSync(h.skills[0].filePath);
  const source = h.session.sessionFile;
  await h.runtime.fork(h.sm.getLeafId()!, { position: "at" });
  expect(h.session.sessionFile).not.toBe(source); expect(h.users()[0]).toEqual(original);
  expect(h.rebuild()).toContain("[skill] alpha");
  await h.session.prompt("Continue");
  const user = h.calls.at(-1)!.find(m => m.role === "user")!;
  expect(user.content).toContainEqual(image); expect(textOf(user)).toContain("ALPHA_BODY");
  expect(h.errors).toEqual([]);
});

it("keeps the finalized user snapshot after a real display JSONL append error without retrying the display", async () => {
  let file = "", backup = "";
  const h = await lifecycleFixture({
    extraBefore: pi => { pi.on("message_start", event => {
      if (event.message.role !== "user" || textOf(event.message) !== "$alpha") return;
      renameSync(file, backup); mkdirSync(file);
    }); },
    extra: pi => { pi.on("message_start", event => {
      if (event.message.role !== "user" || textOf(event.message) !== "$alpha") return;
      rmSync(file, { recursive: true }); renameSync(backup, file);
    }); },
  });
  await h.session.prompt("Seed"); file = h.session.sessionFile!; backup = join(h.cwd, "session-backup.jsonl");
  await h.session.prompt("$alpha");
  expect(h.errors).toHaveLength(1); expect(h.errors[0]).toContain("EISDIR");
  expect(decodeSnapshot(textOf(h.calls.at(-1)!.filter(m => m.role === "user").at(-1)!))?.skills[0].body).toContain("ALPHA_BODY");
  const disk = readFileSync(file, "utf8"); expect(disk).not.toContain(displayType); expect(disk).toContain("ALPHA_BODY");
  rmSync(h.skills[0].filePath);
  await h.runtime.newSession(); await h.runtime.switchSession(file);
  expect(h.rebuild()).not.toContain("[skill]"); expect(h.displays()).toHaveLength(0);
  expect(h.sm.buildSessionContext().messages.some(m => m.role === "user" && textOf(m).includes("ALPHA_BODY"))).toBe(true);
});

it("does not repair a missing display when resuming a persisted snapshot", async () => {
  const h = await lifecycleFixture(); await h.session.prompt("$alpha");
  const rows = readFileSync(h.session.sessionFile!, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const display = rows.find(e => e.type === "custom" && e.customType === displayType);
  const file = join(h.cwd, "missing-display.jsonl");
  writeFileSync(file, rows.filter(e => e !== display).map(e => JSON.stringify(e.parentId === display.id ? { ...e, parentId: display.parentId } : e)).join("\n") + "\n");
  rmSync(h.skills[0].filePath); await h.runtime.switchSession(file);
  expect(h.rebuild()).not.toContain("[skill]"); expect(h.displays()).toHaveLength(0);
  await h.session.prompt("Continue");
  expect(JSON.stringify(h.calls.at(-1))).toContain("ALPHA_BODY"); expect(h.displays()).toHaveLength(0);
  expect(h.errors).toEqual([]);
});

it("preserves skill snapshots when an earlier message_end handler clones the user", async () => {
  const h = await lifecycleFixture({ extraBefore: pi => {
    pi.on("message_end", event => event.message.role === "user" ? { message: { ...event.message } } : undefined);
  } });
  const image = { type: "image" as const, data: RED_PIXEL_PNG, mimeType: "image/png" };
  await h.session.prompt("$alpha", { images: [image] });
  const user = h.calls[0].find(message => message.role === "user")!;
  const snapshot = decodeSnapshot(textOf(user));
  expect(snapshot?.skills[0].body).toContain("ALPHA_BODY");
  expect(decodeSnapshot(textOf(h.users()[0].message))).toEqual(snapshot);
  expect(user.content).toContainEqual(image);
  expect(h.plain()).toContain("[skill] alpha"); expect(h.rebuild()).toContain("[skill] alpha");
  h.sm.branch(h.displays()[0].id);
  expect(h.rebuild()).not.toContain("[skill] alpha");
  expect(h.errors).toEqual([]);
});

it.each(["$alpha changed", "$beta $alpha changed", "plain replacement"])("uses the finalized task and cards after replacement with %s", async task => {
  const h = await lifecycleFixture({ extraBefore: pi => {
    pi.on("message_end", event => event.message.role === "user" ? { message: { ...event.message, content: task } } : undefined);
  } });
  const read = vi.mocked(fs.readFile); read.mockClear();
  await h.session.prompt("$alpha");
  const text = textOf(h.calls[0].find(message => message.role === "user")!);
  const snapshot = decodeSnapshot(text);
  if (task.startsWith("plain")) expect(text).toBe(task);
  else {
    expect(snapshot?.task).toBe(task);
    expect(snapshot?.skills.map(skill => skill.name)).toEqual(task.includes("$beta") ? ["beta", "alpha"] : ["alpha"]);
  }
  expect(textOf(h.users()[0].message)).toBe(text);
  expect(read.mock.calls.filter(([path]) => path === h.skills[0].filePath)).toHaveLength(1);
  for (const rendered of [h.plain(), h.rebuild()]) {
    expect(rendered).toContain(task.startsWith("plain") ? task : "changed");
    expect(rendered.includes("[skill] alpha")).toBe(!task.startsWith("plain"));
    expect(rendered.includes("[skill] beta")).toBe(task.includes("$beta"));
  }
  await h.reload();
  expect(h.rebuild().includes("[skill] beta")).toBe(task.includes("$beta"));
  expect(h.errors).toEqual([]);
});

it("discards unfinished starts on agent end and ignores late reads after reload", async () => {
  const h = await lifecycleFixture();
  const runner = h.session.extensionRunner!;
  await runner.emit({ type: "message_start", message: { role: "user", content: "$alpha", timestamp: 1 } });
  const display = h.displays()[0];
  expect(runner.getEntryRenderer(displayType)!(display, { expanded: false }, {} as any)).toBeDefined();
  await runner.emit({ type: "agent_end", messages: [] });
  expect(runner.getEntryRenderer(displayType)!(display, { expanded: false }, {} as any)).toBeUndefined();
  expect(await runner.emitMessageEnd({ type: "message_end", message: { role: "user", content: "$alpha", timestamp: 1 } })).toBeUndefined();
  const entered = deferred(), release = deferred();
  const read = vi.mocked(fs.readFile), original = (await vi.importActual<typeof fs>("node:fs/promises")).readFile;
  read.mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
    if (args[0] === h.skills[0].filePath) { entered.resolve(); await release.promise; }
    return original(...args);
  }) as typeof fs.readFile);
  const start = runner.emit({ type: "message_start", message: { role: "user", content: "$alpha $beta", timestamp: 2 } });
  await entered.promise;
  try { await h.reload(); } finally { release.resolve(); }
  await start;
  expect(h.displays()).toHaveLength(1);
  expect(h.rebuild()).not.toContain("[skill] alpha");
  await h.session.prompt("$beta");
  expect(decodeSnapshot(textOf(h.calls[0].find(message => message.role === "user")!))?.skills.map(skill => skill.name)).toEqual(["beta"]);
  expect(h.errors).toEqual([]);
});

it("shows the replacement when an earlier handler replaces a pasted snapshot", async () => {
  let replace = false;
  const h = await lifecycleFixture({ extraBefore: pi => {
    pi.on("message_end", event => replace && event.message.role === "user" ? { message: { ...event.message, content: "plain replacement" } } : undefined);
  } });
  await h.session.prompt("$alpha");
  const snapshot = textOf(h.users()[0].message);
  replace = true;
  await h.session.prompt(snapshot);
  expect(textOf(h.users()[1].message)).toBe("plain replacement");
  expect(h.plain()).toContain("plain replacement");
});

it("invalidates an already rendered user when message_end changes its task", async () => {
  let render = () => "";
  const h = await lifecycleFixture({ extraBefore: pi => {
    pi.on("message_end", event => {
      if (event.message.role !== "user") return;
      expect(render()).toContain("alpha");
      return { message: { ...event.message, content: "$beta changed" } };
    });
  } });
  render = h.plain;
  await h.session.prompt("$alpha");
  expect(h.plain()).toContain("changed");
  expect(h.plain()).not.toContain("alpha");
  expect(h.errors).toEqual([]);
});

it("activates references introduced at message_end and preserves replacement images", async () => {
  const image = { type: "image" as const, data: BLUE_PIXEL_PNG, mimeType: "image/png" };
  const h = await lifecycleFixture({ extraBefore: pi => {
    pi.on("message_end", event => event.message.role === "user" ? { message: { ...event.message,
      content: [{ type: "text" as const, text: "$beta introduced" }, image] } } : undefined);
  } });
  await h.session.prompt("plain task");
  const user = h.calls[0].find(message => message.role === "user")!;
  expect(decodeSnapshot(textOf(user))?.task).toBe("$beta introduced");
  expect(user.content).toContainEqual(image);
  expect(textOf(h.users()[0].message)).toBe(textOf(user));
  expect(h.displays()).toHaveLength(1);
  for (const rendered of [h.plain(), h.rebuild()]) {
    expect(rendered).toContain("[skill] beta"); expect(rendered).toContain("introduced");
    expect(rendered).not.toContain("plain task");
  }
  expect(h.errors).toEqual([]);
});

it("does not display activation after finalizing a newly introduced reference fails", async () => {
  const h = await lifecycleFixture({ extraBefore: pi => {
    pi.on("message_end", event => event.message.role === "user" ? { message: { ...event.message, content: "$beta" } } : undefined);
  } });
  const append = vi.spyOn(h.sm, "appendCustomEntry").mockImplementationOnce(() => { throw new Error("Display append failed"); });
  try {
    await h.session.prompt("plain task");
    expect(textOf(h.users()[0].message)).toBe("$beta");
    expect(textOf(h.calls[0].find(message => message.role === "user")!)).toBe("$beta");
    expect(h.plain()).toContain("$beta");
    expect(h.plain()).not.toContain("\u{f01a7}");
    expect(h.errors).toEqual(["Display append failed"]);
  } finally { append.mockRestore(); }
});
