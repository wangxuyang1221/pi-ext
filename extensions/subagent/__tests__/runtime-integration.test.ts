import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { executeCommand } from "../src/command-executor.js";
import { TmuxRuntime as SourceTmuxRuntime } from "../src/tmux-runtime.js";
import { SubagentManager as SourceManager } from "../src/manager.js";
import { createSessionState, SessionStateStore } from "../src/state-store.js";
import { registerDirectChild } from "../src/ownership.js";

const TmuxRuntime: typeof SourceTmuxRuntime = process.env.PI_SUBAGENT_FIXTURE_DIST === "1" ? ((await import("../dist/tmux-runtime.js")).TmuxRuntime as unknown as typeof SourceTmuxRuntime) : SourceTmuxRuntime;

const Manager: typeof SourceManager = process.env.PI_SUBAGENT_FIXTURE_DIST === "1" ? ((await import("../dist/manager.js")).SubagentManager as unknown as typeof SourceManager) : SourceManager;
const tmux = ["/opt/homebrew/bin/tmux", "/usr/bin/tmux"].find(existsSync);
const fish = [process.env.PI_SUBAGENT_TEST_FISH, "/opt/homebrew/bin/fish", "/usr/bin/fish"].find((path): path is string => !!path && existsSync(path));
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

test.skipIf(!tmux || !fish).each(["new-session", "new-window"])("%s starts a child with its own pane under a fish default shell", async (mode) => {
  const root = await mkdtemp(join(process.cwd(), ".sa-fish-"));
  const wrapper = join(root, "tmux");
  const pids = new Set<number>();
  const alive = () => [...pids].filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
  try {
    const config = join(root, "tmux.conf");
    await writeFile(config, `set -g default-shell ${quote(fish!)}\nset -g remain-on-exit on\n`);
    await writeFile(wrapper, `#!/bin/sh\nexport LANG=en_US.UTF-8 HOME=${quote(root)} TMPDIR=${quote(root)} XDG_CONFIG_HOME=${quote(root)} XDG_DATA_HOME=${quote(root)} XDG_CACHE_HOME=${quote(root)}\nexec ${quote(tmux!)} -S ${quote(join(root, "socket"))} -f ${quote(config)} "$@"\n`, { mode: 0o700 });
    const keeper = await executeCommand(wrapper, ["new-session", "-d", "-s", mode === "new-window" ? "owned" : "keeper", "-P", "-F", "#{pid}\\t#{pane_pid}", "/bin/sleep", "60"]);
    assert.equal(keeper.code, 0, keeper.stderr);
    for (const value of keeper.stdout.trim().split("\\t")) pids.add(Number(value));
    assert.equal((await executeCommand(wrapper, ["show-options", "-gv", "default-shell"])).stdout.trim(), fish);
    const runtime = new TmuxRuntime({ execute: executeCommand, tmuxPath: wrapper, sessionName: "owned", transferDirectory: root });
    const output = join(root, "effective.json");
    const argument = `a 'quote' "double" $d ;`;
    const locator = await runtime.launch({ cwd: root, windowName: "child", command: process.execPath,
      args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({pid:process.pid,pane:process.env.TMUX_PANE,tmux:process.env.TMUX,arg:process.argv[1]}));setInterval(()=>{},1000)`, argument],
      environment: { PATH: "/usr/bin:/bin", HOME: root, PI_SUBAGENT_ID: "fish-child" } });
    pids.add(locator.panePid!);
    const deadline = performance.now() + 2000;
    while (!existsSync(output) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(existsSync(output), true, await runtime.capturePane(locator));
    const effective = JSON.parse(await readFile(output, "utf8"));
    assert.equal(effective.pane, locator.paneId);
    assert.equal(effective.pid, locator.panePid);
    assert.ok(effective.tmux.startsWith(join(root, "socket")));
    assert.equal(effective.arg, argument);
    assert.equal((await executeCommand(wrapper, ["show-options", "-gv", "default-shell"])).stdout.trim(), fish);
    await runtime.close(locator);
  } finally {
    const panes = await executeCommand(wrapper, ["list-panes", "-a", "-F", "#{pane_pid}"]).catch(() => undefined);
    if (panes?.code === 0) for (const value of panes.stdout.trim().split("\n")) pids.add(Number(value));
    await executeCommand(wrapper, ["kill-server"]).catch(() => undefined);
    const deadline = performance.now() + 2000;
    while (alive().length && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(alive(), []);
    assert.notEqual((await executeCommand(wrapper, ["list-sessions"])).code, 0);
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(!tmux)("manager single-target close removes a retained dead pane after list marks it interrupted", async () => {
  const root = await mkdtemp(join(process.cwd(), ".sa-real-"));
  const wrapper = join(root, "tmux");
  const pids = new Set<number>();
  const alive = () => [...pids].filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
  let manager: InstanceType<typeof Manager> | undefined;
  try {
    await writeFile(wrapper, `#!/bin/sh\nexport LANG=en_US.UTF-8\nexec '${tmux}' -S '${join(root, "socket")}' -f /dev/null "$@"\n`, { mode: 0o700 });
    const runtime = new TmuxRuntime({ execute: executeCommand, tmuxPath: wrapper, sessionName: "owned", transferDirectory: root });
    const locator = await runtime.launch({ cwd: root, windowName: "child", command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"], environment: { PATH: "/usr/bin:/bin", PI_SUBAGENT_ID: "instance", HOME: root } });
    pids.add(locator.panePid!); pids.add(locator.serverPid!);
    assert.equal((await executeCommand(wrapper, ["set-option", "-w", "-t", locator.windowId, "remain-on-exit", "on"])).code, 0);
    const store = new SessionStateStore(join(root, "state"));
    const child = createSessionState({ sessionId: "child", epoch: "ce", cwd: root, sessionFile: join(root, "child.jsonl"), now: "now",
      parent: { sessionId: "parent", epoch: "pe", registrationToken: "registration" },
      launch: { processInstanceId: "instance", cwd: root, sessionDir: root, displayName: "Child" },
      pid: locator.panePid, processInstanceId: "instance", tmux: locator });
    await store.save(registerDirectChild(createSessionState({ sessionId: "parent", epoch: "pe", cwd: root, sessionFile: join(root, "parent.jsonl"), now: "now" }), child, "now"));
    await store.save(child);
    manager = new Manager({ store, runtime, stateRoot: store.root, nativeSessionRoot: root, extensionPath: "/unused", piPath: "pi", environment: {} });
    process.kill(locator.panePid!, "SIGTERM");
    const deadline = performance.now() + 2000;
    while ((await runtime.observe(locator)).process !== "exited" && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    const listed = await manager.list("parent");
    assert.equal(listed.agents[0]?.status, "interrupted");
    assert.equal((await runtime.observe(locator)).terminal, "present");
    const closed = await manager.close("parent", "child");
    assert.equal(closed[0]?.status, "closed");
    assert.equal((await runtime.observe(locator)).terminal, "absent");
    assert.equal(await store.load("child"), undefined);
    assert.deepEqual((await store.load("parent"))?.processes, {});
  } finally {
    await manager?.releaseNamespace("parent");
    await executeCommand(wrapper, ["kill-server"]).catch(() => undefined);
    const deadline = performance.now() + 2000;
    while (alive().length && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(alive(), []);
    assert.notEqual((await executeCommand(wrapper, ["list-sessions"])).code, 0);
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(!tmux)("a restarted tmux server cannot make an old pane locator own a replacement", async () => {
  const root = await mkdtemp(join(process.cwd(), ".sa-real-"));
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
  const root = await mkdtemp(join(process.cwd(), ".sa-real-"));
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
