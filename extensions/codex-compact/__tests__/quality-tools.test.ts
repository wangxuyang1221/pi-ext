import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { WorkspaceTools, fingerprintWorkspace } from "../../../scripts/codex-compact-quality-tools.mjs";

const temporary = path.resolve(".tmp/codex-quality/tool-tests");
fs.mkdirSync(temporary, { recursive: true });
const folders: string[] = [];
function setup() {
  const folder = fs.mkdtempSync(path.join(temporary, "case-")); folders.push(folder);
  const root = path.join(folder, "workspace"); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "source.py"), "before\n");
  fs.writeFileSync(path.join(root, "tests.py"), "protected\n");
  fs.writeFileSync(path.join(folder, "secret"), "hidden-evaluator-data");
  return { folder, root, tools: new WorkspaceTools(root, ["source.py"]) };
}
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true }); });

test("creates only an explicitly opted-in new file and permits later scoped edits", () => {
  const { root, tools: defaults } = setup();
  expect(defaults.execute("write_file", { path: "new-skin/src/client.ts", content: "export const title = 'first';\n" })).toContain("error");
  expect(fs.existsSync(path.join(root, "new-skin"))).toBe(false);
  const tools = new WorkspaceTools(root, ["source.py", "new-skin/src/client.ts"], { createPaths: ["new-skin/src/client.ts"] });
  expect(tools.execute("write_file", { path: "new-skin/src/client.ts", content: "export const title = 'first';\n" })).toBe("File created.");
  expect(tools.execute("read_file", { path: "new-skin/src/client.ts" })).toBe("export const title = 'first';\n");
  expect(tools.execute("replace_text", { path: "new-skin/src/client.ts", old_text: "first", new_text: "second" })).toBe("Replacement applied.");
  expect(tools.execute("write_file", { path: "new-skin/src/client.ts", content: "overwritten" })).toContain("error");
  expect(fs.readFileSync(path.join(root, "new-skin/src/client.ts"), "utf8")).toContain("second");
  expect(Object.keys(fingerprintWorkspace(root))).toContain("new-skin/src/client.ts");
  expect(tools.events.map((event: any) => event.status)).toEqual(["ok", "ok", "ok", "error"]);
});

test("rejects malformed or undeclared creation permissions before touching a workspace", () => {
  const { root } = setup();
  const before = fingerprintWorkspace(root);
  for (const createPaths of ["source.py", {}, [42], [""], ["../secret"], ["/tmp/outside"], ["new\\\\file"], ["file:stream"], ["bad\u0000name"], ["source.py", "source.py"], ["not-allowed.py"]]) {
    expect(() => new WorkspaceTools(root, ["source.py"], { createPaths: createPaths as any })).toThrow();
  }
  expect(fingerprintWorkspace(root)).toEqual(before);
});

test("removes only its newly created file and directories when a write fails partway", () => {
  const { root } = setup();
  const tools = new WorkspaceTools(root, ["new-skin/src/client.ts"], { createPaths: ["new-skin/src/client.ts"] });
  const originalWrite = fs.writeFileSync.bind(fs);
  const write = vi.spyOn(fs, "writeFileSync").mockImplementation((file: any, _data: any, options: any) => {
    originalWrite(file, "partial", options);
    throw Object.assign(new Error("Injected write failure"), { code: "EIO" });
  });
  try {
    expect(tools.execute("write_file", { path: "new-skin/src/client.ts", content: "complete" })).toContain("Injected write failure");
    expect(fs.existsSync(path.join(root, "new-skin"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "source.py"), "utf8")).toBe("before\n");
  } finally { write.mockRestore(); }
});

test("rejects creation through symlinks and invalid payloads without changing protected files", () => {
  const { root, folder } = setup();
  fs.symlinkSync(folder, path.join(root, "escape"));
  fs.symlinkSync(path.join(folder, "secret"), path.join(root, "leaf"));
  const paths = ["escape/new.ts", "leaf", "source.py", "source.py/child", "new-skin/src/client.ts"];
  const tools = new WorkspaceTools(root, paths, { createPaths: paths });
  for (const name of paths.slice(0, 4)) expect(tools.execute("write_file", { path: name, content: "changed" })).toContain("error");
  for (const content of [undefined, {}, "界".repeat(700000)]) expect(tools.execute("write_file", { path: paths[4], content })).toContain("error");
  expect(tools.execute("write_file", { path: "undeclared/new.ts", content: "changed" })).toContain("Forbidden");
  expect(fs.existsSync(path.join(root, "new-skin"))).toBe(false);
  expect(fs.existsSync(path.join(root, "undeclared"))).toBe(false);
  expect(fs.existsSync(path.join(folder, "new.ts"))).toBe(false);
  expect(fs.lstatSync(path.join(root, "leaf")).isSymbolicLink()).toBe(true);
  expect(fs.readFileSync(path.join(folder, "secret"), "utf8")).toBe("hidden-evaluator-data");
  expect(fs.readFileSync(path.join(root, "source.py"), "utf8")).toBe("before\n");
  expect(tools.execute("write_file", { path: paths[4], content: "" })).toBe("File created.");
  expect(fs.statSync(path.join(root, paths[4])).size).toBe(0);
});

test("copies a workspace asset byte-for-byte only to a declared new path", () => {
  const { root, folder } = setup();
  const bytes = Buffer.from([0, 255, 128, 65, 0]);
  fs.writeFileSync(path.join(root, "asset.png"), bytes);
  fs.symlinkSync(path.join(folder, "secret"), path.join(root, "private-link"));
  const paths = ["new-skin/assets/logo.png", "new-skin/assets/rejected.png"];
  const tools = new WorkspaceTools(root, paths, { createPaths: paths });
  expect(tools.execute("copy_file", { source_path: "asset.png", path: paths[0] })).toBe("File copied.");
  expect(fs.readFileSync(path.join(root, paths[0]))).toEqual(bytes);
  for (const source_path of ["../secret", "private-link", path.join(folder, "secret")]) {
    expect(tools.execute("copy_file", { source_path, path: paths[1] })).toContain("error");
  }
  expect(fs.existsSync(path.join(root, paths[1]))).toBe(false);
  expect(tools.execute("copy_file", { source_path: "source.py", path: paths[0] })).toContain("error");
  expect(fs.readFileSync(path.join(root, paths[0]))).toEqual(bytes);
});

test("does not read, copy or modify a hard-linked evaluator file", () => {
  const { root, folder } = setup();
  fs.linkSync(path.join(folder, "secret"), path.join(root, "hard-link"));
  const tools = new WorkspaceTools(root, ["hard-link", "new.ts"], { createPaths: ["new.ts"] });
  expect(tools.execute("read_file", { path: "hard-link" })).toContain("error");
  expect(tools.execute("copy_file", { source_path: "hard-link", path: "new.ts" })).toContain("error");
  expect(tools.execute("replace_text", { path: "hard-link", old_text: "hidden-evaluator-data", new_text: "changed" })).toContain("error");
  expect(fs.readFileSync(path.join(folder, "secret"), "utf8")).toBe("hidden-evaluator-data");
  expect(fs.existsSync(path.join(root, "new.ts"))).toBe(false);
});

test("rejects traversal, symlink escapes, and modifications outside the fixed scope", () => {
  const { root, folder, tools } = setup();
  fs.symlinkSync(path.join(folder, "secret"), path.join(root, "link"));
  for (const name of ["../secret", path.join(folder, "secret"), "link"]) {
    const result = tools.execute("read_file", { path: name });
    expect(result).toContain("error"); expect(result).not.toContain("hidden-evaluator-data");
  }
  expect(tools.execute("replace_text", { path: "tests.py", old_text: "protected", new_text: "tampered" })).toContain("Forbidden");
  expect(fs.readFileSync(path.join(root, "tests.py"), "utf8")).toBe("protected\n");
  expect(tools.execute("replace_text", { path: "source.py", old_text: "before", new_text: "after" })).toBe("Replacement applied.");
  expect(tools.execute("read_file", { path: "source.py" })).toBe("after\n");
});

test("does not apply an ambiguous replacement", () => {
  const { root, tools } = setup(); fs.writeFileSync(path.join(root, "source.py"), "same same");
  expect(tools.execute("replace_text", { path: "source.py", old_text: "same", new_text: "changed" })).toContain("exactly once");
  expect(fs.readFileSync(path.join(root, "source.py"), "utf8")).toBe("same same");
});

test("fingerprints include mode changes, not just file bytes", () => {
  const { root } = setup(); const file = path.join(root, "source.py");
  fs.chmodSync(file, 0o644); const before = fingerprintWorkspace(root);
  fs.chmodSync(file, 0o755); const after = fingerprintWorkspace(root);
  expect(after["source.py"]).not.toBe(before["source.py"]);
});
