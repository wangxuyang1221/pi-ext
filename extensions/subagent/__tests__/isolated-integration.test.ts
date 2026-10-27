import { waitFor } from "../../../test-support/wait.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "vitest";
import { SubagentManager } from "../src/manager.js";
import { createSessionState, SessionStateStore } from "../src/state-store.js";
import { TmuxRuntime, type CommandExecution } from "../src/tmux-runtime.js";

const exec = promisify(execFile);
const enabled = process.env.PI_SUBAGENT_ISOLATED_INTEGRATION === "1";
const quote = (text: string) => `'${text.replaceAll("'", `'"'"'`)}'`;

async function until(check: () => boolean | Promise<boolean>, timeout = 10_000): Promise<void> {
  await waitFor(check, Boolean, { label: "isolated fixture", timeoutMs: timeout });
}

test.skipIf(!enabled)("uses real Pi and an offline provider on an isolated tmux socket", async () => {
  const root = await mkdtemp(join(process.cwd(), ".sa-it-"));
  const home = join(root, "home");
  const agentDir = join(home, ".pi", "agent");
  const socket = join(root, "tmux.sock");
  const tmuxWrapper = join(root, "tmux");
  const piWrapper = join(root, "pi");
  const compiled = process.env.PI_SUBAGENT_FIXTURE_DIST === "1";
  const Store: typeof SessionStateStore = compiled ? ((await import("../dist/state-store.js")).SessionStateStore as unknown as typeof SessionStateStore) : SessionStateStore;
  const Manager: typeof SubagentManager = compiled ? ((await import("../dist/manager.js")).SubagentManager as unknown as typeof SubagentManager) : SubagentManager;
  const Runtime: typeof TmuxRuntime = compiled ? ((await import("../dist/tmux-runtime.js")).TmuxRuntime as unknown as typeof TmuxRuntime) : TmuxRuntime;
  const store = new Store(join(root, "state"));
  const childPids = new Set<number>();
  const env = { PATH: process.env.PATH!, HOME: home, SHELL: "/bin/sh", TERM: "xterm-256color", LANG: "en_US.UTF-8",
    TMPDIR: root, PI_CODING_AGENT_DIR: agentDir, PI_SUBAGENT_TMUX_PATH: tmuxWrapper,
    PI_SUBAGENT_FIXTURE_DIST: compiled ? "1" : "0" };
  const execute: CommandExecution = async (command, args) => {
    try {
      const result = await exec(command, args, { env, cwd: root, timeout: 5000 });
      return { code: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error: any) {
      if (typeof error.code !== "number") throw error;
      return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
    }
  };
  let manager: SubagentManager | undefined;
  try {
    const tmuxPath = (await exec("/usr/bin/which", ["tmux"])).stdout.trim();
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
    await writeFile(tmuxWrapper, `#!/bin/sh\nexec ${quote(tmuxPath)} -S ${quote(socket)} -f /dev/null "$@"\n`);
    const cli = process.env.PI_SUBAGENT_TEST_CLI ?? resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    await writeFile(piWrapper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} --no-extensions --no-context-files --no-skills --no-prompt-templates --no-themes --no-builtin-tools --no-approve "$@"\n`);
    await chmod(tmuxWrapper, 0o700);
    await chmod(piWrapper, 0o700);
    const runtime = new Runtime({ execute, tmuxPath: tmuxWrapper, sessionName: "isolated-subagent", transferDirectory: join(root, "transfer") });
    const originalLaunch = runtime.launch.bind(runtime);
    runtime.launch = async (options) => {
      const locator = await originalLaunch(options);
      if (locator.panePid) childPids.add(locator.panePid);
      const server = await execute(tmuxWrapper, ["display-message", "-p", "#{pid}"]);
      const serverPid = Number(server.stdout.trim());
      if (server.code === 0 && Number.isSafeInteger(serverPid) && serverPid > 0) childPids.add(serverPid);
      return locator;
    };
    await store.save(createSessionState({ sessionId: "parent", epoch: "parent-epoch", cwd: root,
      sessionFile: join(root, "parent.jsonl"), now: new Date().toISOString() }));
    manager = new Manager({ store, runtime, stateRoot: store.root, nativeSessionRoot: join(root, "native"),
      extensionPath: resolve("extensions/subagent/__tests__/fixtures/offline-child.ts"), piPath: piWrapper,
      environment: env, pollIntervalMs: 20, registrationTimeoutMs: 15000, promptAckTimeoutMs: 5000 });
    const child = await manager.spawn("parent", { task: "hold:old", model: { provider: "subagent-fixture", id: "deterministic" } }, { cwd: root });
    await until(() => existsSync(join(home, "started-old")));
    const originalSend = runtime.sendPrompt.bind(runtime);
    let forceRace = true;
    runtime.sendPrompt = async (locator, text, delivery) => {
      if (forceRace) {
        forceRace = false;
        await writeFile(join(home, "release-old"), "release");
        await until(async () => (await store.load(child.agentId))?.runtime.settledGeneration === 1);
      }
      await originalSend(locator, text, delivery);
    };
    const next = await manager.prompt("parent", child.agentId, "hold:new", "follow_up");
    await until(() => existsSync(join(home, "started-new")));
    assert.equal((await manager.wait("parent", child.agentId, { afterSettled: next.agent.settledCursor, timeoutMs: 0 })).outcome, "timeout");
    const queued = await manager.prompt("parent", child.agentId, "queued work", "follow_up");
    assert.equal((await manager.wait("parent", child.agentId, { afterSettled: queued.agent.settledCursor, timeoutMs: 0 })).outcome, "timeout");
    const steered = await manager.prompt("parent", child.agentId, "steered work", "steer");
    assert.equal((await manager.wait("parent", child.agentId, { afterSettled: steered.agent.settledCursor, timeoutMs: 0 })).outcome, "timeout");
    await writeFile(join(home, "release-new"), "release");
    assert.equal((await manager.wait("parent", child.agentId, { afterSettled: queued.agent.settledCursor, timeoutMs: 10000 })).outcome, "settled");
    assert.equal((await manager.wait("parent", child.agentId, { afterSettled: steered.agent.settledCursor, timeoutMs: 10000 })).outcome, "settled");
    for (const delivery of ["steer", "follow_up"] as const) {
      const generation = (await store.load(child.agentId))!.runtime.generation;
      runtime.sendPrompt = async (locator, text, mode) => {
        await originalSend(locator, text, mode);
        await until(async () => (await store.load(child.agentId))!.runtime.settledGeneration > generation);
      };
      const fast = await manager.prompt("parent", child.agentId, "fast work", delivery);
      assert.equal((await manager.wait("parent", child.agentId, { afterSettled: fast.agent.settledCursor, timeoutMs: 0 })).outcome, "settled");
    }
    runtime.sendPrompt = originalSend;
    const failure = await manager.prompt("parent", child.agentId, "fail-fixture", "steer");
    const failed = await manager.wait("parent", child.agentId, { afterSettled: failure.agent.settledCursor, timeoutMs: 10000 });
    assert.equal(failed.outcome, "settled");
    assert.ok(failed.activity.some((item) => item.kind === "assistant" && item.errorMessage?.includes("offline fixture error")));
    assert.match(await readFile(child.sessionFile, "utf8"), /subagent_delivery/u);
    await store.update(child.agentId, (state) => ({ ...state, runtime: { ...state.runtime, status: "interrupted" } }));
    await manager.close("parent", child.agentId);
    assert.equal(await store.load(child.agentId), undefined);
    assert.equal(existsSync(child.sessionFile), true);
  } finally {
    await manager?.close("parent", "all").catch(() => undefined);
    if (existsSync(tmuxWrapper)) await execute(tmuxWrapper, ["kill-server"]).catch(() => undefined);
    for (const pid of childPids) {
      await until(() => {
        try { process.kill(pid, 0); return false; } catch { return true; }
      }, 5000);
    }
    if (existsSync(tmuxWrapper)) {
      const listener = await execute(tmuxWrapper, ["list-sessions"]);
      assert.notEqual(listener.code, 0);
      console.log(JSON.stringify({ cleanup: { socket, pids: [...childPids], livePids: [], socketUnavailable: true } }));
    }
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
