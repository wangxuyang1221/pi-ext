const STATUS_GLYPH = "@";

export const TOOLS = ["bash", "read", "edit", "write"];
export const OUTCOMES = ["success", "error", "interrupted", "timeout", "hold", "mixed"];
const base = {
  read: { path: "src/目标说明.ts", offset: 1, limit: 3 },
  edit: { path: "src/config.ts", edits: [{ oldText: "retries: 2", newText: "retries: 3" }] },
  write: { path: "docs/result.md", content: "# Fixture result\n\nTool markers reflect execution status.\n" },
  bash: { command: "pnpm test status.test.ts" },
};

/** Build fixed, isolated fixture calls; never derive filesystem paths from free input. */
export function makeScenario({ tool = "all", outcome = "success", batch = false, animate = false } = {}) {
  if ((!TOOLS.includes(tool) && tool !== "all") || !OUTCOMES.includes(outcome) || (batch && tool === "all")) throw new Error("Unknown fixture scenario");
  const names = batch ? Array(3).fill(tool) : tool === "all" ? TOOLS : [tool];
  return names.map((name, index) => {
    const args = structuredClone(base[name]);
    if (batch) {
      if (name === "read") args.path = ["src/目标说明.ts", "src/config.ts", "src/helpers.ts"][index];
      if (name === "edit") args.path = ["src/config.ts", "src/cache.ts", "src/ui.ts"][index];
      if (name === "write") args.path = ["docs/result.md", "docs/checks.md", "docs/summary.md"][index];
      if (name === "bash") args.command = ["pnpm test status.test.ts", "pnpm run typecheck", "pnpm run build"][index];
    }
    const finalOutcome = outcome === "mixed" ? (batch ? ["success", "error", "interrupted"] : ["success", "success", "error", "interrupted"])[index] : outcome;
    const seed = name === "read" ? `// Isolated read fixture\nexport const status = 'running';\nexport const marker = '${STATUS_GLYPH}';\n`
      : name === "edit" ? "export const config = {\n  retries: 2,\n};\n"
      : name === "write" ? "# Fixture result\n\nPrevious content.\n" : undefined;
    const updates = name === "bash" ? [
      { at: 600, text: "Collecting fixture tests…" },
      { at: 1400, text: "✓ status.test.ts (2/4 tests)\nTest Files  1 running\nTests       2 passed" },
    ] : [];
    return { tool: name, args, seed, outcome: finalOutcome,
      script: animate ? { durationMs: 2200 + index * 800, updates } : undefined };
  });
}
