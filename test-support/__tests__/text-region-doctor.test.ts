import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { doctor, checkNodeVersion } from "../../.cursor/skills/verify-pi-text-regions/scripts/doctor.mjs";
// Offline checks do not require Conda. The skill self-proof exercises the real executable.
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: (...args: Parameters<typeof actual.execFileSync>) => {
    if (args[0] === "conda") return JSON.stringify({version:"3.12.13", executable:"/fixture/python", pyte:"0.8.2"});
    return actual.execFileSync(...args);
  } };
});

const repo = process.cwd();
const invoke = (...args: string[]) => doctor(args);

describe("text region doctor", () => {
  it("reports the actual CLI, both renderer capabilities and prerequisites without changing configuration", async () => {
    const files = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].map(path => ({ path, bytes: readFileSync(path), mtime: statSync(path).mtimeMs }));
    const report = await invoke();
    expect(report.ok).toBe(true);
    expect(report.project).toBe(repo);
    expect(report.cli).toBe(resolve("node_modules/.bin/pi"));
    expect(report.cliVersion).toBe("1.4.0");
    expect(report.regionApi).toEqual({ regular: true, fullscreen: true });
    expect(report.python.pyte).toBe("0.8.2");
    expect(report.python.version).toMatch(/^3\.12\./);
    expect(report.pnpm).toBe("11.9.0");
    expect(report.extension).toBe(realpathSync("extensions/codex-ui/dist/index.js"));
    expect(report.sources["pnpm-lock.yaml"]).toMatch(/^[a-f0-9]{64}$/);
    for (const file of files) {
      expect(readFileSync(file.path)).toEqual(file.bytes);
      expect(statSync(file.path).mtimeMs).toBe(file.mtime);
    }
  });

  it("rejects a patched host labelled as original", async () => {
    await expect(invoke("--original")).rejects.toThrow(/Region API does not match requested host/);
  });

  it("rejects a nonexistent project without creating it", async () => {
    const missing = resolve(`.tmp/doctor-missing-${process.pid}`);
    await expect(invoke("--project", missing)).rejects.toThrow(/ENOENT/);
    expect(existsSync(missing)).toBe(false);
  });

  it("rejects a missing published extension rather than silently using the checkout", async () => {
    await expect(invoke("--extension", "missing-published-index.js")).rejects.toThrow(/ENOENT/);
  });

  it("rejects unknown flags", async () => {
    await expect(invoke("--wrong-flag")).rejects.toThrow(/Unknown option/);
  });
});

for (const version of ["22.19.0", "22.22.2", "23.0.0"]) {
  it(`accepts supported Node ${version}`, () => expect(() => checkNodeVersion(version)).not.toThrow());
}
for (const version of ["22.18.9", "21.99.0"]) {
  it(`rejects unsupported Node ${version}`, () => expect(() => checkNodeVersion(version)).toThrow(/Node must satisfy/));
}
