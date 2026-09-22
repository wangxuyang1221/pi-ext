import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, vi } from "vitest";
import { privateEnvironmentScript, providerEnvironment } from "../src/auth-environment.js";
import { TmuxRuntime } from "../src/tmux-runtime.js";
import { executeCommand } from "../src/command-executor.js";

test("selects only the chosen provider's configured environment keys", async () => {
  assert.deepEqual(await providerEnvironment("deepseek/deepseek-flash", { DEEPSEEK_API_KEY: "key", OPENAI_API_KEY: "other" }), { DEEPSEEK_API_KEY: "key" });
  assert.deepEqual(await providerEnvironment("openai-codex/gpt-6-astra", { DEEPSEEK_API_KEY: "key" }), {});
});

test("does not import ambient credentials outside the explicitly supplied environment", async () => {
  vi.stubEnv("DEEPSEEK_API_KEY", "ambient");
  try { assert.deepEqual(await providerEnvironment("deepseek/deepseek-flash", {}), {}); }
  finally { vi.unstubAllEnvs(); }
});

test("hands authentication to the child without putting values in tmux arguments", async () => {
  const root = await mkdtemp(join(process.cwd(), ".sa-auth-transfer-"));
  const key = "fake'key\n$(exit 92)`exit 93`";
  const path = join(root, "auth.sh");
  const calls: string[][] = [];
  const runtime = new TmuxRuntime({ execute: async (_command, args) => {
    calls.push(args);
    return args[0] === "has-session" ? { code: 1, stdout: "", stderr: "" }
      : { code: 0, stdout: "test\t@1\t%1\t123\n", stderr: "" };
  }, tmuxPath: "tmux", sessionName: "test", transferDirectory: root });
  try {
    await writeFile(path, privateEnvironmentScript({ DEEPSEEK_API_KEY: key }), { mode: 0o600 });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await runtime.launch({ cwd: root, command: process.execPath, args: ["-e", "console.log(JSON.stringify({key:process.env.DEEPSEEK_API_KEY,other:process.env.OPENAI_API_KEY}))"],
      windowName: "test", environment: {}, privateEnvironmentFile: path });
    assert.equal(JSON.stringify(calls).includes(key), false);
    const result = await executeCommand("/bin/sh", ["-c", calls.at(-1)!.at(-1)!]);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), { key });
    await assert.rejects(readFile(path), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
