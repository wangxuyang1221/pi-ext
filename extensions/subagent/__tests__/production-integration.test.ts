import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";
import { HERO_NAMES } from "../src/hero-names.js";
import subagentExtension from "../src/index.js";
import { executeCommand } from "../src/command-executor.js";
import { SessionStateStore } from "../src/state-store.js";

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
const enabled = process.env.PI_SUBAGENT_ISOLATED_INTEGRATION === "1";
const fish = [process.env.PI_SUBAGENT_TEST_FISH, "/opt/homebrew/bin/fish", "/usr/bin/fish"].find((path): path is string => !!path && existsSync(path));

for (const mode of ["immediate", "delayed", "fish", "full-package-fast", "full-package-delayed", "auth-env", "auth-stored", "auth-both", "auth-missing"] as const) {
test.skipIf(!enabled || (mode === "fish" && !fish))(`production parent entry overrides a stale server with ${mode} startup`, async () => {
  const delayIdentity = mode === "delayed";
  const nativeAuth = mode.startsWith("auth-");
  const fullPackage = mode.startsWith("full-package") || nativeAuth;
  const root = await mkdtemp(join(process.cwd(), ".sa-production-"));
  const home = join(root, "home");
  const agentDir = join(home, "agent");
  const wrapper = join(root, "tmux");
  const piPath = join(root, "pi");
  const socket = join(root, "socket");
  const stateRoot = join(root, "state");
  const pids = new Set<number>();
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const tools = new Map<string, any>();
  try {
    await mkdir(agentDir, { recursive: true });
    if (mode === "auth-stored" || mode === "auth-both") {
      await writeFile(join(agentDir, "auth.json"), JSON.stringify({ deepseek: { type: "api_key", key: "fixture-stored-secret" } }), { mode: 0o600 });
    }
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false },
      ...(fullPackage ? { packages: [resolve(".")] } : {}),
    }));
    const tmux = (await executeCommand("/usr/bin/which", ["tmux"])).stdout.trim();
    const handshakeStarted = join(root, "handshake-started");
    const identityBarrier = delayIdentity ? `
if [ "$1" = set-option ] && [ "$5" = @pi_subagent_instance ]; then
  attempts=0
  while [ ! -f ${quote(handshakeStarted)} ]; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 400 ] || exit 90
    sleep 0.01
  done
  sleep 0.15
fi
if [ "$1" = display-message ]; then
  case "$*" in
    *'@pi_subagent_instance'*)
      ${quote(tmux)} -S ${quote(socket)} -f /dev/null "$@"
      result=$?
      : > ${quote(handshakeStarted)}
      exit "$result"
      ;;
  esac
fi
` : "";
    await writeFile(wrapper, `#!/bin/sh\nexport LANG=en_US.UTF-8\n${identityBarrier}\nif [ "$1" = kill-window ]; then ${quote(tmux)} -S ${quote(socket)} capture-pane -p -S -100 -t "$3" > ${quote(join(root, "last-pane"))}; fi\nexec ${quote(tmux)} -S ${quote(socket)} -f /dev/null "$@"\n`, { mode: 0o700 });
    const cli = process.env.PI_SUBAGENT_TEST_CLI ?? resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    await writeFile(piPath, `#!/bin/sh\nexport PI_OFFLINE=1\nexec ${quote(process.execPath)} ${quote(cli)} ${fullPackage ? "" : "--no-extensions"} --no-context-files --no-skills --no-prompt-templates --no-themes --no-builtin-tools --no-approve "$@"\n`, { mode: 0o700 });
    const started = await executeCommand("/usr/bin/env", [`HOME=${home}`, `TMPDIR=${root}`, `XDG_CONFIG_HOME=${home}`, `XDG_DATA_HOME=${home}`, `XDG_CACHE_HOME=${home}`, "PI_CODING_AGENT_DIR=/old/server", "PI_SUBAGENT_TMUX_PATH=/old/tmux", "SUBAGENT_STALE_SENTINEL=must-not-inherit",
      wrapper, "new-session", "-d", "-s", "keeper", "-P", "-F", "#{pid}\t#{pane_pid}", "sleep 60"]);
    assert.equal(started.code, 0, started.stderr);
    for (const value of started.stdout.trim().split("\t")) pids.add(Number(value));
    if (mode === "fish") assert.equal((await executeCommand(wrapper, ["set-option", "-g", "default-shell", fish!])).code, 0);
    const fixture = join(root, "child.ts");
    await writeFile(fixture, `import offlineChild from ${JSON.stringify(pathToFileURL(resolve("extensions/subagent/__tests__/fixtures/offline-child.ts")).href)};
import {writeFile} from 'node:fs/promises';
export default async function(pi){
 process.env.PI_SUBAGENT_FIXTURE_DIST=${JSON.stringify(process.env.PI_SUBAGENT_FIXTURE_DIST ?? "0")};
 await offlineChild(pi, ${!fullPackage}, ${nativeAuth});
 ${mode === "full-package-delayed" ? "pi.on('resources_discover', async () => { await new Promise(resolve => setTimeout(resolve, 5000)); });" : ""}
 pi.on('session_start',async()=>{await writeFile(${JSON.stringify(join(root, "effective.json"))},JSON.stringify({agentDir:process.env.PI_CODING_AGENT_DIR,tmuxPath:process.env.PI_SUBAGENT_TMUX_PATH,piPath:process.env.PI_SUBAGENT_PI_PATH,pane:process.env.TMUX_PANE,stale:process.env.SUBAGENT_STALE_SENTINEL}));});
}`);
    const pi = { on: (name: string, handler: any) => handlers.set(name, handler), registerTool: (tool: any) => tools.set(tool.name, tool), events: { emit() {} } };
    const extension = process.env.PI_SUBAGENT_FIXTURE_DIST === "1" ? (await import("../dist/index.js")).default : subagentExtension;
    extension(pi as never, { env: { PATH: process.env.PATH, HOME: home, SHELL: "/bin/sh", LANG: "en_US.UTF-8", TERM: "xterm-256color", TMPDIR: root, PI_CODING_AGENT_DIR: agentDir, TMUX_PANE: "%parent",
      ...(mode === "auth-env" || mode === "auth-both" ? { DEEPSEEK_API_KEY: "fixture-auth-secret", OPENAI_API_KEY: "unrelated-secret" } : {}),
    },
      stateRoot, nativeSessionRoot: join(root, "native"), tmuxPath: wrapper, tmuxSessionName: "keeper", piPath, extensionPath: fixture });
    const ctx = { cwd: root, sessionManager: { getSessionId: () => "parent", getSessionFile: () => join(root, "parent.jsonl"), getLeafId: () => null, getEntries: () => [] } };
    await handlers.get("session_start")!({}, ctx);
    const spawn = () => tools.get("subagent_spawn").execute("spawn", { task: "fast work", model: nativeAuth ? "deepseek/deepseek-flash" : "subagent-fixture/deterministic" }, undefined, undefined, ctx);
    if (mode === "auth-missing") {
      await assert.rejects(spawn(), /delivery_rejected: Child authentication unavailable/u);
      const parent = await new SessionStateStore(stateRoot).load("parent");
      assert.deepEqual(parent?.children, []);
      assert.deepEqual(parent?.reservations, []);
      await handlers.get("session_shutdown")!({});
      return;
    }
    const spawned = await spawn();
    const { agent } = JSON.parse(spawned.content[0].text);
    pids.add(agent.tmux.panePid);
    assert.ok(HERO_NAMES.includes(agent.name));
    assert.equal(spawned.details.agent.name, agent.name);
    assert.equal((await executeCommand(wrapper, ["display-message", "-p", "-t", agent.tmux.paneId, "#{window_name}"])).stdout.trim(), agent.name);
    const effective = JSON.parse(await readFile(join(root, "effective.json"), "utf8"));
    assert.equal(effective.agentDir, agentDir);
    assert.equal(effective.tmuxPath, wrapper);
    assert.equal(effective.piPath, piPath);
    assert.equal(effective.pane, agent.tmux.paneId);
    assert.notEqual(effective.pane, "%parent");
    assert.equal(effective.stale, undefined);
    if (mode === "fish") assert.equal((await executeCommand(wrapper, ["show-options", "-gv", "default-shell"])).stdout.trim(), fish);
    const state = await new SessionStateStore(stateRoot).load(agent.agentId);
    assert.equal(state?.runtime.configuration?.agentDir, agentDir);
    assert.equal(state?.runtime.promptReady, true);
    assert.equal(state?.launch?.displayName, agent.name);
    assert.equal((await new SessionStateStore(stateRoot).load("parent"))?.children[0]?.name, agent.name);
    let session = await readFile(agent.sessionFile, "utf8");
    if (nativeAuth) {
      const deadline = performance.now() + 3000;
      while (!session.includes('"role":"assistant"') && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
        session = await readFile(agent.sessionFile, "utf8");
      }
      const assistant = session.trim().split("\n").map(line => JSON.parse(line)).find(entry => entry.message?.role === "assistant");
      assert.equal(assistant?.message.stopReason, "stop");
      const command = await executeCommand("/bin/ps", ["-p", String(agent.tmux.panePid), "-o", "command="]);
      assert.doesNotMatch(command.stdout + session + JSON.stringify(state), /fixture-auth-secret|fixture-stored-secret|unrelated-secret/u);
      assert.equal((await readdir(state!.launch!.sessionDir)).some(name => name.startsWith("authentication") || name.startsWith(".auth-")), false);
    }
    assert.equal(session.trim().split("\n").map(line => JSON.parse(line)).find(entry => entry.type === "session_info")?.name, agent.name);
    assert.match(session, /subagent_delivery/u);
    assert.match(session, /fast work/u);
    assert.doesNotMatch(session, /subagent-runtime-ready/u);
    if (delayIdentity) assert.equal(await readFile(handshakeStarted, "utf8"), "");
    if (mode === "immediate" || mode === "full-package-fast") {
      const execute = (kind: string, params: unknown) => tools.get("subagent_" + kind).execute(kind, params, undefined, undefined, ctx);
      const waited = await execute("wait", { agentId: agent.agentId, afterSettled: agent.settledCursor, timeoutMs: 3000 });
      assert.equal(waited.details.agent.name, agent.name);
      assert.equal(waited.details.outcome, "settled");
      const listed = await execute("list", {});
      assert.equal(listed.details.agents[0].name, agent.name);
      const read = await execute("read", { agentId: agent.agentId, view: "recent_activity" });
      assert.equal(read.details.agent.name, agent.name);
      assert.equal(Object.hasOwn(JSON.parse(read.content[0].text), "agent"), false);
      const prompted = await execute("prompt", { agentId: agent.agentId, text: "second work" });
      assert.equal(prompted.details.agent.name, agent.name);
    }
    const closed = await tools.get("subagent_close").execute("close", { target: "all" }, undefined, undefined, ctx);
    assert.equal(closed.details.affected[0].name, agent.name);
    await handlers.get("session_shutdown")!({});
  } finally {
    const panes = await executeCommand(wrapper, ["list-panes", "-a", "-F", "#{pane_pid}"]).catch(() => undefined);
    if (panes?.code === 0) for (const pid of panes.stdout.trim().split("\n").map(Number)) if (pid > 0) pids.add(pid);
    await executeCommand(wrapper, ["kill-server"]).catch(() => undefined);
    const alive = () => [...pids].filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
    const deadline = performance.now() + 2000;
    while (alive().length && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(alive(), []);
    assert.notEqual((await executeCommand(wrapper, ["list-sessions"])).code, 0);
    console.log(JSON.stringify({ cleanup: { pids: [...pids], livePids: alive(), socketUnavailable: true } }));
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
}
