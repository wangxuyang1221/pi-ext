import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";

export const NATIVE_FIXTURES = {
  read: { args: { path: "src/sample.ts" }, seed: "export const status = 'ready';\nexport const source = 'offline fixture';\n" },
  bash: { args: { command: "pnpm run typecheck" } },
  edit: { args: { path: "src/config.ts", edits: [{ oldText: "retries: 2", newText: "retries: 3" }] }, seed: "export const config = {\n  retries: 2,\n};\n" },
  write: { args: { path: "docs/result.md", content: "# Icon comparison\n\nCompare MCP with file and shell tools.\n" }, seed: "# Icon comparison\n\nPrevious fixture content.\n" },
};

export async function seedNativeFixtures(workspace) {
  for (const fixture of Object.values(NATIVE_FIXTURES)) {
    if (fixture.seed === undefined) continue;
    const path = join(workspace, fixture.args.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, fixture.seed);
  }
}

export function wrapNativeTool(tool, { plans, workspace, delayMs = 1000 }) {
  return { ...tool, executionMode: "parallel", async execute(id, args, signal, onUpdate, ctx) {
    assert.equal(plans.get(id), tool.name, "Only scripted fixture calls may execute");
    assert.ok(Object.hasOwn(NATIVE_FIXTURES, tool.name), "Only supported fixture tools may execute");
    assert.deepEqual(args, NATIVE_FIXTURES[tool.name].args);
    assert.equal(ctx.cwd, workspace);
    await delay(delayMs, undefined, { signal });
    if (tool.name === "bash") {
      return { content: [{ type: "text", text: "Type check passed (offline fixture; no shell executed)." }], details: {} };
    }
    return tool.execute(id, args, signal, onUpdate, ctx);
  } };
}
