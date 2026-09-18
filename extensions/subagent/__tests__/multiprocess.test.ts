import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "vitest";
import { executeCommand } from "../src/command-executor.js";
import { createSessionState, SessionStateStore } from "../src/state-store.js";

async function until(path: string): Promise<void> {
  const deadline = performance.now() + 3000;
  while (!existsSync(path)) {
    if (performance.now() > deadline) throw new Error(`Missing process barrier: ${path}`);
    await delay(5);
  }
}

test("independent OS writers cannot erase a completed generation", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-process-test-"));
  const controller = new AbortController();
  const running: Promise<unknown>[] = [];
  try {
    const build = await executeCommand(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", "extensions/subagent/tsconfig.json",
      "--outDir", join(root, "build"), "--declaration", "false", "--declarationMap", "false", "--sourceMap", "false"], { timeout: 15000 });
    assert.equal(build.code, 0, build.stdout + build.stderr);
    const store = new SessionStateStore(join(root, "state"));
    await store.save(createSessionState({ sessionId: "child", epoch: "e", cwd: root, sessionFile: join(root, "native.jsonl"), now: "now" }));
    const script = join(root, "writer.mjs");
    await writeFile(script, `import {SessionStateStore} from ${JSON.stringify(pathToFileURL(join(root, "build", "state-store.js")).href)};
import {writeFile} from 'node:fs/promises'; import {existsSync} from 'node:fs'; import {setTimeout as delay} from 'node:timers/promises';
const [root,role]=process.argv.slice(2); const store=new SessionStateStore(root+'/state');
await writeFile(root+'/'+role+'-started',String(process.pid));
await store.update('child',async state=>{
 if(role==='parent'){await writeFile(root+'/parent-read','ready');while(!existsSync(root+'/release'))await delay(5);state.runtime.status='closing';}
 else {state.runtime.generation=1;state.runtime.settledGeneration=1;}
 return state;
}); console.log(process.pid);`);
    const parent = executeCommand(process.execPath, [script, root, "parent"], { timeout: 5000, signal: controller.signal });
    running.push(parent);
    await until(join(root, "parent-read"));
    const child = executeCommand(process.execPath, [script, root, "child"], { timeout: 5000, signal: controller.signal });
    running.push(child);
    await until(join(root, "child-started"));
    await writeFile(join(root, "release"), "go");
    const results = await Promise.all([parent, child]);
    for (const result of results) { assert.equal(result.code, 0, result.stderr); assert.notEqual(Number(result.stdout), process.pid); }
    assert.notEqual(results[0].stdout, results[1].stdout);
    assert.equal((await store.load("child"))?.runtime.settledGeneration, 1);
  } finally {
    controller.abort();
    await Promise.allSettled(running);
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
