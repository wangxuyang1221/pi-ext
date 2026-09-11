import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectHistoryIdentities, MAX_HISTORY_FILE_BYTES, readBoundedFile, readHistoryIdentities } from "../src/history.js";

const call = (name: string) => ({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name, arguments: { secret: "never persist" } }] } });
const result = (name: string, server: string, tool: string) => ({ type: "message", message: { role: "toolResult", toolName: name, isError: true, details: { mcp: true, server, tool } } });

describe("history identities", () => {
  it("reads legacy JSONL without rewriting bytes and reports corrupt lines", () => {
    mkdirSync(".tmp", { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), ".tmp/history-"));
    const path = join(dir, "session.jsonl");
    try {
      const data = JSON.stringify({ type: "session", version: 1 }) + "\n" + JSON.stringify(call("mcp__old__query"));
      writeFileSync(path, data);
      expect(readHistoryIdentities(path)).toEqual([{ fullName: "mcp__old__query", serverName: "old", toolName: "query" }]);
      expect(readFileSync(path, "utf8")).toBe(data);
      writeFileSync(path, data + "\n{broken");
      expect(() => readHistoryIdentities(path)).toThrow();
      expect(readFileSync(path, "utf8")).toBe(data + "\n{broken");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("bounds file reads before allocation and rejects session symlinks without changing their target", () => {
    mkdirSync(".tmp", { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), ".tmp/history-"));
    try {
      const path = join(dir, "session");
      writeFileSync(path, "x".repeat(32));
      expect(readBoundedFile(path, 32)).toHaveLength(32);
      expect(() => readBoundedFile(path, 31)).toThrow();
      symlinkSync(path, join(dir, "link"));
      expect(() => readHistoryIdentities(join(dir, "link"))).toThrow();
      expect(readFileSync(path, "utf8")).toBe("x".repeat(32));
      truncateSync(path, MAX_HISTORY_FILE_BYTES + 1);
      expect(() => readHistoryIdentities(path)).toThrow("oversized");
      expect(collectHistoryIdentities([call(`mcp__x__${"a".repeat(1016)}`)])[0].fullName).toHaveLength(1024);
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
