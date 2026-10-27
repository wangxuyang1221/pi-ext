import { waitFor } from "../../../test-support/wait.js";
import { hasSuccessfulPaneExit } from "../../../test-support/tmux-exit.js";
import { createTestUi } from "../../../test-support/pi-ui.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
import { inspectPiHost } from "../../../scripts/pi-host.mjs";

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
const enabled = process.env.PI_SUBAGENT_ISOLATED_INTEGRATION === "1";
const entryType = "pi-fast-mode-session";
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  return waitFor(read, accept, { label, timeoutMs: 12000, intervalMs: 30 });
}
const lines = async (path: string): Promise<any[]> => (await readFile(path, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));

test.skipIf(!enabled)("isolates roles and Fast through a real root host and managed tmux children", async () => {
  const root = await mkdtemp(join(process.cwd(), ".sa-fast-"));
  const home = join(root, "home"), agentDir = join(home, "agent"), stateRoot = join(root, "state");
  const wrapper = join(root, "tmux"), socket = join(root, "socket"), piPath = join(root, "pi");
  const pids = new Set<number>();
  const children: any[] = [];
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let resumed: typeof session;
  const report: Record<string, any> = { host: inspectPiHost(), requests: {}, checkpoints: [], cleanup: {} };
  try {
    await mkdir(agentDir, { recursive: true });
    const configPath = getUserConfigPath(agentDir);
    const rolesDir = join(agentDir, "agents");
    await mkdir(rolesDir, { recursive: true });
    const roleFiles = new Map<string, string>();
    const writeRole = async (name: string, bytes: string) => {
      await writeFile(join(rolesDir, `${name}.jsonc`), bytes);
      roleFiles.set(name, bytes);
    };
    const marker = "ROOT_ONLY_ROLE_DESCRIPTION";
    await writeRole("worker", `// User role\n{"description":"${marker}","model":"openai-codex/role-fixture","thinkingLevel":"high","fast":true}`);
    await writeRole("empty", "{}");
    await writeRole("removed", '{"fast":true}');
    await writeRole("damaged", '{"fast":true}');
    await writeRole("broken", '{"fast":"yes"}');
    await writeRole("unknown-model", '{"model":"unknown/missing"}');
    await mkdir(join(root, ".pi", "agents"), { recursive: true });
    await writeFile(join(root, ".pi", "agents", "project-only.jsonc"), "{}");
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
        stateRoot, maxActive: 4, nativeSessionRoot: join(root, "native"), tmuxPath: wrapper, tmuxSessionName: "keeper", piPath, extensionPath: fixturePath,
      })],
    });
    await resourceLoader.reload();
    const rootFile = join(root, "root.jsonl"); await writeFile(rootFile, "");
    ({ session } = await createAgentSession({ cwd: root, agentDir, settingsManager, sessionManager: SessionManager.open(rootFile, root), resourceLoader, modelRuntime, model: fixture.model as any, noTools: "builtin" }));
    const errors: string[] = [];
    const notifications: string[] = [];
    await session.bindExtensions({ mode: "json", uiContext: { ...createTestUi(), setStatus() {}, setWidget() {}, notify(message: string) { notifications.push(message); } }, onError: error => errors.push(JSON.stringify(error)) });
    session.setThinkingLevel("medium");
    assert.ok(notifications.some(message => /broken\.jsonc: fast must be a boolean/u.test(message)));
    const checkpoint = async (label: string, expected: string) => {
      assert.equal(await readFile(configPath, "utf8"), expected, label);
      assert.deepEqual((await readdir(rolesDir)).sort(), [...roleFiles.keys()].map(name => `${name}.jsonc`).sort(), label);
      for (const [name, bytes] of roleFiles) assert.equal(await readFile(join(rolesDir, `${name}.jsonc`), "utf8"), bytes, `${label}: ${name}`);
      assert.equal(await readFile(join(root, ".pi", "agents", "project-only.jsonc"), "utf8"), "{}", label);
      report.checkpoints.push(label);
    };
    const spawnResult = async (task: string, options: Record<string, unknown> = {}) => {
      await session!.prompt(`spawn:${JSON.stringify({ task, ...options })}`);
      await session!.waitForIdle();
      const results = session!.state.messages.filter((message: any) => message.role === "toolResult" && message.toolName === "subagent_spawn");
      const result = results.at(-1) as any;
      assert.ok(result, JSON.stringify(session!.state.messages.filter((message: any) => message.role !== "system")));
      return result;
    };
    const spawn = async (task: string, options: Record<string, unknown> = {}) => {
      const result = await spawnResult(task, options);
      assert.equal(result.isError, false, JSON.stringify(result));
      const child = JSON.parse(result.content[0].text).agent;
      children.push(child); pids.add(child.tmux.panePid);
      await until(() => lines(join(home, `payload-${child.tmux.panePid}.jsonl`)), value => value.length > 0, "child first payload");
      const start = JSON.parse(await readFile(join(home, `start-${child.tmux.panePid}.json`), "utf8"));
      assert.equal(start.hostVersion, report.host.versions["pi-coding-agent"]);
      assert.deepEqual(start.versions, report.host.versions);
      report.childVersions ??= [];
      report.childVersions.push({ pid: child.tmux.panePid, versions: start.versions });
      return child;
    };
    const rejectSpawn = async (agent_type: string, message: RegExp) => {
      const store = new SessionStateStore(stateRoot);
      const before = await store.load(session!.sessionManager.getSessionId());
      const result = await spawnResult("invalid-role-request", { agent_type });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), message);
      const after = await store.load(session!.sessionManager.getSessionId());
      assert.deepEqual(after!.children, before!.children);
      assert.deepEqual(after!.reservations, before!.reservations);
      report.rejections ??= [];
      report.rejections.push({ agent_type, content: result.content, unchangedChildren: true, unchangedReservations: true });
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
    const exited = new Set<any>();
    const quit = async (child: any) => {
      await until(() => new SessionStateStore(stateRoot).load(child.agentId), state => state?.runtime.status === "settled", "settled before quit");
      await send(child, "/quit");
      // With remain-on-exit, Linux may retain the exited PID until tmux reaps it.
      // Older tmux versions omit the status until reaping; read the Linux wait
      // status in that case. Final cleanup still verifies all PIDs disappear.
      try {
        await until(async () => {
          const pane = await executeCommand(wrapper, ["display-message", "-p", "-t", child.tmux.paneId, "#{pane_dead}\t#{pane_dead_status}"]);
          if (pane.code !== 0) return false;
          const stat = process.platform === "linux" && pane.stdout.trim() === "1"
            ? await readFile(`/proc/${child.tmux.panePid}/stat`, "utf8").catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return undefined;
              throw error;
            }) : undefined;
          return hasSuccessfulPaneExit(pane.stdout, stat);
        }, Boolean, "child graceful shutdown");
      } catch (error) {
        report.shutdownFailure = {
          pid: child.tmux.panePid,
          pane: await executeCommand(wrapper, ["display-message", "-p", "-t", child.tmux.paneId, "#{pane_pid}\t#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}\t#{pane_current_command}"]),
          processes: await executeCommand("/bin/ps", ["-e", "-o", "pid=,ppid=,pgid=,stat=,comm="]),
        };
        throw error;
      }
      exited.add(child);
    };
    const state = async (child: any) => (await lines(child.sessionFile)).filter(entry => entry.type === "custom" && entry.customType === entryType).at(-1)?.data.enabled;
    const command = async (child: any, value: boolean) => {
      await send(child, `/fast ${value ? "on" : "off"}`);
      await until(() => state(child), current => current === value, "persisted Fast command");
    };
    const rootOff = await readFile(configPath, "utf8");
    const a = await spawn("hold:first", { agent_type: "worker" });
    assert.equal(a.model, "openai-codex/role-fixture");
    assert.equal(a.thinkingLevel, "high");
    assert.equal((await payloads(a))[0].payload.model, "role-fixture");
    assert.equal((await payloads(a))[0].payload.reasoning.effort, "high");
    assert.notEqual(a.name, "worker");
    const initialStart = JSON.parse(await readFile(join(home, `start-${a.tmux.panePid}.json`), "utf8"));
    assert.equal(initialStart.tools.some((tool: any) => tool.name.startsWith("subagent_")), false);
    assert.doesNotMatch(JSON.stringify(initialStart), /ROOT_ONLY_ROLE_DESCRIPTION|agent_type/u);
    report.childInitialTools = initialStart.tools;
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
    const reloadedStart = JSON.parse(await readFile(join(home, `start-${a.tmux.panePid}.json`), "utf8"));
    assert.equal(reloadedStart.tools.some((tool: any) => tool.name.startsWith("subagent_")), false);
    assert.doesNotMatch(JSON.stringify(reloadedStart), /ROOT_ONLY_ROLE_DESCRIPTION|agent_type/u);
    report.childReloadTools = reloadedStart.tools;
    await request(a, "after-reload", undefined);
    await checkpoint("child reload keeps false despite launch true", rootOff);
    await session.prompt("/fast on");
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).enabled, true);
    const rootOn = await readFile(configPath, "utf8");
    const b = await spawn("child-explicit-off", { agent_type: "worker", fast: false, model: "openai-codex/fast-fixture", thinkingLevel: "low" });
    assert.equal(b.model, "openai-codex/fast-fixture");
    assert.equal(b.thinkingLevel, "low");
    assert.equal((await payloads(b))[0].payload.model, "fast-fixture");
    assert.equal((await payloads(b))[0].payload.reasoning.effort, "low");
    assert.equal((await payloads(b))[0].payload.service_tier, undefined);
    const initialTranscript = await until(() => lines(b.sessionFile),
      entries => entries.some(entry => entry.message?.role === "assistant"), "first child assistant persisted");
    const fastIndex = initialTranscript.findIndex(entry => entry.customType === entryType);
    const assistantIndex = initialTranscript.findIndex(entry => entry.message?.role === "assistant");
    assert.ok(fastIndex >= 0, "Initial Fast state must be persisted");
    assert.equal(initialTranscript[fastIndex].data.enabled, false);
    assert.ok(assistantIndex >= 0, "First assistant must be persisted");
    assert.ok(fastIndex < assistantIndex, "Fast state must precede the first assistant");
    const c = await spawn("child-inherited-on", { agent_type: "empty" });
    assert.equal(c.model, "openai-codex/fast-fixture");
    assert.equal(c.thinkingLevel, "medium");
    assert.equal((await payloads(c))[0].payload.model, "fast-fixture");
    assert.equal((await payloads(c))[0].payload.reasoning.effort, "medium");
    assert.equal((await payloads(c))[0].payload.service_tier, "priority");
    await checkpoint("root on with explicit off and inherited on", rootOn);
    await session.prompt("/fast off");
    const nextRootOff = await readFile(configPath, "utf8");
    await command(b, true);
    await request(b, "child-b-on", "priority");
    await request(a, "child-a-stays-off", undefined);
    await request(c, "child-c-stays-on", "priority");
    await checkpoint("root and sibling switches stay independent", nextRootOff);
    await rejectSpawn("missing", /Unknown or invalid agent_type/u);
    await rejectSpawn("broken", /Unknown or invalid agent_type/u);
    await rejectSpawn("project-only", /Unknown or invalid agent_type/u);
    await rejectSpawn("unknown-model", /Model not found: unknown\/missing/u);
    await writeRole("worker", '{"description":"UPDATED_ROLE_DESCRIPTION","model":"openai-codex/fast-fixture","thinkingLevel":"low","fast":false}');
    await writeRole("added", '{"fast":true}');
    await writeRole("damaged", '{"fast":');
    await rm(join(rolesDir, "removed.jsonc")); roleFiles.delete("removed");
    await rejectSpawn("added", /Unknown or invalid agent_type/u);
    for (const type of ["worker", "removed", "damaged"]) {
      const child = await spawn(`before-reload-${type}`, { agent_type: type });
      assert.equal((await payloads(child))[0].payload.service_tier, "priority");
      if (type === "worker") {
        assert.equal(child.model, "openai-codex/role-fixture");
        assert.equal(child.thinkingLevel, "high");
      }
      await quit(child);
    }
    const beforeReloadRows = await lines(join(home, "root-payload.jsonl"));
    report.beforeReloadCatalog = beforeReloadRows.at(-1).payload.tools.find((tool: any) => tool.name === "subagent_spawn");
    assert.match(report.beforeReloadCatalog.description, /ROOT_ONLY_ROLE_DESCRIPTION/u);
    assert.match(report.beforeReloadCatalog.description, /removed|damaged/u);
    assert.doesNotMatch(report.beforeReloadCatalog.description, /UPDATED_ROLE_DESCRIPTION|added/u);
    const existingLaunch = (await new SessionStateStore(stateRoot).load(a.agentId))!.launch;
    const notificationCount = notifications.length;
    await session.reload();
    assert.ok(notifications.slice(notificationCount).some(message => message.includes("broken.jsonc:")));
    assert.ok(notifications.slice(notificationCount).some(message => message.includes("damaged.jsonc:")));
    await rejectSpawn("removed", /Unknown or invalid agent_type/u);
    await rejectSpawn("damaged", /Unknown or invalid agent_type/u);
    for (const [type, tier] of [["worker", undefined], ["added", "priority"], [undefined, undefined]] as const) {
      const child = await spawn(`after-reload-${type ?? "ordinary"}`, type ? { agent_type: type } : {});
      assert.equal((await payloads(child))[0].payload.service_tier, tier);
      if (type === "worker") {
        assert.equal(child.model, "openai-codex/fast-fixture");
        assert.equal(child.thinkingLevel, "low");
      }
      await quit(child);
    }
    report.afterReloadCatalog = (await lines(join(home, "root-payload.jsonl"))).at(-1).payload.tools.find((tool: any) => tool.name === "subagent_spawn");
    assert.match(report.afterReloadCatalog.description, /UPDATED_ROLE_DESCRIPTION/u);
    assert.match(report.afterReloadCatalog.description, /added/u);
    assert.doesNotMatch(report.afterReloadCatalog.description, /ROOT_ONLY_ROLE_DESCRIPTION|removed|damaged|broken|project-only/u);
    assert.deepEqual((await new SessionStateStore(stateRoot).load(a.agentId))!.launch, existingLaunch);
    await request(a, "existing-child-after-root-reload", undefined);
    const existingPayload = (await payloads(a)).at(-1).payload;
    assert.equal(existingPayload.model, "role-fixture");
    assert.equal(existingPayload.reasoning.effort, "high");
    await request(c, "inherited-child-after-root-reload", "priority");
    await checkpoint("role reload preserves live children and shared files", nextRootOff);
    report.notifications = notifications;
    await session.prompt("/fast on");
    const roleOff = await spawn("role-false-over-root-on", { agent_type: "worker" });
    assert.equal((await payloads(roleOff))[0].payload.service_tier, undefined);
    await quit(roleOff);
    await session.prompt("/fast off");
    await checkpoint("role false overrides root on", nextRootOff);
    await request(b, "reject-fast", "priority");
    const rejectedCount = (await payloads(b)).length;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await payloads(b)).length, rejectedCount, "rejected request is not replayed");
    await request(b, "after-rejection", undefined);
    await request(c, "sibling-after-rejection", "priority");
    await request(c, "other-error", "priority");
    await request(c, "after-other-error", "priority");
    await quit(a);
    await checkpoint("child graceful shutdown", nextRootOff);
    const d = await spawn("child-inherited-off", { agent_type: "empty" });
    assert.equal((await payloads(d))[0].payload.service_tier, undefined);
    await checkpoint("later child inherits root off", nextRootOff);
    for (const child of children) {
      const rows = await payloads(child);
      assert.ok(rows.every(row => !(row.payload.tools ?? []).some((tool: any) => tool.name.startsWith("subagent_"))));
      assert.ok(rows.every(row => !JSON.stringify(row.payload).includes(entryType)));
      assert.ok(rows.every(row => !/ROOT_ONLY_ROLE_DESCRIPTION|UPDATED_ROLE_DESCRIPTION|agent_type|可用的 agent_type/u.test(JSON.stringify(row.payload))));
      assert.ok(rows.every(row => !JSON.stringify(row.payload).includes(rolesDir)));
      report.requests[child === a ? "a" : child === b ? "b" : child === c ? "c" : child === d ? "d" : rows[0].text.replace(/^\[subagent:[^\]]+\]\n/u, "")] = rows;
    }
    report.rootCatalog = (report.requests.root = await lines(join(home, "root-payload.jsonl")))[0].payload.tools.find((tool: any) => tool.name === "subagent_spawn");
    assert.match(report.rootCatalog.description, /ROOT_ONLY_ROLE_DESCRIPTION/u);
    assert.doesNotMatch(report.rootCatalog.description, /broken|project-only/u);
    assert.equal(errors.length, 0);
    for (const child of children.filter(child => !exited.has(child))) await quit(child);
    await checkpoint("all child shutdown hooks preserve shared config", nextRootOff);
    // Resume the saved child file without its original launch environment in a real host.
    for (const [child, expected] of [[a, false], [c, true]] as const) {
      const resumedLoader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager,
        noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
        extensionFactories: [createPiFastModeExtension({ agentDir, extensionDir: root, env: {} })] });
      await resumedLoader.reload();
      ({ session: resumed } = await createAgentSession({ cwd: root, agentDir, settingsManager, sessionManager: SessionManager.open(child.sessionFile, root), resourceLoader: resumedLoader, modelRuntime, model: fixture.model as any, noTools: "builtin" }));
      await resumed.bindExtensions({ mode: "json", uiContext: { ...createTestUi(), setStatus() {}, setWidget() {} }, onError: error => errors.push(JSON.stringify(error)) });
      await resumed.prompt(`resumed-without-launch-${expected}`); await resumed.waitForIdle();
      assert.equal((await lines(join(home, "root-payload.jsonl"))).at(-1).payload.service_tier, expected ? "priority" : undefined);
      await resumed.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as any);
      await checkpoint(`resume ${expected} without launch and shutdown preserve shared config`, nextRootOff);
      resumed.dispose(); resumed = undefined;
    }
    report.requests.root = await lines(join(home, "root-payload.jsonl"));
    const rootRows = report.requests.root;
    assert.equal(rootRows[0].payload.service_tier, undefined);
    assert.equal(rootRows.find((row: any) => row.text.includes("child-explicit-off")).payload.service_tier, "priority");
    assert.equal(rootRows.find((row: any) => row.text.includes("child-inherited-off")).payload.service_tier, undefined);
    assert.equal(errors.length, 0);
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as any);
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
}, 180000);
