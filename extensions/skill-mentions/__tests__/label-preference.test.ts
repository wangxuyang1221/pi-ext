import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadIconPreference, saveIconPreference } from "../src/label-preference.js";

const directories: string[] = [];
function fixture() { const directory = mkdtempSync(join(tmpdir(), "skill-label-pref-")); directories.push(directory); return join(directory, "preference.json"); }
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

it("defaults to cube only when the preference file does not exist", () => {
  const path = fixture(); expect(loadIconPreference(path)).toBe("cube");
  writeFileSync(path, "broken"); expect(() => loadIconPreference(path)).toThrow();
});
it("saves both icon modes and loads them in a new lifecycle", () => {
  const path = fixture();
  for (const icon of ["command", "cube"] as const) {
    saveIconPreference(path, icon); expect(loadIconPreference(path)).toBe(icon);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 1, icon });
  }
});
it("rejects unsupported stored values and reports write failures without overwriting the original", () => {
  const path = fixture(); writeFileSync(path, JSON.stringify({ version: 1, icon: "text" }));
  expect(() => loadIconPreference(path)).toThrow();
  const before = readFileSync(path, "utf8");
  expect(() => saveIconPreference(join(path, "child.json"), "command")).toThrow();
  expect(readFileSync(path, "utf8")).toBe(before);
});
