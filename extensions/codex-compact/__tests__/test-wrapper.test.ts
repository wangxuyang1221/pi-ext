import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { test, vi } from "vitest";
import { runTestProcess } from "../../../scripts/test-process.mjs";

const wrapper = resolve("scripts/test.mjs");
const pnpm = process.env.npm_execpath!;
const baseEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG"].includes(key.toUpperCase())));

function fixture(body: string) {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp/test-wrapper-"));
  const result = join(root, "result.json");
  const file = join(root, "probe.test.ts");
  writeFileSync(file, `import {test} from 'vitest';\nimport {writeFileSync} from 'node:fs';\n${body.replaceAll("RESULT_FILE", JSON.stringify(result))}\n`);
  const config = join(root, "vitest.config.mjs");
  writeFileSync(config, `export default {test:{include:[${JSON.stringify(file)}],testTimeout:60000}};`);
  return { root, result, config };
}

async function run(config: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [wrapper, "--config", config], {
    env: { ...baseEnv(), npm_execpath: pnpm, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  let output = "";
  child.stdout!.on("data", data => { output += data; });
  child.stderr!.on("data", data => { output += data; });
  const exited = once(child, "exit");
  return { child, exited, output: () => output };
}

async function finish(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await Promise.race([once(child, "exit"), delay(5000)]);
  }
}

test("isolates every supported external AWS credential source while preserving offline test switches", async () => {
  const keys = ["OPENAI_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS", "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE", "AWS_PROFILE",
    "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
    "PI_MCP_CONFIG", "PI_SUBAGENT_PARENT", "PI_CODING_AGENT_SESSION_DIR"];
  const sdk = pathToFileURL(resolve("node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href;
  const f = fixture(`import {ModelRuntime} from ${JSON.stringify(sdk)};
    test('records the isolated environment',async()=>{
      const runtime=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
      writeFileSync(RESULT_FILE,JSON.stringify({
        inherited:${JSON.stringify(keys)}.filter(key=>process.env[key]!==undefined),
        bedrockAuth:!!(await runtime.getAuth('amazon-bedrock')),
        switches:[process.env.PI_SUBAGENT_ISOLATED_INTEGRATION,process.env.PI_SUBAGENT_FIXTURE_DIST],
        home:process.env.HOME,agentDir:process.env.PI_CODING_AGENT_DIR,path:!!process.env.PATH
      }));
    });`);
  // All values are inert sentinels. No real identity file or endpoint is supplied.
  const sentinels = Object.fromEntries(keys.map(key => [key, key.includes("URI") ? "http://127.0.0.1:1" : join(f.root, "nonexistent-credential")]));
  const execution = await run(f.config, { ...sentinels, PI_SUBAGENT_ISOLATED_INTEGRATION: "1", PI_SUBAGENT_FIXTURE_DIST: "1" });
  try {
    const [code] = await execution.exited;
    assert.equal(code, 0, execution.output());
    const result = JSON.parse(readFileSync(f.result, "utf8"));
    assert.deepEqual(result.inherited, []);
    assert.equal(result.bedrockAuth, false);
    assert.deepEqual(result.switches, ["1", "1"]);
    assert.equal(result.path, true);
    assert.ok(result.home.startsWith(resolve(".tmp") + "/") || result.home.startsWith(resolve(".tmp") + "\\"));
    assert.equal(existsSync(result.home), false);
    assert.equal(existsSync(result.agentDir), false);
  } finally { await finish(execution.child); rmSync(f.root, { recursive: true, force: true }); }
}, 30000);

test.each([
  { mode: "SIGINT", workers: 1 },
  { mode: "SIGTERM", workers: 6 },
  { mode: "early-exit", workers: 2 },
])("cleans $workers uncooperative descendants after $mode without serial grace periods", async ({ mode, workers }) => {
  const f = fixture("");
  const runner = join(f.root, "pnpm.mjs");
  const worker = join(f.root, "worker.mjs");
  writeFileSync(worker, `import {createServer} from 'node:net';
    process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});
    const server=createServer(socket=>socket.end());
    server.listen(0,'127.0.0.1',()=>process.send({pid:process.pid,port:server.address().port}));`);
  writeFileSync(runner, `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
    process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});
    const ready=[];
    for(let i=0;i<${workers};i++) {
      const child=spawn(process.execPath,[${JSON.stringify(worker)}],{stdio:['ignore','ignore','ignore','ipc']});
      child.once('message',data=>{ready.push(data);if(ready.length===${workers}) {
        writeFileSync(${JSON.stringify(f.result)},JSON.stringify({pid:process.pid,home:process.env.HOME,workers:ready}));
        ${mode === "early-exit" ? "process.exit(0);" : ""}
      }});
    }`);
  const execution = await run(f.config, { npm_execpath: runner });
  let state: { pid: number; home: string; workers: { pid: number; port: number }[] } | undefined;
  try {
    await until(() => existsSync(f.result), "Process fixture did not start");
    state = JSON.parse(readFileSync(f.result, "utf8"));
    const started = performance.now();
    if (mode !== "early-exit") {
      execution.child.kill(mode as NodeJS.Signals);
      // Allow the first handler to run; a repeat must not restart its grace timer.
      if (process.platform !== "win32") { await delay(100); execution.child.kill(mode as NodeJS.Signals); }
    }
    const [code] = await Promise.race([execution.exited, delay(10000).then(() => { throw new Error("Cleanup exceeded its shared deadline"); })]);
    if (mode === "early-exit") assert.equal(code, 0, execution.output());
    else assert.notEqual(code, 0);
    // One 2 s grace + one 3 s verification window, independent of descendant count.
    assert.ok(performance.now() - started < 8000, "Cleanup waited a grace period per descendant");
    await until(() => state!.workers.every(worker => !alive(worker.pid)), "Descendants survived cleanup");
    for (const worker of state!.workers) assert.equal(await portOpen(worker.port), false);
    await until(() => !existsSync(state!.home), "Home remained after cleanup");
  } finally {
    if (state) {
      if (process.platform !== "win32") { try { process.kill(-state.pid, "SIGKILL"); } catch {} }
      for (const worker of state.workers) if (alive(worker.pid)) { try { process.kill(worker.pid, "SIGKILL"); } catch {} }
    }
    await finish(execution.child);
    if (state) { for (const worker of state.workers) await until(async () => !(await portOpen(worker.port)), "Leaked fixture port"); rmSync(dirname(state.home), { recursive: true, force: true }); }
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30000);

test("preserves a failing runner exit code and removes its isolated directory", async () => {
  const f = fixture("");
  const runner = join(f.root, "pnpm.mjs");
  writeFileSync(runner, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(f.result)},JSON.stringify({home:process.env.HOME}));process.exit(7);`);
  const execution = await run(f.config, { npm_execpath: runner });
  try {
    assert.equal((await execution.exited)[0], 7, execution.output());
    assert.equal(existsSync(JSON.parse(readFileSync(f.result, "utf8")).home), false);
  } finally { await finish(execution.child); rmSync(f.root, { recursive: true, force: true }); }
});

test("removes the isolated directory when the command cannot start", async () => {
  mkdirSync(".tmp", { recursive: true });
  const directory = mkdtempSync(resolve(".tmp/test-spawn-error-"));
  try {
    try {
      const code = await runTestProcess(join(directory, "missing-executable"), [], {
        directory, env: { ...baseEnv(), HOME: directory, TMP: directory, TEMP: directory, TMPDIR: directory },
      });
      assert.notEqual(code, 0);
    } catch (error: any) { assert.equal(error.code, "ENOENT"); }
    assert.equal(existsSync(directory), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("retains diagnostics when process ownership cannot be verified", async () => {
  mkdirSync(".tmp", { recursive: true });
  const directory = mkdtempSync(resolve(".tmp/test-cleanup-error-"));
  const original = process.kill;
  const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (pid < 0) throw Object.assign(new Error("Cannot inspect owned group"), { code: "EPERM" });
    return original(pid, signal);
  });
  try {
    await assert.rejects(runTestProcess(process.execPath, ["-e", ""], { directory, env: baseEnv() }), /Cannot inspect owned group/);
    assert.equal(existsSync(directory), true);
  } finally { kill.mockRestore(); rmSync(directory, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("waits for confirmed group disappearance after transient EPERM probes", async () => {
  const directory = mkdtempSync(resolve(".tmp/test-transient-probe-"));
  const original = process.kill;
  let denied = 0, confirmedAbsent = false;
  const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (pid < 0 && signal === 0 && denied < 3) {
      denied++;
      throw Object.assign(new Error("Group probe temporarily unavailable"), { code: "EPERM" });
    }
    try { return original(pid, signal); }
    catch (error: any) {
      if (pid < 0 && signal === 0 && error.code === "ESRCH") {
        assert.equal(existsSync(directory), true, "Directory must remain until absence is confirmed");
        confirmedAbsent = true;
      }
      throw error;
    }
  });
  try {
    assert.equal(await runTestProcess(process.execPath, ["-e", ""], { directory, env: baseEnv() }), 0);
    assert.equal(denied, 3);
    assert.equal(confirmedAbsent, true);
    assert.equal(existsSync(directory), false);
  } finally { kill.mockRestore(); rmSync(directory, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("retains the directory when EPERM probes never confirm group disappearance", async () => {
  const directory = mkdtempSync(resolve(".tmp/test-persistent-probe-"));
  const original = process.kill;
  const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (pid < 0 && signal === 0) throw Object.assign(new Error("Group probe unavailable"), { code: "EPERM" });
    return original(pid, signal);
  });
  try {
    await assert.rejects(runTestProcess(process.execPath, ["-e", ""], { directory, env: baseEnv() }), /Owned test process group .* did not stop/);
    assert.equal(existsSync(directory), true);
  } finally { kill.mockRestore(); rmSync(directory, { recursive: true, force: true }); }
});

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const portOpen = (port: number) => new Promise<boolean>(resolve => {
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});
async function until(check: () => boolean | Promise<boolean>, message: string, milliseconds = 10000) {
  const deadline = performance.now() + milliseconds;
  while (!(await check())) { assert.ok(performance.now() < deadline, message); await delay(20); }
}

test("stops real Vitest workers and listeners before removing their home on cancellation", async () => {
  const f = fixture(`import {createServer} from 'node:net';
    test('holds a task-owned listener',async()=>{
      const server=createServer(socket=>socket.end());
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      writeFileSync(RESULT_FILE,JSON.stringify({pid:process.pid,port:server.address().port,home:process.env.HOME}));
      try {await new Promise(resolve=>setTimeout(resolve,55000));}
      finally {await new Promise(resolve=>server.close(resolve));}
    });`);
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const execution = await run(f.config);
  let state: { pid: number; port: number; home: string } | undefined;
  let group: number | undefined;
  try {
    await until(() => existsSync(f.result), execution.output());
    state = JSON.parse(readFileSync(f.result, "utf8"));
    if (process.platform !== "win32") group = Number(execFileSync("ps", ["-o", "pgid=", "-p", String(state!.pid)], { encoding: "utf8" }).trim());
    execution.child.kill("SIGTERM");
    const result = await Promise.race([execution.exited, delay(10000).then(() => { throw new Error("Wrapper cancellation did not finish"); })]);
    assert.notEqual(result[0], 0);
    if (process.platform !== "win32") assert.equal(result[0], 143, `Wrapper did not complete SIGTERM cleanup:\n${execution.output()}`);
    await until(() => !alive(state!.pid), "Vitest worker survived wrapper cancellation", 1000);
    assert.equal(await portOpen(state!.port), false);
    await until(() => !existsSync(state!.home), `Isolated home survived verified cleanup:\n${execution.output()}`);
    assert.equal(alive(unrelated.pid!), true, "Unrelated process was terminated");
  } finally {
    // Independent supervision also cleans up the intentionally failing Red run.
    if (group) { try { process.kill(-group, "SIGKILL"); } catch {} }
    if (process.platform === "win32" && state && alive(state.pid)) {
      try { execFileSync("taskkill", ["/PID", String(state.pid), "/T", "/F"]); } catch {}
    }
    await finish(execution.child); await finish(unrelated);
    if (state) { await until(async () => !(await portOpen(state!.port)), "Probe port survived supervision"); rmSync(dirname(state.home), { recursive: true, force: true }); }
    rmSync(f.root, { recursive: true, force: true });
  }
}, 30000);
