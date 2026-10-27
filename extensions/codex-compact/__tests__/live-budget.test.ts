import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { expect, test, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { budgetFetch } from "../../../scripts/pi14-live-budget.mjs";

test("keeps the network guard installed after real CLI dispatcher setup", async () => {
  const root = await mkdtemp(resolve(".tmp/pi14-budget-"));
  const path = join(root, "state.json");
  await writeFile(path, JSON.stringify({ deadline: Date.now() + 10_000, maxRequests: 1, maxCompactions: 1,
    requests: 0, compactions: 0, auxiliary: 0, allowedOrigins: [], localOrigins: [] }));
  const script = `const { setupCli } = await import(new URL("./cli/setup.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
    setupCli();
    try { await fetch("data:text/plain,fixture"); console.log("bypassed"); } catch { console.log("blocked"); }
    console.log(typeof WebSocket);`;
  try {
    const result = await promisify(execFile)(process.execPath, ["--import", resolve("scripts/pi14-live-network.mjs"), "--input-type=module", "-e", script],
      { env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, PI_CODING_AGENT_DIR: root, PI14_LIVE_STATE: path } });
    expect(result.stdout.trim().split("\n")).toEqual(["blocked", "undefined"]);
    expect(JSON.parse(await readFile(path, "utf8")).requests).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("records remote compaction usage without consuming or logging checkpoint content", async () => {
  const root = await mkdtemp(resolve(".tmp/pi14-budget-"));
  const path = join(root, "state.json");
  await writeFile(path, JSON.stringify({ deadline: Date.now() + 10_000, maxRequests: 1, maxCompactions: 1,
    requests: 0, compactions: 0, auxiliary: 0, allowedOrigins: ["https://example.com"], localOrigins: [] }));
  const usage = { input_tokens: 12, output_tokens: 3, total_tokens: 15 };
  const body = `data: ${JSON.stringify({ type: "response.completed", response: { usage, output: [{ encrypted_content: "private-checkpoint" }] } })}\n\n`;
  try {
    const response = await budgetFetch(path, async () => new Response(body))("https://example.com/responses", {
      method: "POST", body: JSON.stringify({ input: [{ type: "compaction_trigger" }] }) });
    expect(await response.text()).toBe(body);
    await vi.waitFor(async () => {
      const log = await readFile(`${path}.events.jsonl`, "utf8");
      expect(log).not.toContain("private-checkpoint");
      expect(log.trim().split("\n").map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ kind: "compaction-usage", usage }));
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("counts retries and compression requests before dispatch and rejects excess calls", async () => {
  const root = await mkdtemp(resolve(".tmp/pi14-budget-"));
  const path = join(root, "state.json");
  await writeFile(path, JSON.stringify({ deadline: Date.now() + 10_000, maxRequests: 3, maxCompactions: 1,
    requests: 0, compactions: 0, auxiliary: 0, allowedOrigins: ["https://example.com"], localOrigins: [] }));
  const transport = vi.fn(async () => new Response("failed", { status: 503 }));
  const request = budgetFetch(path, transport);
  try {
    await request("https://example.com/responses", { method: "POST", body: JSON.stringify({ input: [{ type: "compaction_trigger" }] }) });
    await expect(request("https://example.com/responses", { method: "POST", body: JSON.stringify({ input: [{ type: "compaction_trigger" }] }) })).rejects.toThrow(/budget/i);
    await request("https://example.com/responses", { method: "POST" });
    await request("https://example.com/responses", { method: "POST" });
    await expect(request("https://example.com/responses", { method: "POST" })).rejects.toThrow(/budget/i);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ requests: 3, compactions: 1 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("shares the request limit across processes", async () => {
  const root = await mkdtemp(resolve(".tmp/pi14-budget-"));
  const path = join(root, "state.json");
  await writeFile(path, JSON.stringify({ deadline: Date.now() + 10_000, maxRequests: 3, maxCompactions: 1,
    requests: 0, compactions: 0, auxiliary: 0, allowedOrigins: ["https://example.com"], localOrigins: [] }));
  const script = `import { budgetFetch } from ${JSON.stringify(new URL("../../../scripts/pi14-live-budget.mjs", import.meta.url).href)};
    try { await budgetFetch(process.argv[1], async () => new Response())("https://example.com/responses"); console.log("sent"); }
    catch { console.log("blocked"); }`;
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, path])));
    expect(results.filter(result => result.stdout.trim() === "sent")).toHaveLength(3);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ requests: 3 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("aborts an in-flight last allowed request at the deadline and rejects new requests", async () => {
  const root = await mkdtemp(resolve(".tmp/pi14-budget-"));
  const path = join(root, "state.json");
  await writeFile(path, JSON.stringify({ deadline: Date.now() + 100, maxRequests: 1, maxCompactions: 1,
    requests: 0, compactions: 0, auxiliary: 0, allowedOrigins: ["https://example.com"], localOrigins: [] }));
  const transport = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
    if (init.signal.aborted) reject(init.signal.reason);
    else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }));
  const request = budgetFetch(path, transport);
  try {
    await expect(request("https://example.com/responses")).rejects.toThrow();
    await expect(request("https://example.com/responses")).rejects.toThrow(/deadline/);
    expect(transport).toHaveBeenCalledTimes(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
