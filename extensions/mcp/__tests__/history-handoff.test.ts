import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryHandoff } from "../src/history-handoff.js";

let dir: string;
beforeEach(() => { mkdirSync(".tmp", { recursive: true }); dir = mkdtempSync(join(process.cwd(), ".tmp/handoff-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const identities = [{ fullName: "mcp__offline__query", serverName: "offline", toolName: "query" }];

describe("history handoff", () => {
  it("rejects old versions, pre-boot payloads, extra fields, and corrupt data, then consumes the bad file", () => {
    const handoff = new HistoryHandoff(dir, "123-boot-a");
    for (const payload of [
      { version: 0, createdAt: Date.now(), identities },
      { version: 1, createdAt: 0, identities },
      { version: 1, createdAt: Date.now(), identities: [{ ...identities[0], schema: { secret: true } }] },
      { version: 1, createdAt: Date.now(), identities: [{ fullName: "bash" }] },
      { version: 1, createdAt: Date.now(), identities: [{ ...identities[0], serverName: "wrong" }] },
      "broken",
    ]) {
      handoff.publish(identities);
      writeFileSync(handoff.path, typeof payload === "string" ? payload : JSON.stringify(payload));
      expect(() => handoff.consume()).toThrow();
      expect(existsSync(handoff.path)).toBe(false);
    }
  });

  it("isolates process boots and rejects unsafe directories and symlinks", () => {
    const first = new HistoryHandoff(dir, "123-boot-a");
    first.publish(identities);
    expect(new HistoryHandoff(dir, "123-boot-b").consume()).toEqual([]);
    expect(new HistoryHandoff(dir, "124-boot-a").consume()).toEqual([]);
    chmodSync(first.path, 0o644);
    expect(() => first.consume()).toThrow();
    first.publish(identities);
    const other = join(dir, "other.json");
    writeFileSync(other, "untouched");
    rmSync(first.path);
    symlinkSync(other, first.path);
    expect(() => first.consume()).toThrow();
    expect(readFileSync(other, "utf8")).toBe("untouched");
    rmSync(join(dir, "mcp-history"), { recursive: true });
    symlinkSync(dir, join(dir, "mcp-history"));
    expect(() => first.publish(identities)).toThrow();
    expect(readdirSync(dir).sort()).toEqual(["mcp-history", "other.json"]);
  });

  it("does not persist execution metadata or retain an old handoff after publish failure", () => {
    const handoff = new HistoryHandoff(dir, "123-boot-a");
    handoff.publish(identities);
    expect(() => handoff.publish([{ ...identities[0], parameters: { token: "secret" } } as any])).toThrow();
    expect(existsSync(handoff.path)).toBe(false);
    expect(() => handoff.publish(Array.from({ length: 4097 }, (_, i) => ({ fullName: `mcp__x__${i}` })))).toThrow();
    expect(readdirSync(join(dir, "mcp-history"))).toEqual([]);
  });

  it("keeps a pending handoff through long trust prompts and does not prune a live process", () => {
    const handoff = new HistoryHandoff(dir);
    handoff.publish(identities);
    const other = new HistoryHandoff(dir, "999999-other-boot");
    const before = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(before + 3_600_000);
    try {
      expect(other.consume()).toEqual([]);
      expect(existsSync(handoff.path)).toBe(true);
      expect(handoff.consume()).toEqual(identities);
    } finally { clock.mockRestore(); }
  });

  it("removes expired interrupted writes without touching fresh files from another process", () => {
    const handoff = new HistoryHandoff(dir, "123-boot-a");
    handoff.publish(identities);
    const root = join(dir, "mcp-history");
    const stale = join(root, "456-abcdef.json.tmp-interrupted");
    const fresh = join(root, "789-abcdef.json");
    writeFileSync(stale, "partial", { mode: 0o600 });
    utimesSync(stale, new Date(0), new Date(0));
    writeFileSync(fresh, "other process", { mode: 0o600 });
    const kill = process.kill;
    const probe = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === 456 && signal === 0) throw Object.assign(new Error("Fixture process exited"), { code: "ESRCH" });
      return kill(pid, signal);
    });
    try {
      handoff.consume();
      expect(existsSync(stale)).toBe(false);
      expect(readFileSync(fresh, "utf8")).toBe("other process");
    } finally { probe.mockRestore(); }
  });

  it("passes display-only identities once between instances of the same process boot", () => {
    const old = new HistoryHandoff(dir, "123-boot-a");
    expect(old.consume()).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
    old.publish(identities);
    const text = readFileSync(old.path, "utf8");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["createdAt", "identities", "version"]);
    expect(new HistoryHandoff(dir, "123-boot-a").consume()).toEqual(identities);
    expect(existsSync(old.path)).toBe(false);
    expect(old.consume()).toEqual([]);
  });
});
