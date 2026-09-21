import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { createJiti } = require(createRequire(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))).resolve("jiti"));
const jiti = createJiti(import.meta.url);
const { initTheme } = await jiti.import("@earendil-works/pi-coding-agent");
const { lifecycleFixture, cleanup } = await jiti.import("./lifecycle-fixture.ts");
assert.equal(typeof global.gc, "function"); initTheme("dark", false);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function collect() { for (let i = 0; i < 5; i++) { await tick(); global.gc(); } return process.memoryUsage(); }
const results = [];
try {
  for (const codex of [undefined, "before", "after"]) {
    const h = await lifecycleFixture({ codex }), paste = "p".repeat(32768);
    const references = [];
    for (let i = 0; i < 3; i++) {
      h.mode.editor.setText(""); h.mode.editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
      h.mode.editor.insertTextAtCursor(" $alpha"); h.mode.editor.handleInput("\x7f");
      references.push(new WeakRef(h.mode.editor));
      await h.reload(); h.forgetRetiredEditors();
      assert.equal(h.mode.editor.getExpandedText(), paste + " ");
      assert.match(h.mode.editor.getText(), /^\[paste #1 32768 chars\] $/);
      const memory = await collect();
      assert(references.every(reference => reference.deref() === undefined), "Retired real-host editors must be collectable after reload");
      results.push({ host: codex ?? "native", reload: i + 1, released: references.length, memory });
    }
  }
} finally { await cleanup(); }
console.log(JSON.stringify({ node: process.version, pid: process.pid, results, cleanup: "SDK runtimes disposed; fixture directories removed; no listener started" }, null, 2));
