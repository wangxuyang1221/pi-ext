import assert from "node:assert/strict";
import { test } from "node:test";
import { NATIVE_FIXTURES, wrapNativeTool } from "./native-fixtures.mjs";

const workspace = "/isolated-fixture-workspace";
for (const name of ["read", "edit", "write"]) {
  test(`delegates only the fixed ${name} call to the real tool`, async () => {
    const args = structuredClone(NATIVE_FIXTURES[name].args);
    let calls = 0;
    const original = { name, execute: async (id, received, _signal, _update, ctx) => {
      calls++;
      assert.equal(id, "allowed");
      assert.deepEqual(received, args);
      assert.equal(ctx.cwd, workspace);
      return { content: [{ type: "text", text: "Real file result" }], details: {} };
    } };
    const tool = wrapNativeTool(original, { workspace, plans: new Map([["allowed", name]]), delayMs: 0 });
    const run = (id, input, cwd = workspace) => tool.execute(id, input, undefined, undefined, { cwd });
    assert.equal((await run("allowed", args)).content[0].text, "Real file result");
    await assert.rejects(run("unexpected", args));
    await assert.rejects(run("allowed", { ...args, path: "../outside.txt" }));
    await assert.rejects(run("allowed", args, "/other-workspace"));
    assert.equal(calls, 1, "Rejected calls must never reach the real tool");
  });
}

test("bash returns a fixture without invoking the real shell tool", async () => {
  let calls = 0;
  const tool = wrapNativeTool({ name: "bash", execute: async () => { calls++; throw new Error("Shell must not run"); } },
    { workspace, plans: new Map([["allowed", "bash"]]), delayMs: 0 });
  const result = await tool.execute("allowed", NATIVE_FIXTURES.bash.args, undefined, undefined, { cwd: workspace });
  assert.match(result.content[0].text, /Type check passed/);
  assert.equal(calls, 0);
});
