import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { AssistantMessageComponent, UserMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { TuiMainScreen, Text } from "@earendil-works/pi-tui";
import { CodexFooter } from "../../codex-ui/dist/footer.js";

// Reconstruct the fixed pre-change footer, rather than claiming a pre-implementation measurement.
const baseline = "341c22b15035392c8bd8a8cb5df203bd71c61e24";
mkdirSync(resolve(".tmp"), { recursive: true });
const root = mkdtempSync(resolve(".tmp/goal-footer-bench-"));
class Terminal {
  columns = 120; rows = 40; bytes = 0;
  write(text) { this.bytes += Buffer.byteLength(text); }
  start() {} stop() {} async drainInput() {} hideCursor() {} showCursor() {}
  moveBy() {} clearLine() {} clearFromCursor() {} setTitle() {}
}
const theme = { fg: (_tone, text) => text, bold: text => text, getColorMode: () => "256color" };
const message = text => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-responses", provider: "openai", model: "gpt-4.1", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 0 });
const percentile = (items, p) => [...items].sort((a, b) => a - b)[Math.min(items.length - 1, Math.floor(items.length * p))];
try {
  const old = execFileSync("git", ["show", `${baseline}:extensions/codex-ui/src/footer.ts`], { encoding: "utf8" }).replace('"./layout.js"', JSON.stringify(pathToFileURL(resolve("extensions/codex-ui/dist/layout.js")).href));
  const file = join(root, "baseline.mjs");
  writeFileSync(file, ts.transpileModule(old, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const { CodexFooter: OldFooter } = await import(pathToFileURL(file).href);
  initTheme("dark", false);
  const results = [];
  for (const history of [0, 500, 2000]) for (const workload of ["idle", "tool-wait", "streaming"]) for (const implementation of ["baseline", "minute"]) {
    const terminal = new Terminal();
    const screen = new TuiMainScreen(terminal, false, root);
    screen.requestRender = () => {};
    screen.start();
    try {
      for (let index = 0; index < history; index++) {
        screen.addChild(new UserMessageComponent(`历史问题 ${index}: explain the state transition.`));
        screen.addChild(new AssistantMessageComponent(message(`Answer ${index}.\n\n- Preserve accounting.\n- Render the **cached** goal summary.\n\n\`\`\`ts\nconst state = "active";\n\`\`\``)));
      }
      const tail = new AssistantMessageComponent(message("Current response"));
      screen.addChild(tail);
      if (workload === "tool-wait") screen.addChild(new Text("Tool running: waiting for a controlled result", 0, 0));
      let minute = 12;
      const display = () => ({ version: 1, ownerSessionId: "s", goalId: "g", objective: "验证目标计时与长会话渲染成本", status: "active", summary: `Active · ${minute}m · 12.3k / 80k tokens` });
      const Footer = implementation === "baseline" ? OldFooter : CodexFooter;
      screen.addChild(new Footer({ cwd: process.cwd(), getModelId: () => "gpt-4.1", getThinkingLevel: () => "off", getContextUsage: () => ({ percent: 12 }), getBranch: () => "main", getTheme: () => theme, getExtensionStatuses: () => new Map([["goal", "Goal: active | 12345/80000 tokens | 720s"]]), getGoalDisplay: display }));
      screen.renderNow();
      const samples = [];
      for (let index = 0; index < 65; index++) {
        if (implementation === "minute") minute++;
        if (workload === "streaming") tail.updateContent(message(`Current response ${index}: ${"text ".repeat(index + 1)}`), true);
        terminal.bytes = 0;
        const cpu = process.cpuUsage(); const start = performance.now();
        screen.renderNow();
        const wallMs = performance.now() - start; const used = process.cpuUsage(cpu);
        if (index >= 5) samples.push({ cpuMs: (used.user + used.system) / 1000, wallMs, bytes: terminal.bytes });
      }
      results.push({ historyPairs: history, workload, implementation, samples: samples.length, medianCpuMs: percentile(samples.map(s => s.cpuMs), 0.5), p95WallMs: percentile(samples.map(s => s.wallMs), 0.95), medianBytes: percentile(samples.map(s => s.bytes), 0.5) });
    } finally { screen.stop(); }
  }
  const passed = results.filter(r => r.implementation === "minute").every(r => r.medianCpuMs <= 60 && r.p95WallMs <= 100);
  const report = { passed, baseline, node: process.version, pi: "0.84.3", columns: 120, rows: 40, medianCpuBudgetMs: 60, p95WallBudgetMs: 100, limitations: ["Reconstructed baseline measured after implementation", "Controlled cached text history, not arbitrary tools or images", "Tool wait uses a static label, not a spinner", "Streaming uses explicit controlled frames", "Terminal emulator CPU is not measured", "Footer theme is deterministic uncolored; message theme is dark"], results };
  writeFileSync(resolve(".tmp/goal-footer-benchmark.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (!passed) process.exitCode = 1;
} finally { rmSync(root, { recursive: true, force: true }); }
