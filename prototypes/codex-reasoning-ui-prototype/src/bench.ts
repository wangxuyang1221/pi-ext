// Synthetic production-registration benchmark; no model requests or tool execution.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus } from "node:os";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import { reasoningPipeline } from "../../../extensions/codex-ui/__tests__/fixtures/reasoning-pipeline.js";

const root = process.env.PI_REASONING_BENCH_ROOT!;
const run = process.env.PI_REASONING_BENCH_RUN!;
const require = createRequire(join(root, "prototypes/codex-ui-performance/package.json"));
const { Terminal } = require("@xterm/headless");
const samples: any[] = [];
const production = process.env.PI_REASONING_LAB_VARIANT === "production";
const measure = async (fn: () => unknown) => {
  const cpu = process.cpuUsage(); const start = performance.now();
  await fn();
  const usage = process.cpuUsage(cpu);
  return { wallMs: performance.now() - start, cpuMs: (usage.user + usage.system) / 1000 };
};

for (const [history, expanded] of [[0, false], [20, false], [20, true]] as const) {
  for (let round = 0; round < 7; round++) {
    const pipeline = await reasoningPipeline(codexUi, root, history, expanded);
    const emulator = new Terminal({ cols: 120, rows: 40, scrollback: 10000, allowProposedApi: true, logLevel: "off" });
    const feed = async (data: string) => measure(() => data ? new Promise<void>(resolve => emulator.write(Buffer.from(data), resolve)) : undefined);
    try {
      await pipeline.begin();
      let text = "**Stable title**\n\n";
      await pipeline.update(text, text);
      pipeline.screen.renderNow(); await feed(pipeline.terminal.take());
      for (const scenario of ["body-deltas", "title-only", "title-changes", "final-history", "stable-input"] as const) {
        let bytes = 0; let parseCpuMs = 0; let renderCpuMs = 0; let wallMs = 0; let maxFrameMs = 0;
        const frames = scenario === "final-history" ? 1 : 64;
        const previous = pipeline.screen.fullRedraws;
        const requests = pipeline.stats().requests;
        for (let index = 0; index < frames; index++) {
          const timing = await measure(async () => {
            if (scenario === "body-deltas") {
              const delta = `Paragraph ${index}. ` + "This is a synthetic reasoning paragraph. ".repeat(25) + "\n\n";
              text += delta;
              await pipeline.update(text, delta);
            } else if (scenario === "title-only" || scenario === "title-changes") {
              // Compare equal visible title changes as well as newly visible changes over a fixed body.
              await pipeline.update("", "", "thinking_start");
              text = scenario === "title-only" ? `**Title ${index}**`
                : `**Title ${index}**\n\n` + "Final reasoning paragraph. ".repeat(2500);
              await pipeline.update(text, text);
            } else if (scenario === "final-history") await pipeline.finish();
            else pipeline.editor.handleInput(index % 2 ? "\x7f" : "x");
            pipeline.screen.renderNow();
          });
          const data = pipeline.terminal.take();
          if (production && (scenario === "title-only" || scenario === "title-changes")) {
            assert.doesNotMatch(data, /offscreen-reasoning-marker|\x1b\[(?:2J|3J)/u);
          }
          const parsed = await feed(data);
          bytes += Buffer.byteLength(data); parseCpuMs += parsed.cpuMs;
          renderCpuMs += timing.cpuMs; wallMs += timing.wallMs; maxFrameMs = Math.max(maxFrameMs, timing.wallMs);
        }
        samples.push({ history, expanded, round, warmup: round < 2, scenario, frames,
          bytes, renderCpuMs, parseCpuMs, wallMs, maxFrameMs,
          fullRedraws: pipeline.screen.fullRedraws - previous, requests: pipeline.stats().requests - requests });
      }
    } finally { await pipeline.dispose(); emulator.dispose(); }
    globalThis.gc?.();
  }
}
const memory = [];
const pipeline = await reasoningPipeline(codexUi, root, 0);
try {
  for (let index = 0; index < 30; index++) {
    await pipeline.begin();
    const text = `**Replay ${index}**\n\n` + "Memory fixture. ".repeat(1000);
    await pipeline.update(text, text); await pipeline.finish();
    pipeline.screen.renderNow(); pipeline.terminal.take();
    globalThis.gc?.();
    memory.push({ index, ...process.memoryUsage() });
  }
} finally { await pipeline.dispose(); }
writeFileSync(join(run, "metrics.json"), JSON.stringify({
  manifest: JSON.parse(readFileSync(join(run, "manifest.json"), "utf8")),
  environment: { cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch, theme: "codex-pi", width: 120, height: 40,
    parser: "@xterm/headless@5.5.0", rounds: 7, warmup: 2, framesPerStream: 64,
    note: "Explicit frames and fixture events, not real network timing or Ghostty/GPU. Input measures synchronous handleInput-to-render time." },
  samples, memory,
}, null, 2));
console.log(`Reasoning benchmark passed: ${samples.length} samples, 30 fixed-history replays.`);
