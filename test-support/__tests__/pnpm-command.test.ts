import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { pnpmCommand } from "../../scripts/pnpm-command.mjs";

test("runs native executables without parsing them as JavaScript", () => {
  const [command, ...args] = pnpmCommand(["-e", "process.stdout.write(process.argv[1])", "spaces & symbols"], process.execPath);
  expect(execFileSync(command!, args, { encoding: "utf8" })).toBe("spaces & symbols");
});

test("runs JavaScript entry points with the current Node runtime", () => {
  const directory = mkdtempSync(join(tmpdir(), "pnpm entry "));
  try {
    const entry = join(directory, "pnpm.cjs");
    writeFileSync(entry, "process.stdout.write(process.argv[2]);");
    const [command, ...args] = pnpmCommand(["spaces & symbols"], entry);
    expect(execFileSync(command!, args, { encoding: "utf8" })).toBe("spaces & symbols");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
