#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, appendFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fauxProvider, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import * as agent from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";
import { loadThemeFromPath, setThemeInstance } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { Working, WorkingActivity } from "../extensions/codex-ui/dist/working.js";
import { CodexFooter } from "../extensions/codex-ui/dist/footer.js";
import { createContextUsageReader } from "../extensions/codex-ui/dist/context-usage.js";

// Compare installed production components. Synchronous batches isolate renderer CPU;
// --interval=32 additionally drives the native scheduler at the production cadence.
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const profile = option("profile", "pi14");
assert.ok(["pi14", "pi152"].includes(profile));
const baselinePath = option("baseline");
const startedAt = new Date().toISOString();
assert.ok(baselinePath, "Pass --baseline=<pristine pi-tui package directory>");
const baselineAgentPath = option("baseline-agent", resolve(baselinePath, "../pi-coding-agent"));
const originalTui = await import(pathToFileURL(resolve(baselinePath, "dist/index.js")).href);
const originalAgent = await import(pathToFileURL(resolve(baselineAgentPath, "dist/index.js")).href);
assert.equal(typeof originalTui.TuiMainScreen.prototype.registerTextRegion, "undefined", "Baseline must be unpatched");
assert.equal(typeof tui.TuiMainScreen.prototype.registerTextRegion, "function", "Candidate must expose the production API");
agent.initTheme("dark", false);
originalAgent.initTheme("dark", false);
const theme = loadThemeFromPath(resolve("themes/codex-pi.json"), "truecolor");
setThemeInstance(theme);
(await import(pathToFileURL(resolve(baselineAgentPath, "dist/modes/interactive/theme/theme.js")).href)).setThemeInstance(theme);
const frames = Number(option("frames", "320"));
const repetitions = Number(option("samples", "7"));
const interval = Number(option("interval", "0"));
const journal = option("journal");
const record = value => { if (journal) appendFileSync(journal, JSON.stringify(value) + "\n"); };
const historySizes = option("pairs", "0,200,1000").split(",").map(Number);
const workloads = option("workloads", "animation-and-rate,streaming-and-animation,unused-api").split(",");
const mode = option("mode", "regular");
assert.ok(["regular", "fullscreen"].includes(mode));
const baselineOnly = process.argv.includes("--baseline-only");
assert.ok(Number.isInteger(frames) && frames > 0 && Number.isInteger(repetitions) && repetitions > 0 && interval >= 0);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const message = text => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-responses", provider: "openai", model: "gpt-4.1", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 0 });

const viewportModules = {
  baseline: await import(pathToFileURL(resolve(baselineAgentPath, "dist/modes/interactive/chat-viewport.js")).href),
  candidate: await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/chat-viewport.js"),
};
function layoutSnapshot(frame) {
  const box = value => ({ rect: value.rect, clip: value.clip, lines: value.lines, lineOffset: value.lineOffset,
    scrollContentLines: value.scrollContentLines, children: value.children.map(box) });
  return { width: frame.width, height: frame.height, lines: frame.lines, root: box(frame.root) };
}
async function createFixture(implementation, historyPairs) {
  const Host = implementation === "baseline" ? originalTui : tui;
  const Agent = implementation === "baseline" ? originalAgent : agent;
  let output = "", bytes = 0, step = 0, completed = 0;
  const terminal = { columns: 120, rows: 40, write: text => { output += text; bytes += Buffer.byteLength(text); }, hideCursor() {}, showCursor() {} };
  const manager = Agent.SessionManager.inMemory(scratch);
  const chat = new Host.Container();
  for (let i = 0; i < historyPairs; i++) {
    const userText = `历史问题 ${i}: explain the state transition.`;
    const answer = message(`Answer ${i}.\n\n- Preserve accounting.\n- Render the **cached** summary.\n\n\`\`\`ts\nconst state = "active";\n\`\`\``);
    manager.appendMessage({ role: "user", content: userText, timestamp: 0 });
    manager.appendMessage(answer);
    chat.addChild(new Agent.UserMessageComponent(userText));
    chat.addChild(new Agent.AssistantMessageComponent(answer));
  }
  const tail = new Agent.AssistantMessageComponent(message("Current response"));
  chat.addChild(tail);
  const faux = fauxProvider();
  const modelRuntime = await Agent.ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = Agent.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
  const loader = new Agent.DefaultResourceLoader({ cwd: scratch, agentDir: resolve(scratch, "agent"), settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
  await loader.reload();
  const { session } = await Agent.createAgentSession({ cwd: scratch, agentDir: resolve(scratch, "agent"), modelRuntime,
    model: faux.getModel(), sessionManager: manager, resourceLoader: loader, settingsManager, tools: [] });
  const activity = new WorkingActivity(() => step * 32); activity.start();
  const animation = new Working(activity, () => theme);
  const argumentText = JSON.stringify({ command: "echo received tool arguments 中文; ".repeat(16) });
  const responseMessage = () => ({ ...message(""), content: [
    { type: "text", text: "" }, { type: "thinking", thinking: "" },
    { type: "toolCall", id: "benchmark", name: "bash", arguments: JSON.parse(argumentText) },
  ] });
  let response = responseMessage();
  activity.rate.start(response);
  const editor = { invalidate() {}, render() { return [`> draft${Host.CURSOR_MARKER}`]; } };
  const footer = new CodexFooter({ cwd: process.cwd(), getModelId: () => "gpt-4.1", getThinkingLevel: () => "high",
    getContextUsage: createContextUsageReader({ sessionManager: manager, get model() { return session.model; }, getContextUsage: () => session.getContextUsage() }), getBranch: () => "main", getTheme: () => theme,
    getExtensionStatuses: () => new Map([["status", "Status: active | neutral footer second row"], ["pi-openai-fast-mode", "fast"]]), getRate: () => activity.label() });
  const widget = new Host.Container(); widget.addChild(animation);
  const bottom = new Host.Container(); bottom.addChild(footer);
  const renderer = mode === "fullscreen" ? new Host.TuiAltScreen(terminal, true) : new Host.TuiMainScreen(terminal, true);
  const doRender = renderer.doRender.bind(renderer);
  renderer.doRender = () => { doRender(); completed++; };
  if (mode === "fullscreen") {
    const viewport = viewportModules[implementation === "baseline" ? "baseline" : "candidate"].createChatViewport({ document: chat, pendingMessages: new Host.Container(), status: new Host.Container(), widgetsAbove: widget, editor, footer: bottom });
    renderer.setLayoutRoot(viewport.root);
    renderer.altScreenActive = true;
  }
  for (const component of [chat, widget, editor, bottom]) renderer.addChild(component);
  const handles = implementation === "region" ? [animation, footer].map(c => renderer.registerTextRegion(c)) : [];
  renderer.renderNow();
  return {
    async render(local) {
      output = ""; bytes = 0;
      for (const handle of handles) handle.requestRender();
      if (!local || !handles.length) renderer.requestRender();
      const before = completed;
      if (interval) {
        const frameStarted = performance.now();
        const deadline = frameStarted + 2000;
        while (completed === before && performance.now() < deadline) await delay(1);
        const remaining = interval - (performance.now() - frameStarted);
        if (remaining > 0) await delay(remaining);
      }
      else {
        // Flush the queued frame without converting a local request into renderNow's normal request.
        renderer.cancelRenderTimer(); renderer.renderRequested = false; renderer.doRender();
      }
      assert.equal(completed - before, 1, "Exactly one completed render per measured frame");
    },
    completed: () => completed,
    advance(streaming) {
      step++;
      if (step % 64 === 1) { activity.rate.finish(response); response = responseMessage(); activity.rate.start(response); }
      const delta = "Received visible output 中文. ";
      response.content[0].text += delta;
      activity.rate.update({ type: "text_delta", contentIndex: 0, delta, partial: response });
      const thinking = "visible reasoning ";
      response.content[1].thinking += thinking;
      activity.rate.update({ type: "thinking_delta", contentIndex: 1, delta: thinking, partial: response });
      const phase = (step - 1) % 64, chunk = Math.ceil(argumentText.length / 64);
      activity.rate.update({ type: "toolcall_delta", contentIndex: 2, delta: argumentText.slice(phase * chunk, (phase + 1) * chunk), partial: response });
      if (streaming) tail.updateContent(message(`Current response ${step}: ${"text ".repeat(step % 30 + 1)}`), true); },
    snapshot: () => ({ state: mode === "fullscreen" ? { screen: renderer.getScreenLines(), layout: layoutSnapshot(renderer.currentLayout) } : renderer.captureRenderState(), output }),
    bytes: () => bytes,
    dispose() { session.dispose(); activity.stop(); footer.dispose(); for (const h of handles) h.dispose(); renderer.stopped = true; renderer.cancelRenderTimer(); },
  };
}

const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const version = JSON.parse(readFileSync(resolve("node_modules/@earendil-works/pi-tui/package.json"))).version;
assert.equal(version, profile === "pi152" ? "1.5.2" : "1.4.0");
const identities = root => Object.fromEntries(["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-tui"].map(name => {
  const path = realpathSync(resolve(root, name));
  const pkg = JSON.parse(readFileSync(resolve(path, "package.json")));
  assert.equal(pkg.version, version, "Mixed benchmark versions");
  return [name, { path, version: pkg.version, manifest: hash(resolve(path, "package.json")), entry: hash(resolve(path, "dist/index.js")) }];
}));
const hosts = { candidate: identities("node_modules/@earendil-works"), baseline: identities(resolve(baselinePath, "..")) };
const sources = Object.fromEntries(["pnpm-lock.yaml", "themes/codex-pi.json", "scripts/local-refresh-cpu.mjs", "extensions/codex-ui/dist/working.js", "extensions/codex-ui/dist/footer.js", "extensions/codex-ui/dist/token-rate.js", "extensions/codex-ui/src/working.ts", "extensions/codex-ui/src/token-rate.ts", "extensions/codex-ui/src/json-units.ts", "extensions/codex-ui/src/footer.ts", "extensions/codex-ui/src/context-usage.ts", `patches/@earendil-works__pi-tui@${version}.patch`, `patches/@earendil-works__pi-coding-agent@${version}.patch`].map(path => [path, hash(path)]));
const baselineLockSha256 = option("baseline-lock") ? hash(option("baseline-lock")) : undefined;
record({ type: "identity", startedAt, mode, interval, hosts, sources, baselineLockSha256 });
mkdirSync(resolve(".tmp"), { recursive: true });
const scratch = mkdtempSync(resolve(".tmp/working-cpu-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const results = [];
for (const historyPairs of historySizes) for (const workload of workloads) {
  assert.ok(["animation-and-rate", "streaming-and-animation", "unused-api"].includes(workload));
  const fixtures = { baseline: await createFixture("baseline", historyPairs), ...(!baselineOnly ? { region: await createFixture(workload === "unused-api" ? "unused" : "region", historyPairs) } : {}) };
  try {
    const local = workload === "animation-and-rate";
    for (let i = 0; i < 50; i++) {
      for (const f of Object.values(fixtures)) { f.advance(!local); await f.render(local); }
      if (fixtures.region) assert.deepEqual(fixtures.region.snapshot(), fixtures.baseline.snapshot(), `${historyPairs}/${workload}/frame-${i}`);
    }
    const samples = { baseline: [], region: [] };
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const order = Object.keys(fixtures);
      for (const implementation of [...order.slice(repetition % order.length), ...order.slice(0, repetition % order.length)]) {
        const f = fixtures[implementation];
        await nextTurn(); global.gc?.();
        const startMonotonicUs = Number(process.hrtime.bigint() / 1000n);
        const startCpu = process.cpuUsage(), start = performance.now();
        let bytes = 0;
        const completedBefore = f.completed();
        for (let i = 0; i < frames; i++) { f.advance(!local); await f.render(local); bytes += f.bytes(); }
        await nextTurn();
        const wallMs = performance.now() - start, cpu = process.cpuUsage(startCpu);
        const completedFrames = f.completed() - completedBefore;
        assert.equal(completedFrames, frames);
        samples[implementation].push({ startMonotonicUs, endMonotonicUs: Number(process.hrtime.bigint() / 1000n), completedFrames, userMs: cpu.user / 1000, systemMs: cpu.system / 1000, cpuMsPerFrame: (cpu.user + cpu.system) / 1000 / frames, wallMsPerFrame: wallMs / frames, bytes });
        record({ type: "sample", historyPairs, workload, repetition, implementation, sample: samples[implementation].at(-1) });
      }
      if (fixtures.region) {
        assert.deepEqual(fixtures.region.snapshot(), fixtures.baseline.snapshot());
        assert.equal(samples.region.at(-1).bytes, samples.baseline.at(-1).bytes);
      }
    }
    const baseline = median(samples.baseline.map(s => s.cpuMsPerFrame));
    const region = median(samples.region.map(s => s.cpuMsPerFrame));
    const tolerance = Math.max(baseline * 0.1, 0.1);
    const passed = baselineOnly || (local && historyPairs > 0 ? region <= baseline * 0.7 : region - baseline <= tolerance);
    if (!passed) process.exitCode = 1;
    results.push({ passed, tolerance, historyPairs, workload, framesPerSample: frames, repetitions, baselineCpuMsPerFrame: baseline, regionCpuMsPerFrame: region, regionReductionPercent: (baseline - region) / baseline * 100, samples });
  } finally { for (const f of Object.values(fixtures)) f.dispose(); }
}
console.log(JSON.stringify({ pid: process.pid, startedAt, finishedAt: new Date().toISOString(), node: process.version, mode, profile, hosts, baselineLockSha256, pi: version, theme: "codex-pi/truecolor", columns: 120, rows: 40, animationStepMs: 32, intervalMs: interval,
  metric: "Process user+system CPU per frame; median of rotating repeated batches", baselinePath, baselineAgentPath,
  sources,
  limitations: ["Production Working, CodexFooter, real AgentSession context usage and TokenRate with controlled provider event deltas; external model not called", "In-memory terminal; terminal emulator CPU excluded", "Synchronous mode flushes the real queued frame; interval mode uses the native timer"], results }, null, 2));
