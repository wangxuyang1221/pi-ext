import { performance } from "node:perf_hooks";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectHistoryIdentities, readHistoryIdentities } from "../../src/history.js";
import { HistoryHandoff } from "../../src/history-handoff.js";

/** Measures bounded extraction and real loader registration with synthetic history. */
export default async function benchmark(_pi: ExtensionAPI): Promise<void> {
  if (VERSION !== process.env.PI_MCP_TEST_PI_VERSION) throw new Error(`Expected Pi ${process.env.PI_MCP_TEST_PI_VERSION}, got ${VERSION}`);
  const root = process.env.PI_MCP_TEST_PI_ROOT!;
  const loader = await import(pathToFileURL(join(root, "dist/core/extensions/loader.js")).href);
  const baseline = process.env.MCP_BENCH_BASELINE === "1";
  const base = process.env.PI_CODING_AGENT_DIR!;
  mkdirSync(base, { recursive: true });
  const run = mkdtempSync(join(base, "benchmark-"));
  const loads = [
    { name: "small", count: 20, tools: 4, bytes: 32 },
    { name: "branches", count: 10000, tools: 200, bytes: 32 },
    { name: "large-results", count: 128, tools: 4, bytes: 256 * 1024 },
    { name: "many-tools", count: 4096, tools: 4096, bytes: 32 },
  ];
  try {
    for (const load of loads) {
      const entries = Array.from({ length: load.count }, (_, i) => ({ type: "message", id: String(i), parentId: null,
        message: { role: "toolResult", toolName: `mcp__fixture__tool${i % load.tools}`, content: [{ type: "text", text: "x".repeat(load.bytes) }],
          details: { mcp: true, server: "fixture", tool: `tool${i % load.tools}` } } }));
      const path = join(run, `${load.name}.jsonl`);
      writeFileSync(path, entries.map(entry => JSON.stringify(entry)).join("\n"));
      const samples: Array<Record<string, number>> = [];
      for (let iteration = 0; iteration < 6; iteration += 1) {
        global.gc?.();
        const start = performance.now();
        const identities = baseline ? [] : await readHistoryIdentities(path);
        const extracted = performance.now();
        const handoff = new HistoryHandoff(base);
        if (!baseline) handoff.publish(identities);
        const handoffBytes = baseline ? 0 : Buffer.byteLength(readFileSync(handoff.path));
        const published = performance.now();
        const loaded = await loader.loadExtensions([process.env.MCP_BENCH_EXTENSION!], run);
        if (loaded.errors.length) throw new Error(JSON.stringify(loaded.errors));
        const finished = performance.now();
        if (loaded.extensions[0].tools.size !== (baseline ? 0 : load.tools)) throw new Error("Unexpected registration count");
        if (iteration) samples.push({ extract_ms: extracted - start, handoff_ms: published - extracted,
          factory_ms: finished - published, handoff_bytes: handoffBytes, rss: process.memoryUsage().rss });
      }
      console.log(JSON.stringify({ pi: VERSION, baseline, load: load.name, session_bytes: Buffer.byteLength(readFileSync(path)), samples }));
    }
    const before = process.memoryUsage().rss;
    for (let i = 0; i < 100; i += 1) {
      const handoff = new HistoryHandoff(base);
      handoff.publish(collectHistoryIdentities([{ type: "message", message: { role: "toolResult", toolName: `mcp__test__${i}` } }]));
      const next = new HistoryHandoff(base);
      next.consume();
    }
    global.gc?.();
    if (readdirSync(join(base, "mcp-history")).length) throw new Error("Handoff files accumulated");
    console.log(JSON.stringify({ switches: 100, files: 0, rss_before: before, rss_after_gc: process.memoryUsage().rss, peak_rss_kib: process.resourceUsage().maxRSS }));
  } finally { rmSync(run, { recursive: true, force: true }); }
}
