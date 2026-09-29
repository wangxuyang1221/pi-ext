import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as promises from "node:fs/promises";
import { collectHistoryIdentities, HISTORY_READ_CHUNK_BYTES, MAX_HISTORY_RECORD_BYTES, readBoundedFile, readHistoryIdentities } from "../src/history.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

const call = (name: string) => ({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name, arguments: { secret: "never persist" } }] } });
const result = (name: string, server: string, tool: string) => ({ type: "message", message: { role: "toolResult", toolName: name, isError: true, details: { mcp: true, server, tool } } });

describe("history identities", () => {
  it("reads a session larger than 64 MiB incrementally and keeps cross-record identity conflicts", async () => {
    mkdirSync(".tmp", { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), ".tmp/history-large-"));
    const path = join(dir, "session.jsonl");
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    try {
      writeFileSync(path, JSON.stringify(result("mcp__a__b__c", "a__b", "c")) + "\n");
      const image = JSON.stringify({ type: "message", message: { role: "toolResult", toolName: "mcp__old__query", content: [{ type: "image", data: "A".repeat(1024 * 1024), mimeType: "image/png" }] } }) + "\n";
      for (let i = 0; i < 65; i++) appendFileSync(path, image);
      appendFileSync(path, JSON.stringify(result("mcp__a__b__c", "a", "b__c")) + "\n" + JSON.stringify(result("mcp__a__b__c", "a__b", "c")));
      expect(await readHistoryIdentities(path)).toEqual([
        { fullName: "mcp__a__b__c" },
        { fullName: "mcp__old__query", serverName: "old", toolName: "query" },
      ]);
      expect(ticks).toBeGreaterThan(1);
    } finally { clearInterval(timer); rmSync(dir, { recursive: true, force: true }); }
  });
  it("reads legacy JSONL without rewriting bytes and reports corrupt lines", async () => {
    mkdirSync(".tmp", { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), ".tmp/history-"));
    const path = join(dir, "session.jsonl");
    try {
      const data = JSON.stringify({ type: "session", version: 1 }) + "\n" + JSON.stringify(call("mcp__old__query"));
      writeFileSync(path, data);
      expect(await readHistoryIdentities(path)).toEqual([{ fullName: "mcp__old__query", serverName: "old", toolName: "query" }]);
      expect(readFileSync(path, "utf8")).toBe(data);
      writeFileSync(path, data + "\n{broken");
      await expect(readHistoryIdentities(path)).rejects.toThrow();
      expect(readFileSync(path, "utf8")).toBe(data + "\n{broken");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("bounds records and handoff reads and rejects session symlinks without changing their target", async () => {
    mkdirSync(".tmp", { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), ".tmp/history-"));
    try {
      const path = join(dir, "session");
      writeFileSync(path, "x".repeat(32));
      expect(readBoundedFile(path, 32)).toHaveLength(32);
      expect(() => readBoundedFile(path, 31)).toThrow();
      symlinkSync(path, join(dir, "link"));
      await expect(readHistoryIdentities(join(dir, "link"))).rejects.toThrow();
      expect(readFileSync(path, "utf8")).toBe("x".repeat(32));
      truncateSync(path, MAX_HISTORY_RECORD_BYTES + 1);
      await expect(readHistoryIdentities(path)).rejects.toThrow("Oversized");
      expect(collectHistoryIdentities([call(`mcp__x__${"a".repeat(1016)}`)])[0].fullName).toHaveLength(1024);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each(["grow", "shrink", "rewrite", "read-error"])("rejects %s during a bounded scan and closes the file", async change => {
    mkdirSync(".tmp", { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), ".tmp/history-change-"));
    const path = join(dir, "session");
    const data = JSON.stringify({ ...call("mcp__x__read"), padding: "x".repeat(HISTORY_READ_CHUNK_BYTES * 2) }) + "\n";
    writeFileSync(path, data);
    const fd = await promises.open(path, "r");
    const realRead = fd.read.bind(fd);
    const lengths: number[] = [];
    const closed = vi.spyOn(fd, "close");
    vi.spyOn(promises, "open").mockResolvedValueOnce(fd);
    vi.spyOn(fd, "read").mockImplementation((async (...args: any[]) => {
      lengths.push(args[2]);
      const result = await (realRead as any)(...args);
      if (lengths.length === 1) {
        if (change === "grow") appendFileSync(path, "{}\n");
        if (change === "shrink") truncateSync(path, 0);
        if (change === "rewrite") { await new Promise(resolve => setTimeout(resolve, 10)); writeFileSync(path, data); }
        if (change === "read-error") throw new Error("Injected read failure");
      }
      return result;
    }) as any);
    try {
      await expect(readHistoryIdentities(path)).rejects.toThrow();
      expect(lengths.every(length => length <= HISTORY_READ_CHUNK_BYTES)).toBe(true);
      expect(closed).toHaveBeenCalledOnce();
    } finally { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("decodes UTF-8 across chunk boundaries, ignores blank lines and rejects non-object JSON", async () => {
    mkdirSync(".tmp", { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), ".tmp/history-unicode-"));
    const path = join(dir, "session");
    try {
      const prefix = '{"padding":"';
      const padding = "x".repeat(HISTORY_READ_CHUNK_BYTES - Buffer.byteLength(prefix) - 1);
      writeFileSync(path, prefix + padding + '中文🙂","type":"message","message":{"role":"toolResult","toolName":"mcp__中文__查询"}}\r\n\n  \n');
      expect(await readHistoryIdentities(path)).toEqual([{ fullName: "mcp__中文__查询", serverName: "中文", toolName: "查询" }]);
      for (const value of ["null", "[]", "42", "{broken"]) {
        writeFileSync(path, value);
        await expect(readHistoryIdentities(path)).rejects.toThrow("Malformed");
      }
      await expect(readHistoryIdentities(dir)).rejects.toThrow("Unsafe");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("keeps delimiter-heavy names as generic identities instead of dropping them", () => {
    expect(collectHistoryIdentities([call("mcp__server____tool"), call("mcp____server__tool")])).toEqual([
      { fullName: "mcp__server____tool" }, { fullName: "mcp____server__tool" },
    ]);
  });

  it("rejects unsafe names and bounded identity overflows without truncating names", () => {
    for (const name of ["mcp__x__bad\u001b[2J", `mcp__x__${"a".repeat(1024)}`, "mcp__x__bad\nname"]) {
      expect(() => collectHistoryIdentities([call(name)])).toThrow();
    }
    expect(() => collectHistoryIdentities(Array.from({ length: 4097 }, (_, i) => call(`mcp__x__t${i}`)))).toThrow();
  });

  it("ignores empty or mismatched result identities", () => {
    expect(collectHistoryIdentities([
      result("mcp____server__tool", "", "server__tool"),
      result("mcp__a__b__c", "different", "tool"),
    ])).toEqual([{ fullName: "mcp____server__tool" }, { fullName: "mcp__a__b__c" }]);
  });

  it("falls back to the full name when branches disagree about the separator", () => {
    expect(collectHistoryIdentities([
      result("mcp__a__b__c", "a__b", "c"), result("mcp__a__b__c", "a", "b__c"),
      result("mcp__a__b__c", "a__b", "c"),
    ])).toEqual([{ fullName: "mcp__a__b__c" }]);
  });

  it("collects all branches and confirms ambiguous identities only from matching details", () => {
    expect(collectHistoryIdentities([
      { ...call("mcp__alpha__query"), id: "a", parentId: null },
      { ...call("mcp__team__east__query"), id: "b", parentId: null },
      result("mcp__team__east__query", "team__east", "query"),
      call("mcp__missing__details__query"), call("bash"),
      { type: "compaction", firstKeptEntryId: "a" },
    ])).toEqual([
      { fullName: "mcp__alpha__query", serverName: "alpha", toolName: "query" },
      { fullName: "mcp__team__east__query", serverName: "team__east", toolName: "query" },
      { fullName: "mcp__missing__details__query" },
    ]);
  });
});
