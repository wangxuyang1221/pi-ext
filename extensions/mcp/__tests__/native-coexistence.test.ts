import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);

describe("Native MCP coexistence on the installed Pi host", () => {
  it("keeps restored deferred tools executable through resume and reload", async () => {
    const { stdout } = await execute(process.execPath, [
      "extensions/mcp/__tests__/fixtures/verification/native-coexistence.mjs",
    ], { timeout: 25_000, maxBuffer: 1024 * 1024 });
    const proof = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(proof.passed).toBe(true);
    expect(proof.cases.map((row: { kind: string }) => row.kind)).toEqual(["success", "error", "unfinished"]);
    for (const row of proof.cases) {
      expect(row).toMatchObject({ resume: true, reload: true, connections: 2, calls: 2 });
    }
    expect(proof.cleanup).toEqual({ scratchRemoved: true, openTransports: 0, pendingTimers: 0 });
  }, 30_000);
});
