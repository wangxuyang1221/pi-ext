import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as ai from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import subagentExtension from "../src/index.js";
import { executeCommand } from "../src/command-executor.js";
import { SessionStateStore } from "../src/state-store.js";
import { createPiFastModeExtension } from "../../openai-fast-mode/src/index.js";
import { getUserConfigPath } from "../../openai-fast-mode/src/config.js";
import { fastProvider } from "./fixtures/fast-provider.js";

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
const enabled = process.env.PI_SUBAGENT_ISOLATED_INTEGRATION === "1";
const entryType = "pi-fast-mode-session";
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 12000;
  do { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 30)); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
const lines = async (path: string): Promise<any[]> => (await readFile(path, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));

test.skipIf(!enabled)("isolates Fast through a real root host and managed tmux children", async () => {
  const root = await mkdtemp(join(process.cwd(), ".sa-fast-"));
  const home = join(root, "home"), agentDir = join(home, "agent"), stateRoot = join(root, "state");
  const wrapper = join(root, "tmux"), socket = join(root, "socket"), piPath = join(root, "pi");
  const pids = new Set<number>();
  const children: any[] = [];
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let resumed: typeof session;
  const report: Record<string, any> = { requests: {}, checkpoints: [], cleanup: {} };
  try {
    await mkdir(agentDir, { recursive: true });
    const configPath = getUserConfigPath(agentDir);
    const rolePath = join(agentDir, "agents", "sentinel.jsonc");
    await mkdir(join(agentDir, "agents"), { recursive: true });
    const roleBytes = '// Slice 1 must not read or write roles.\n{"fast":true}\n';
    await writeFile(rolePath, roleBytes);
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [resolve(".")], retry: { enabled: false }, compaction: { enabled: false } }));
    const tmux = (await executeCommand("/usr/bin/which", ["tmux"])).stdout.trim();
    await writeFile(wrapper, `#!/bin/sh\nexport LANG=en_US.UTF-8\nif [ "$1" = kill-window ]; then ${quote(tmux)} -S ${quote(socket)} capture-pane -p -S -100 -t "$3" > ${quote(join(root, "last-pane"))}; fi\nexec ${quote(tmux)} -S ${quote(socket)} -f /dev/null "$@"\n`, { mode: 0o700 });
    await writeFile(piPath, `#!/bin/sh\nexport PI_OFFLINE=1\nexec ${quote(process.execPath)} ${quote(resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"))} --no-context-files --no-skills --no-prompt-templates --no-themes --no-builtin-tools --no-approve "$@" 2> ${quote(join(root, "child-stderr"))}\n`, { mode: 0o700 });
    const keeper = await executeCommand("/usr/bin/env", [`HOME=${home}`, `TMPDIR=${root}`, `XDG_CONFIG_HOME=${home}`, `XDG_DATA_HOME=${home}`, `XDG_CACHE_HOME=${home}`, wrapper, "new-session", "-d", "-s", "keeper", "-P", "-F", "#{pid}\t#{pane_pid}", "sleep 180"]);
    assert.equal(keeper.code, 0, keeper.stderr);
    await executeCommand(wrapper, ["set-option", "-g", "remain-on-exit", "on"]);
    keeper.stdout.trim().split("\t").forEach(value => pids.add(Number(value)));
    const fixturePath = resolve("extensions/subagent/__tests__/fixtures/fast-provider.ts");
    const fixture = await fastProvider(join(home, "root-payload.jsonl"), home);
    const modelRuntime = await ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    modelRuntime.registerNativeProvider(fixture.provider);
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
    const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [createPiFastModeExtension({ agentDir, extensionDir: root, env: {} }), pi => subagentExtension(pi, {
        env: { PATH: process.env.PATH, HOME: home, SHELL: "/bin/sh", LANG: "en_US.UTF-8", TERM: "xterm-256color", TMPDIR: root, PI_CODING_AGENT_DIR: agentDir },
        stateRoot, nativeSessionRoot: join(root, "native"), tmuxPath: wrapper, tmuxSessionName: "keeper", piPath, extensionPath: fixturePath,
      })],
    });
    await resourceLoader.reload();
    const rootFile = join(root, "root.jsonl"); await writeFile(rootFile, "");
    ({ session } = await createAgentSession({ cwd: root, agentDir, settingsManager, sessionManager: SessionManager.open(rootFile, root), resourceLoader, modelRuntime, model: fixture.model as any, noTools: "builtin" }));
    const errors: string[] = [];
    await session.bindExtensions({ mode: "json", uiContext: { setStatus() {}, setWidget() {}, notify() {} }, onError: error => errors.push(JSON.stringify(error)) });
    const checkpoint = async (label: string, expected: string) => {
      assert.equal(await readFile(configPath, "utf8"), expected, label);
      assert.equal(await readFile(rolePath, "utf8"), roleBytes, label);
      report.checkpoints.push(label);
    };
    const spawn = async (task: string, fast?: boolean) => {
      await session!.prompt(`spawn:${JSON.stringify({ task, ...(fast === undefined ? {} : { fast }) })}`);
      await session!.waitForIdle();
      const results = session!.state.messages.filter((message: any) => message.role === "toolResult" && message.toolName === "subagent_spawn");
      const result = results.at(-1) as any;
      assert.ok(result, JSON.stringify(session!.state.messages.filter((message: any) => message.role !== "system")));
      assert.equal(result.isError, false, JSON.stringify(result));
      const child = JSON.parse(result.content[0].text).agent;
      children.push(child); pids.add(child.tmux.panePid);
      await until(() => lines(join(home, `payload-${child.tmux.panePid}.jsonl`)), value => value.length > 0, "child first payload");
      return child;
    };
    const payloads = (child: any) => lines(join(home, `payload-${child.tmux.panePid}.jsonl`));
    const send = async (child: any, text: string) => {
      assert.equal((await executeCommand(wrapper, ["send-keys", "-t", child.tmux.paneId, "-l", `${text} `])).code, 0);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal((await executeCommand(wrapper, ["send-keys", "-H", "-t", child.tmux.paneId, "1b", "0d"])).code, 0);
    };
    const request = async (child: any, text: string, tier: string | undefined) => {
      const count = (await payloads(child)).length;
      await send(child, text);
      const rows = await until(() => payloads(child), rows => rows.length === count + 1, text);
      assert.equal(rows.at(-1).payload.service_tier, tier, text);
      await until(() => new SessionStateStore(stateRoot).load(child.agentId), state => state?.runtime.status === "settled", "child settled");
    };
    const state = async (child: any) => (await lines(child.sessionFile)).filter(entry => entry.type === "custom" && entry.customType === entryType).at(-1)?.data.enabled;
    const command = async (child: any, value: boolean) => {
      await send(child, `/fast ${value ? "on" : "off"}`);
      await until(() => state(child), current => current === value, "persisted Fast command");
    };
    const rootOff = await readFile(configPath, "utf8");
    const a = await spawn("hold:first", true);
    assert.equal((await payloads(a))[0].payload.service_tier, "priority");
    assert.equal(await state(a), true);
    assert.equal((await lines(a.sessionFile)).some(entry => entry.message?.role === "assistant"), false);
    await checkpoint("child initial true before assistant", rootOff);
    await command(a, false);
    assert.equal((await lines(a.sessionFile)).some(entry => entry.message?.role === "assistant"), false);
    await checkpoint("child command false before assistant", rootOff);
    await writeFile(join(home, "release-first"), "");
    await until(() => new SessionStateStore(stateRoot).load(a.agentId), state => state?.runtime.status === "settled", "initial child settled");
    const oldStart = await readFile(join(home, `start-${a.tmux.panePid}.json`), "utf8");
    await send(a, "/reload");
    await until(() => readFile(join(home, `start-${a.tmux.panePid}.json`), "utf8"), value => value !== oldStart, "child reload");
    assert.equal(await state(a), false);
    await request(a, "after-reload", undefined);
    await checkpoint("child reload keeps false despite launch true", rootOff);
    await session.prompt("/fast on");
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).enabled, true);
    const rootOn = await readFile(configPath, "utf8");
    const b = await spawn("child-explicit-off", false);
    assert.equal((await payloads(b))[0].payload.service_tier, undefined);
    assert.equal((await lines(b.sessionFile)).findIndex(entry => entry.customType === entryType)
      < (await lines(b.sessionFile)).findIndex(entry => entry.message?.role === "assistant"), true);
    const c = await spawn("child-inherited-on");
    assert.equal((await payloads(c))[0].payload.service_tier, "priority");
    await checkpoint("root on with explicit off and inherited on", rootOn);
    await session.prompt("/fast off");
    const nextRootOff = await readFile(configPath, "utf8");
    await command(b, true);
    await request(b, "child-b-on", "priority");
    await request(a, "child-a-stays-off", undefined);
    await request(c, "child-c-stays-on", "priority");
    await checkpoint("root and sibling switches stay independent", nextRootOff);
    await request(b, "reject-fast", "priority");
    const rejectedCount = (await payloads(b)).length;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await payloads(b)).length, rejectedCount, "rejected request is not replayed");
    await request(b, "after-rejection", undefined);
    await request(c, "sibling-after-rejection", "priority");
    await request(c, "other-error", "priority");
    await request(c, "after-other-error", "priority");
    await send(a, "/quit");
    await until(async () => { try { process.kill(a.tmux.panePid, 0); return false; } catch { return true; } }, value => value, "child graceful shutdown");
    await checkpoint("child graceful shutdown", nextRootOff);
    const d = await spawn("child-inherited-off");
    assert.equal((await payloads(d))[0].payload.service_tier, undefined);
    await checkpoint("later child inherits root off", nextRootOff);
    for (const child of children) {
      const rows = await payloads(child);
      assert.ok(rows.every(row => !(row.payload.tools ?? []).some((tool: any) => tool.name.startsWith("subagent_"))));
      assert.ok(rows.every(row => !JSON.stringify(row.payload).includes(entryType)));
      report.requests[child === a ? "a" : child === b ? "b" : child === c ? "c" : "d"] = rows;
    }
    assert.deepEqual(errors, []);
    for (const child of children.filter(child => child !== a)) {
      await send(child, "/quit");
      await until(async () => { try { process.kill(child.tmux.panePid, 0); return false; } catch { return true; } }, value => value, "child graceful shutdown");
    }
    await checkpoint("all child shutdown hooks preserve shared config", nextRootOff);
    // Resume the saved child file without its original launch environment in a real host.
    for (const [child, expected] of [[a, false], [c, true]] as const) {
      const resumedLoader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager,
        noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
        extensionFactories: [createPiFastModeExtension({ agentDir, extensionDir: root, env: {} })] });
      await resumedLoader.reload();
      ({ session: resumed } = await createAgentSession({ cwd: root, agentDir, settingsManager, sessionManager: SessionManager.open(child.sessionFile, root), resourceLoader: resumedLoader, modelRuntime, model: fixture.model as any, noTools: "builtin" }));
      await resumed.bindExtensions({ mode: "json", uiContext: { setStatus() {}, setWidget() {} }, onError: error => errors.push(JSON.stringify(error)) });
      await resumed.prompt(`resumed-without-launch-${expected}`); await resumed.waitForIdle();
      assert.equal((await lines(join(home, "root-payload.jsonl"))).at(-1).payload.service_tier, expected ? "priority" : undefined);
      await resumed.extensionRunner.emit({ type: "session_shutdown", reason: "exit" } as any);
      await checkpoint(`resume ${expected} without launch and shutdown preserve shared config`, nextRootOff);
      resumed.dispose(); resumed = undefined;
    }
    report.requests.root = await lines(join(home, "root-payload.jsonl"));
    const rootRows = report.requests.root;
    assert.equal(rootRows[0].payload.service_tier, undefined);
    assert.equal(rootRows.find((row: any) => row.text.includes("child-explicit-off")).payload.service_tier, "priority");
    assert.equal(rootRows.find((row: any) => row.text.includes("child-inherited-off")).payload.service_tier, undefined);
    assert.deepEqual(errors, []);
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "exit" } as any);
    await checkpoint("root shutdown preserves its last switch", nextRootOff);
  } finally {
    await resumed?.abort(); resumed?.dispose(); await session?.abort(); session?.dispose();
    for (const child of children) {
      const pane = await executeCommand(wrapper, ["capture-pane", "-p", "-S", "-60", "-t", child.tmux.paneId]).catch(() => undefined);
      if (pane?.code === 0) report[`pane-${child.agentId}`] = pane.stdout;
    }
    await executeCommand(wrapper, ["kill-server"]).catch(() => undefined);
    const alive = () => [...pids].filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
    await until(async () => alive(), value => value.length === 0, "process cleanup");
    assert.notEqual((await executeCommand(wrapper, ["list-sessions"])).code, 0);
    report.stderr = await readFile(join(root, "child-stderr"), "utf8").catch(() => "");
    report.lastPane = await readFile(join(root, "last-pane"), "utf8").catch(() => "");
    report.cleanup = { pids: [...pids], livePids: alive(), socketUnavailable: true };
    if (process.env.PI_FAST_EVIDENCE) await writeFile(resolve(process.env.PI_FAST_EVIDENCE), JSON.stringify(report, null, 2) + "\n");
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
