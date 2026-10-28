import { spawnSync } from "node:child_process";
import { checkRepository } from "./check-repository.mjs";
import { readSnapshot, repositoryRoot } from "./repository-snapshot.mjs";
import { reportSecrets, scanSecrets } from "./secret-scan.mjs";
import { snapshotIgnores } from "./repository-ignores.mjs";

const forbiddenDirectory = /(?:^|\/)(?:node_modules|dist|build|target|coverage|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.cache|\.pnpm-store|\.tmp|\.scratch|handoff|prototypes)(?:\/|$)/;
const forbiddenFile = /(?:^|\/)(?:\.env(?:\..+)?|\.DS_Store|DECISIONS\.md|[^/]+\.(?:tsbuildinfo|pyc|pyo|pyd|log|tgz))$/;

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--base" || args[1].startsWith("-"))) {
    throw new Error("Usage: check-commit.mjs [--base <commit>]");
  }
  const root = repositoryRoot();
  const snapshot = readSnapshot(root, true);
  const isIgnored = snapshotIgnores(snapshot.files);
  const failures = [];
  for (const [path, entry] of snapshot.files) {
    if (isIgnored(path) || forbiddenDirectory.test(path) || (forbiddenFile.test(path) && !/(?:^|\/)\.env\.example$/.test(path)) ||
      path.startsWith(".pi/") || /^adventure\/evidence\/.*\.(?:json|jsonl|ansi)$/.test(path)) {
      failures.push(`${JSON.stringify(path)}: local configuration or generated artifact is not allowed.`);
    }
    if (entry.mode !== "120000" && !entry.content.includes(0)) {
      const lines = entry.content.toString("utf8").split("\n");
      lines.forEach((line, index) => {
        if (/^(?:<{7}(?: |$)|={7}\r?$|>{7}(?: |$)|\|{7}(?: |$))/.test(line)) {
          failures.push(`${JSON.stringify(path)}:${index + 1}: unresolved conflict marker.`);
        }
      });
    }
  }
  // Do not print diff --check output: it can contain secret-bearing source lines.
  const whitespace = spawnSync("git", ["diff", "--cached", "--check", ...(args.length ? [args[1]] : []), "--"], {
    cwd: root, stdio: "pipe",
  });
  if (whitespace.status !== 0) failures.push("Staged diff has whitespace errors or cannot be checked.");
  let findings;
  try { findings = await scanSecrets(snapshot.files); }
  catch { throw new Error("Secret scanner failed; check dependencies and exception configuration."); }
  reportSecrets(findings);
  if (findings.length) failures.push(`Secret scan rejected ${findings.length} finding(s); values are redacted.`);
  if (failures.length) throw new Error(failures.join("\n"));
  const documents = checkRepository(snapshot.files);
  snapshot.assertUnchanged();
  console.log(`Commit gate passed: ${snapshot.files.size} index files, ${documents} documents. Working files and index were not modified.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
