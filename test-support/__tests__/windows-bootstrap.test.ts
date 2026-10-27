import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { waitFor } from "../wait.js";

test("accepts a UTF-8 BOM from the Windows supervisor before starting the command", async () => {
  const directory = mkdtempSync(join(tmpdir(), "test-gate-"));
  const resultFile = join(directory, "result.json");
  const configuration = join(directory, "command.json");
  writeFileSync(configuration, JSON.stringify({ command: process.execPath, args: ["-e", ""], resultFile }));
  const child = spawn(process.execPath, [resolve("scripts/test-process-child.mjs"), configuration], { stdio: ["pipe", "ignore", "pipe"] });
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr.on("data", data => { stderr += data; });
  try {
    child.stdin.end("\uFEFFstart\r\n");
    await waitFor(() => existsSync(resultFile) || child.exitCode !== null, Boolean, { label: "bootstrap result", timeoutMs: 5000 });
    expect(existsSync(resultFile), stderr).toBe(true);
    expect(JSON.parse(readFileSync(resultFile, "utf8")).code).toBe(0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    rmSync(directory, { recursive: true, force: true });
  }
});
