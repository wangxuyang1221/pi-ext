import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import * as plugin from "../../../scripts/codex-compact-quality-plugin.mjs";
import { fingerprintWorkspace } from "../../../scripts/codex-compact-quality-tools.mjs";

test("runs a frozen plugin entry in an isolated Pi process and captures transport without headers", async () => {
  expect(typeof plugin.runPluginCompaction).toBe("function");
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-plugin-"));
  let calls = 0;
  const server = http.createServer((request, response) => { calls++; request.resume(); response.setHeader("content-type", "application/json"); response.end('{}'); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const port = (server.address() as { port: number }).port;
    const moduleDirectory = path.join(root, "modules"); fs.mkdirSync(moduleDirectory);
    fs.writeFileSync(path.join(moduleDirectory, "remote-compaction.js"), `export async function createNativeCheckpoint(params) {
      if(params.ctx.thinkingLevel!=="medium"||params.model.id!=="gpt-5.6-sol") throw new Error("Wrong model context");
      const response=await fetch("http://127.0.0.1:${port}/codex/responses",{method:"POST",headers:{authorization:"Bearer do-not-record-test-secret"},body:JSON.stringify({model:params.model.id,instructions:params.ctx.getSystemPrompt(),reasoning:{effort:"medium"},input:[...params.input,{type:"compaction_trigger"}]})});await response.json();
      return {details:{kind:"openai-codex-native-compaction",version:2,modelKey:"openai-codex:openai-codex-responses:gpt-5.6-sol",replacementHistory:[{type:"compaction",encrypted_content:"test-only-data"}]},usage:{input:100,output:10,cacheRead:0,cacheWrite:0,totalTokens:110}};
    }`);
    const sourceWorkspace = path.join(root, "source"); fs.mkdirSync(sourceWorkspace); fs.writeFileSync(path.join(sourceWorkspace, "file.txt"), "baseline");
    const directory = path.join(root, "job"); fs.mkdirSync(directory);
    const credentialFile = path.join(root, "credential.json"); fs.writeFileSync(credentialFile, "{}");
    const result = await plugin.runPluginCompaction({ directory, moduleDirectory, expectedModuleFingerprint: fingerprintWorkspace(moduleDirectory), sourceWorkspace, expectedWorkspaceFingerprint: fingerprintWorkspace(sourceWorkspace), credentialFile, history: [], instructions: "instructions", executionTimeoutMs: 10000 });
    expect(result.usage.input).toBe(100); expect(result.requestCount).toBe(1); expect(calls).toBe(1);
    expect(result.piVersion).toBe("0.87.0"); expect(result.replacementHistory[0].type).toBe("compaction");
    expect(fs.existsSync(path.join(directory, "plugin/pi-home/auth.json"))).toBe(false);
    const capture = fs.readFileSync(path.join(directory, "plugin/request-0.json"), "utf8");
    expect(capture).not.toContain("authorization"); expect(capture).not.toContain("do-not-record-test-secret");
    expect(JSON.parse(fs.readFileSync(path.join(directory, "plugin/cleanup.json"), "utf8")).groupStopped).toBe(true);
    expect(fs.readFileSync(path.join(sourceWorkspace, "file.txt"), "utf8")).toBe("baseline");
  } finally {
    const stderr = path.join(root, "job/plugin/stderr.log");
    if (fs.existsSync(stderr)) fs.copyFileSync(stderr, path.join(process.cwd(), ".tmp/codex-quality", `${path.basename(root)}.stderr.log`), fs.constants.COPYFILE_EXCL);
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true });
  }
}, 15000);

function fixture(code: string) {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-plugin-failure-"));
  const moduleDirectory = path.join(root, "modules"); fs.mkdirSync(moduleDirectory);
  fs.writeFileSync(path.join(moduleDirectory, "remote-compaction.js"), code);
  const sourceWorkspace = path.join(root, "source"); fs.mkdirSync(sourceWorkspace);
  const directory = path.join(root, "job"); fs.mkdirSync(directory);
  const credentialFile = path.join(root, "credentials.json"); fs.writeFileSync(credentialFile, "{}");
  return { root, options: { directory, moduleDirectory, expectedModuleFingerprint: fingerprintWorkspace(moduleDirectory), sourceWorkspace, expectedWorkspaceFingerprint: fingerprintWorkspace(sourceWorkspace), credentialFile, history: [], instructions: "instructions" } };
}

test("preserves a native preflight refusal without bypassing it or inventing a model request", async () => {
  const { root, options } = fixture('export async function createNativeCheckpoint(){throw new Error("Original entry refused oversized input");}');
  try {
    await expect(plugin.runPluginCompaction(options)).rejects.toThrow(/worker failed/);
    const failure = JSON.parse(fs.readFileSync(path.join(options.directory, "plugin/failure.json"), "utf8"));
    expect(failure.workerFailure.message).toBe("Original entry refused oversized input");
    expect(failure.workerFailure.requestCount).toBe(0);
    expect(fs.existsSync(path.join(options.directory, "plugin/result.json"))).toBe(false);
    expect(fs.existsSync(path.join(options.directory, "plugin/pi-home/auth.json"))).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("rejects changed module snapshots before opening credentials or starting a worker", async () => {
  const { root, options } = fixture('export async function createNativeCheckpoint(){}');
  try {
    fs.appendFileSync(path.join(options.moduleDirectory, "remote-compaction.js"), "\n// Changed snapshot\n");
    await expect(plugin.runPluginCompaction(options)).rejects.toThrow(/fingerprint/);
    expect(fs.existsSync(path.join(options.directory, "plugin"))).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("terminates an unresponsive worker at the execution deadline and verifies its process group", async () => {
  const { root, options } = fixture('export async function createNativeCheckpoint(){setInterval(()=>{},1000);await new Promise(()=>{});}');
  try {
    await expect(plugin.runPluginCompaction({ ...options, executionTimeoutMs: 800 })).rejects.toThrow();
    const cleanup = JSON.parse(fs.readFileSync(path.join(options.directory, "plugin/cleanup.json"), "utf8"));
    expect(cleanup.groupStopped).toBe(true);
    expect(() => process.kill(-cleanup.pid, 0)).toThrow();
    expect(fs.existsSync(path.join(options.directory, "plugin/pi-home/auth.json"))).toBe(false);
    expect(fs.existsSync(path.join(options.directory, "plugin/result.json"))).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 10000);
