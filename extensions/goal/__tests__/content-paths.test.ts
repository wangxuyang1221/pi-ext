import { expect, it, vi } from "vitest";
import { posix, win32 } from "node:path";

it.each([
  { label: "POSIX native paste", path: posix, root: "/tmp" },
  { label: "Windows native paste", path: win32, root: "C:\\Users\\Alice\\AppData\\Local\\Temp" },
  { label: "Windows drive root native paste", path: win32, root: "C:\\" },
  { label: "Windows UNC native paste", path: win32, root: "\\\\server\\share\\Temp [1]" },
])("recognizes $label candidate without file access", async ({ path, root }) => {
  vi.resetModules();
  vi.doMock("node:path", () => ({ ...path }));
  try {
    const { GoalContent } = await import("../src/content.js");
    const candidate = path.join(path.resolve(root), "pi-clipboard-123e4567-e89b-42d3-a456-426614174000.png");
    const content = new GoalContent("unused", root);
    expect(content.candidates(`See ${candidate}`)).toEqual([candidate]);
  } finally {
    vi.doUnmock("node:path");
    vi.resetModules();
  }
});

it("keeps Windows native paste candidate order and rejects lookalike paths", async () => {
  vi.resetModules();
  vi.doMock("node:path", () => ({ ...win32 }));
  try {
    const { GoalContent } = await import("../src/content.js");
    const root = "C:\\Temp (images) [1].v2";
    const first = win32.join(root, "pi-clipboard-123e4567-e89b-42d3-a456-426614174000.png");
    const second = win32.join(root, "pi-clipboard-123e4567-e89b-42d3-a456-426614174001.jpg");
    const content = new GoalContent("unused", root);
    expect(content.candidates(`"${first}" ${second} ${first}`)).toEqual([first, second]);
    expect(content.candidates([
      `x${first}`, `${first}.exe`, first.replace("Temp (images)", "Temp (other)"),
      first.replace("123e4567", "zzze4567"), `${root}\\..\\${win32.basename(first)}`,
    ].join(" "))).toEqual([]);
  } finally {
    vi.doUnmock("node:path");
    vi.resetModules();
  }
});

it("recognizes a Windows candidate without touching the file system", async () => {
  vi.resetModules();
  vi.doMock("node:path", () => ({ ...win32 }));
  vi.doMock("node:fs/promises", async importOriginal => {
    const fs = await importOriginal<typeof import("node:fs/promises")>();
    const forbidden = () => { throw new Error("Candidate recognition must not access files"); };
    return { ...fs, lstat: forbidden, open: forbidden, realpath: forbidden, readdir: forbidden };
  });
  try {
    const { GoalContent } = await import("../src/content.js");
    const root = "C:\\Temp";
    const candidate = win32.join(root, "pi-clipboard-123e4567-e89b-42d3-a456-426614174000.png");
    expect(new GoalContent("unused", root).candidates(candidate)).toEqual([candidate]);
  } finally {
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("node:path");
    vi.resetModules();
  }
});
