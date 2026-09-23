import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageDirectory = process.argv[2];
assert.ok(packageDirectory, "Pass the installed pi-coding-agent package directory.");
const packageRoot = resolve(packageDirectory);
const version = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version;
assert.equal(version, "0.87.0", "This probe targets Pi 0.87.0.");
const { SessionManager } = await import(pathToFileURL(join(packageRoot, "dist/core/session-manager.js")).href);
const temporaryRoot = resolve(".scratch");
mkdirSync(temporaryRoot, { recursive: true });
const directory = mkdtempSync(join(temporaryRoot, "fast-session-probe-"));
try {
  const ordinary = SessionManager.create(directory, join(directory, "ordinary"));
  ordinary.appendCustomEntry("fast-state-probe", { enabled: true });
  assert.equal(existsSync(ordinary.getSessionFile()), false, "A new ordinary session defers its first custom entry.");

  const sessionDirectory = join(directory, "managed");
  mkdirSync(sessionDirectory);
  const sessionFile = join(sessionDirectory, "session.jsonl");
  writeFileSync(sessionFile, "", { flag: "wx", mode: 0o600 });
  const managed = SessionManager.open(sessionFile, sessionDirectory, directory);
  managed.appendCustomEntry("fast-state-probe", { enabled: true });
  managed.appendCustomEntry("fast-state-probe", { enabled: false });
  const saved = readFileSync(sessionFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(saved.some(entry => entry.type === "message"), false, "No model messages were needed for persistence.");
  assert.deepEqual(saved.filter(entry => entry.type === "custom").map(entry => entry.data.enabled), [true, false]);

  const reopened = SessionManager.open(sessionFile, sessionDirectory, directory);
  const latest = reopened.getEntries().filter(entry => entry.type === "custom" && entry.customType === "fast-state-probe").at(-1);
  assert.equal(latest.data.enabled, false, "Reopening preserves an explicit false before any assistant response.");
  assert.equal(reopened.buildSessionContext().messages.length, 0, "Custom state is absent from model message context.");
  console.log(JSON.stringify({
    version,
    ordinarySessionDefersFirstWrite: true,
    precreatedSessionPersistsBeforeAssistant: true,
    reopenedLatestEnabled: latest.data.enabled,
    modelMessages: reopened.buildSessionContext().messages.length,
  }, null, 2));
} finally {
  rmSync(directory, { recursive: true, force: true });
  assert.equal(existsSync(directory), false, "Probe files must be removed.");
}
