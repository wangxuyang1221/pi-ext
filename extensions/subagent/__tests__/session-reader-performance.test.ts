import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "vitest";
import { readSessionView } from "../src/session-reader.js";

test("measures a single turn with twenty 64 KiB assistant messages", async () => {
  const root = await mkdtemp(join(process.cwd(), ".subagent-perf-"));
  const sessionFile = join(root, "large.jsonl");
  try {
    const entries: object[] = [
      { type: "session", version: 3, id: "agent-a" },
      { type: "message", id: "u", parentId: null, timestamp: "2026-09-09T00:00:00.000Z", message: { role: "user", content: "Work" } },
    ];
    for (let index = 0; index < 20; index++) entries.push({ type: "message", id: `a${index}`,
      parentId: index === 0 ? "u" : `a${index - 1}`, timestamp: "2026-09-09T00:00:00.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "A".repeat(64 * 1024) }], stopReason: "stop" } });
    await writeFile(sessionFile, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const measurements = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      const result = await readSessionView({ sessionFile, agentId: "agent-a", epoch: "epoch-a", view: "turns", limit: 1 });
      assert.equal(result.view, "turns");
      const bytes = Buffer.byteLength(JSON.stringify(result));
      assert.ok(bytes <= 72 * 1024);
      measurements.push({ milliseconds: +(performance.now() - start).toFixed(3), bytes, maxRssKiB: process.resourceUsage().maxRSS });
    }
    const pagination = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      let pageCursor: string | undefined;
      let pages = 0, bytes = 0;
      const ids: string[] = [];
      do {
        const result = await readSessionView({ sessionFile, agentId: "agent-a", epoch: "epoch-a", view: "turns", limit: 1, pageCursor });
        assert.equal(result.view, "turns");
        const size = Buffer.byteLength(JSON.stringify(result));
        assert.ok(size <= 72 * 1024);
        bytes += size;
        pages++;
        ids.push(...result.turns.flatMap(turn => turn.activity.map(item => item.id)));
        pageCursor = result.nextPageCursor;
        assert.ok(pages <= 20);
      } while (pageCursor);
      assert.deepEqual(ids, Array.from({ length: 20 }, (_, index) => `a${index}`));
      pagination.push({ milliseconds: +(performance.now() - start).toFixed(3), bytes, pages, maxRssKiB: process.resourceUsage().maxRSS });
    }
    if (process.env.PI_SUBAGENT_BENCHMARK === "1") console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, measurements, pagination }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
