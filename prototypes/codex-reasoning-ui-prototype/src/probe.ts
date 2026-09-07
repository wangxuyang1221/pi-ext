// Isolate title-only frame costs from completed-history growth.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Session } from "node:inspector/promises";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import { reasoningPipeline } from "../../../extensions/codex-ui/__tests__/fixtures/reasoning-pipeline.js";
const root = process.env.PI_REASONING_BENCH_ROOT!;
const run = process.env.PI_REASONING_BENCH_RUN!;
const { Terminal } = createRequire(join(root, "prototypes/codex-ui-performance/package.json"))("@xterm/headless");
const pipeline = await reasoningPipeline(codexUi, root, 20, true);
const emulator = new Terminal({ cols: 120, rows: 40, scrollback: 10000, allowProposedApi: true, logLevel: "off" });
const feed = (data: string) => new Promise<void>(resolve => data ? emulator.write(data, resolve) : resolve());
const inspector = new Session(); inspector.connect();
const render = pipeline.screen.render.bind(pipeline.screen);
let treeMs = 0;
pipeline.screen.render = width => { const start = performance.now(); const value = render(width); treeMs += performance.now() - start; return value; };
const rounds = [];
try {
  await pipeline.begin(); await pipeline.update("**First**", "**First**");
  pipeline.screen.renderNow(); await feed(pipeline.terminal.take());
  await inspector.post("Profiler.enable"); await inspector.post("Profiler.start");
  for (let round = 0; round < 20; round++) {
    let eventMs = 0; let renderMs = 0; let parseMs = 0; treeMs = 0;
    const cpu = process.cpuUsage();
    for (let index = 0; index < 64; index++) {
      let time = performance.now();
      await pipeline.update("", "", "thinking_start");
      const text = `**Title ${round}-${index}**`;
      await pipeline.update(text, text);
      eventMs += performance.now() - time;
      time = performance.now(); pipeline.screen.renderNow(); renderMs += performance.now() - time;
      time = performance.now(); await feed(pipeline.terminal.take()); parseMs += performance.now() - time;
    }
    const usage = process.cpuUsage(cpu);
    rounds.push({ round, eventMs: eventMs / 64, treeMs: treeMs / 64, diffMs: (renderMs - treeMs) / 64, parseMs: parseMs / 64, cpuMs: (usage.user + usage.system) / 1000 / 64 });
  }
  const { profile } = await inspector.post("Profiler.stop");
  writeFileSync(join(run, "probe.json"), JSON.stringify({ rounds, profile }, null, 2));
} finally { inspector.disconnect(); await pipeline.dispose(); emulator.dispose(); }
console.log("Title-only frame probe completed.");
