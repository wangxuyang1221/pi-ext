import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { executeCommand } from "../src/command-executor.js";
import { TmuxRuntime as SourceTmuxRuntime } from "../src/tmux-runtime.js";

const TmuxRuntime = process.env.PI_SUBAGENT_FIXTURE_DIST === "1" ? (await import("../dist/tmux-runtime.js")).TmuxRuntime : SourceTmuxRuntime;

const tmux = ["/opt/homebrew/bin/tmux", "/usr/bin/tmux"].find(existsSync);

test.skipIf(!tmux)("a restarted tmux server cannot make an old pane locator own a replacement", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-runtime-real-"));
  const wrapper = join(root, "tmux");
  const pids = new Set<number>();
  const alive = () => [...pids].filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
  try {
    await writeFile(wrapper, `#!/bin/sh\nexport LANG=en_US.UTF-8\nexec '${tmux}' -S '${join(root, "socket")}' -f /dev/null "$@"\n`, { mode: 0o700 });
    const runtime = new TmuxRuntime({ execute: executeCommand, tmuxPath: wrapper, sessionName: "owned", transferDirectory: root });
    const launch = async (id: string) => {
      const locator = await runtime.launch({ cwd: root, windowName: "child", command: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"], environment: { PATH: "/usr/bin:/bin", PI_SUBAGENT_ID: id, HOME: root } });
      pids.add(locator.panePid!); pids.add(locator.serverPid!);
      return locator;
    };
    const previous = await launch("previous");
    await executeCommand(wrapper, ["kill-server"]);
    let deadline = performance.now() + 2000;
    while (alive().length && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(alive(), []);
    const replacement = await launch("replacement");
    assert.equal(replacement.paneId, previous.paneId);
    assert.notEqual(replacement.serverPid, previous.serverPid);
    assert.equal((await runtime.observe(previous)).identity, "mismatch");
    await assert.rejects(runtime.close(previous), /identity mismatch/u);
    assert.equal((await runtime.observe(replacement)).process, "alive");
    await runtime.close(replacement);
  } finally {
    await executeCommand(wrapper, ["kill-server"]).catch(() => undefined);
    const deadline = performance.now() + 2000;
    while (alive().length && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(alive(), []);
    assert.notEqual((await executeCommand(wrapper, ["list-sessions"])).code, 0);
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(!tmux).each(["live", "dead"])("real tmux rename retains identity and removes a %s pane on close", async (mode) => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-runtime-real-"));
  const socket = join(root, "socket");
  const wrapper = join(root, "tmux");
  let pid: number | undefined;
  try {
    await writeFile(wrapper, `#!/bin/sh\nexport LANG=en_US.UTF-8\nexec '${tmux}' -S '${socket}' -f /dev/null "$@"\n`, { mode: 0o700 });
    const runtime = new TmuxRuntime({ execute: executeCommand, tmuxPath: wrapper, sessionName: "owned", transferDirectory: root });
    const locator = await runtime.launch({ cwd: root, windowName: "child", command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"], environment: { PATH: "/usr/bin:/bin", PI_SUBAGENT_ID: "instance-a", HOME: root } });
    pid = locator.panePid;
    assert.equal(locator.processInstanceId, "instance-a");
    assert.ok(locator.serverPid);
    await executeCommand(wrapper, ["rename-session", "-t", "owned", "renamed"]);
    const observation = await runtime.observe(locator);
    assert.equal(observation.identity, "matched");
    assert.equal(observation.process, "alive");
    assert.equal(observation.locator?.sessionName, "renamed");
    if (mode === "dead") {
      assert.equal((await executeCommand(wrapper, ["set-option", "-w", "-t", locator.windowId, "remain-on-exit", "on"])).code, 0);
      process.kill(pid!, "SIGTERM");
      const stoppedBy = performance.now() + 2000;
      while ((await runtime.observe(locator)).process !== "exited" && performance.now() < stoppedBy) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal((await runtime.observe(locator)).process, "exited");
      assert.equal((await runtime.observe(locator)).terminal, "present");
    }
    await runtime.close(locator);
    const deadline = performance.now() + 2000;
    while ((await runtime.observe(locator)).process !== "exited" && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    const closed = await runtime.observe(locator);
    assert.equal(closed.process, "exited");
    assert.equal(closed.terminal, "absent");
    assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
  } finally {
    await executeCommand(wrapper, ["kill-server"]).catch(() => undefined);
    if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
    const deadline = performance.now() + 2000;
    while ((await executeCommand(wrapper, ["list-sessions"]).catch(() => ({ code: 1 }))).code === 0 && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.notEqual((await executeCommand(wrapper, ["list-sessions"])).code, 0);
    await rm(root, { recursive: true, force: true });
  }
});
