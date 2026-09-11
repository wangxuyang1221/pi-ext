import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { initTheme, SessionManager, ToolExecutionComponent, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { registerCodexTools, parseUnifiedPatch } from "../src/tools.js";

const { readFileMock, snapshotReadMock, patchMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(), snapshotReadMock: vi.fn(), patchMock: vi.fn(),
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => readFileMock(...args) ?? actual.readFile(...args),
    async open(...args: Parameters<typeof actual.open>) {
      const handle = await actual.open(...args);
      return new Proxy(handle, {
        get(target, property) {
          if (property === "read") return (...readArgs: Parameters<typeof handle.read>) => {
            snapshotReadMock(...readArgs);
            return target.read(...readArgs);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});
vi.mock("@earendil-works/pi-coding-agent", async (original) => {
  const actual = await original<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, generateUnifiedPatch: (...args: Parameters<typeof actual.generateUnifiedPatch>) => patchMock(...args) ?? actual.generateUnifiedPatch(...args) };
});
afterEach(() => { readFileMock.mockReset(); snapshotReadMock.mockReset(); patchMock.mockReset(); });

function tools(lowPower = false) {
  const registered: ToolDefinition[] = [];
  registerCodexTools({ registerTool(tool: ToolDefinition) { registered.push(tool); }, on() {} } as unknown as ExtensionAPI,
    undefined, { isLowPowerEnabled: () => lowPower });
  return registered;
}

test("write bounds each UTF-8 snapshot and skips diffs above the approved byte or line limits", async () => {
  const cwd = await mkdtemp(join(process.cwd(), ".write-test-"));
  try {
    const write = tools().find(tool => tool.name === "write")!;
    const max = 1024 * 1024;
    const cases = [
      { old: "x".repeat(max + 1), next: "new", reads: false },
      { old: "old", next: "x".repeat(max + 1), reads: false },
      { old: "old", next: "中".repeat(Math.ceil(max / 3)), reads: false },
      { old: "x\n".repeat(2001), next: "x\n".repeat(2000), reads: true },
    ];
    for (const sample of cases) {
      await writeFile(join(cwd, "file.ts"), sample.old);
      readFileMock.mockClear(); snapshotReadMock.mockClear(); patchMock.mockClear();
      const result = await write.execute("over-limit", { path: "file.ts", content: sample.next }, undefined, undefined, { cwd } as never);
      assert.equal(result.details.codexWrite.action, "Edited");
      assert.equal("patch" in result.details.codexWrite, false);
      assert.equal(patchMock.mock.calls.length, 0);
      assert.equal(readFileMock.mock.calls.length, 0, "Snapshots must use bounded handle reads");
      assert.equal(snapshotReadMock.mock.calls.length > 0, sample.reads);
      assert.equal(await readFile(join(cwd, "file.ts"), "utf8"), sample.next);
    }
    for (const content of ["x".repeat(max), "x\n".repeat(2000)]) {
      await writeFile(join(cwd, "file.ts"), content);
      const result = await write.execute("at-limit", { path: "file.ts", content }, undefined, undefined, { cwd } as never);
      assert.equal(typeof result.details.codexWrite.patch, "string");
      assert.deepEqual(parseUnifiedPatch(result.details.codexWrite.patch), []);
    }
    for (const [buffer] of snapshotReadMock.mock.calls) assert.ok(buffer.length <= max + 1);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("write caps persisted patches at two MiB without changing the write result", async () => {
  const cwd = await mkdtemp(join(process.cwd(), ".write-test-"));
  try {
    const write = tools().find(tool => tool.name === "write")!;
    const old = "a".repeat(1024 * 1024);
    const content = "b".repeat(1024 * 1024);
    await writeFile(join(cwd, "file.ts"), old);
    const result = await write.execute("over", { path: "file.ts", content }, undefined, undefined, { cwd } as never);
    assert.equal("patch" in result.details.codexWrite, false);
    assert.equal(result.details.codexWrite.action, "Edited");
    assert.equal(await readFile(join(cwd, "file.ts"), "utf8"), content);
    const exact = "p".repeat(2 * 1024 * 1024);
    patchMock.mockReturnValueOnce(exact);
    const atLimit = await write.execute("at", { path: "file.ts", content: "short" }, undefined, undefined, { cwd } as never);
    assert.equal(atLimit.details.codexWrite.patch, exact);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("same-file writes and edits capture the previous queued mutation including symlink aliases", async () => {
  const cwd = await mkdtemp(join(process.cwd(), ".write-test-"));
  try {
    await writeFile(join(cwd, "file.ts"), "zero\n");
    await symlink("file.ts", join(cwd, "alias.ts"));
    const registered = tools();
    const write = registered.find(tool => tool.name === "write")!;
    const edit = registered.find(tool => tool.name === "edit")!;
    const ctx = { cwd } as never;
    const results = await Promise.all([
      write.execute("first", { path: "file.ts", content: "one\n" }, undefined, undefined, ctx),
      edit.execute("second", { path: "alias.ts", edits: [{ oldText: "one", newText: "two" }] }, undefined, undefined, ctx),
      write.execute("third", { path: "alias.ts", content: "three\n" }, undefined, undefined, ctx),
    ]);
    const changes = results.filter(result => result.details.codexWrite).map(result =>
      parseUnifiedPatch(result.details.codexWrite.patch).map(line => [line.kind, line.text]));
    assert.deepEqual(changes, [
      [["removed", "zero"], ["added", "one"]],
      [["removed", "two"], ["added", "three"]],
    ]);
    assert.equal(await readFile(join(cwd, "file.ts"), "utf8"), "three\n");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("snapshot and diff failures preserve writable files and never claim an addition", async () => {
  const cwd = await mkdtemp(join(process.cwd(), ".write-test-"));
  try {
    const path = "file.ts";
    await writeFile(join(cwd, path), "old\n");
    const write = tools().find(tool => tool.name === "write")!;
    for (const code of ["EACCES", "ENOENT", "EIO"]) {
      snapshotReadMock.mockImplementationOnce(() => { throw Object.assign(new Error(code), { code }); });
      const result = await write.execute(code, { path, content: code }, undefined, undefined, { cwd } as never);
      assert.deepEqual(result.details, { codexWrite: { version: 1, action: "Edited" } });
      assert.equal(await readFile(join(cwd, path), "utf8"), code);
    }
    patchMock.mockImplementationOnce(() => { throw new Error("Diff failed"); });
    const result = await write.execute("diff", { path, content: "still written" }, undefined, undefined, { cwd } as never);
    assert.deepEqual(result.details, { codexWrite: { version: 1, action: "Edited" } });
    assert.equal(await readFile(join(cwd, path), "utf8"), "still written");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("write retains empty, newline-only, BOM and no-op changes without coercing bytes", async () => {
  const cwd = await mkdtemp(join(process.cwd(), ".write-test-"));
  try {
    const write = tools().find(tool => tool.name === "write")!;
    for (const [oldContent, content, expectedKinds] of [
      ["", "", []], ["x", "x", []], ["x", "x\n", ["removed", "added"]],
      ["x\n", "", ["removed"]], ["", "\n", ["added"]],
      ["\ufeffx\r\n", "x\r\n", ["removed", "added"]],
    ] as const) {
      await writeFile(join(cwd, "file.ts"), oldContent);
      const result = await write.execute("edge", { path: "file.ts", content }, undefined, undefined, { cwd } as never);
      assert.equal(result.details.codexWrite.action, "Edited");
      assert.deepEqual(parseUnifiedPatch(result.details.codexWrite.patch).map(line => line.kind), expectedKinds);
      assert.equal(await readFile(join(cwd, "file.ts"), "utf8"), content);
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("write metadata describes encoded bytes even if the argument object changes during execution", async () => {
  const cwd = await mkdtemp(join(process.cwd(), ".write-test-"));
  try {
    await writeFile(join(cwd, "file.ts"), "\ufffd");
    const write = tools().find(tool => tool.name === "write")!;
    const args = { path: "file.ts", content: "\ud800" };
    snapshotReadMock.mockImplementationOnce(() => { args.content = "not actually written"; });
    const result = await write.execute("encoded", args, undefined, undefined, { cwd } as never);
    assert.deepEqual(parseUnifiedPatch(result.details.codexWrite.patch), []);
    assert.equal(await readFile(join(cwd, "file.ts"), "utf8"), "\ufffd");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("failed and aborted writes do not compute success patches", async () => {
  const cwd = await mkdtemp(join(process.cwd(), ".write-test-"));
  try {
    const write = tools().find(tool => tool.name === "write")!;
    await assert.rejects(write.execute("directory", { path: ".", content: "x" }, undefined, undefined, { cwd } as never));
    await assert.rejects(write.execute("abort", { path: "missing.ts", content: "x" }, AbortSignal.abort(), undefined, { cwd } as never), /aborted/u);
    assert.equal(patchMock.mock.calls.length, 0);
    assert.equal(readFileMock.mock.calls.length, 0);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("an abort after the filesystem operation can leave bytes without a success patch", async () => {
  const cwd = await mkdtemp(join(process.cwd(), ".write-test-"));
  try {
    await writeFile(join(cwd, "file.ts"), "old\n");
    const controller = new AbortController();
    snapshotReadMock.mockImplementationOnce(() => { controller.abort(); });
    const write = tools().find(tool => tool.name === "write")!;
    await assert.rejects(write.execute("abort", { path: "file.ts", content: "new\n" }, controller.signal, undefined, { cwd } as never), /aborted/u);
    assert.equal(await readFile(join(cwd, "file.ts"), "utf8"), "new\n");
    assert.equal(patchMock.mock.calls.length, 0);
    const next = await write.execute("next", { path: "file.ts", content: "next\n" }, undefined, undefined, { cwd } as never);
    assert.deepEqual(parseUnifiedPatch(next.details.codexWrite.patch).map(line => line.text), ["new", "next"]);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("real write results survive disk session recovery without reading or recomputing the file", async () => {
  initTheme("dark", false);
  const cwd = await mkdtemp(join(process.cwd(), ".write-test-"));
  try {
    const write = tools().find(tool => tool.name === "write")!;
    const args = { path: "file.ts", content: Array.from({ length: 20 }, (_, i) => `const value${i} = ${i};\n`).join("") };
    const result = await write.execute("saved", args, undefined, undefined, { cwd } as never);
    const sm = SessionManager.create(cwd, join(cwd, "sessions"));
    sm.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "saved", name: "write", arguments: args }],
      api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "toolUse", timestamp: 1,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    sm.appendMessage({ role: "toolResult", toolName: "write", toolCallId: "saved", ...result, isError: false, timestamp: 2 });
    const restored = SessionManager.open(sm.getSessionFile()!).getEntries().find(entry =>
      entry.type === "message" && entry.message.role === "toolResult");
    assert.ok(restored?.type === "message" && restored.message.role === "toolResult");
    assert.deepEqual(restored.message.details, result.details);
    await rm(join(cwd, args.path));
    readFileMock.mockClear(); patchMock.mockClear();
    const row = new ToolExecutionComponent("write", "saved", args, { showImages: false }, write, { requestRender() {} }, cwd);
    row.updateResult(restored.message);
    row.setExpanded(false);
    const collapsed = row.render(92).map(stripTerminalSequences).filter(Boolean);
    assert.match(collapsed.join("\n"), /• Added file.ts \(\+20 -0\)/u);
    assert.match(collapsed.at(-1)!, /… 8 more lines/u);
    row.setExpanded(true);
    assert.match(row.render(92).map(stripTerminalSequences).join("\n"), /value19/u);
    for (const width of [1, 8, 16, 24, 40, 60, 92, 160]) {
      row.invalidate();
      assert.ok(row.render(width).every(line => visibleWidth(line) <= width));
    }
    row.setExpanded(false);
    assert.deepEqual(row.render(92).map(stripTerminalSequences).filter(Boolean), collapsed);
    assert.equal(readFileMock.mock.calls.length, 0);
    assert.equal(patchMock.mock.calls.length, 0);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("low-power writes identify the operation without reading old content or computing a diff", async () => {
  const cwd = await mkdtemp(join(process.cwd(), ".write-test-"));
  try {
    await writeFile(join(cwd, "file.ts"), "old\n".repeat(20_000));
    const write = tools(true).find(tool => tool.name === "write")!;
    for (const [path, action] of [["file.ts", "Edited"], ["new.ts", "Added"]]) {
      const result = await write.execute(path!, { path, content: "new\n" }, undefined, undefined, { cwd } as never);
      assert.deepEqual(result.details, { codexWrite: { version: 1, action } });
    }
    assert.equal(readFileMock.mock.calls.length, 0);
    assert.equal(patchMock.mock.calls.length, 0);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("write persists actual creation and overwrite patches without changing model output", async () => {
  const cwd = await mkdtemp(join(process.cwd(), ".write-test-"));
  try {
    const write = tools().find(tool => tool.name === "write")!;
    const args = { path: "nested/file.ts", content: "const value = 1;\n" };
    const added = await write.execute("add", args, undefined, undefined, { cwd } as never);
    assert.deepEqual(added.content, [{ type: "text", text: `Successfully wrote ${args.content.length} bytes to ${args.path}` }]);
    assert.equal(added.details.codexWrite.version, 1);
    assert.equal(added.details.codexWrite.action, "Added");
    assert.deepEqual(parseUnifiedPatch(added.details.codexWrite.patch).map(line => [line.kind, line.text]), [
      ["added", "const value = 1;"],
    ]);
    const edited = await write.execute("edit", { ...args, content: "const value = 2;\n" }, undefined, undefined, { cwd } as never);
    assert.equal(edited.details.codexWrite.action, "Edited");
    assert.deepEqual(parseUnifiedPatch(edited.details.codexWrite.patch).map(line => [line.kind, line.text]), [
      ["removed", "const value = 1;"], ["added", "const value = 2;"],
    ]);
    assert.equal(await readFile(join(cwd, args.path), "utf8"), "const value = 2;\n");
    assert.deepEqual(JSON.parse(JSON.stringify(edited.details)), edited.details);
    assert.ok(!("oldContent" in edited.details.codexWrite));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
